import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { SYNTHETIC_TICKETS, uniqueConversationId, runTag } from "./fixtures/synthetic-tickets";

/**
 * T-24 — Full-pipeline ticket state machine (integration).
 *
 * Extends the T-19 `new -> triaged` test to the whole Sprint-2 pipeline and
 * migrates it onto the RLS-genuine login path (discharging the `// TODO T-12`
 * that the original T-19 file carried).
 *
 * AUTH MODEL (the load-bearing decision — same as T-18 `rls-isolation.test.ts`)
 * ---------------------------------------------------------------------------
 * `service_role` BYPASSES RLS, so asserting state through it tests nothing while
 * looking green. Therefore:
 *   - `service_role` (supabase-js): SETUP/TEARDOWN ONLY — create the project +
 *     tenant (those tables have no app write policy) and sweep fixtures.
 *   - `ops_hub_app_login` (pg driver): EVERY assertion path AND every ticket
 *     state-machine write (insert / state transition / dedup). This is the
 *     exact RLS-bound, GUC-scoped path `pollFreeScout`, `triageTicket`, and
 *     (future) `ticket-respond` use in production. RLS genuinely engages, so a
 *     broken tenant scope fails loudly instead of passing vacuously.
 *
 * POOLER SAFETY: each login-role operation runs in ONE transaction and sets the
 * tenant/project GUC with `set_config(..., true)` (transaction-local), so it is
 * correct under both session and transaction (PgBouncer 6543) pooling.
 *
 * WHY NO LIVE Inngest / LiteLLM CALLS HERE
 * ----------------------------------------
 * The integration seam QA owns is the DB + RLS + state-machine contract. Each
 * test mirrors the precise SQL the functions execute. Function internals
 * (classification, dispatch, retry, LangFuse) are covered deterministically by
 * the unit suites (`src/inngest/__tests__/*`). Real LiteLLM calls are excluded
 * on purpose: they cost money, are nondeterministic, and would break the
 * <10-min / deterministic CI bar.
 *
 * COVERAGE HONESTY (read before trusting a green run)
 * ---------------------------------------------------
 *   - `new -> triaged`     : LIVE coverage.
 *   - dedup (conv_id UNIQUE): LIVE coverage.
 *   - `triaged -> responded`: WRITTEN BUT DORMANT. The `responded` state is not
 *     in the schema until T-23 ships a migration extending the `tickets` state
 *     CHECK constraint. `beforeAll` probes the constraint; the test dynamic-skips
 *     (NOT passes) until that migration lands, then auto-activates.
 *   - respond error-path   : DEFERRED to a `ticket-respond` unit test (the
 *     faithful form — see `src/inngest/__tests__/ticket-respond.test.ts`). A
 *     transaction-rollback simulation here would test Postgres, not our code.
 *
 * CI BEHAVIOUR: skips (does NOT fail) when staging creds are absent, so CI stays
 * green without secrets. Requires all three: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (setup/teardown), OPS_HUB_APP_LOGIN_URL (assertions).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPS_HUB_APP_LOGIN_URL = process.env.OPS_HUB_APP_LOGIN_URL;

const hasCreds = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && OPS_HUB_APP_LOGIN_URL);

if (!hasCreds) {
  // Surfaced in CI logs so a green run is not mistaken for a passing run.
  console.warn(
    "SKIPPED: T-24 integration suite requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, " +
      "and OPS_HUB_APP_LOGIN_URL (the ops_hub_app_login connection string). " +
      "Set all three to run against staging."
  );
}

const RUN_TAG = runTag("t24");

/**
 * Run a callback AS `ops_hub_app_login` inside one transaction with the
 * tenant + project GUCs set transaction-locally (pooler-safe). Commits on
 * success, rolls back + rethrows on error.
 */
async function asTenant<T>(
  login: PgClient,
  tenantId: string,
  projectId: string,
  fn: (c: PgClient) => Promise<T>
): Promise<T> {
  await login.query("begin");
  try {
    await login.query("select set_config('app.current_tenant', $1, true)", [tenantId]);
    await login.query("select set_config('app.current_project', $1, true)", [projectId]);
    const result = await fn(login);
    await login.query("commit");
    return result;
  } catch (err) {
    await login.query("rollback");
    throw err;
  }
}

describe.skipIf(!hasCreds)("T-24 full pipeline state machine", () => {
  let supabase: SupabaseClient;
  let login: PgClient;

  let projectId: string | undefined;
  let tenantId: string | undefined;

  // Set in beforeAll by probing the live schema; gates the `responded` test.
  let respondedSupported = false;

  beforeAll(async () => {
    // Service-role client: setup/teardown only (bypasses RLS by design).
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Login-role connection: the RLS-bound agent path every assertion exercises.
    login = new PgClient({ connectionString: OPS_HUB_APP_LOGIN_URL! });
    await login.connect();

    // Probe whether T-23's migration has extended the state CHECK to allow
    // 'responded'. Robust to the constraint's auto-generated name: scan every
    // CHECK constraint on `tickets` for the literal. Catalog reads need no GUC.
    const probe = await login.query<{ ok: boolean }>(
      `select coalesce(bool_or(pg_get_constraintdef(c.oid) like '%responded%'), false) as ok
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
        where t.relname = 'tickets' and c.contype = 'c'`
    );
    respondedSupported = probe.rows[0]?.ok === true;
    if (!respondedSupported) {
      console.warn(
        "T-24: 'responded' is not yet an allowed ticket state — the triaged->responded " +
          "test will dynamic-skip until T-23 ships the CHECK-constraint migration."
      );
    }

    // Seed a project, then a tenant under it (service_role — no app write policy
    // on these tables). DB assigns UUIDs; read them back.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: `${RUN_TAG}-project` })
      .select("id")
      .single();
    expect(projectError, projectError?.message).toBeNull();
    expect(project).not.toBeNull();
    projectId = project!.id;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({ project_id: projectId, name: `${RUN_TAG}-tenant`, tier: "starter" })
      .select("id")
      .single();
    expect(tenantError, tenantError?.message).toBeNull();
    expect(tenant).not.toBeNull();
    tenantId = tenant!.id;
  });

  // -------------------------------------------------------------------------
  // Scenario 1 — new -> triaged (LIVE)
  // Mirrors triageOneTicket's persistence: INSERT (state defaults 'new') then
  // UPDATE state='triaged' + urgency/category/routing, all on the login path.
  // -------------------------------------------------------------------------
  it("drives a ticket new -> triaged with classification fields (login path)", async () => {
    const fx = SYNTHETIC_TICKETS.authOutage;

    const ticketId = await asTenant(login, tenantId!, projectId!, async (c) => {
      const ins = await c.query<{ id: string; state: string }>(
        `insert into tickets (project_id, tenant_id, title, body, severity)
         values ($1, $2, $3, $4, $5)
         returning id, state`,
        [projectId, tenantId, fx.title, fx.body, fx.severity]
      );
      // Schema default must land the row in 'new'.
      expect(ins.rows[0]!.state).toBe("new");
      return ins.rows[0]!.id;
    });

    // Re-read as the login role: confirms RLS lets the owning tenant see its row
    // (positive control) AND that it persisted as 'new'.
    const asNew = await asTenant(login, tenantId!, projectId!, (c) =>
      c.query<{ state: string }>("select state from tickets where id = $1", [ticketId])
    );
    expect(asNew.rows).toHaveLength(1);
    expect(asNew.rows[0]!.state).toBe("new");

    // Transition new -> triaged exactly as triageOneTicket's UPDATE does.
    await asTenant(login, tenantId!, projectId!, (c) =>
      c.query(
        `update tickets
            set state = 'triaged', urgency = $1, category = $2, routing = $3,
                owner_agent = 'ticket-triage'
          where id = $4`,
        [fx.expectedTriage.urgency, fx.expectedTriage.category, fx.expectedTriage.routing, ticketId]
      )
    );

    const triaged = await asTenant(login, tenantId!, projectId!, (c) =>
      c.query<{ state: string; urgency: string; category: string; routing: string }>(
        "select state, urgency, category, routing from tickets where id = $1",
        [ticketId]
      )
    );
    expect(triaged.rows[0]).toEqual({
      state: "triaged",
      urgency: fx.expectedTriage.urgency,
      category: fx.expectedTriage.category,
      routing: fx.expectedTriage.routing,
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2 — dedup (LIVE)
  // pollFreeScout uses INSERT ... ON CONFLICT (freescout_conversation_id) DO
  // NOTHING so a re-polled conversation is never re-ingested. Assert the second
  // insert of the same conv_id returns zero rows and exactly one ticket exists.
  // -------------------------------------------------------------------------
  it("does not re-insert a conversation already ingested (freescout_conversation_id dedup)", async () => {
    const fx = SYNTHETIC_TICKETS.billingQuestion;
    const convId = uniqueConversationId();

    const firstInserted = await asTenant(login, tenantId!, projectId!, (c) =>
      c.query<{ id: string }>(
        `insert into tickets (project_id, tenant_id, title, body, severity, freescout_conversation_id)
         values ($1, $2, $3, $4, 'P3', $5::bigint)
         on conflict (freescout_conversation_id) do nothing
         returning id`,
        [projectId, tenantId, fx.title, fx.body, convId]
      )
    );
    expect(firstInserted.rows, "first poll should insert the new conversation").toHaveLength(1);

    // Second poll of the SAME conversation: conflict -> nothing returned.
    const secondInserted = await asTenant(login, tenantId!, projectId!, (c) =>
      c.query<{ id: string }>(
        `insert into tickets (project_id, tenant_id, title, body, severity, freescout_conversation_id)
         values ($1, $2, $3, $4, 'P3', $5::bigint)
         on conflict (freescout_conversation_id) do nothing
         returning id`,
        [projectId, tenantId, fx.title, fx.body, convId]
      )
    );
    expect(secondInserted.rows, "re-poll must NOT insert a duplicate").toHaveLength(0);

    // Exactly one ticket exists for that conversation id.
    const count = await asTenant(login, tenantId!, projectId!, (c) =>
      c.query<{ n: string }>(
        "select count(*)::text as n from tickets where freescout_conversation_id = $1::bigint",
        [convId]
      )
    );
    expect(count.rows[0]!.n).toBe("1");
  });

  // -------------------------------------------------------------------------
  // Scenario 3 — triaged -> responded (DORMANT until T-23)
  // Dynamic-skips (not passes) until T-23's migration adds 'responded' to the
  // tickets state CHECK. Asserts the DB persists state='responded' on the login
  // path — the contract ticket-respond must satisfy. ctx.skip() verified to mark
  // the case SKIPPED, not passed.
  // -------------------------------------------------------------------------
  it("drives a triaged ticket -> responded (login path)", async (ctx) => {
    if (!respondedSupported) {
      ctx.skip();
      return;
    }
    const fx = SYNTHETIC_TICKETS.authOutage;

    const ticketId = await asTenant(login, tenantId!, projectId!, async (c) => {
      const ins = await c.query<{ id: string }>(
        `insert into tickets (project_id, tenant_id, title, body, severity, state, urgency, category, routing)
         values ($1, $2, $3, $4, $5, 'triaged', $6, $7, $8)
         returning id`,
        [
          projectId,
          tenantId,
          fx.title,
          fx.body,
          fx.severity,
          fx.expectedTriage.urgency,
          fx.expectedTriage.category,
          fx.expectedTriage.routing,
        ]
      );
      return ins.rows[0]!.id;
    });

    await asTenant(login, tenantId!, projectId!, (c) =>
      c.query(
        "update tickets set state = 'responded', owner_agent = 'ticket-respond' where id = $1",
        [ticketId]
      )
    );

    const responded = await asTenant(login, tenantId!, projectId!, (c) =>
      c.query<{ state: string }>("select state from tickets where id = $1", [ticketId])
    );
    expect(responded.rows[0]!.state).toBe("responded");
  });

  // Teardown in reverse FK order. Sweep by tenant_id (service_role) so a
  // mid-test failure never strands fixture rows. tickets have no delete policy
  // for ops_hub_app, so teardown MUST use service_role.
  afterAll(async () => {
    if (supabase) {
      if (tenantId) {
        await supabase.from("tickets").delete().eq("tenant_id", tenantId);
        await supabase.from("tenants").delete().eq("id", tenantId);
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
