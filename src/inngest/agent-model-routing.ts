import type { PoolClient } from "pg";
import { isAllowedAgentModel, type AgentRoutingKey } from "../config/model-allowlist";

/**
 * S3 — per-agent-role model routing resolver, the product-domain analogue of
 * resolveModelRouting() (T-73/ADR-0006), adapted per the reboot plan's
 * "KEEP-AND-ADAPT" note: same precedence ladder, allowlist gating, and
 * fail-closed degrade shape — reading agent_routing (product-scoped) instead
 * of agent_model_routing (project-scoped). See that table's migration
 * (20260718170000) for why these are separate tables, not a shared one.
 *
 * Precedence, identical in spirit to resolveModelRouting:
 *   1. `agent_routing` table row — dashboard-editable override, gated
 *      against AGENT_ROUTING_ALLOWLIST (defense in depth).
 *   2. per-role env default — trusted Coolify deploy config.
 *   3. registered alias literal — the guaranteed, allowlisted-by-construction floor.
 *
 * FOLDED INTO THE CALLER'S TRANSACTION: takes an already-open, GUC-scoped
 * PoolClient (not a Pool) — same connection-reuse discipline as
 * detect-vulnerabilities.ts's fetch/write clients (`set_config('app.current_product', ...)`).
 *
 * PRE-MIGRATION SAFETY: agent_routing may not exist yet (founder-run SQL
 * Editor apply, same as every migration in this repo). The read is wrapped
 * in a SAVEPOINT and degrades to the env/literal default on 42P01 only,
 * exactly like resolveModelRouting.
 */

export type ResolvedAgentRouting = {
  /** The alias to try first. Always a value in this role's allowlist-or-literal. */
  primary: string;
  /** No reboot agent role has a fallback slot yet (S3) — always null today.
   * Kept as a field (not omitted) so a future role that DOES need one is an
   * additive change to the return shape, not a breaking one. */
  fallback: string | null;
};

type AgentRoutingConfig = {
  primaryEnv: string;
  primaryLiteral: string;
};

// Per-role env var name + registered-alias literal. `triage-model` is reused
// as fix_author's bootstrap literal — an already-registered, already-proven
// LiteLLM alias — same bootstrap pattern respond/kb_learn used before their
// own env defaults were provisioned (T-73).
const AGENT_ROUTING: Record<AgentRoutingKey, AgentRoutingConfig> = {
  fix_author: {
    primaryEnv: "LITELLM_FIX_AUTHOR_MODEL",
    primaryLiteral: "triage-model",
  },
};

type AgentRoutingRow = { primary_model: string };

// Postgres SQLSTATE for "undefined_table" — raised when agent_routing does
// not exist yet (this migration not applied). The ONLY error we degrade on.
const UNDEFINED_TABLE = "42P01";

function pickModel(
  agentRole: AgentRoutingKey,
  tableValue: string | null | undefined,
  envValue: string | undefined,
  literal: string
): string {
  if (tableValue) {
    if (isAllowedAgentModel(agentRole, tableValue)) {
      return tableValue;
    }
    console.warn(
      `[agentModelRouting] agent_routing named out-of-allowlist model ` +
        `"${tableValue}" for agent role "${agentRole}"; ignoring it and falling ` +
        `back to the env/literal default (defense-in-depth, same discipline as T-73).`
    );
  }
  if (envValue !== undefined && envValue.trim() !== "") {
    return envValue;
  }
  return literal;
}

/**
 * Resolve the primary alias for one reboot agent role.
 *
 * @param client     an already-open, GUC-scoped connection inside a transaction.
 * @param productId  the product scope (also enforced by RLS on this connection).
 * @param agentRole  which reboot agent role to resolve for.
 */
export async function resolveAgentModelRouting(
  client: PoolClient,
  productId: string,
  agentRole: AgentRoutingKey
): Promise<ResolvedAgentRouting> {
  const cfg = AGENT_ROUTING[agentRole];

  const row = await readAgentRoutingRow(client, productId, agentRole);

  const primary = pickModel(
    agentRole,
    row?.primary_model,
    process.env[cfg.primaryEnv],
    cfg.primaryLiteral
  );

  return { primary, fallback: null };
}

async function readAgentRoutingRow(
  client: PoolClient,
  productId: string,
  agentRole: AgentRoutingKey
): Promise<AgentRoutingRow | null> {
  await client.query("SAVEPOINT agent_routing_read");
  try {
    const { rows } = await client.query<AgentRoutingRow>(
      `SELECT primary_model
         FROM agent_routing
        WHERE product_id = $1 AND agent_role = $2
        LIMIT 1`,
      [productId, agentRole]
    );
    await client.query("RELEASE SAVEPOINT agent_routing_read");
    return rows[0] ?? null;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === UNDEFINED_TABLE) {
      await client.query("ROLLBACK TO SAVEPOINT agent_routing_read");
      console.warn(
        `[agentModelRouting] agent_routing does not exist yet (migration not ` +
          `applied); using env/literal default for "${agentRole}".`
      );
      return null;
    }
    throw err;
  }
}
