import type { PoolClient } from "pg";
import { isAllowedModel, type RoutingFunctionKey } from "../config/model-allowlist";

/**
 * T-73 — per-function model routing resolver (ADR-0006 Decision A).
 *
 * Resolves which LiteLLM alias each agent function (triage / respond / kb_learn)
 * should call, in strict precedence order:
 *
 *   1. `agent_model_routing` table row  — the dashboard-editable override (T-72).
 *      GATED against the T-79 curated allowlist (defense in depth).
 *   2. per-function env default          — trusted Coolify deploy config.
 *   3. registered alias literal          — the guaranteed, allowlisted floor.
 *
 * Design constraints honoured here (see ADR-0006 + WORK.md T-73):
 *
 * - PROVIDER-NEUTRAL: this resolver only ever reads/returns LiteLLM *alias
 *   strings*. It never names a provider or touches a provider SDK — LiteLLM owns
 *   the alias->provider mapping (ADR-0004), so the whole path stays provider- and
 *   app-agnostic (Project #2 brings its own aliases; a project with no rows falls
 *   through to its env defaults).
 *
 * - FOLDED INTO THE CALLER'S TRANSACTION: the function takes an already-open,
 *   GUC-scoped `PoolClient` (NOT a Pool). The routing read rides the caller's
 *   existing fetch transaction — it does NOT open a third connection (ADR-0006:
 *   "Triage already opens two connections per ticket; the routing read rides that
 *   same connection"). RLS (`amr_select`, project-scoped) also guards this read;
 *   the explicit `project_id` predicate is belt-and-braces.
 *
 * - FAIL-CLOSED, BUT NEVER OFFLINE: an out-of-allowlist *table* value (a bad or
 *   forged write that slipped past T-72 RLS + T-74 write validation) is refused
 *   and we fall through to the trusted env/literal default. "Fail closed" here
 *   means we never *run* an unvetted model — NOT that we throw. Throwing would
 *   take a production function offline, which is exactly the outcome ADR-0006's
 *   write-time validation exists to prevent. The anomaly is logged loudly.
 *
 * - PRE-MIGRATION SAFETY: this code can deploy (staging auto-deploys on merge to
 *   main; `src/**` is not paths-ignored) BEFORE the founder applies T-72's
 *   migration as `service_role`. Until the table exists, the routing SELECT would
 *   raise `42P01 undefined_table`, which — inside the caller's fetch transaction —
 *   would abort it and take the ticket hot path down (retry-storm). We wrap the
 *   read in a SAVEPOINT and, on `42P01` ONLY, roll back to it and fall through to
 *   the env/literal default. That degradation is byte-identical to today's
 *   behaviour, so the resolver is a provable no-op until the table exists.
 */

export type ResolvedRouting = {
  /** The alias to try first. Always a value in this function's allowlist. */
  primary: string;
  /** Triage-only this sprint; `null` for respond / kb_learn (primary-only). */
  fallback: string | null;
};

type FunctionRoutingConfig = {
  primaryEnv: string;
  primaryLiteral: string;
  // Fallback is Triage-only this sprint (ADR-0006 §Fallback scope). respond /
  // kb_learn omit these → fallback resolves to null (no fallback retry logic).
  fallbackEnv?: string;
  fallbackLiteral?: string;
};

// Per-function env var names + registered-alias literals. Keys match the DB
// CHECK on `agent_model_routing.function_key` and `RoutingFunctionKey` exactly.
const FUNCTION_ROUTING: Record<RoutingFunctionKey, FunctionRoutingConfig> = {
  triage: {
    primaryEnv: "LITELLM_TRIAGE_MODEL",
    primaryLiteral: "triage-model",
    fallbackEnv: "LITELLM_FALLBACK_MODEL",
    fallbackLiteral: "fallback-model",
  },
  respond: {
    // NEW per-function default (T-73). Unset until T-81 provisions it → respond
    // falls to the literal "triage-model", which is respond's ONLY allowlisted
    // model, so the transition is correct-by-design.
    primaryEnv: "LITELLM_RESPOND_MODEL",
    primaryLiteral: "triage-model",
  },
  kb_learn: {
    // NEW per-function default (T-73). Same story as respond.
    primaryEnv: "LITELLM_KBLEARN_MODEL",
    primaryLiteral: "triage-model",
  },
};

type RoutingRow = { primary_model: string; fallback_model: string | null };

// Postgres SQLSTATE for "undefined_table" — raised when agent_model_routing does
// not exist yet (T-72 migration not applied). The ONLY error we degrade on.
const UNDEFINED_TABLE = "42P01";

/**
 * Choose one slot's alias by precedence, gating ONLY the (lower-trust,
 * dashboard-editable) table value against the allowlist. Env defaults and the
 * literal are trusted deploy-time config, outside the allowlist's threat model
 * (T-79 scopes the allowlist to "which aliases the dashboard may SELECT").
 */
function pickModel(
  functionKey: RoutingFunctionKey,
  tableValue: string | null | undefined,
  envValue: string | undefined,
  literal: string
): string {
  // 1. Dashboard-editable table value — trusted only if allowlisted.
  if (tableValue) {
    if (isAllowedModel(functionKey, tableValue)) {
      return tableValue;
    }
    // A persisted out-of-allowlist value means several controls were bypassed
    // (T-72 RLS + T-74 write validation). That is incident-worthy — surface it,
    // do not swallow it — then fall through to the trusted default.
    console.warn(
      `[modelRouting] agent_model_routing named out-of-allowlist model ` +
        `"${tableValue}" for function "${functionKey}"; ignoring it and falling ` +
        `back to the env/literal default (defense-in-depth, ADR-0006 T-B1).`
    );
  }
  // 2. Per-function env default (trusted Coolify deploy config).
  if (envValue !== undefined && envValue.trim() !== "") {
    return envValue;
  }
  // 3. Registered alias literal — allowlisted by construction (T-79).
  return literal;
}

/**
 * Resolve the primary (+ optional fallback) alias for one agent function.
 *
 * @param client     an already-open, GUC-scoped connection inside a transaction.
 * @param projectId  the project scope (also enforced by RLS on this connection).
 * @param functionKey which agent function to resolve for.
 */
export async function resolveModelRouting(
  client: PoolClient,
  projectId: string,
  functionKey: RoutingFunctionKey
): Promise<ResolvedRouting> {
  const cfg = FUNCTION_ROUTING[functionKey];

  const row = await readRoutingRow(client, projectId, functionKey);

  const primary = pickModel(
    functionKey,
    row?.primary_model,
    process.env[cfg.primaryEnv],
    cfg.primaryLiteral
  );

  const fallback =
    cfg.fallbackLiteral !== undefined
      ? pickModel(
          functionKey,
          row?.fallback_model,
          cfg.fallbackEnv !== undefined ? process.env[cfg.fallbackEnv] : undefined,
          cfg.fallbackLiteral
        )
      : null;

  return { primary, fallback };
}

/**
 * Read the (optional) routing row, wrapped in a SAVEPOINT so that a missing
 * table (pre-migration) degrades gracefully instead of aborting the caller's
 * transaction. Returns `null` when there is no row OR the table does not exist
 * yet; both mean "no override — use the env/literal default".
 */
async function readRoutingRow(
  client: PoolClient,
  projectId: string,
  functionKey: RoutingFunctionKey
): Promise<RoutingRow | null> {
  await client.query("SAVEPOINT amr_read");
  try {
    const { rows } = await client.query<RoutingRow>(
      `SELECT primary_model, fallback_model
         FROM agent_model_routing
        WHERE project_id = $1 AND function_key = $2
        LIMIT 1`,
      [projectId, functionKey]
    );
    await client.query("RELEASE SAVEPOINT amr_read");
    return rows[0] ?? null;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === UNDEFINED_TABLE) {
      // Table not created yet (T-72 not applied). Roll back to the savepoint so
      // the caller's transaction stays usable, then fall through to defaults.
      await client.query("ROLLBACK TO SAVEPOINT amr_read");
      console.warn(
        `[modelRouting] agent_model_routing does not exist yet (T-72 migration ` +
          `not applied); using env/literal default for "${functionKey}".`
      );
      return null;
    }
    // Any other error (connection/permission/etc.) is real — the caller's fetch
    // on this same connection is doomed anyway; let it propagate.
    throw err;
  }
}
