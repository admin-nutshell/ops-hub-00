import type { Pool } from "pg";
import { inngest } from "../inngest/client";
import { SettingsWriteError } from "./settingsWrite";
import type { TreeEntry, CommitSummary } from "../inngest/repo-inspect";

// Dashboard read + trigger surface for the product-domain reboot's S1
// repo-inspection feature (src/inngest/repo-inspect.ts). Deliberately its
// OWN file, not folded into dashboard.ts (ticket-domain reads,
// tenant/project-scoped via withTenantScope) or settingsWrite.ts
// (ticket-domain writes) — this feature lives on a genuinely different axis
// (product-scoped only, one GUC: app.current_product) and doesn't fit either
// existing file's scope statement. Still follows the same discipline both of
// those files establish: all SQL for this feature lives here, `web/` holds
// none of it; every read/write function takes an already-resolved scope, not
// raw request input.
//
// Read side backs `repo_snapshots` (product-scoped, ops_hub_app-only, may
// not be migrated live yet — degrades to `schema_not_ready` rather than
// throwing, same convention as getModelRoutingOverrides in dashboard.ts).
// Trigger side sends the `ops-hub/repo.inspect.requested` event that
// src/inngest/repo-inspect.ts's `inspectRepo` function listens for — it does
// NOT touch the database at all (the actual DB write happens later, inside
// that Inngest function, in its own transaction); this module's trigger path
// is nothing more than "ask Inngest Cloud to run the workflow."

const UNDEFINED_TABLE = "42P01"; // Postgres SQLSTATE for undefined_table

function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

// ---------------------------------------------------------------------------
// Read: latest repo_snapshots row (joined with its repo_connections row) for
// one product.
// ---------------------------------------------------------------------------

export type RepoSnapshotView =
  // repo_connections and/or repo_snapshots haven't been migrated live yet
  // (both migrations' own header comments note they were NOT YET APPLIED as
  // of authoring — see supabase/migrations/20260717120000_s1_product_domain_schema.sql
  // and .../20260717140000_s1_repo_snapshots_schema.sql). Distinct from
  // "no_connection" so the panel can say exactly what's missing.
  | { status: "schema_not_ready" }
  // Schema is live but this product has no `status = 'active'`
  // repo_connections row.
  | { status: "no_connection" }
  // A connection exists but has never been inspected (repo_snapshots has no
  // row for it yet) — the first-ever-click state the task calls out
  // explicitly.
  | { status: "no_snapshot"; repoFullName: string; defaultBranch: string }
  | {
      status: "ready";
      repoFullName: string;
      defaultBranch: string;
      fetchedAt: string;
      treeEntryCount: number;
      treeTruncated: boolean;
      tree: TreeEntry[];
      commits: CommitSummary[];
    };

type SnapshotRow = {
  repo_full_name: string;
  default_branch: string;
  fetched_at: string | null;
  tree_entry_count: number | null;
  tree_truncated: boolean | null;
  tree: unknown | null;
  commits: unknown | null;
};

/**
 * Read the latest repo-inspection snapshot for one product, LEFT JOINed
 * against its active repo_connections row so "connected but never inspected"
 * (`fetched_at IS NULL`) is distinguishable from "no connection at all" (zero
 * rows) — both are honest, non-error states the panel renders differently,
 * per the task's "handle first-ever click gracefully" requirement.
 *
 * Product-scoped via the same transaction-local `app.current_product` GUC
 * repo-inspect.ts itself sets before writing — RLS (repo_connections_select /
 * repo_snapshots_select, both `product_id = current_product_id()`) enforces
 * this can never return another product's row even on a bug here.
 */
export async function getRepoSnapshotView(
  pool: Pool,
  productId: string
): Promise<RepoSnapshotView> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_product', $1, true)", [productId]);

    let result: RepoSnapshotView;
    try {
      const { rows } = await client.query<SnapshotRow>(
        `SELECT rc.repo_full_name, rc.default_branch,
                rs.fetched_at::text AS fetched_at,
                rs.tree_entry_count, rs.tree_truncated, rs.tree, rs.commits
           FROM repo_connections rc
           LEFT JOIN repo_snapshots rs ON rs.repo_connection_id = rc.id
          WHERE rc.product_id = $1 AND rc.status = 'active'
          LIMIT 1`,
        [productId]
      );
      const row = rows[0];
      if (!row) {
        result = { status: "no_connection" };
      } else if (!row.fetched_at) {
        result = {
          status: "no_snapshot",
          repoFullName: row.repo_full_name,
          defaultBranch: row.default_branch,
        };
      } else {
        result = {
          status: "ready",
          repoFullName: row.repo_full_name,
          defaultBranch: row.default_branch,
          fetchedAt: row.fetched_at,
          treeEntryCount: row.tree_entry_count ?? 0,
          treeTruncated: Boolean(row.tree_truncated),
          tree: (row.tree ?? []) as TreeEntry[],
          commits: (row.commits ?? []) as CommitSummary[],
        };
      }
    } catch (err) {
      if (!isUndefinedTable(err)) throw err;
      // Neither table exists yet in this environment — honest "not ready"
      // state, not a crash. See the schema_not_ready doc comment above.
      result = { status: "schema_not_ready" };
    }

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
// Trigger: dispatch ops-hub/repo.inspect.requested via the shared Inngest
// client (src/inngest/client.ts) — no DB access on this path at all.
// ---------------------------------------------------------------------------

// Reuses SettingsWriteError (src/metrics/settingsWrite.ts) purely so
// web/lib/apiRoute.ts's existing errorResponse() can map this failure to a
// JSON response the same way it already maps every settings-write failure —
// one error-mapping code path for every POST route this dashboard has, not a
// second one invented for this feature.
export class RepoInspectDispatchError extends SettingsWriteError {
  constructor(message: string) {
    super(message, 503);
    this.name = "RepoInspectDispatchError";
  }
}

/**
 * Send the `ops-hub/repo.inspect.requested` event for one product.
 *
 * IMPORTANT — a successful dispatch here does NOT mean the inspection ran.
 * `inngest.send()` only confirms Inngest Cloud accepted the event over HTTP;
 * it says nothing about whether the backend process has a live
 * `INNGEST_SIGNING_KEY`/registration for `inspectRepo`, or whether that
 * process has even been redeployed since this function was added to its
 * function list. The dashboard polls `repo_snapshots.fetched_at` afterward
 * specifically because dispatch success is not proof of completion.
 *
 * Throws RepoInspectDispatchError (503) — not a raw 500 — if the SDK itself
 * refuses to send, which happens synchronously and BEFORE any network call
 * when `INNGEST_EVENT_KEY` is unset in this (the dashboard's own) process:
 * see node_modules/inngest's Inngest.send(), which throws when
 * `mode === "cloud" && !eventKeySet()`. The dashboard Coolify app does not
 * have this var set as of this writing (only OPS_HUB_APP_LOGIN_URL /
 * POLLING_PROJECT_ID / POLLING_TENANT_ID are provisioned there — see
 * docs/deploys/2026-07-06-t68-dashboard-staging-provision.md) — provisioning
 * it is a Production Manager follow-up, not something this function can do.
 */
export async function triggerRepoInspect(productId: string): Promise<{ dispatched: true }> {
  try {
    await inngest.send({ name: "ops-hub/repo.inspect.requested", data: { product_id: productId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RepoInspectDispatchError(
      `Could not dispatch the repo-inspection event — is INNGEST_EVENT_KEY provisioned on the ` +
        `dashboard app? (not set as of the T-68 provisioning note) — ${message}`
    );
  }
  return { dispatched: true };
}
