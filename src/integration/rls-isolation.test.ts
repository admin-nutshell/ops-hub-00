import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

/**
 * T-18 — Cross-tenant RLS isolation (automated test).
 *
 * Proves that Row-Level Security on `tickets` (enabled in the T-11 migration
 * `20260618120100_enable_rls_policies.sql`) genuinely isolates one tenant's
 * rows from another's, on the SAME connection path the agents use in
 * production.
 *
 * WHY THIS DOES NOT USE THE SERVICE-ROLE PATH FOR THE ASSERTIONS
 * --------------------------------------------------------------
 * `service_role` has BYPASSRLS (see the migration header, and the T-11/T-12
 * runbooks). Any query it runs ignores every RLS policy, so setting
 * `app.current_tenant` and selecting through the service role would return ALL
 * rows regardless of tenant — it would test nothing while LOOKING like it
 * passed. A green-but-meaningless isolation test is worse than no test.
 *
 * Therefore the ASSERTIONS run as `ops_hub_app_login` — the connectable login
 * role created in T-12 (PR #69) that inherits `ops_hub_app`'s grants and does
 * NOT bypass RLS (`nobypassrls`). This is exactly the "Real login-path RLS
 * check" the T-12 runbook §8 names as "the seam the T-18 test will exercise."
 * Because RLS actually engages for this role, the GUC `app.current_tenant`
 * drives the `tickets_select USING (tenant_id = current_tenant_id())` policy.
 *
 * The `service_role` (supabase-js) connection is used ONLY for setup/teardown:
 * creating projects + tenants is service-role-only (those tables have no app
 * write policy), and teardown likewise needs to bypass RLS to sweep fixtures.
 * This mirrors production precisely: platform ops seed/clean as service_role;
 * agents read/write tenant data as the RLS-bound app role.
 *
 * POOLER SAFETY (Tech Lead condition 1)
 * -------------------------------------
 * A session-level GUC set with `set_config(..., is_local := false)` would
 * survive on a direct/session connection but EVAPORATE under a transaction
 * pooler (PgBouncer port 6543), which multiplexes a fresh backend per
 * transaction — the supabase-js failure in a new costume. Each probe is
 * therefore wrapped in ONE explicit transaction and uses
 * `set_config(..., true)` (transaction-local). Correct under both session and
 * transaction pooling, so the connection-string port choice is not
 * load-bearing.
 *
 * POSITIVE CONTROL (Tech Lead condition 2)
 * ----------------------------------------
 * "tenant_B sees zero rows" alone is a vacuous pass — it also holds when the
 * probe is silently broken (wrong role, wrong GUC, empty path) or if everyone
 * sees zero rows. We assert in THREE directions:
 *   - tenant_A GUC  -> tenant_A's ticket IS visible   (positive control)
 *   - tenant_B GUC  -> tenant_A's ticket is NOT visible (isolation)
 *   - no GUC        -> zero rows                        (fail-closed)
 * The positive control also turns the Postgres "table owner bypasses RLS"
 * gotcha from a silent vacuous pass into a loud failure.
 *
 * CI BEHAVIOUR
 * ------------
 * Skips (does NOT fail) when staging credentials are absent, so CI stays green
 * without secrets. Requires BOTH the service-role creds (setup/teardown) and
 * the `ops_hub_app_login` connection string (assertions). Where this runs
 * against real staging is recorded in DECISIONS.md under T-18.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Direct Postgres connection string for the non-superuser login role created in
// T-12 (e.g. postgresql://ops_hub_app_login:<pw>@<host>:<port>/postgres?sslmode=require).
const OPS_HUB_APP_LOGIN_URL = process.env.OPS_HUB_APP_LOGIN_URL;

const hasCreds = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && OPS_HUB_APP_LOGIN_URL);

if (!hasCreds) {
  // Surfaced in CI logs so a green run is not mistaken for a passing run.
  console.warn(
    "SKIPPED: no staging creds — RLS isolation test requires SUPABASE_URL, " +
      "SUPABASE_SERVICE_ROLE_KEY, and OPS_HUB_APP_LOGIN_URL (the ops_hub_app_login " +
      "connection string). Set all three to run against staging."
  );
}

// Unique marker so concurrent/leftover runs never collide and any orphaned
// fixture rows are trivially identifiable in staging.
const RUN_TAG = `t18-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Run one isolated probe AS the `ops_hub_app_login` role: open a transaction,
 * set the tenant GUC transaction-locally, select the fixture ticket, commit.
 * Returns the ticket ids visible under that tenant scope.
 *
 * `tenantId === null` sets no GUC at all (fail-closed check).
 */
async function ticketsVisibleAs(
  login: PgClient,
  ticketId: string,
  tenantId: string | null
): Promise<string[]> {
  await login.query("begin");
  try {
    if (tenantId !== null) {
      // is_local = true => transaction-scoped GUC; pooler-safe.
      await login.query("select set_config('app.current_tenant', $1, true)", [tenantId]);
    }
    // Scope to the fixture ticket so unrelated staging rows never affect the
    // result; RLS still decides whether THIS row is returned.
    const res = await login.query<{ id: string }>("select id from tickets where id = $1", [
      ticketId,
    ]);
    return res.rows.map((r) => r.id);
  } finally {
    await login.query("commit");
  }
}

describe.skipIf(!hasCreds)("cross-tenant RLS isolation on tickets", () => {
  let supabase: SupabaseClient;
  let login: PgClient;

  // IDs captured from gen_random_uuid() at insert time, used for teardown.
  let projectId: string | undefined;
  let tenantAId: string | undefined;
  let tenantBId: string | undefined;
  let ticketAId: string | undefined;

  beforeAll(async () => {
    // Service-role client: setup/teardown only (bypasses RLS by design).
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Login-role connection: the RLS-bound agent path the assertions exercise.
    login = new PgClient({ connectionString: OPS_HUB_APP_LOGIN_URL! });
    await login.connect();

    // One project, two tenants under it. Let the DB assign UUIDs and read them
    // back rather than pre-generating.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: `${RUN_TAG}-project` })
      .select("id")
      .single();
    expect(projectError, projectError?.message).toBeNull();
    expect(project).not.toBeNull();
    projectId = project!.id;

    const { data: tenants, error: tenantsError } = await supabase
      .from("tenants")
      .insert([
        { project_id: projectId, name: `${RUN_TAG}-tenant-A`, tier: "starter" },
        { project_id: projectId, name: `${RUN_TAG}-tenant-B`, tier: "starter" },
      ])
      .select("id, name");
    expect(tenantsError, tenantsError?.message).toBeNull();
    expect(tenants).not.toBeNull();
    expect(tenants!.length).toBe(2);
    tenantAId = tenants!.find((t) => t.name.endsWith("-tenant-A"))!.id;
    tenantBId = tenants!.find((t) => t.name.endsWith("-tenant-B"))!.id;

    // One ticket owned by tenant_A. tenant_B owns none.
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .insert({
        project_id: projectId,
        tenant_id: tenantAId,
        title: `${RUN_TAG}-ticket-A`,
        severity: "P2",
      })
      .select("id")
      .single();
    expect(ticketError, ticketError?.message).toBeNull();
    expect(ticket).not.toBeNull();
    ticketAId = ticket!.id;
  });

  it("returns tenant_A's ticket when scoped to tenant_A (positive control)", async () => {
    const visible = await ticketsVisibleAs(login, ticketAId!, tenantAId!);
    expect(visible).toContain(ticketAId);
  });

  it("hides tenant_A's ticket when scoped to tenant_B (isolation)", async () => {
    const visible = await ticketsVisibleAs(login, ticketAId!, tenantBId!);
    expect(visible).not.toContain(ticketAId);
    expect(visible.length).toBe(0);
  });

  it("returns zero rows when no tenant is set (fail-closed)", async () => {
    const visible = await ticketsVisibleAs(login, ticketAId!, null);
    expect(visible.length).toBe(0);
  });

  // Teardown in reverse FK order: tickets -> tenants -> projects. Sweep by
  // tenant_id as well as id so a mid-test failure never strands fixture rows.
  afterAll(async () => {
    if (supabase) {
      if (ticketAId) {
        await supabase.from("tickets").delete().eq("id", ticketAId);
      }
      if (tenantAId) {
        await supabase.from("tickets").delete().eq("tenant_id", tenantAId);
        await supabase.from("tenants").delete().eq("id", tenantAId);
      }
      if (tenantBId) {
        await supabase.from("tickets").delete().eq("tenant_id", tenantBId);
        await supabase.from("tenants").delete().eq("id", tenantBId);
      }
      if (projectId) {
        await supabase.from("projects").delete().eq("id", projectId);
      }
    }
    if (login) {
      await login.end();
    }
  });
});
