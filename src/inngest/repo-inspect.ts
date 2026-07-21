import { Pool } from "pg";
import { inngest } from "./client";
import { createLazyPool } from "./utils";
import { mintInstallationToken, githubHeaders } from "../github/appAuth";

// S1 of the ops-hub reboot — read-only repo inspection. Follows the exact
// transaction/GUC/audit shape of src/inngest/ticket-triage.ts (the canonical
// pattern per the reboot plan's "Critical files to reuse" list), re-pivoted
// from project/tenant to product. No write scope exists on the GitHub App
// this sprint (contents:read/pull_requests:read/checks:read/statuses:read/
// security_events:read only) — this module must never assume a write path.

type RepoInspectEventData = { product_id: string };

type RepoConnectionRow = {
  id: string;
  github_installation_id: string; // bigint comes back as text from pg by default
  repo_full_name: string;
  default_branch: string;
};

// Exported (not just module-local) so the dashboard's read side
// (src/metrics/repoInspect.ts) can type the `repo_snapshots.tree` / `.commits`
// jsonb columns against the exact same shape this function writes, instead of
// re-declaring a parallel copy that could silently drift.
export type TreeEntry = { path: string; type: string; size?: number };
export type CommitSummary = {
  sha: string;
  message: string;
  author: string | null;
  date: string | null;
};

export type RepoSnapshot = {
  repo_full_name: string;
  default_branch: string;
  tree: { entries: TreeEntry[]; entry_count: number; truncated: boolean };
  commits: CommitSummary[];
};

export type RepoInspectResult =
  { skipped: true; reason: string } | { inspected: true; snapshot: RepoSnapshot };

type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

const _opsPool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
export function getPool(): Pool {
  return _opsPool.get();
}
export function _resetPool(mock?: Pool): void {
  _opsPool.reset(mock);
}

// Hard cap on stored/returned tree entries — a repo the size of a real
// product monorepo must never balloon this function's memory, DB row, or
// Inngest step-result size. GitHub's own recursive-tree response already
// self-truncates past ~100k entries/7MB (json.truncated); this cap is a
// SECOND, tighter ceiling applied on top of that, independent of repo size.
const TREE_ENTRY_CAP = 1500;
const GITHUB_FETCH_TIMEOUT_MS = 20_000;

// Skip generated/vendor noise so the cap is spent on source, not on
// megabytes of dependency trees a "file tree" view has no use for. Deliberately
// general (not TTS-specific) — app-agnostic per the standing constraint.
function isNoisePath(path: string): boolean {
  return (
    path === "node_modules" ||
    path.startsWith("node_modules/") ||
    path.includes("/node_modules/") ||
    path === ".git" ||
    path.startsWith(".git/")
  );
}

// repo_full_name is DB-sourced (repo_connections.repo_full_name) but is
// interpolated directly into a GitHub API URL path below — validate its
// shape before it is ever used to build a URL. Must be exactly two
// non-empty, path-safe components separated by "/" (owner/repo), and
// neither component may be "." or ".." (a bare regex character-class check
// like /^[\w.-]+\/[\w.-]+$/ would still ACCEPT "owner/.." or "../repo"
// since "." is inside the class — the dot-segment check below is what
// actually blocks path traversal, not the shape regex alone).
const REPO_FULL_NAME_COMPONENT_RE = /^[\w.-]+$/;

export function assertValidRepoFullName(repoFullName: string): void {
  const parts = repoFullName.split("/");
  const invalid =
    parts.length !== 2 ||
    parts.some(
      (part) =>
        part === "" || part === "." || part === ".." || !REPO_FULL_NAME_COMPONENT_RE.test(part)
    );
  if (invalid) {
    throw new Error(`Invalid repo_full_name shape: ${JSON.stringify(repoFullName)}`);
  }
}

function repoApiPath(repoFullName: string): string {
  const [owner, repo] = repoFullName.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function fetchRepoTree(
  repoFullName: string,
  branch: string,
  token: string
): Promise<{ entries: TreeEntry[]; entry_count: number; truncated: boolean }> {
  const resp = await fetch(
    `https://api.github.com/repos/${repoApiPath(repoFullName)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
      headers: githubHeaders(token),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub tree fetch ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    tree?: Array<{ path: string; type: string; size?: number }>;
    truncated?: boolean;
  };
  const filtered = (json.tree ?? []).filter((e) => !isNoisePath(e.path));
  const cappedByUs = filtered.length > TREE_ENTRY_CAP;
  const entries = filtered
    .slice(0, TREE_ENTRY_CAP)
    .map((e) => ({ path: e.path, type: e.type, ...(e.size !== undefined && { size: e.size }) }));
  return {
    entries,
    entry_count: filtered.length,
    truncated: Boolean(json.truncated) || cappedByUs,
  };
}

async function fetchRecentCommits(repoFullName: string, token: string): Promise<CommitSummary[]> {
  const resp = await fetch(
    `https://api.github.com/repos/${repoApiPath(repoFullName)}/commits?per_page=10`,
    {
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
      headers: githubHeaders(token),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub commits fetch ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as Array<{
    sha: string;
    commit?: { message?: string; author?: { name?: string; date?: string } };
  }>;
  return json.map((c) => ({
    sha: c.sha,
    // First line only, capped — a commit body is untrusted external content
    // and this is storage/display data, not a prompt input in S1, but keep
    // it bounded regardless (mirrors the untrusted-content discipline used
    // for ticket bodies elsewhere in this repo).
    message: (c.commit?.message ?? "").split("\n")[0].slice(0, 200),
    author: c.commit?.author?.name ?? null,
    date: c.commit?.author?.date ?? null,
  }));
}

// Fetch the product's active repo connection, mint a fresh installation
// token, pull tree + recent commits, and persist a snapshot + audit row in
// one transaction. Idempotent-by-replace: re-running UPSERTs the one
// repo_snapshots row for this connection rather than appending.
export async function inspectProductRepo(
  pool: Pool,
  productId: string
): Promise<RepoInspectResult> {
  // 1. Read the product's active repo connection (product-scoped read via
  // the GUC pattern). repo_connections is ops_hub_app-only — no direct
  // browser/authenticated access — so this Inngest function IS the correct
  // read path, not a shortcut around one.
  const fetchClient = await pool.connect();
  let connection: RepoConnectionRow | null = null;
  try {
    await fetchClient.query("BEGIN");
    await fetchClient.query("SELECT set_config('app.current_product', $1, true)", [productId]);
    const { rows } = await fetchClient.query<RepoConnectionRow>(
      `SELECT id, github_installation_id::text, repo_full_name, default_branch
       FROM repo_connections
       WHERE product_id = $1 AND status = 'active'
       LIMIT 1`,
      [productId]
    );
    await fetchClient.query("COMMIT");
    connection = rows[0] ?? null;
  } catch (err) {
    await fetchClient.query("ROLLBACK");
    throw err;
  } finally {
    fetchClient.release();
  }

  if (!connection) {
    return { skipped: true, reason: "no_active_repo_connection" };
  }

  // repo_full_name is DB-sourced and gets interpolated into GitHub API URLs
  // by fetchRepoTree/fetchRecentCommits below — validate its shape once,
  // here, before minting a token or making any network call. Throws on
  // anything that isn't a clean two-component owner/repo shape (rejects
  // extra path segments, "." / ".." dot-segments, and other characters that
  // could alter the URL's meaning).
  assertValidRepoFullName(connection.repo_full_name);

  // 2. Mint a fresh installation token for THIS connection's installation id
  // — never a hardcoded id, never cached, never persisted (see
  // src/github/appAuth.ts module header). Used immediately below and
  // discarded when this function returns.
  const { token } = await mintInstallationToken(connection.github_installation_id);

  // 3. Fetch tree + recent commits. Both calls must succeed before anything
  // is written — a partial fetch is not a snapshot; Inngest's retry (2x,
  // below) covers a transient failure on either call.
  const tree = await fetchRepoTree(connection.repo_full_name, connection.default_branch, token);
  const commits = await fetchRecentCommits(connection.repo_full_name, token);

  const snapshot: RepoSnapshot = {
    repo_full_name: connection.repo_full_name,
    default_branch: connection.default_branch,
    tree,
    commits,
  };

  // 4. Persist: upsert the one repo_snapshots row for this connection, plus
  // an in-transaction audit_log summary row (Gap G6 convention — counts and
  // metadata only, NEVER the full tree/commit payload; the tree is exactly
  // the kind of bulk content audit_log is not for).
  const writeClient = await pool.connect();
  try {
    await writeClient.query("BEGIN");
    await writeClient.query("SELECT set_config('app.current_product', $1, true)", [productId]);
    await writeClient.query(
      `INSERT INTO repo_snapshots
         (product_id, repo_connection_id, repo_full_name, default_branch,
          tree, tree_entry_count, tree_truncated, commits, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (repo_connection_id) DO UPDATE SET
         repo_full_name   = EXCLUDED.repo_full_name,
         default_branch   = EXCLUDED.default_branch,
         tree             = EXCLUDED.tree,
         tree_entry_count = EXCLUDED.tree_entry_count,
         tree_truncated   = EXCLUDED.tree_truncated,
         commits          = EXCLUDED.commits,
         fetched_at       = now()`,
      [
        productId,
        connection.id,
        snapshot.repo_full_name,
        snapshot.default_branch,
        JSON.stringify(snapshot.tree.entries),
        snapshot.tree.entry_count,
        snapshot.tree.truncated,
        JSON.stringify(snapshot.commits),
      ]
    );
    await writeClient.query(
      `INSERT INTO audit_log (actor, action, resource_type, resource_id, payload)
       VALUES ('repo-inspect', 'repo.inspect', 'repo_connection', $1, $2)`,
      [
        connection.id,
        JSON.stringify({
          product_id: productId,
          repo_full_name: snapshot.repo_full_name,
          default_branch: snapshot.default_branch,
          tree_entry_count: snapshot.tree.entry_count,
          tree_truncated: snapshot.tree.truncated,
          commit_count: snapshot.commits.length,
        }),
      ]
    );
    await writeClient.query("COMMIT");
  } catch (err) {
    await writeClient.query("ROLLBACK");
    throw err;
  } finally {
    writeClient.release();
  }

  return { inspected: true, snapshot };
}

// Event-driven: dispatched with { product_id } for the product whose
// connected repo should be (re-)inspected. No cron sweep in S1 — one pilot
// product, dispatched deliberately (manually or by a later trigger), not on
// a schedule yet.
export const inspectRepo = inngest.createFunction(
  {
    id: "repo-inspect",
    retries: 2,
    triggers: [{ event: "ops-hub/repo.inspect.requested" }],
  },
  async ({ event, step }: InngestCtx) => {
    const { product_id } = event.data as RepoInspectEventData;
    return await step.run("inspect-repo", () => inspectProductRepo(getPool(), product_id));
  }
);
