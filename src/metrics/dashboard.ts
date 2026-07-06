import type { Pool } from "pg";

// Query layer for the ops dashboard's remaining widgets (T-59): open tickets,
// SLA attainment, deflection/auto-resolve rate, pipeline stage counts, ticket
// queue, and platform incidents. Lives alongside agentCost.ts / evalHealth.ts
// on purpose — ALL dashboard SQL is centralized in src/metrics/ so T-60's
// RLS/tenant-scoping audit has one place to look, not queries scattered
// across web/ components. web/ imports these functions directly; it must
// never hold its own copy of this SQL.
//
// Every query is tenant/project-scoped via the same transaction-local RLS GUC
// pattern used everywhere else (ticket-triage.ts, sla-monitor.ts, agentCost.ts):
// the caller supplies the tenant/project it is authorized to see, and RLS
// enforces no row outside that scope comes back even if a query has a bug.

// ---------------------------------------------------------------------------
// Shared SLA-target-minutes SQL fragment (must stay in exact lockstep with
// sla-monitor.ts's findAndLogBreaches CTE — same premium/standard CASE. If
// you change one, change both; T-60 should verify they still match.)
// ---------------------------------------------------------------------------
const SLA_TARGET_MINUTES_SQL = `
  CASE tn.sla_tier
    WHEN 'premium' THEN
      CASE t.urgency
        WHEN 'critical' THEN 30
        WHEN 'high'     THEN 60
        WHEN 'normal'   THEN 240
        ELSE                 480
      END
    ELSE
      COALESCE((tn.sla_config->>'response_target_minutes')::int, 240)
  END
`;

const OPEN_STATES_SQL = `t.state NOT IN ('resolved', 'closed', 'wont_fix', 'duplicate')`;

async function withTenantScope<T>(
  pool: Pool,
  projectId: string,
  tenantId: string,
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_project', $1, true)", [projectId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Project/tenant label (topbar) — deliberately a live lookup, not a
// hardcoded "TTS"/"DNC" string, per CLAUDE.md's app-agnostic standing
// constraint: nothing in this dashboard should assume a specific project.
// ---------------------------------------------------------------------------
export type ScopeLabel = { projectName: string; tenantName: string };

type ScopeLabelRow = { project_name: string; tenant_name: string };

export async function getScopeLabel(
  pool: Pool,
  projectId: string,
  tenantId: string
): Promise<ScopeLabel> {
  return withTenantScope(pool, projectId, tenantId, async (client) => {
    const { rows } = await client.query<ScopeLabelRow>(
      `SELECT p.name AS project_name, tn.name AS tenant_name
         FROM projects p
         JOIN tenants tn ON tn.project_id = p.id
        WHERE p.id = $1 AND tn.id = $2`,
      [projectId, tenantId]
    );
    return {
      projectName: rows[0]?.project_name ?? "(unknown project)",
      tenantName: rows[0]?.tenant_name ?? "(unknown tenant)",
    };
  });
}

// ---------------------------------------------------------------------------
// Open tickets (charter pillar #2)
// ---------------------------------------------------------------------------
export type OpenTicketCounts = {
  total: number;
  critical: number;
  high: number;
  normal: number;
  low: number;
  untriaged: number; // urgency IS NULL — not yet classified
};

type UrgencyCountRow = { urgency: string | null; count: string };

export async function getOpenTicketCounts(
  pool: Pool,
  projectId: string,
  tenantId: string
): Promise<OpenTicketCounts> {
  return withTenantScope(pool, projectId, tenantId, async (client) => {
    const { rows } = await client.query<UrgencyCountRow>(
      `SELECT urgency, count(*)::text AS count
         FROM tickets t
        WHERE t.project_id = $1 AND t.tenant_id = $2 AND ${OPEN_STATES_SQL}
        GROUP BY urgency`,
      [projectId, tenantId]
    );
    const counts: OpenTicketCounts = {
      total: 0,
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
      untriaged: 0,
    };
    for (const r of rows) {
      const n = Number(r.count);
      counts.total += n;
      if (r.urgency === "critical") counts.critical = n;
      else if (r.urgency === "high") counts.high = n;
      else if (r.urgency === "normal") counts.normal = n;
      else if (r.urgency === "low") counts.low = n;
      else counts.untriaged = n;
    }
    return counts;
  });
}

// ---------------------------------------------------------------------------
// SLA attainment (charter pillar #1)
// ---------------------------------------------------------------------------
export type SlaAttainment = {
  windowDays: number;
  consideredCount: number; // tickets that reached a response in the window
  metCount: number; // of those, how many were within their target
  attainmentPct: number | null; // null if consideredCount === 0 (no data, not 100%/0%)
  openAtRiskCount: number; // currently open, past 80% of target but not yet breached
  openBreachedCount: number; // currently open, past target
};

type AttainmentRow = { met: string; considered: string };
type RiskRow = { at_risk: string; breached: string };

export async function getSlaAttainment(
  pool: Pool,
  projectId: string,
  tenantId: string,
  windowDays = 30
): Promise<SlaAttainment> {
  return withTenantScope(pool, projectId, tenantId, async (client) => {
    const { rows: attRows } = await client.query<AttainmentRow>(
      `SELECT
         count(*) FILTER (
           WHERE EXTRACT(EPOCH FROM (t.updated_at - t.created_at)) / 60 <= (${SLA_TARGET_MINUTES_SQL})
         )::text AS met,
         count(*)::text AS considered
       FROM tickets t
       JOIN tenants tn ON tn.id = t.tenant_id
       WHERE t.project_id = $1
         AND t.tenant_id = $2
         AND t.state IN ('responded', 'resolved', 'closed')
         AND t.created_at >= now() - ($3 || ' days')::interval`,
      [projectId, tenantId, windowDays]
    );

    // IMPORTANT: the response-SLA clock stops at first response, same as the
    // real enforcement in sla-monitor.ts's findAndLogBreaches (`t.state IN
    // ('new', 'triaged')`). Using the broader "not yet terminal" filter here
    // (which also matches 'responded'/'investigating' etc.) was tried first
    // and produced nonsense: a ticket sitting in 'responded' for hours before
    // its 24h auto-resolve sweep kept accumulating as "breached" forever.
    // Caught by seeding real local data and looking at the actual number —
    // keep this filter in lockstep with sla-monitor.ts's scope.
    const { rows: riskRows } = await client.query<RiskRow>(
      `SELECT
         count(*) FILTER (
           WHERE EXTRACT(EPOCH FROM (now() - t.created_at)) / 60
                 BETWEEN 0.8 * (${SLA_TARGET_MINUTES_SQL}) AND (${SLA_TARGET_MINUTES_SQL})
         )::text AS at_risk,
         count(*) FILTER (
           WHERE EXTRACT(EPOCH FROM (now() - t.created_at)) / 60 > (${SLA_TARGET_MINUTES_SQL})
         )::text AS breached
       FROM tickets t
       JOIN tenants tn ON tn.id = t.tenant_id
       WHERE t.project_id = $1 AND t.tenant_id = $2 AND t.state IN ('new', 'triaged')`,
      [projectId, tenantId]
    );

    const considered = Number(attRows[0]?.considered ?? 0);
    const met = Number(attRows[0]?.met ?? 0);

    return {
      windowDays,
      consideredCount: considered,
      metCount: met,
      attainmentPct: considered > 0 ? Math.round((met / considered) * 1000) / 10 : null,
      openAtRiskCount: Number(riskRows[0]?.at_risk ?? 0),
      openBreachedCount: Number(riskRows[0]?.breached ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Auto-resolve / deflection rate (5th industry-standard metric)
//
// CAVEAT (render this, don't hide it): this codebase has no human-handoff
// path today — every ticket that reaches 'responded'/'resolved'/'closed' got
// there via the agent pipeline (owner_agent = 'ticket-respond' /
// 'ticket-resolve'; see src/inngest/ticket-respond.ts, ticket-resolve.ts).
// There is no "escalated to a human, handled manually" state yet. So this
// number is really "% of tickets that reached an agent-delivered response,"
// an upper-bound proxy for deflection, not a true deflection-vs-escalation
// split. Ship it labeled with that caveat rather than calling it a clean
// industry-standard deflection rate.
// ---------------------------------------------------------------------------
export type DeflectionRate = {
  windowDays: number;
  totalCount: number;
  autoHandledCount: number;
  ratePct: number | null;
};

type DeflectionRow = { total: string; auto_handled: string };

export async function getDeflectionRate(
  pool: Pool,
  projectId: string,
  tenantId: string,
  windowDays = 30
): Promise<DeflectionRate> {
  return withTenantScope(pool, projectId, tenantId, async (client) => {
    const { rows } = await client.query<DeflectionRow>(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (
           WHERE t.state IN ('responded', 'resolved', 'closed') AND t.owner_agent IS NOT NULL
         )::text AS auto_handled
       FROM tickets t
       WHERE t.project_id = $1
         AND t.tenant_id = $2
         AND t.created_at >= now() - ($3 || ' days')::interval`,
      [projectId, tenantId, windowDays]
    );
    const total = Number(rows[0]?.total ?? 0);
    const autoHandled = Number(rows[0]?.auto_handled ?? 0);
    return {
      windowDays,
      totalCount: total,
      autoHandledCount: autoHandled,
      ratePct: total > 0 ? Math.round((autoHandled / total) * 1000) / 10 : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Pipeline stage counts (bucketed from tickets.state)
// ---------------------------------------------------------------------------
export type PipelineStage = "new" | "triaged" | "responded" | "in_progress" | "resolved";
export type PipelineCounts = Record<PipelineStage, number>;

type StateCountRow = { state: string; count: string };

function bucketState(state: string): PipelineStage {
  switch (state) {
    case "new":
      return "new";
    case "triaged":
      return "triaged";
    case "responded":
      return "responded";
    case "resolved":
    case "closed":
    case "wont_fix":
    case "duplicate":
      return "resolved";
    default:
      // investigating, in_progress, blocked, in_review, staged, deploying,
      // verifying, reopened — all still-actionable states with no dedicated
      // mockup row of their own.
      return "in_progress";
  }
}

export async function getPipelineStageCounts(
  pool: Pool,
  projectId: string,
  tenantId: string
): Promise<PipelineCounts> {
  return withTenantScope(pool, projectId, tenantId, async (client) => {
    const { rows } = await client.query<StateCountRow>(
      `SELECT state, count(*)::text AS count
         FROM tickets t
        WHERE t.project_id = $1 AND t.tenant_id = $2
        GROUP BY state`,
      [projectId, tenantId]
    );
    const counts: PipelineCounts = {
      new: 0,
      triaged: 0,
      responded: 0,
      in_progress: 0,
      resolved: 0,
    };
    for (const r of rows) {
      counts[bucketState(r.state)] += Number(r.count);
    }
    return counts;
  });
}

// ---------------------------------------------------------------------------
// Ticket queue (open tickets, most urgent / soonest-due first)
// ---------------------------------------------------------------------------
export type QueueTicket = {
  id: string;
  title: string;
  category: string | null;
  urgency: string | null;
  state: string;
  tenantName: string;
  createdAt: string;
  updatedAt: string;
  targetMinutes: number;
  minutesOpen: number;
  minutesRemaining: number; // negative == breached
};

type QueueRow = {
  id: string;
  title: string;
  category: string | null;
  urgency: string | null;
  state: string;
  tenant_name: string;
  created_at: string;
  updated_at: string;
  target_minutes: string;
  minutes_open: string;
};

export async function getTicketQueue(
  pool: Pool,
  projectId: string,
  tenantId: string,
  limit = 50
): Promise<QueueTicket[]> {
  return withTenantScope(pool, projectId, tenantId, async (client) => {
    const { rows } = await client.query<QueueRow>(
      `SELECT
         t.id::text,
         t.title,
         t.category,
         t.urgency,
         t.state,
         tn.name AS tenant_name,
         t.created_at,
         t.updated_at,
         (${SLA_TARGET_MINUTES_SQL})::text AS target_minutes,
         (EXTRACT(EPOCH FROM (now() - t.created_at)) / 60)::text AS minutes_open
       FROM tickets t
       JOIN tenants tn ON tn.id = t.tenant_id
       WHERE t.project_id = $1 AND t.tenant_id = $2 AND ${OPEN_STATES_SQL}
       ORDER BY
         CASE t.urgency
           WHEN 'critical' THEN 0
           WHEN 'high'     THEN 1
           WHEN 'normal'   THEN 2
           WHEN 'low'      THEN 3
           ELSE 4
         END,
         t.created_at ASC
       LIMIT $3`,
      [projectId, tenantId, limit]
    );

    return rows.map((r) => {
      const target = Number(r.target_minutes);
      const minutesOpen = Number(r.minutes_open);
      return {
        id: r.id,
        title: r.title,
        category: r.category,
        urgency: r.urgency,
        state: r.state,
        tenantName: r.tenant_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        targetMinutes: target,
        minutesOpen,
        minutesRemaining: Math.round(target - minutesOpen),
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Platform incidents feed
//
// HONEST STATE: nothing writes infra-incident rows into audit_log today. The
// richer incident narrative (T-38's Cstate status page) lives on a separate
// `status-content` git branch / GitHub Pages site, gated behind FQ-47's
// founder actions, and is NOT wired into Supabase or this query. So this
// function will genuinely return an empty array in production right now —
// that's correct, not a bug. The dashboard must render "no incidents
// recorded in this feed" plus the Cstate-not-wired-in caveat, never invent
// rows to fill the panel.
// (Until T-66, an RLS deny bug ALSO hid any such row even if one existed;
//  that is now fixed — today the feed is empty purely because no writer
//  exists yet, not because RLS blocks it.)
// ---------------------------------------------------------------------------
export type PlatformIncident = {
  id: string;
  timestamp: string;
  action: string;
  payload: Record<string, unknown>;
};

type IncidentRow = { id: string; timestamp: string; action: string; payload: unknown };

const PLATFORM_INCIDENT_ACTIONS = ["platform_incident"];

export async function getPlatformIncidents(
  pool: Pool,
  projectId: string,
  limit = 20
): Promise<PlatformIncident[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Platform incidents are project-scoped: they live in audit_log with
    // tenant_id IS NULL and a non-null project_id. Only the project GUC is
    // set; audit_log_select_platform (migration 20260706000000, T-66)
    // exposes a NULL-tenant row exactly when the caller's project GUC
    // matches that row's project_id. Before T-66 the tenant-only USING
    // clause on audit_log_select denied every NULL-tenant row, so this feed
    // was silently empty (deny-direction dead code, not a leak) — see
    // DECISIONS.md 2026-07-06 T-60 Check 2 / T-66.
    await client.query("SELECT set_config('app.current_project', $1, true)", [projectId]);
    const { rows } = await client.query<IncidentRow>(
      `SELECT id::text, timestamp::text, action, payload
         FROM audit_log
        WHERE project_id = $1
          AND tenant_id IS NULL
          AND action = ANY($2)
        ORDER BY timestamp DESC
        LIMIT $3`,
      [projectId, PLATFORM_INCIDENT_ACTIONS, limit]
    );
    await client.query("COMMIT");
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      action: r.action,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
