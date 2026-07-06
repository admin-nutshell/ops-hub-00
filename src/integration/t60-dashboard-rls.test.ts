import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, Client as PgClient } from "pg";
import {
  getScopeLabel,
  getOpenTicketCounts,
  getSlaAttainment,
  getDeflectionRate,
  getPipelineStageCounts,
  getTicketQueue,
  getPlatformIncidents,
} from "../metrics/dashboard";
import { getDailyCostForTenant } from "../metrics/agentCost";
import { getEvalHealth } from "../metrics/evalHealth";

/**
 * T-60 — Live RLS / tenant-scoping verification of the ops dashboard query layer.
 *
 * This is the LIVE half of T-60 (the analytical half is the Security Lead code
 * audit + the migration-SQL cross-read recorded in DECISIONS.md). It proves,
 * against the REAL shared Supabase database, the five checks on the Security
 * Lead's action list — one live check per dashboard widget confirming it cannot
 * return rows outside its intended scope (the literal WORK.md T-60 exit
 * criterion), plus the agent_cost_daily invoker check, the audit_log
 * platform-row CONCERN, and the eval_gate_runs project-scoping rule.
 *
 * ROLES (mirrors T-18 / rls-isolation.test.ts exactly):
 *   - ASSERTIONS run as `ops_hub_app_login` (OPS_HUB_APP_LOGIN_URL) — the
 *     connectable login role that does NOT bypass RLS (nobypassrls). This is
 *     the only role for which RLS actually engages, so a no-GUC read that
 *     returns zero rows is a REAL fail-closed proof, not a vacuous one.
 *   - SETUP/TEARDOWN run as a superuser (SUPABASE_SETUP_DB_URL) — creating
 *     projects/tenants and a NULL-tenant audit_log row needs a role that
 *     bypasses RLS by design, exactly as the T-18 test uses service_role.
 *     NEVER run the assertions on this connection — superuser bypasses RLS and
 *     every check below would falsely pass.
 *
 * "NEVER TOUCH PROD DATA": the shared DB also holds the tts-prod / DNC-prod
 * rows. All fixtures here use a fresh random project (name tagged with RUN_TAG)
 * and are torn down in reverse-FK order in a finally-safe afterAll. No query
 * reads or mutates the …0003 / …0030 production rows.
 *
 * CI BEHAVIOUR: skips (does not fail) when the two DSNs are absent, so the
 * repo-root `vitest run` stays green without secrets. Runs live only when
 * dispatched with both DSNs set — see .github/workflows/t60-dashboard-rls-verify.yml.
 */

const OPS_HUB_APP_LOGIN_URL = process.env.OPS_HUB_APP_LOGIN_URL;
const SETUP_DB_URL = process.env.SUPABASE_SETUP_DB_URL;
const hasCreds = Boolean(OPS_HUB_APP_LOGIN_URL && SETUP_DB_URL);

if (!hasCreds) {
  console.warn(
    "SKIPPED: T-60 live RLS verification requires OPS_HUB_APP_LOGIN_URL " +
      "(ops_hub_app_login, non-superuser) and SUPABASE_SETUP_DB_URL (superuser, " +
      "setup/teardown). Set both to run against staging."
  );
}

const RUN_TAG = `t60-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!hasCreds)("T-60 dashboard RLS / tenant-scoping (live)", () => {
  let loginPool: Pool;
  let setup: PgClient;

  let projectId: string;
  let tenantAId: string;
  let tenantAName: string;
  let tenantBId: string;

  // Run a query on the login role with NO GUC set (fail-closed floor probe).
  async function noGuc<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const c = await loginPool.connect();
    try {
      await c.query("BEGIN");
      const { rows } = await c.query<T>(sql, params);
      await c.query("COMMIT");
      return rows;
    } finally {
      c.release();
    }
  }

  // Run a query on the login role with the given transaction-local GUCs set.
  async function scoped<T extends Record<string, unknown>>(
    guc: { project?: string; tenant?: string },
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const c = await loginPool.connect();
    try {
      await c.query("BEGIN");
      if (guc.tenant)
        await c.query("SELECT set_config('app.current_tenant', $1, true)", [guc.tenant]);
      if (guc.project)
        await c.query("SELECT set_config('app.current_project', $1, true)", [guc.project]);
      const { rows } = await c.query<T>(sql, params);
      await c.query("COMMIT");
      return rows;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    loginPool = new Pool({ connectionString: OPS_HUB_APP_LOGIN_URL!, max: 4 });
    setup = new PgClient({ connectionString: SETUP_DB_URL! });
    await setup.connect();

    tenantAName = `${RUN_TAG}-tenant-A`;

    const proj = await setup.query<{ id: string }>(
      "INSERT INTO projects (name) VALUES ($1) RETURNING id",
      [`${RUN_TAG}-project`]
    );
    projectId = proj.rows[0].id;

    const tA = await setup.query<{ id: string }>(
      "INSERT INTO tenants (project_id, name, tier, sla_tier) VALUES ($1,$2,'starter','standard') RETURNING id",
      [projectId, tenantAName]
    );
    tenantAId = tA.rows[0].id;
    const tB = await setup.query<{ id: string }>(
      "INSERT INTO tenants (project_id, name, tier, sla_tier) VALUES ($1,$2,'starter','standard') RETURNING id",
      [projectId, `${RUN_TAG}-tenant-B`]
    );
    tenantBId = tB.rows[0].id;

    // Tenant A: 4 tickets across urgencies/states (positive-control data).
    //   open (new/triaged): critical + high ; terminal-ish: responded + resolved.
    await setup.query(
      `INSERT INTO tickets (project_id, tenant_id, title, severity, state, urgency, category, owner_agent)
       VALUES
         ($1,$2,$3,'P1','new','critical','billing',NULL),
         ($1,$2,$4,'P2','triaged','high','auth',NULL),
         ($1,$2,$5,'P2','responded','normal','perf','ticket-respond'),
         ($1,$2,$6,'P3','resolved','low','other','ticket-resolve')`,
      [
        projectId,
        tenantAId,
        `${RUN_TAG}-A-crit`,
        `${RUN_TAG}-A-high`,
        `${RUN_TAG}-A-resp`,
        `${RUN_TAG}-A-res`,
      ]
    );
    // Tenant B: exactly one open ticket, distinct from A's.
    await setup.query(
      `INSERT INTO tickets (project_id, tenant_id, title, severity, state, urgency, category)
       VALUES ($1,$2,$3,'P2','new','normal','auth')`,
      [projectId, tenantBId, `${RUN_TAG}-B-new`]
    );

    // agent_cost_events: one row each for A and B (recent).
    await setup.query(
      `INSERT INTO agent_cost_events
         (project_id, tenant_id, langfuse_trace_id, trace_name, total_cost_usd, trace_timestamp)
       VALUES
         ($1,$2,$3,'ticket-triage',0.012345, now()),
         ($1,$4,$5,'ticket-triage',0.006789, now())`,
      [projectId, tenantAId, `${RUN_TAG}-trace-A`, tenantBId, `${RUN_TAG}-trace-B`]
    );

    // eval_gate_runs: one platform (project_id NULL) row + one project-scoped row.
    await setup.query(
      `INSERT INTO eval_gate_runs (project_id, run_type, status, ci_run_at, notes)
       VALUES (NULL,'schema_validation','pass', now(), $1)`,
      [RUN_TAG]
    );
    await setup.query(
      `INSERT INTO eval_gate_runs (project_id, run_type, status, total_cases, passed_cases, ci_run_at, notes)
       VALUES ($1,'llm_rubric','pass', 20, 20, now(), $2)`,
      [projectId, RUN_TAG]
    );

    // audit_log: one platform_incident row with tenant_id NULL (the CONCERN fixture).
    await setup.query(
      `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, payload)
       VALUES ($1, NULL, 'qa-t60', 'platform_incident', 'incident', $2)`,
      [projectId, JSON.stringify({ run_tag: RUN_TAG, note: "T-60 CONCERN fixture" })]
    );
  });

  afterAll(async () => {
    if (setup) {
      // Reverse-FK order; scoped strictly to this run's fixtures. Superuser
      // bypasses RLS so these deletes always sweep, even after a mid-run failure.
      await setup.query("DELETE FROM audit_log WHERE project_id = $1", [projectId]);
      await setup.query("DELETE FROM agent_cost_events WHERE project_id = $1", [projectId]);
      await setup.query("DELETE FROM eval_gate_runs WHERE notes = $1", [RUN_TAG]);
      await setup.query("DELETE FROM tickets WHERE project_id = $1", [projectId]);
      await setup.query("DELETE FROM tenants WHERE project_id = $1", [projectId]);
      await setup.query("DELETE FROM projects WHERE id = $1", [projectId]);
      await setup.end();
    }
    if (loginPool) await loginPool.end();
  });

  // ── CHECK 1 — agent_cost_daily invoker + tenant isolation ──────────────────
  describe("Check 1 — agent_cost_daily (security_invoker view)", () => {
    it("view is defined WITH (security_invoker=true)", async () => {
      const { rows } = await setup.query<{ reloptions: string[] | null }>(
        "SELECT reloptions FROM pg_class WHERE relname = 'agent_cost_daily'"
      );
      expect(rows.length).toBe(1);
      expect(rows[0].reloptions ?? []).toContain("security_invoker=true");
    });

    it("no-GUC read of agent_cost_daily returns 0 rows (fail-closed)", async () => {
      const rows = await noGuc<{ count: string }>(
        "SELECT count(*)::text AS count FROM agent_cost_daily"
      );
      expect(rows[0].count).toBe("0");
    });

    it("tenant-B scope cannot see tenant-A cost rows (RLS backstop, WHERE targets A)", async () => {
      const rows = await scoped<{ count: string }>(
        { project: projectId, tenant: tenantBId },
        "SELECT count(*)::text AS count FROM agent_cost_daily WHERE tenant_id = $1",
        [tenantAId]
      );
      expect(rows[0].count).toBe("0");
    });

    it("tenant-A scope DOES see tenant-A cost rows (positive control)", async () => {
      const rows = await getDailyCostForTenant(loginPool, projectId, tenantAId, 30);
      expect(rows.length).toBeGreaterThan(0);
      const other = await getDailyCostForTenant(loginPool, projectId, tenantBId, 30);
      // B has its own single row; must NOT include A's trace.
      expect(other.reduce((s, r) => s + r.eventCount, 0)).toBe(1);
    });
  });

  // ── CHECK 2 — audit_log platform-incident CONCERN ──────────────────────────
  describe("Check 2 — getPlatformIncidents / audit_log_select (proves CONCERN)", () => {
    it("the NULL-tenant platform_incident row EXISTS (superuser view)", async () => {
      const { rows } = await setup.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_log WHERE project_id = $1 AND tenant_id IS NULL AND action = 'platform_incident'",
        [projectId]
      );
      expect(rows[0].count).toBe("1");
    });

    it("getPlatformIncidents returns 0 rows despite the row existing (dead/no-op code)", async () => {
      // project GUC only, no tenant GUC — exactly how the dashboard calls it.
      const incidents = await getPlatformIncidents(loginPool, projectId, 20);
      // CONCERN: audit_log_select USING (tenant_id = current_tenant_id()) denies
      // NULL-tenant rows unconditionally, so this feed can never return a row.
      expect(incidents.length).toBe(0);
    });
  });

  // ── CHECK 3 — eval_gate_runs project-scoping ───────────────────────────────
  describe("Check 3 — eval_gate_runs (platform NULL rows readable; project rows scoped)", () => {
    it("NULL-project rows ARE readable with no GUC (by design — platform CI health)", async () => {
      const rows = await noGuc<{ count: string }>(
        "SELECT count(*)::text AS count FROM eval_gate_runs WHERE notes = $1 AND project_id IS NULL",
        [RUN_TAG]
      );
      expect(rows[0].count).toBe("1");
    });

    it("project-scoped row is NOT readable without the project GUC", async () => {
      const rows = await noGuc<{ count: string }>(
        "SELECT count(*)::text AS count FROM eval_gate_runs WHERE notes = $1 AND project_id = $2",
        [RUN_TAG, projectId]
      );
      expect(rows[0].count).toBe("0");
    });

    it("project-scoped row IS readable with the correct project GUC", async () => {
      const rows = await scoped<{ count: string }>(
        { project: projectId },
        "SELECT count(*)::text AS count FROM eval_gate_runs WHERE notes = $1 AND project_id = $2",
        [RUN_TAG, projectId]
      );
      expect(rows[0].count).toBe("1");
    });

    it("getEvalHealth stays 'pending' on the login pool (no llm_rubric visible without GUC)", async () => {
      const health = await getEvalHealth(loginPool);
      expect(health.status).toBe("pending");
    });
  });

  // ── CHECK 4 — one fail-closed live check per widget ────────────────────────
  // Literal WORK.md T-60 exit criterion: each widget's underlying SQL, with the
  // set_config GUC lines skipped, must return 0 rows.
  describe("Check 4 — per-widget no-GUC fail-closed + cross-tenant", () => {
    it("getScopeLabel — projects & tenants return 0 rows with no GUC", async () => {
      const p = await noGuc<{ count: string }>(
        "SELECT count(*)::text AS count FROM projects WHERE id = $1",
        [projectId]
      );
      const t = await noGuc<{ count: string }>(
        "SELECT count(*)::text AS count FROM tenants WHERE id = $1",
        [tenantAId]
      );
      expect(p[0].count).toBe("0");
      expect(t[0].count).toBe("0");
      // Positive control + correct scope: function returns A's real name.
      const label = await getScopeLabel(loginPool, projectId, tenantAId);
      expect(label.tenantName).toBe(tenantAName);
    });

    it("tickets — no-GUC read of A's tickets returns 0 rows (covers open/SLA/deflection/pipeline/queue)", async () => {
      const rows = await noGuc<{ count: string }>(
        "SELECT count(*)::text AS count FROM tickets WHERE project_id = $1 AND tenant_id = $2",
        [projectId, tenantAId]
      );
      expect(rows[0].count).toBe("0");
    });

    it("tickets — tenant-B GUC cannot see A's tickets even when WHERE targets A (RLS backstop)", async () => {
      const rows = await scoped<{ count: string }>(
        { project: projectId, tenant: tenantBId },
        "SELECT count(*)::text AS count FROM tickets WHERE project_id = $1 AND tenant_id = $2",
        [projectId, tenantAId]
      );
      expect(rows[0].count).toBe("0");
    });

    it("getOpenTicketCounts — A sees its 2 open tickets; B sees only its 1, none of A's", async () => {
      const a = await getOpenTicketCounts(loginPool, projectId, tenantAId);
      expect(a.total).toBe(2); // critical(new) + high(triaged); responded/resolved excluded
      expect(a.critical).toBe(1);
      expect(a.high).toBe(1);
      const b = await getOpenTicketCounts(loginPool, projectId, tenantBId);
      expect(b.total).toBe(1);
    });

    it("getSlaAttainment — A considers 2 (responded+resolved), scoped to A only", async () => {
      const a = await getSlaAttainment(loginPool, projectId, tenantAId, 3650);
      expect(a.consideredCount).toBe(2);
      const b = await getSlaAttainment(loginPool, projectId, tenantBId, 3650);
      expect(b.consideredCount).toBe(0);
    });

    it("getDeflectionRate — A totals its 4 tickets; B totals its 1", async () => {
      const a = await getDeflectionRate(loginPool, projectId, tenantAId, 3650);
      expect(a.totalCount).toBe(4);
      const b = await getDeflectionRate(loginPool, projectId, tenantBId, 3650);
      expect(b.totalCount).toBe(1);
    });

    it("getPipelineStageCounts — A's states are scoped to A", async () => {
      const a = await getPipelineStageCounts(loginPool, projectId, tenantAId);
      expect(a.new).toBe(1);
      expect(a.triaged).toBe(1);
      expect(a.responded).toBe(1);
      expect(a.resolved).toBe(1);
      const b = await getPipelineStageCounts(loginPool, projectId, tenantBId);
      expect(b.new).toBe(1);
      expect(b.triaged).toBe(0);
    });

    it("getTicketQueue — A's queue holds only A's tickets; B's holds none of A's", async () => {
      const a = await getTicketQueue(loginPool, projectId, tenantAId, 50);
      expect(a.length).toBe(2); // 2 open
      expect(a.every((t) => t.title.startsWith(`${RUN_TAG}-A-`))).toBe(true);
      const b = await getTicketQueue(loginPool, projectId, tenantBId, 50);
      expect(b.every((t) => !t.title.startsWith(`${RUN_TAG}-A-`))).toBe(true);
    });
  });
});
