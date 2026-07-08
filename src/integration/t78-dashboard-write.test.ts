import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import * as settingsWrite from "../metrics/settingsWrite";
import {
  updateSlaConfig,
  toggleFeatureFlag,
  validateSlaPatch,
  validateModelRoutingInput,
  validateFeatureFlagInput,
  NotFoundError,
  ValidationError,
} from "../metrics/settingsWrite";
import { resolveWriteScope } from "../http/dashboardWriteGuards";
import { isAllowedModel } from "../config/model-allowlist";

/**
 * T-78 — Live write-path verification of the Ops Dashboard settings surface
 * (ADR-0006 Decision B, Surfaces 1-3). The LIVE proof that the T-72 migration
 * (applied by the founder via SQL Editor, FQ-67), the T-73/T-74 write path
 * (src/metrics/settingsWrite.ts + src/http/dashboardWriteGuards.ts), and the
 * T-75 UI's server-pinned scope model actually enforce, against the REAL
 * shared Supabase DB through the REAL `ops_hub_app` login role (RLS engaged),
 * the six exit criteria in WORK.md's T-78 row.
 *
 * PATTERN — inherited verbatim from T-60 (src/integration/t60-dashboard-rls.test.ts):
 *   - Connect ONLY as OPS_HUB_APP_LOGIN_URL (non-superuser, RLS on) — the exact
 *     runtime path the dashboard/agents use. NEVER service_role (CLAUDE.md #3);
 *     CI holds no superuser/service_role credential by design.
 *   - Every fixture is created with INSERT inside a transaction that is ALWAYS
 *     ROLLBACK-ed. Nothing is ever committed; the shared prod rows are never
 *     read-mutated. This is strictly in-model (it is what the Inngest functions
 *     and the write routes do at runtime).
 *
 * REAL-FUNCTION vs. REPLICATED-SQL fidelity note (read before trusting a green):
 *   The production write functions in settingsWrite.ts wrap BEGIN...COMMIT
 *   (`withWriteTransaction`) and COMMIT on success — so calling them on a
 *   SUCCESS path would persist to the shared DB, violating the no-commit rule.
 *   `withWriteTransaction` ROLLBACKs on ANY throw, so a real function is
 *   commit-safe IFF it throws before COMMIT — true for every NEGATIVE path
 *   (0-row SELECT -> NotFound; RLS with-check -> 42501), false for every
 *   POSITIVE path. Therefore:
 *     - NEGATIVE / rejection assertions call the REAL functions (highest
 *       fidelity — they throw and roll back, zero commit).
 *     - POSITIVE / success assertions replicate the EXACT write+audit SQL from
 *       settingsWrite.ts, run inside our own always-ROLLBACK transaction. Each
 *       replicated statement cites its settingsWrite.ts source line range so a
 *       reviewer can diff replica vs. source:
 *         * SLA UPDATE via jsonb_set        -> settingsWrite.ts L200-209
 *         * model-routing upsert (ON CONFLICT) -> settingsWrite.ts L326-334
 *         * feature-flag toggle UPDATE       -> settingsWrite.ts L438-444
 *         * audit_log INSERT (each surface)  -> settingsWrite.ts L218-222 / L346-349 / L450-454
 *   Which proofs use the real fn vs. replicated SQL is stated per-check below.
 *
 * NON-VACUOUS RLS DISCIPLINE (per T-60/T-18 doctrine): a 0-row / not-found
 * result only proves RLS if the row TARGETED actually EXISTS but is out of the
 * current GUC scope. Every cross-scope proof below targets a REAL staging row
 * (STAGING_PROJECT_ID / STAGING_TENANT_ID) from a wrong/forged scope — never a
 * random UUID that would merely prove "absent."
 *
 * CI: the DB suites skip without OPS_HUB_APP_LOGIN_URL, so repo-root
 * `vitest run` stays green. The pure app-layer checks (6a, 4-static) always run.
 */

const OPS_HUB_APP_LOGIN_URL = process.env.OPS_HUB_APP_LOGIN_URL;
const STAGING_PROJECT_ID = process.env.STAGING_PROJECT_ID;
const STAGING_TENANT_ID = process.env.STAGING_TENANT_ID;
const hasLogin = Boolean(OPS_HUB_APP_LOGIN_URL);
const hasStagingScope = Boolean(STAGING_PROJECT_ID && STAGING_TENANT_ID);

if (!hasLogin) {
  console.warn(
    "SKIPPED: T-78 live write-path verification requires OPS_HUB_APP_LOGIN_URL " +
      "(ops_hub_app login, non-superuser). Set it to run against staging."
  );
}
if (hasLogin && !hasStagingScope) {
  console.warn(
    "T-78: STAGING_PROJECT_ID/STAGING_TENANT_ID not set — the FK-valid scope " +
      "checks (1/2/3/5/6b) skip; only app-layer (6a) + surface (4-static) checks run."
  );
}

const RUN_TAG = `t78-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const AUDIT_ACTOR = `t78-audit-${RUN_TAG}`;

// ===========================================================================
// Pure app-layer checks — NO DB, always run (even locally / in default CI).
// These are the "prove it at the app layer too" half of the prove-it-twice
// discipline; the DB half lives in the login-role suite below.
// ===========================================================================
describe("T-78 app-layer guards (pure, no DB)", () => {
  // ── Check 3 (app half) — sla_tier cannot be smuggled through the SLA path ──
  it("Check 3a: validateSlaPatch rejects sla_tier even alongside a valid key", () => {
    expect(() => validateSlaPatch({ sla_tier: "premium" })).toThrow(ValidationError);
    expect(() => validateSlaPatch({ sla_tier: "premium", response_target_minutes: 60 })).toThrow(
      /sla_tier/
    );
  });
  it("Check 3a: validateSlaPatch rejects any key outside SLA_ALLOWED_KEYS", () => {
    expect(() => validateSlaPatch({ tier: "premium" })).toThrow(ValidationError);
    expect(() => validateSlaPatch({ response_target_minutes: 0 })).toThrow(/between/);
    expect(() => validateSlaPatch({ response_target_minutes: 10081 })).toThrow(/between/);
    // and it ACCEPTS a correctly-bounded patch (positive control):
    expect(validateSlaPatch({ response_target_minutes: 60 })).toEqual({
      response_target_minutes: 60,
    });
  });

  // ── Check 4 (surface half) — no create/delete flag path is EXPORTED ────────
  it("Check 4-static: the settings write module exports only an UPDATE-only flag toggle (no create/delete)", () => {
    const exported = Object.keys(settingsWrite);
    // The one and only feature-flag write entrypoint is the toggle.
    expect(exported).toContain("toggleFeatureFlag");
    // Nothing that could create or delete a flag is reachable from this surface.
    const forbidden = exported.filter((k) =>
      /(create|insert|delete|remove|add).*flag|flag.*(create|insert|delete|remove|add)/i.test(k)
    );
    expect(forbidden).toEqual([]);
    // toggleFeatureFlag is a function; validateFeatureFlagInput exists and is
    // the only flag validator (UPDATE payload shape: id + enabled + rollout%).
    expect(typeof toggleFeatureFlag).toBe("function");
    expect(typeof validateFeatureFlagInput).toBe("function");
  });

  // ── Check 6 (app half) — resolveWriteScope is fail-closed on a missing GUC ─
  it("Check 6a: resolveWriteScope() returns null when either scope env var is unset (no silent unscoped write)", () => {
    const savedP = process.env.POLLING_PROJECT_ID;
    const savedT = process.env.POLLING_TENANT_ID;
    try {
      delete process.env.POLLING_PROJECT_ID;
      delete process.env.POLLING_TENANT_ID;
      expect(resolveWriteScope()).toBeNull();

      // only one set -> still null (an incomplete pair is a misconfigured deploy)
      process.env.POLLING_PROJECT_ID = randomUUID();
      expect(resolveWriteScope()).toBeNull();
      delete process.env.POLLING_PROJECT_ID;
      process.env.POLLING_TENANT_ID = randomUUID();
      expect(resolveWriteScope()).toBeNull();

      // blank string is treated as unset -> null (positive control)
      process.env.POLLING_PROJECT_ID = "   ";
      expect(resolveWriteScope()).toBeNull();
    } finally {
      if (savedP === undefined) delete process.env.POLLING_PROJECT_ID;
      else process.env.POLLING_PROJECT_ID = savedP;
      if (savedT === undefined) delete process.env.POLLING_TENANT_ID;
      else process.env.POLLING_TENANT_ID = savedT;
    }
  });
});

// ===========================================================================
// Live DB verification — as the ops_hub_app login role, RLS engaged.
// ===========================================================================
describe.skipIf(!hasLogin)("T-78 dashboard write-path (live, ops_hub_app login role)", () => {
  let pool: Pool;

  // Run `fn` inside a transaction that is ALWAYS rolled back (never commits).
  async function inRollbackTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      return await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  }

  // Assert `run` raises a pg error with the given SQLSTATE. Isolated in its own
  // rolled-back tx because a raised error aborts the transaction (25P02), so it
  // cannot share a tx with any following query.
  async function expectSqlState(
    code: string,
    run: (c: PoolClient) => Promise<unknown>
  ): Promise<void> {
    const c = await pool.connect();
    let captured: (Error & { code?: string }) | undefined;
    try {
      await c.query("BEGIN");
      await run(c);
    } catch (e) {
      captured = e as Error & { code?: string };
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    expect(captured, `expected a thrown pg error with SQLSTATE ${code}`).toBeDefined();
    expect(captured!.code).toBe(code);
  }

  async function setScope(c: PoolClient, guc: { project?: string; tenant?: string }) {
    if (guc.tenant !== undefined)
      await c.query("SELECT set_config('app.current_tenant', $1, true)", [guc.tenant]);
    if (guc.project !== undefined)
      await c.query("SELECT set_config('app.current_project', $1, true)", [guc.project]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: OPS_HUB_APP_LOGIN_URL!, max: 4 });
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ── Migration-presence probe — HARD assertions, never a skip ──────────────
  // If T-72 is not live in this DB, these go RED with a clear message (the same
  // discipline T-60 used when it caught the unapplied T-58 migration), rather
  // than letting every downstream check pass vacuously. Doubles as printed
  // evidence that the environment matches the reviewed migration.
  describe("Migration presence (T-72 must be live)", () => {
    it("agent_model_routing table exists", async () => {
      const c = await pool.connect();
      try {
        const { rows } = await c.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_class WHERE relname = 'agent_model_routing' AND relkind = 'r'"
        );
        console.log(`T-78 probe: agent_model_routing present = ${rows[0].n === "1"}`);
        expect(rows[0].n).toBe("1");
      } finally {
        c.release();
      }
    });

    it("agent_model_routing has exactly amr_select / amr_insert / amr_update policies", async () => {
      const c = await pool.connect();
      try {
        const { rows } = await c.query<{ polname: string }>(
          `SELECT p.polname FROM pg_policy p JOIN pg_class cl ON cl.oid = p.polrelid
            WHERE cl.relname = 'agent_model_routing' ORDER BY p.polname`
        );
        const names = rows.map((r) => r.polname);
        console.log(`T-78 probe: agent_model_routing policies = [${names.join(", ")}]`);
        expect(names).toEqual(["amr_insert", "amr_select", "amr_update"]);
      } finally {
        c.release();
      }
    });

    it("tenants has the tenants_update_sla policy", async () => {
      const c = await pool.connect();
      try {
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_policy p JOIN pg_class cl ON cl.oid = p.polrelid
            WHERE cl.relname = 'tenants' AND p.polname = 'tenants_update_sla'`
        );
        console.log(`T-78 probe: tenants_update_sla present = ${rows[0].n === "1"}`);
        expect(rows[0].n).toBe("1");
      } finally {
        c.release();
      }
    });

    it("tenants.sla_tier column exists (so Check 3b's 42501 proves 'no grant', not 'no column')", async () => {
      const c = await pool.connect();
      try {
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'sla_tier'`
        );
        console.log(`T-78 probe: tenants.sla_tier column present = ${rows[0].n === "1"}`);
        expect(rows[0].n).toBe("1");
      } finally {
        c.release();
      }
    });
  });

  // ── Check 4 (behavioral) — needs login only ───────────────────────────────
  // NOTE ON LAYER: feature_flags_write is intentionally `FOR ALL to ops_hub_app`
  // (agents legitimately INSERT/DELETE flags — that is how the Check-1 fixture
  // flag below gets created). So a raw DELETE/INSERT by the login role WILL
  // succeed inside a rollback — that is BY DESIGN and is NOT a T-78 failure.
  // Check 4 is an API-SURFACE property: the dashboard route surface only exposes
  // an UPDATE-only toggle. Proven statically above (4-static) + behaviorally here.
  describe("Check 4: feature-flag create/delete is unreachable from the dashboard surface", () => {
    it("the REAL toggleFeatureFlag on a non-existent id returns NotFound — never creates a row", async () => {
      const missingId = randomUUID();
      const projectId = STAGING_PROJECT_ID ?? randomUUID();
      // Real fn: SELECT (0 rows) -> throws NotFoundError BEFORE any write; its
      // own withWriteTransaction rolls the SELECT-only tx back. Zero commit.
      await expect(
        toggleFeatureFlag(
          pool,
          { projectId },
          {
            id: missingId,
            enabled: true,
            rolloutPercentage: 50,
          }
        )
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── Checks that need an FK-valid real scope (INSERT/UPDATE against real rows) ─
  describe.skipIf(!hasStagingScope)(
    "live writes against the real staging scope (all inside ROLLBACK)",
    () => {
      const P = () => STAGING_PROJECT_ID!;
      const T = () => STAGING_TENANT_ID!;

      // =====================================================================
      // Check 1 — valid in-scope writes succeed & are visible in the same read.
      // Positive path -> REPLICATED SQL (real fn would COMMIT). Rolled back.
      // =====================================================================
      describe("Check 1: valid in-scope writes succeed", () => {
        it("Check 1a: an in-scope SLA edit applies via jsonb_set and reads back (settingsWrite L200-209)", async () => {
          const patch = validateSlaPatch({ response_target_minutes: 77 }); // app validator accepts
          await inRollbackTx(async (c) => {
            await setScope(c, { tenant: T(), project: P() });
            const before = await c.query<{ sla_config: unknown }>(
              "SELECT sla_config FROM tenants WHERE id = $1",
              [T()]
            );
            expect(before.rowCount).toBe(1); // positive control: the tenant IS in scope
            // Replicated from settingsWrite.updateSlaConfig L200-209 (jsonb_set on
            // the specific key, never a blind blob overwrite).
            const upd = await c.query<{ sla_config: { response_target_minutes?: number } }>(
              `UPDATE tenants
                  SET sla_config = jsonb_set(sla_config, '{response_target_minutes}', $1::jsonb, true)
                WHERE id = $2 RETURNING sla_config`,
              [JSON.stringify(patch.response_target_minutes), T()]
            );
            expect(upd.rowCount).toBe(1);
            expect(upd.rows[0].sla_config.response_target_minutes).toBe(77);
            // same-transaction audit row (settingsWrite L218-222)
            const audit = await c.query(
              `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
               VALUES ($1, $2, $3, 'sla_config.update', 'tenant', $4, $5)`,
              [
                P(),
                T(),
                AUDIT_ACTOR,
                T(),
                JSON.stringify({
                  before: before.rows[0].sla_config,
                  after: upd.rows[0].sla_config,
                }),
              ]
            );
            expect(audit.rowCount).toBe(1);
            // change is visible within the same scoped read
            const readback = await c.query<{ sla_config: { response_target_minutes?: number } }>(
              "SELECT sla_config FROM tenants WHERE id = $1",
              [T()]
            );
            expect(readback.rows[0].sla_config.response_target_minutes).toBe(77);
          });
        });

        it("Check 1b: an in-scope model-routing upsert applies and reads back (settingsWrite L326-334)", async () => {
          const input = validateModelRoutingInput({
            functionKey: "triage",
            primaryModel: "triage-model",
            fallbackModel: "fallback-model",
          });
          expect(isAllowedModel("triage", "triage-model")).toBe(true); // allowlist positive control
          await inRollbackTx(async (c) => {
            await setScope(c, { project: P() });
            const before = await c.query(
              "SELECT id FROM agent_model_routing WHERE project_id = $1 AND function_key = $2",
              [P(), input.functionKey]
            );
            // Replicated from settingsWrite.upsertModelRouting L326-334.
            const up = await c.query<{
              id: string;
              primary_model: string;
              fallback_model: string | null;
            }>(
              `INSERT INTO agent_model_routing (project_id, function_key, primary_model, fallback_model, updated_by)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (project_id, function_key)
               DO UPDATE SET primary_model = EXCLUDED.primary_model,
                             fallback_model = EXCLUDED.fallback_model,
                             updated_by = EXCLUDED.updated_by
               RETURNING id, primary_model, fallback_model`,
              [P(), input.functionKey, input.primaryModel, input.fallbackModel, AUDIT_ACTOR]
            );
            expect(up.rowCount).toBe(1);
            expect(up.rows[0].primary_model).toBe("triage-model");
            expect(up.rows[0].fallback_model).toBe("fallback-model");
            // project-scoped audit row: tenant_id NULL (settingsWrite L346-349)
            const audit = await c.query(
              `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
               VALUES ($1, NULL, $2, 'model_routing.update', 'agent_model_routing', $3, $4)`,
              [
                P(),
                AUDIT_ACTOR,
                up.rows[0].id,
                JSON.stringify({ before: before.rows[0] ?? null, after: up.rows[0] }),
              ]
            );
            expect(audit.rowCount).toBe(1);
            const readback = await c.query(
              "SELECT primary_model FROM agent_model_routing WHERE project_id = $1 AND function_key = $2",
              [P(), input.functionKey]
            );
            expect((readback.rows[0] as { primary_model: string }).primary_model).toBe(
              "triage-model"
            );
          });
        });

        it("Check 1c: an in-scope feature-flag toggle applies and reads back (settingsWrite L438-444)", async () => {
          const input = validateFeatureFlagInput({
            id: randomUUID(), // replaced with the real fixture id below
            enabled: true,
            rolloutPercentage: 50,
          });
          await inRollbackTx(async (c) => {
            await setScope(c, { project: P() });
            // Fixture: create an in-scope flag (feature_flags_write FOR ALL allows
            // this for ops_hub_app; rolled back with everything else).
            const ins = await c.query<{ id: string }>(
              `INSERT INTO feature_flags (project_id, environment, flag_key, enabled, rollout_percentage)
               VALUES ($1, 'staging', $2, false, 0) RETURNING id`,
              [P(), `${RUN_TAG}-flag`]
            );
            expect(ins.rowCount).toBe(1);
            const flagId = ins.rows[0].id;
            const before = await c.query(
              "SELECT id, enabled, rollout_percentage FROM feature_flags WHERE id = $1 AND project_id = $2",
              [flagId, P()]
            );
            expect(before.rowCount).toBe(1);
            // Replicated toggle from settingsWrite.toggleFeatureFlag L438-444.
            const upd = await c.query<{ id: string; enabled: boolean; rollout_percentage: number }>(
              `UPDATE feature_flags SET enabled = $1, rollout_percentage = $2
                WHERE id = $3 AND project_id = $4
                RETURNING id, enabled, rollout_percentage`,
              [input.enabled, input.rolloutPercentage, flagId, P()]
            );
            expect(upd.rowCount).toBe(1);
            expect(upd.rows[0].enabled).toBe(true);
            expect(upd.rows[0].rollout_percentage).toBe(50);
            const audit = await c.query(
              `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
               VALUES ($1, NULL, $2, 'feature_flag.toggle', 'feature_flags', $3, $4)`,
              [
                P(),
                AUDIT_ACTOR,
                flagId,
                JSON.stringify({ before: before.rows[0], after: upd.rows[0] }),
              ]
            );
            expect(audit.rowCount).toBe(1);
          });
        });
      });

      // =====================================================================
      // Check 2 — cross-tenant / cross-project writes are rejected by RLS
      // (`with check` / `using`), not merely by application logic. Load-bearing
      // security property. Targets REAL rows from a wrong scope (non-vacuous).
      // =====================================================================
      describe("Check 2: cross-scope writes are rejected at the DB layer", () => {
        it("Check 2a (with-check, load-bearing): INSERT agent_model_routing for the REAL project while scoped elsewhere -> 42501", async () => {
          // FK is satisfied (project_id = REAL P), so the ONLY thing that can
          // reject the row is amr_insert's `with check (project_id = current_project_id())`.
          // Postgres evaluates WITH CHECK before the unique-index insert, so a
          // pre-existing (P,'kb_learn') row cannot pre-empt this with a 23505.
          await expectSqlState("42501", async (c) => {
            await setScope(c, { project: randomUUID() }); // wrong/forged scope
            await c.query(
              `INSERT INTO agent_model_routing (project_id, function_key, primary_model)
               VALUES ($1, 'kb_learn', 'triage-model')`,
              [P()] // the REAL project — the forged part is the session scope, not the FK
            );
          });
        });

        it("Check 2b (using, SLA): UPDATE the REAL tenant's sla_config from a wrong tenant scope -> 0 rows", async () => {
          await inRollbackTx(async (c) => {
            await setScope(c, { tenant: randomUUID(), project: P() });
            const upd = await c.query(
              `UPDATE tenants
                  SET sla_config = jsonb_set(sla_config, '{response_target_minutes}', '99'::jsonb, true)
                WHERE id = $1 RETURNING id`,
              [T()] // REAL tenant, hidden by using(id = current_tenant_id())
            );
            expect(upd.rowCount).toBe(0);
          });
        });

        it("Check 2b (app-fn corroboration): the REAL updateSlaConfig refuses an out-of-scope tenant (NotFound, no commit)", async () => {
          await expect(
            updateSlaConfig(
              pool,
              { projectId: P(), tenantId: randomUUID() },
              {
                response_target_minutes: 42,
              }
            )
          ).rejects.toBeInstanceOf(NotFoundError);
        });

        it("Check 2c (feature-flag forged key): a flag created in project P cannot be toggled from a foreign scope -> 0 rows", async () => {
          await inRollbackTx(async (c) => {
            await setScope(c, { project: P() });
            const ins = await c.query<{ id: string }>(
              `INSERT INTO feature_flags (project_id, environment, flag_key, enabled, rollout_percentage)
               VALUES ($1, 'staging', $2, false, 0) RETURNING id`,
              [P(), `${RUN_TAG}-flag-xscope`]
            );
            const flagId = ins.rows[0].id;
            // Switch to a foreign scope (as if the dashboard were pinned to a
            // different project and a client forged this id).
            await setScope(c, { project: randomUUID() });
            const seen = await c.query("SELECT id FROM feature_flags WHERE id = $1", [flagId]);
            expect(seen.rowCount).toBe(0); // RLS feature_flags_select hides it
            // The exact toggle WHERE clause finds nothing -> a 404 in the real fn.
            const upd = await c.query(
              `UPDATE feature_flags SET enabled = true, rollout_percentage = 100
                WHERE id = $1 AND project_id = $2 RETURNING id`,
              [flagId, randomUUID()]
            );
            expect(upd.rowCount).toBe(0);
          });
        });
      });

      // =====================================================================
      // Check 3 — sla_tier cannot be written via the SLA path (prove it twice:
      // app-layer done above in 3a; DB-layer grant proof here).
      // =====================================================================
      describe("Check 3: sla_tier is unwritable via the SLA grant", () => {
        it("Check 3b: even bypassing the app layer, ops_hub_app has NO grant to UPDATE tenants.sla_tier -> 42501", async () => {
          // Column exists (probe asserted it), so a 42501 here proves 'no grant',
          // not 42703 'no column'. This is the DB-layer half of T-B3.
          await expectSqlState("42501", async (c) => {
            await setScope(c, { tenant: T(), project: P() });
            await c.query("UPDATE tenants SET sla_tier = 'premium' WHERE id = $1", [T()]);
          });
        });

        it("Check 3b (control): the SAME role CAN update sla_config on the same row (grant is column-scoped, not row-blocked)", async () => {
          await inRollbackTx(async (c) => {
            await setScope(c, { tenant: T(), project: P() });
            const upd = await c.query(
              `UPDATE tenants
                  SET sla_config = jsonb_set(sla_config, '{response_target_minutes}', '60'::jsonb, true)
                WHERE id = $1 RETURNING id`,
              [T()]
            );
            expect(upd.rowCount).toBe(1); // proves the 42501 above is column-specific, not a blanket denial
          });
        });
      });

      // =====================================================================
      // Check 5 — an audit_log row is emitted atomically with each config
      // change, and no orphan audit row survives a rollback.
      // =====================================================================
      describe("Check 5: audit atomicity (exactly one row per change; none after rollback)", () => {
        it("in-txn: one config change emits exactly one tagged audit row; after ROLLBACK a correct-scope read sees zero", async () => {
          // Phase A — do the change + audit in ONE tx, assert both visible, roll back.
          await inRollbackTx(async (c) => {
            await setScope(c, { project: P() });
            const up = await c.query<{ id: string }>(
              `INSERT INTO agent_model_routing (project_id, function_key, primary_model, updated_by)
               VALUES ($1, 'respond', 'triage-model', $2)
               ON CONFLICT (project_id, function_key)
               DO UPDATE SET primary_model = EXCLUDED.primary_model, updated_by = EXCLUDED.updated_by
               RETURNING id`,
              [P(), AUDIT_ACTOR]
            );
            expect(up.rowCount).toBe(1);
            await c.query(
              `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
               VALUES ($1, NULL, $2, 'model_routing.update', 'agent_model_routing', $3, $4)`,
              [
                P(),
                AUDIT_ACTOR,
                up.rows[0].id,
                JSON.stringify({ before: null, after: { id: up.rows[0].id } }),
              ]
            );
            // EXACTLY ONE audit row for this change, read in the same tx & scope.
            const inTx = await c.query<{ n: string }>(
              "SELECT count(*)::text AS n FROM audit_log WHERE actor = $1",
              [AUDIT_ACTOR]
            );
            expect(inTx.rows[0].n).toBe("1"); // positive control (pre-rollback)
          });
          // Phase B — fresh connection, CORRECT project scope. If the read were
          // done under a wrong scope, a 0 would be ambiguous (RLS could be hiding
          // it); under the correct scope, 0 means the rollback truly removed it.
          const c2 = await pool.connect();
          try {
            await c2.query("BEGIN");
            await setScope(c2, { project: P(), tenant: T() });
            const after = await c2.query<{ n: string }>(
              "SELECT count(*)::text AS n FROM audit_log WHERE actor = $1",
              [AUDIT_ACTOR]
            );
            expect(after.rows[0].n).toBe("0"); // no orphan audit row survived the rollback
          } finally {
            await c2.query("ROLLBACK").catch(() => {});
            c2.release();
          }
        });
      });

      // =====================================================================
      // Check 6 (DB half) — a write with NO GUC set must be rejected, never
      // silently landing unscoped. (App half = Check 6a above.)
      // =====================================================================
      describe("Check 6b: fail-closed at the DB layer when no GUC is set", () => {
        it("INSERT agent_model_routing with no project GUC -> with-check (project_id = NULL) -> 42501", async () => {
          await expectSqlState("42501", async (c) => {
            // deliberately NO set_config — current_project_id() resolves to NULL
            await c.query(
              `INSERT INTO agent_model_routing (project_id, function_key, primary_model)
               VALUES ($1, 'triage', 'triage-model')`,
              [P()]
            );
          });
        });

        it("UPDATE tenants.sla_config with no tenant GUC -> using(id = NULL) -> 0 rows (never unscoped-writes)", async () => {
          await inRollbackTx(async (c) => {
            // no set_config
            const upd = await c.query(
              `UPDATE tenants
                  SET sla_config = jsonb_set(sla_config, '{response_target_minutes}', '55'::jsonb, true)
                WHERE id = $1 RETURNING id`,
              [T()]
            );
            expect(upd.rowCount).toBe(0);
          });
        });
      });
    }
  );
});
