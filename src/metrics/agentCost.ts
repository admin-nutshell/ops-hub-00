import type { Pool } from "pg";

// Query layer for the ops dashboard's "agent cost" pillar (T-58 → T-59).
// Reads from `agent_cost_daily` (a security_invoker view over
// agent_cost_events — see migration 20260704010000_t58_agent_cost_eval_health.sql),
// populated by the `agent-cost-sync` Inngest cron (src/inngest/agent-cost-sync.ts).
//
// Every query here is tenant/project-scoped via the same transaction-local RLS
// GUC pattern used everywhere else in this codebase (ticket-triage.ts,
// sla-monitor.ts): the caller MUST supply the tenant/project it is authorized
// to see, and RLS enforces that no row outside that scope is returned even if
// the query itself has a bug — T-60 verifies this holds.

export type DailyCostRow = {
  day: string;
  traceName: "ticket-triage" | "ticket-respond" | "kb-learn";
  eventCount: number;
  totalCostUsd: number;
};

type RawDailyCostRow = {
  day: string;
  trace_name: string;
  event_count: string; // count(*) comes back as a string from `pg`
  total_cost_usd: string; // numeric comes back as a string from `pg`
};

// Returns per-day, per-agent cost for one tenant over the last `days` days
// (default 30 — enough for a monthly reconciliation view without an unbounded
// scan). Sets both GUCs transaction-local (is_local=true) for pooler safety,
// exactly like every other tenant-scoped read in this codebase.
export async function getDailyCostForTenant(
  pool: Pool,
  projectId: string,
  tenantId: string,
  days = 30
): Promise<DailyCostRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_project', $1, true)", [projectId]);
    const { rows } = await client.query<RawDailyCostRow>(
      `SELECT day, trace_name, event_count, total_cost_usd
         FROM agent_cost_daily
        WHERE project_id = $1
          AND tenant_id = $2
          AND day >= now() - ($3 || ' days')::interval
        ORDER BY day DESC, trace_name`,
      [projectId, tenantId, days]
    );
    await client.query("COMMIT");
    return rows.map((r) => ({
      day: r.day,
      traceName: r.trace_name as DailyCostRow["traceName"],
      eventCount: Number(r.event_count),
      totalCostUsd: Number(r.total_cost_usd),
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Convenience rollup: total cost for one tenant over the window (sum across
// agents/days) — the single number the dashboard's headline agent-cost tile
// needs; getDailyCostForTenant remains available for the cost-per-ticket /
// cost-over-time breakdown views.
export async function getTotalCostForTenant(
  pool: Pool,
  projectId: string,
  tenantId: string,
  days = 30
): Promise<number> {
  const rows = await getDailyCostForTenant(pool, projectId, tenantId, days);
  return rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
}
