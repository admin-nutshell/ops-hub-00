import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
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
 * The LIVE half of T-60 (the analytical half = Security Lead code audit +
 * migration-SQL cross-read in DECISIONS.md). Proves the 5 Security-Lead checks
 * against the REAL shared Supabase DB using ONLY the `ops_hub_app_login` role
 * (non-superuser, RLS engaged) — the exact runtime path the dashboard uses.
 *
 * WHY NO SERVICE_ROLE / SUPERUSER: CLAUDE.md #3 forbids any agent from holding
 * service_role, and CI has no superuser DB credential (SUPABASE_STAGING_DB_URL
 * turned out to be a bare hostname, not a DSN). So fixtures are created with
 * `INSERT` inside a transaction that is always `ROLLBACK`-ed — the app role can
 * do every insert its RLS policies allow, and nothing is ever committed. This
 * is strictly in-model (it's what the Inngest functions do at runtime) and
 * leaves ZERO test data in staging, including the shared prod rows.
 *
 * POSITIVE CONTROL (per T-18's own doctrine): "everything returns 0" is a
 * vacuous pass if the connection is dead. We anchor on real staging data
 * (STAGING_PROJECT_ID/STAGING_TENANT_ID = the POLLING_* scope) that definitely
 * exists, asserting it IS visible with the right GUC and is NOT visible without.
 *
 * system-health is intentionally absent: it is an HTTP /health probe, not a DB
 * query (see web/ system-health widget), so it has no RLS surface to check.
 *
 * CI: skips without OPS_HUB_APP_LOGIN_URL, so repo-root `vitest run` stays green.
 */

const OPS_HUB_APP_LOGIN_URL = process.env.OPS_HUB_APP_LOGIN_URL;
const STAGING_PROJECT_ID = process.env.STAGING_PROJECT_ID;
const STAGING_TENANT_ID = process.env.STAGING_TENANT_ID;
const hasLogin = Boolean(OPS_HUB_APP_LOGIN_URL);
const hasStagingScope = Boolean(STAGING_PROJECT_ID && STAGING_TENANT_ID);

if (!hasLogin) {
  console.warn(
    "SKIPPED: T-60 live RLS verification requires OPS_HUB_APP_LOGIN_URL " +
      "(ops_hub_app_login, non-superuser). Set it to run against staging."
  );
}
if (hasLogin && !hasStagingScope) {
  console.warn(
    "T-60: STAGING_PROJECT_ID/STAGING_TENANT_ID not set — running per-widget " +
      "fail-closed checks only; positive-control + insert/rollback RLS backstop skipped."
  );
}

const RUN_TAG = `t60-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!hasLogin)("T-60 dashboard RLS / tenant-scoping (live, login-role)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: OPS_HUB_APP_LOGIN_URL!, max: 4 });
    // Diagnostic: pg_class lists every relation in the DB across all schemas,
    // readable by any role regardless of privilege. This unambiguously reports
    // whether each object the dashboard queries actually EXISTS in the live DB
    // (distinguishes "RLS returned 0" from "relation is absent / migration
    // not applied"). Printed once, never fails the suite.
    const rel = await pool.query<{ relname: string; kind: string; schema: string }>(
      `SELECT relname, relkind::text AS kind, relnamespace::regnamespace::text AS schema
         FROM pg_class
        WHERE relname IN
          ('tenants','projects','tickets','audit_log','agent_cost_daily','agent_cost_events','eval_gate_runs')
        ORDER BY relname`
    );
    const found = new Map(rel.rows.map((r) => [r.relname, `${r.schema} (relkind=${r.kind})`]));
    const report = [
      "tenants",
      "projects",
      "tickets",
      "audit_log",
      "agent_cost_daily",
      "agent_cost_events",
      "eval_gate_runs",
    ]
      .map((n) => `  ${n}: ${found.get(n) ?? "*** ABSENT (not in this DB) ***"}`)
      .join("\n");
    console.log(`T-60 live-DB relation existence (via pg_class):\n${report}`);
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });

  // Run on a dedicated client with the given transaction-local GUCs; auto-COMMIT.
  async function scoped<T extends Record<string, unknown>>(
    guc: { project?: string; tenant?: string },
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (guc.tenant)
        await c.query("SELECT set_config('app.current_tenant', $1, true)", [guc.tenant]);
      if (guc.project)
        await c.query("SELECT set_config('app.current_project', $1, true)", [guc.project]);
      const { rows } = await c.query<T>(sql, params);
      await c.query("COMMIT");
      return rows;
    } catch (err) {
      // MUST clear the aborted-transaction state before returning the client to
      // the pool, or the next borrower hits 25P02 (in_failed_sql_transaction).
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
  const noGuc = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    scoped<T>({}, sql, params);

  // ── Check 1a — agent_cost_daily is a security_invoker view ─────────────────
  it("Check 1a: agent_cost_daily is defined WITH (security_invoker=true)", async () => {
    const rows = await noGuc<{ reloptions: string[] | null }>(
      "SELECT reloptions FROM pg_class WHERE relname = 'agent_cost_daily'"
    );
    expect(rows.length).toBe(1);
    expect(rows[0].reloptions ?? []).toContain("security_invoker=true");
  });

  // ── Check 4 — one fail-closed live check per widget (no GUC ⇒ 0 rows) ───────
  // Literal WORK.md T-60 exit criterion. Every widget's underlying relation is
  // read with NO GUC set; RLS must return nothing.
  describe("Check 4: per-widget fail-closed (no GUC ⇒ 0 rows)", () => {
    const cases: Array<[string, string]> = [
      ["getScopeLabel/projects", "SELECT count(*)::text AS count FROM projects"],
      ["getScopeLabel/tenants", "SELECT count(*)::text AS count FROM tenants"],
      [
        "open/SLA/deflection/pipeline/queue → tickets",
        "SELECT count(*)::text AS count FROM tickets",
      ],
      ["agentCost → agent_cost_daily", "SELECT count(*)::text AS count FROM agent_cost_daily"],
      ["agentCost → agent_cost_events", "SELECT count(*)::text AS count FROM agent_cost_events"],
      [
        "platformIncidents → audit_log",
        "SELECT count(*)::text AS count FROM audit_log WHERE action = 'platform_incident'",
      ],
    ];
    it.each(cases)("no-GUC read of %s returns 0 rows", async (_label, sql) => {
      const rows = await noGuc<{ count: string }>(sql);
      expect(rows[0].count).toBe("0");
    });
  });

  // ── Check 4 (functions) — each widget FUNCTION returns nothing for an empty
  // random scope, exercising the real GUC+query+RLS code path end-to-end. If any
  // widget leaked cross-tenant rows, a random scope would surface them.
  describe("Check 4: per-widget function is fail-closed for a random scope", () => {
    const rp = () => randomUUID();
    it("getScopeLabel → unknown (no fabricated names)", async () => {
      const l = await getScopeLabel(pool, rp(), rp());
      expect(l.projectName).toBe("(unknown project)");
      expect(l.tenantName).toBe("(unknown tenant)");
    });
    it("getOpenTicketCounts → total 0", async () => {
      expect((await getOpenTicketCounts(pool, rp(), rp())).total).toBe(0);
    });
    it("getSlaAttainment → considered 0 / attainment null", async () => {
      const s = await getSlaAttainment(pool, rp(), rp(), 3650);
      expect(s.consideredCount).toBe(0);
      expect(s.attainmentPct).toBeNull();
    });
    it("getDeflectionRate → total 0", async () => {
      expect((await getDeflectionRate(pool, rp(), rp(), 3650)).totalCount).toBe(0);
    });
    it("getPipelineStageCounts → all 0", async () => {
      const p = await getPipelineStageCounts(pool, rp(), rp());
      expect(p.new + p.triaged + p.responded + p.in_progress + p.resolved).toBe(0);
    });
    it("getTicketQueue → []", async () => {
      expect((await getTicketQueue(pool, rp(), rp(), 50)).length).toBe(0);
    });
    it("getDailyCostForTenant → []", async () => {
      expect((await getDailyCostForTenant(pool, rp(), rp(), 3650)).length).toBe(0);
    });
    it("getPlatformIncidents → [] (also: dead/no-op per the CONCERN)", async () => {
      expect((await getPlatformIncidents(pool, rp(), 20)).length).toBe(0);
    });
    it("getEvalHealth → pending (no llm_rubric rows visible)", async () => {
      expect((await getEvalHealth(pool)).status).toBe("pending");
    });
  });

  // ── Positive control + insert/rollback RLS backstop (needs a real, FK-valid
  // staging project/tenant to scope inserts against). All inside ROLLBACK.
  describe.skipIf(!hasStagingScope)("positive control + RLS backstop (insert/rollback)", () => {
    const P = () => STAGING_PROJECT_ID!;
    const T = () => STAGING_TENANT_ID!;

    it("Positive control: staging project/tenant IS visible with GUC, NOT without", async () => {
      const label = await getScopeLabel(pool, P(), T());
      expect(label.projectName).not.toBe("(unknown project)");
      expect(label.tenantName).not.toBe("(unknown tenant)");
      const withGuc = await scoped<{ count: string }>(
        { project: P() },
        "SELECT count(*)::text AS count FROM projects WHERE id = $1",
        [P()]
      );
      const without = await noGuc<{ count: string }>(
        "SELECT count(*)::text AS count FROM projects WHERE id = $1",
        [P()]
      );
      expect(withGuc[0].count).toBe("1");
      expect(without[0].count).toBe("0");
    });

    it("Check 4 backstop: a ticket is hidden from a different tenant even when WHERE targets it", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_tenant', $1, true)", [T()]);
        await c.query("SELECT set_config('app.current_project', $1, true)", [P()]);
        const ins = await c.query<{ id: string }>(
          `INSERT INTO tickets (project_id, tenant_id, title, severity, state, urgency)
           VALUES ($1,$2,$3,'P2','new','high') RETURNING id`,
          [P(), T(), `${RUN_TAG}-ticket`]
        );
        const id = ins.rows[0].id;
        // same tenant → visible
        const same = await c.query("SELECT id FROM tickets WHERE id = $1", [id]);
        expect(same.rowCount).toBe(1);
        // switch to a random tenant → RLS hides it though the WHERE targets it
        await c.query("SELECT set_config('app.current_tenant', $1, true)", [randomUUID()]);
        const other = await c.query("SELECT id FROM tickets WHERE id = $1", [id]);
        expect(other.rowCount).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("Check 1: agent_cost_daily (security_invoker) isolates cost rows cross-tenant", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_tenant', $1, true)", [T()]);
        await c.query("SELECT set_config('app.current_project', $1, true)", [P()]);
        await c.query(
          `INSERT INTO agent_cost_events
             (project_id, tenant_id, langfuse_trace_id, trace_name, total_cost_usd, trace_timestamp)
           VALUES ($1,$2,$3,'ticket-triage',0.0123, now())`,
          [P(), T(), `${RUN_TAG}-trace`]
        );
        const mine = await c.query(
          "SELECT count(*)::int AS n FROM agent_cost_daily WHERE tenant_id = $1",
          [T()]
        );
        expect((mine.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(1);
        // random tenant scope cannot see it through the view
        await c.query("SELECT set_config('app.current_tenant', $1, true)", [randomUUID()]);
        const other = await c.query(
          "SELECT count(*)::int AS n FROM agent_cost_daily WHERE tenant_id = $1",
          [T()]
        );
        expect((other.rows[0] as { n: number }).n).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("Check 2 (CONCERN): a NULL-tenant platform_incident exists yet getPlatformIncidents SQL returns 0", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_project', $1, true)", [P()]);
        // audit_log_insert is `with check (true)` → app role may insert a NULL-tenant row.
        const ins = await c.query(
          `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, payload)
           VALUES ($1, NULL, 'qa-t60', 'platform_incident', 'incident', $2)`,
          [P(), JSON.stringify({ run_tag: RUN_TAG })]
        );
        // Confirm creation via rowCount — RETURNING would be RLS-filtered to 0 and mislead.
        expect(ins.rowCount).toBe(1);
        // Exact getPlatformIncidents SQL (project GUC only, no tenant GUC):
        const feed = await c.query(
          `SELECT id::text FROM audit_log
            WHERE project_id = $1 AND tenant_id IS NULL AND action = ANY($2)
            ORDER BY timestamp DESC LIMIT $3`,
          [P(), ["platform_incident"], 20]
        );
        // CONCERN proven: audit_log_select USING (tenant_id = current_tenant_id())
        // denies the NULL-tenant row unconditionally, so the row exists but the
        // feed can never surface it — RLS is the sole excluder (WHERE matched).
        expect(feed.rowCount).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("Check 3: eval_gate_runs — NULL-project readable no-GUC; project-scoped needs project GUC", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_project', $1, true)", [P()]);
        await c.query(
          `INSERT INTO eval_gate_runs (project_id, run_type, status, ci_run_at, notes)
           VALUES (NULL,'schema_validation','pass', now(), $1)`,
          [RUN_TAG]
        );
        await c.query(
          `INSERT INTO eval_gate_runs (project_id, run_type, status, total_cases, passed_cases, ci_run_at, notes)
           VALUES ($1,'llm_rubric','pass', 20, 20, now(), $2)`,
          [P(), RUN_TAG]
        );
        // NULL-project row is platform CI health — visible even with no GUC.
        await c.query("SELECT set_config('app.current_project', '', true)");
        const nullRows = await c.query(
          "SELECT count(*)::int AS n FROM eval_gate_runs WHERE notes = $1 AND project_id IS NULL",
          [RUN_TAG]
        );
        expect((nullRows.rows[0] as { n: number }).n).toBe(1);
        // project-scoped row hidden with no project GUC …
        const hidden = await c.query(
          "SELECT count(*)::int AS n FROM eval_gate_runs WHERE notes = $1 AND project_id = $2",
          [RUN_TAG, P()]
        );
        expect((hidden.rows[0] as { n: number }).n).toBe(0);
        // … visible once the correct project GUC is set.
        await c.query("SELECT set_config('app.current_project', $1, true)", [P()]);
        const shown = await c.query(
          "SELECT count(*)::int AS n FROM eval_gate_runs WHERE notes = $1 AND project_id = $2",
          [RUN_TAG, P()]
        );
        expect((shown.rows[0] as { n: number }).n).toBe(1);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  });
});
