import type { Pool, PoolClient } from "pg";
import { isAllowedModel, type RoutingFunctionKey } from "../config/model-allowlist";
import type { WriteScope } from "../http/dashboardWriteGuards";

// T-74 — Ops Dashboard settings write surface (ADR-0006 Decision B, Surfaces
// 1-3). Lives alongside dashboard.ts / agentCost.ts / evalHealth.ts on
// purpose — ALL dashboard SQL, read AND write, is centralized in
// src/metrics/ so there is exactly one place to audit RLS/tenant scoping
// (T-59's "query centralization" discipline extended to writes). `web/`
// holds zero SQL and zero validation logic of its own; `web/lib/writeQueries.ts`
// is a thin bound-scope adapter, and `web/app/api/**/route.ts` are thinner
// still (parse request, call here, map errors to HTTP status).
//
// Every write function in this file:
//   - takes an already-resolved WriteScope (server-pinned, never re-derives
//     it) or a project-only subset for project-scoped surfaces;
//   - opens ONE transaction, sets the transaction-local RLS GUC(s), reads
//     the "before" state, performs the write, inserts the SAME-TRANSACTION
//     audit_log row, then commits — atomic by construction (T-78 verifies);
//   - connects via the caller's `ops_hub_app`-authenticated Pool
//     (OPS_HUB_APP_LOGIN_URL) — never service_role (CLAUDE.md #3);
//   - throws a `SettingsWriteError` subclass with an HTTP status baked in,
//     so route handlers can map errors without re-deriving status codes.

// ---------------------------------------------------------------------------
// Error hierarchy — every thrown error a route handler needs to map to HTTP
// carries its own status. Anything else (a raw pg error, a bug) is NOT an
// instance of this class and the route handler treats it as a 500 + logs it
// server-side only (never leak DSNs/stack traces in the response body).
// ---------------------------------------------------------------------------
export class SettingsWriteError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "SettingsWriteError";
  }
}

export class ValidationError extends SettingsWriteError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends SettingsWriteError {
  constructor(message: string) {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

// Schema/grant not applied yet in this environment (T-72 pending FQ-67) or a
// scoped row missing from RLS's perspective — both are "the deploy isn't
// ready for this write yet," not a caller error and not a crash.
export class SchemaNotReadyError extends SettingsWriteError {
  constructor(message: string) {
    super(message, 503);
    this.name = "SchemaNotReadyError";
  }
}

const UNDEFINED_TABLE = "42P01"; // Postgres SQLSTATE for undefined_table

function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

async function withWriteTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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

const ACTOR = "dashboard"; // FQ-66/T-77 (Option B): single shared credential, no per-user identity.

// ===========================================================================
// Surface 1 — SLA target write (tenants.sla_config, tenant-scoped)
// ===========================================================================

// Only key this codebase actually reads today (src/inngest/sla-monitor.ts,
// src/metrics/dashboard.ts both key off this exact name). The validator is
// structured as a per-key allowlist + bounds table specifically so a future
// key can be added in one place without touching the write path's shape.
export const SLA_ALLOWED_KEYS = ["response_target_minutes"] as const;
export type SlaKey = (typeof SLA_ALLOWED_KEYS)[number];

// Bounded positive integers (ADR-0006 §Surface 1). 1 minute floor (a target
// of 0 or negative is nonsensical); 10080 minutes (7 days) ceiling — well
// beyond any realistic support SLA, generous enough not to need revisiting
// soon, tight enough to catch a fat-fingered extra digit.
const SLA_BOUNDS: Record<SlaKey, { min: number; max: number }> = {
  response_target_minutes: { min: 1, max: 10080 },
};

// Keys are drawn only from SLA_ALLOWED_KEYS (checked below), so this is safe
// to interpolate into the jsonb_set path literal — but re-assert the shape
// defensively in case SLA_ALLOWED_KEYS ever grows a key with unsafe
// characters.
const SAFE_KEY_RE = /^[a-z_][a-z0-9_]*$/;

export type SlaPatch = Partial<Record<SlaKey, number>>;

/**
 * Validate a raw JSON request body into a bounded SLA patch. Rejects:
 *   - non-object payloads;
 *   - an empty patch;
 *   - `sla_tier` even if present alongside valid keys (T-B3 — the +$200
 *     CAD/mo billing lever; the DB grant already excludes it, this is
 *     defense-in-depth at the app layer per ADR-0006);
 *   - any key outside SLA_ALLOWED_KEYS;
 *   - non-integer or out-of-bounds values.
 */
export function validateSlaPatch(payload: unknown): SlaPatch {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("payload must be a JSON object of sla_config keys");
  }
  const obj = payload as Record<string, unknown>;

  if ("sla_tier" in obj) {
    throw new ValidationError(
      "sla_tier is a billing lever, not an SLA target, and cannot be written via this route"
    );
  }

  const keys = Object.keys(obj);
  if (keys.length === 0) {
    throw new ValidationError("payload must include at least one sla_config key");
  }

  const patch: SlaPatch = {};
  for (const key of keys) {
    if (!(SLA_ALLOWED_KEYS as readonly string[]).includes(key) || !SAFE_KEY_RE.test(key)) {
      throw new ValidationError(`unknown or unwritable sla_config key: "${key}"`);
    }
    const value = obj[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new ValidationError(`"${key}" must be an integer`);
    }
    const bounds = SLA_BOUNDS[key as SlaKey];
    if (value < bounds.min || value > bounds.max) {
      throw new ValidationError(`"${key}" must be between ${bounds.min} and ${bounds.max}`);
    }
    patch[key as SlaKey] = value;
  }
  return patch;
}

export type SlaWriteResult = { before: unknown; after: unknown };

/**
 * Apply a validated SLA patch via `jsonb_set` on the specific keys named in
 * `patch` — NEVER a blind blob overwrite that could drop unrelated structure
 * in `sla_config` (ADR-0006 §Surface 1). Emits the audit_log row in the same
 * transaction, stamping the real tenant_id (and project_id, harmlessly —
 * tenants belong to exactly one project).
 *
 * A 0-row UPDATE (RLS denied it, or the tenant id doesn't exist in scope) is
 * treated as an error, not a silent no-op — this also covers the pre-T-72
 * state, where `tenants` has no write policy at all and every UPDATE from
 * `ops_hub_app` affects zero rows.
 */
export async function updateSlaConfig(
  pool: Pool,
  scope: WriteScope,
  patch: SlaPatch,
  actor: string = ACTOR
): Promise<SlaWriteResult> {
  return withWriteTransaction(pool, async (client) => {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [scope.tenantId]);
    await client.query("SELECT set_config('app.current_project', $1, true)", [scope.projectId]);

    const { rows: beforeRows } = await client.query<{ sla_config: unknown }>(
      `SELECT sla_config FROM tenants WHERE id = $1`,
      [scope.tenantId]
    );
    if (beforeRows.length === 0) {
      throw new NotFoundError("tenant not found in scope");
    }
    const before = beforeRows[0].sla_config;

    let setExpr = "sla_config";
    const params: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(patch)) {
      setExpr = `jsonb_set(${setExpr}, '{${key}}', $${i}::jsonb, true)`;
      params.push(JSON.stringify(value));
      i++;
    }
    params.push(scope.tenantId);

    const { rows, rowCount } = await client.query<{ sla_config: unknown }>(
      `UPDATE tenants SET sla_config = ${setExpr} WHERE id = $${i} RETURNING sla_config`,
      params
    );
    if (rowCount !== 1) {
      throw new SchemaNotReadyError(
        "SLA update did not apply — the sla_config write grant/policy (T-72) may not be applied " +
          "yet in this environment (see FQ-67), or the tenant is out of scope"
      );
    }
    const after = rows[0].sla_config;

    await client.query(
      `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
       VALUES ($1, $2, $3, 'sla_config.update', 'tenant', $4, $5)`,
      [scope.projectId, scope.tenantId, actor, scope.tenantId, JSON.stringify({ before, after })]
    );

    return { before, after };
  });
}

// ===========================================================================
// Surface 2 — Model-routing write (agent_model_routing, project-scoped)
// ===========================================================================

export type ModelRoutingWriteInput = {
  functionKey: RoutingFunctionKey;
  primaryModel: string;
  fallbackModel: string | null;
};

const FUNCTION_KEYS: readonly RoutingFunctionKey[] = ["triage", "respond", "kb_learn"];

/**
 * Validate a raw JSON request body for a model-routing write. Rejects an
 * unknown function_key, an unlisted primary model (T-79's curated allowlist,
 * fail-closed — the same guarantee resolveModelRouting's read side enforces,
 * T-73), and a fallback value on any function other than `triage` (only
 * Triage carries fallback logic this sprint, ADR-0006 §Fallback scope).
 */
export function validateModelRoutingInput(payload: unknown): ModelRoutingWriteInput {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("payload must be a JSON object");
  }
  const obj = payload as Record<string, unknown>;

  const functionKey = obj.functionKey;
  if (
    typeof functionKey !== "string" ||
    !FUNCTION_KEYS.includes(functionKey as RoutingFunctionKey)
  ) {
    throw new ValidationError('functionKey must be one of "triage" | "respond" | "kb_learn"');
  }
  const fk = functionKey as RoutingFunctionKey;

  const primaryModel = obj.primaryModel;
  if (typeof primaryModel !== "string" || primaryModel.trim() === "") {
    throw new ValidationError("primaryModel is required");
  }
  if (!isAllowedModel(fk, primaryModel)) {
    throw new ValidationError(`"${primaryModel}" is not an allowlisted model for "${fk}"`);
  }

  let fallbackModel: string | null = null;
  if (obj.fallbackModel !== undefined && obj.fallbackModel !== null) {
    if (typeof obj.fallbackModel !== "string" || obj.fallbackModel.trim() === "") {
      throw new ValidationError("fallbackModel must be a non-empty string if provided");
    }
    if (fk !== "triage") {
      throw new ValidationError(`fallbackModel may only be set for "triage" (got "${fk}")`);
    }
    if (!isAllowedModel(fk, obj.fallbackModel)) {
      throw new ValidationError(`"${obj.fallbackModel}" is not an allowlisted model for "${fk}"`);
    }
    fallbackModel = obj.fallbackModel;
  }

  return { functionKey: fk, primaryModel, fallbackModel };
}

export type ModelRoutingRow = {
  id: string;
  primary_model: string;
  fallback_model: string | null;
};

export type ModelRoutingWriteResult = { before: ModelRoutingRow | null; after: ModelRoutingRow };

/**
 * Upsert one (project_id, function_key) row. Only INSERT/UPDATE are ever
 * issued (matches the migration's grant — INSERT, UPDATE only; DELETE is
 * revoked at the DB layer). Same-transaction audit_log row stamps
 * `tenant_id = NULL` + the real `project_id` (routing is project-scoped).
 *
 * Pre-migration safety: if `agent_model_routing` does not exist yet (T-72
 * not applied — FQ-67 pending), the INSERT raises 42P01. Caught and
 * re-thrown as a clear `SchemaNotReadyError` (503) rather than a raw 500 or
 * an uncaught crash — this route must "fail with a clear error, not crash or
 * corrupt anything" per this task's own spec.
 */
export async function upsertModelRouting(
  pool: Pool,
  scope: Pick<WriteScope, "projectId">,
  input: ModelRoutingWriteInput,
  actor: string = ACTOR
): Promise<ModelRoutingWriteResult> {
  try {
    return await withWriteTransaction(pool, async (client) => {
      await client.query("SELECT set_config('app.current_project', $1, true)", [scope.projectId]);

      const { rows: beforeRows } = await client.query<ModelRoutingRow>(
        `SELECT id, primary_model, fallback_model
           FROM agent_model_routing
          WHERE project_id = $1 AND function_key = $2`,
        [scope.projectId, input.functionKey]
      );
      const before = beforeRows[0] ?? null;

      const { rows, rowCount } = await client.query<ModelRoutingRow>(
        `INSERT INTO agent_model_routing (project_id, function_key, primary_model, fallback_model, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (project_id, function_key)
         DO UPDATE SET primary_model = EXCLUDED.primary_model,
                       fallback_model = EXCLUDED.fallback_model,
                       updated_by = EXCLUDED.updated_by
         RETURNING id, primary_model, fallback_model`,
        [scope.projectId, input.functionKey, input.primaryModel, input.fallbackModel, actor]
      );
      if (rowCount !== 1) {
        // RLS denied the write (with-check failed) rather than throwing —
        // treat identically to the SLA 0-row case: a clear, non-crashing error.
        throw new SchemaNotReadyError(
          "model-routing write did not apply — check the project is in scope and T-72's " +
            "RLS policies are applied (see FQ-67)"
        );
      }
      const after = rows[0];

      await client.query(
        `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
         VALUES ($1, NULL, $2, 'model_routing.update', 'agent_model_routing', $3, $4)`,
        [scope.projectId, actor, after.id, JSON.stringify({ before, after })]
      );

      return { before, after };
    });
  } catch (err) {
    if (isUndefinedTable(err)) {
      throw new SchemaNotReadyError(
        "agent_model_routing table not found — T-72's migration has not been applied to this " +
          "environment yet (see FQ-67)"
      );
    }
    throw err;
  }
}

// ===========================================================================
// Surface 3 — Feature-flag toggle (feature_flags, project-scoped, UPDATE-only)
// ===========================================================================

export type FeatureFlagWriteInput = {
  id: string;
  enabled: boolean;
  rolloutPercentage: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a raw JSON request body for a feature-flag toggle. `id` is the
 * client-submitted record key (ADR-0006: "the client submits only the value
 * to change and the record key, never a tenant/project id") — project scope
 * is still applied server-side in the UPDATE's WHERE clause, so a forged id
 * from another project is rejected there, not trusted here.
 */
export function validateFeatureFlagInput(payload: unknown): FeatureFlagWriteInput {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("payload must be a JSON object");
  }
  const obj = payload as Record<string, unknown>;

  const id = obj.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new ValidationError("id must be a valid feature_flags row uuid");
  }
  const enabled = obj.enabled;
  if (typeof enabled !== "boolean") {
    throw new ValidationError("enabled must be a boolean");
  }
  const rolloutPercentage = obj.rolloutPercentage;
  if (
    typeof rolloutPercentage !== "number" ||
    !Number.isInteger(rolloutPercentage) ||
    rolloutPercentage < 0 ||
    rolloutPercentage > 100
  ) {
    throw new ValidationError("rolloutPercentage must be an integer between 0 and 100");
  }

  return { id, enabled, rolloutPercentage };
}

export type FeatureFlagRow = { id: string; enabled: boolean; rollout_percentage: number };
export type FeatureFlagWriteResult = { before: FeatureFlagRow; after: FeatureFlagRow };

/**
 * UPDATE an EXISTING `feature_flags` row's (enabled, rollout_percentage)
 * only. There is no INSERT anywhere in this function — flag creation stays a
 * Tech-Lead/migration action per feature-flags.md's authority table, not
 * reachable from the dashboard. A record key that doesn't resolve to a row
 * IN SCOPE (wrong id, or right id but wrong project) is a 404, not a create.
 */
export async function toggleFeatureFlag(
  pool: Pool,
  scope: Pick<WriteScope, "projectId">,
  input: FeatureFlagWriteInput,
  actor: string = ACTOR
): Promise<FeatureFlagWriteResult> {
  return withWriteTransaction(pool, async (client) => {
    await client.query("SELECT set_config('app.current_project', $1, true)", [scope.projectId]);

    const { rows: beforeRows } = await client.query<FeatureFlagRow>(
      `SELECT id, enabled, rollout_percentage FROM feature_flags WHERE id = $1 AND project_id = $2`,
      [input.id, scope.projectId]
    );
    if (beforeRows.length === 0) {
      throw new NotFoundError("feature flag not found in scope");
    }
    const before = beforeRows[0];

    const { rows, rowCount } = await client.query<FeatureFlagRow>(
      `UPDATE feature_flags
          SET enabled = $1, rollout_percentage = $2
        WHERE id = $3 AND project_id = $4
        RETURNING id, enabled, rollout_percentage`,
      [input.enabled, input.rolloutPercentage, input.id, scope.projectId]
    );
    if (rowCount !== 1) {
      throw new NotFoundError("feature flag not found in scope");
    }
    const after = rows[0];

    await client.query(
      `INSERT INTO audit_log (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
       VALUES ($1, NULL, $2, 'feature_flag.toggle', 'feature_flags', $3, $4)`,
      [scope.projectId, actor, input.id, JSON.stringify({ before, after })]
    );

    return { before, after };
  });
}
