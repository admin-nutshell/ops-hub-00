import AdmZip from "adm-zip";
import { parsePatch, applyPatch } from "diff";
import { Pool } from "pg";
import { inngest } from "./client";
import { createLazyPool } from "./utils";
import { mintInstallationToken, githubHeaders } from "../github/appAuth";
import { assertValidRepoFullName } from "./repo-inspect";

// S3 of the ops-hub reboot — draft-pr-create, the last piece of "propose
// fixes as draft PRs" (per the reboot plan's S3 scope). Once fix-reconcile
// resolves a fix_attempts row to 'completed' (sandbox validated: build/lint/
// test all passed AND the egress canary confirmed blocking), this cron reads
// that attempt's actual diff, applies it against the product repo's current
// default branch content, and opens a DRAFT pull request — never auto-merged
// (S3 ships draft-only by design; auto-merge is S4+, gated behind
// autonomy_policies + a human-approval gate that doesn't exist yet).
//
// THIS IS THE FIRST REAL WRITE TO THE PRODUCT REPO in this reboot (every
// prior S1/S2/S3 piece only ever read it, or wrote to ops-hub-00's OWN repo
// for the sandbox). Highest blast radius of anything built so far — treated
// accordingly: idempotent by construction (see below), size-capped on the
// untrusted diff artifact (same decompression-bomb discipline as
// fix-reconcile's results.json), and explicitly rejects a diff that touches
// governance-sensitive paths (.github/**, CODEOWNERS) rather than silently
// trusting the AI-authored patch to stay in scope.
//
// WHY THE DIFF IS FETCHED FROM A THIRD FLAT ARTIFACT (`patch-diff`), NOT THE
// EXISTING sandbox-results BUNDLE: same rationale as fix-reconcile's
// sandbox-results-summary — a single-zip-layer artifact needs only a zip
// reader (adm-zip, already a dependency), never a tar reader. The GENERAL
// pattern (a single uploaded file = exactly one zip layer, no pagination
// surprises) was confirmed against a REAL probe dispatch (2026-07-19, run
// 29695747514) — the zip→tar.gz nesting of the existing bundle was verified
// by hand-extracting patch.diff from it, not assumed. That run PREDATES this
// specific `patch-diff` artifact, though: the exact name/path pairing below
// has never itself been produced by a live sandbox run, and fetchPatchDiff
// has only ever been exercised against mocked GitHub responses in tests —
// disclosed explicitly rather than assumed proven, still pending a live run.
//
// WHY GitHub'S GIT DATA API DIRECTLY, NOT A LOCAL git CLONE+PATCH+PUSH: this
// backend process holds no git binary/working directory by design (same
// "never shell out with untrusted content" posture as everywhere else in
// this codebase) — every other GitHub write in this reboot (repo-inspect's
// reads, fix-author's dispatch) already goes through minted-token REST calls
// directly from Node, never a subprocess. blob -> tree -> commit -> ref is
// the standard low-level sequence for "apply a set of file changes as one
// commit" via that API.
//
// PATCH APPLICATION LIBRARY: `diff` (jsdiff), zero transitive dependencies,
// ships its own types. `parsePatch`/`applyPatch` understand git's unified
// diff dialect (isCreate/isDelete/isRename/isCopy/isBinary flags) — verified
// directly against the real probe patch, not assumed from the README.
// Rename/copy/binary changes are explicitly rejected (fail closed) rather
// than half-supported — an LLM fixing a single dependency/code-level finding
// has no legitimate reason to rename or binary-patch a file this sprint, and
// correctly handling those adds meaningful risk for a case not expected to
// occur in practice.
//
// IDEMPOTENCY (a hard requirement given this makes real, hard-to-silently-
// retry writes): the branch name is DETERMINISTIC per fix_attempt_id
// (`ops-hub/fix-<id>`), and both the branch-exists and PR-exists checks run
// BEFORE any create call — a retry after a partial failure (branch pushed,
// PR-open call failed; or worse, a crash between GitHub-side success and the
// pull_requests INSERT) detects and reuses what already exists rather than
// creating a duplicate. The `pull_requests` table's own `unique(fix_attempt_id)`
// constraint is the final DB-level backstop (`ON CONFLICT DO NOTHING`).
//
// INJECTION DISCIPLINE ON THE PR ITSELF: finding.title (surfaced in the PR
// body for a human reviewer's context) is untrusted external content, same
// as everywhere else findings.detail/title is used in this reboot. Wrapped
// in a fenced code block in the PR body — GitHub does not parse @mentions,
// markdown, or issue/PR autolinks inside a code span/block — which defuses
// both a notification-spam vector (a crafted "@everyone"-style title) and a
// markdown-injection vector, without needing a custom sanitizer.
//
// PRODUCT ENUMERATION / EXACTLY-ONE-ENVIRONMENT GATE: same reasoning and
// same conventions as fix-reconcile.ts — DRAFT_PR_PRODUCT_IDS (comma-
// separated, defaults to the one pilot product; ops_hub_app has no
// "list all products" path under RLS) and DRAFT_PR_ENABLED (staging/prod
// share one Supabase DB and would otherwise both attempt the same repo
// writes).
//
// INDEPENDENT SECURITY LEAD REVIEW (PR #568, pre-merge) found and required
// four fixes, all applied: (1) assertPathSafe rejected ".." and empty path
// segments but not a bare "." segment — a path like "b/./.github/workflows/
// evil.yml" would have slipped past both that check AND isGovernancePath's
// literal ".github/" prefix match, a real governance-bypass risk this fixes
// closes; (2) isGovernancePath was missing docs/CODEOWNERS (GitHub honors
// CODEOWNERS at root, .github/, AND docs/ — only the first two were
// covered); (3) the diff-declared file mode was taken verbatim, letting an
// LLM-authored diff mint a 120000 (symlink) or 160000 (gitlink) entry — now
// allowlisted to 100644/100755 only; (4) the `patch-diff` artifact was
// originally uploaded in s3-fix-sandbox.yml AFTER npm ci/build/lint/test had
// already run untrusted, patched code in that same job/VM/user — since this
// artifact's content becomes a real commit here (not just triage data like
// results.json), a hostile patch backgrounding a process to tamper with it
// before upload would have let attacker content through under a PR body
// that claimed it was "validated." Fixed by moving the upload to
// immediately after the patch is decoded, before it's even applied — see
// that workflow step's own comment — and by softening buildPrBody's wording
// to match the "advisory signal, not a trust boundary" framing already used
// elsewhere in this codebase for sandbox output.
//
// STILL NOT LIVE-EXECUTED: built on top of a confirmed App permission
// escalation (contents:write/pull_requests:write on the pilot repo,
// FOUNDER_QUEUE.md FQ-79 Item 2) that this session could not independently
// verify (checking a GitHub App's own installation permissions needs either
// the App's own credentials or an `admin:org`-scoped token, neither
// available here) — taken on the founder's direct confirmation. The code
// below fails closed on any non-2xx GitHub response, including the 403 an
// unescalated App would return, rather than assuming success; the first
// real end-to-end proof still awaits staging being started.

const OPS_HUB_BRANCH_PREFIX = "ops-hub/fix-";
const GITHUB_API_TIMEOUT_MS = 15_000;
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;
// The real patch.diff this sprint's LLM produces is well under 5KB; 64KB
// matches fix-reconcile's own cap and the same rationale (comfortably
// generous for legitimate output, small enough to reject a decompression-
// bomb-style artifact before it's ever fully inflated).
const MAX_DIFF_ARTIFACT_BYTES = 64 * 1024;
const DRAFT_PR_BATCH_SIZE = 20;

// Same pilot product id as fix-reconcile.ts's DEFAULT_RECONCILE_PRODUCT_IDS /
// web/lib/project.ts's DASHBOARD_PRODUCT_ID default.
const DEFAULT_DRAFT_PR_PRODUCT_IDS = "8bafa6a6-4d80-4983-89bc-e536d3dba672";

function getDraftPrProductIds(): string[] {
  const raw = process.env.DRAFT_PR_PRODUCT_IDS ?? DEFAULT_DRAFT_PR_PRODUCT_IDS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const _opsPool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
export function getPool(): Pool {
  return _opsPool.get();
}
export function _resetPool(mock?: Pool): void {
  _opsPool.reset(mock);
}

export type CompletedAttempt = {
  id: string;
  product_id: string;
  finding_id: string;
  sandbox_run_id: string | null;
};

// Candidates: attempts the sandbox validated ('completed') that don't yet
// have a pull_requests row. Read-only pre-check — the write path re-checks
// idempotency itself (branch/PR existence, then the DB unique constraint),
// so a stale read here just means "attempt again next tick" at worst.
export async function fetchCompletedAttempts(
  pool: Pool,
  productId: string
): Promise<CompletedAttempt[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_product', $1, true)", [productId]);
    const result = await client.query(
      `SELECT fa.id, fa.finding_id, fa.sandbox_run_id
       FROM fix_attempts fa
       WHERE fa.status = 'completed'
         AND NOT EXISTS (SELECT 1 FROM pull_requests pr WHERE pr.fix_attempt_id = fa.id)
       ORDER BY fa.created_at ASC
       LIMIT $1`,
      [DRAFT_PR_BATCH_SIZE]
    );
    await client.query("COMMIT");
    return result.rows.map((r) => ({
      id: String(r.id),
      product_id: productId,
      finding_id: String(r.finding_id),
      sandbox_run_id: r.sandbox_run_id === null ? null : String(r.sandbox_run_id),
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type RepoConnectionRow = {
  github_installation_id: string;
  repo_full_name: string;
  default_branch: string;
};

export async function fetchActiveConnection(
  pool: Pool,
  productId: string
): Promise<RepoConnectionRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_product', $1, true)", [productId]);
    const { rows } = await client.query<RepoConnectionRow>(
      `SELECT github_installation_id::text, repo_full_name, default_branch
       FROM repo_connections
       WHERE product_id = $1 AND status = 'active'
       LIMIT 1`,
      [productId]
    );
    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function requireDispatchTokenEnv(name: string): string {
  const token = process.env[name];
  if (!token) {
    throw new Error(`${name} not configured`);
  }
  return token;
}

type GhArtifact = { id: number; name: string; size_in_bytes: number };

// Same shape as fix-reconcile's fetchSandboxResults: size-capped before
// download, size-capped again on the zip entry before inflating it, never
// throws on garbage (returns null instead) — the diff artifact is untrusted-
// content-derived same as results.json, same decompression-bomb concern.
export async function fetchPatchDiff(
  runId: number,
  ownerRepo: string,
  token: string
): Promise<string | null> {
  const listResp = await fetch(
    `https://api.github.com/repos/${ownerRepo}/actions/runs/${runId}/artifacts`,
    { signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!listResp.ok) {
    const text = await listResp.text();
    throw new Error(`GitHub list artifacts ${listResp.status}: ${text.slice(0, 200)}`);
  }
  const listJson = (await listResp.json()) as { artifacts?: GhArtifact[] };
  const artifact = (listJson.artifacts ?? []).find((a) => a.name === "patch-diff");
  if (!artifact) return null;
  if (artifact.size_in_bytes > MAX_DIFF_ARTIFACT_BYTES) return null;

  const zipResp = await fetch(
    `https://api.github.com/repos/${ownerRepo}/actions/artifacts/${artifact.id}/zip`,
    { signal: AbortSignal.timeout(ARTIFACT_DOWNLOAD_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!zipResp.ok) {
    const text = await zipResp.text();
    throw new Error(`GitHub download artifact ${zipResp.status}: ${text.slice(0, 200)}`);
  }
  const zipBuf = Buffer.from(await zipResp.arrayBuffer());
  const zip = new AdmZip(zipBuf);
  const entry = zip.getEntry("patch.diff");
  if (!entry) return null;
  if (entry.header.size > MAX_DIFF_ARTIFACT_BYTES) return null;
  try {
    return entry.getData().toString("utf8");
  } catch {
    return null;
  }
}

// Governance-sensitive paths an AI-authored fix has no legitimate reason to
// touch this sprint — fix-author's whole scope is a single detected finding
// in the product repo's own code, never CI/ownership config. Fails closed
// (rejects the whole attempt) rather than silently allowing it through to a
// draft PR a reviewer might approve without noticing. GitHub honors
// CODEOWNERS in exactly three locations (root, .github/, docs/) — all three
// are covered explicitly, not just the .github/ prefix (a Security Lead
// review caught docs/CODEOWNERS being missed here).
function isGovernancePath(path: string): boolean {
  return (
    path === "CODEOWNERS" ||
    path === "docs/CODEOWNERS" ||
    path === ".github" ||
    path.startsWith(".github/")
  );
}

// Git diff headers use "a/<path>" / "b/<path>" prefixes; strip only an exact
// leading "a/" or "b/" (never a bare regex on arbitrary content) so a real
// path that happens to start with those two characters isn't mangled.
function stripGitPrefix(path: string): string {
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function assertPathSafe(path: string): void {
  // A bare "." segment (e.g. "b/./.github/workflows/evil.yml") is neither
  // ".." nor empty, so it previously slipped past this check AND defeated
  // isGovernancePath's literal ".github/" prefix match — a real path-
  // traversal-adjacent bypass of the one check that exists specifically to
  // stop a governance-file write. Caught by an independent Security Lead
  // review before merge; a backslash is rejected too since it's a raw path
  // separator on Windows CI checkouts, even though GitHub's own APIs treat
  // it as a literal filename character.
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    throw new Error(`unsafe file path in diff: ${JSON.stringify(path)}`);
  }
  if (isGovernancePath(path)) {
    throw new Error(`diff touches a governance-sensitive path, rejected: ${JSON.stringify(path)}`);
  }
}

type ParsedFilePatch = ReturnType<typeof parsePatch>[number];

export type PlannedChange =
  | { kind: "delete"; path: string }
  | { kind: "upsert"; path: string; isCreate: boolean; mode: string; filePatch: ParsedFilePatch };

// Pure, sync, no network — parses the diff and validates every file change
// in it before anything is fetched or written. Any single unsupported/unsafe
// file change rejects the WHOLE attempt (never a partial application).
export function planFileChanges(
  diffText: string
): { ok: true; changes: PlannedChange[] } | { ok: false; error: string } {
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(diffText);
  } catch {
    return { ok: false, error: "diff did not parse as a unified diff" };
  }
  if (parsed.length === 0) {
    return { ok: false, error: "diff contained no file changes" };
  }

  const changes: PlannedChange[] = [];
  for (const filePatch of parsed) {
    if (filePatch.isBinary) {
      return { ok: false, error: "binary file changes are not supported" };
    }
    if (filePatch.isRename || filePatch.isCopy) {
      return { ok: false, error: "renamed/copied files are not supported" };
    }
    const rawPath = filePatch.isDelete ? filePatch.oldFileName : filePatch.newFileName;
    if (!rawPath) {
      return { ok: false, error: "diff hunk missing a file path" };
    }
    const path = stripGitPrefix(rawPath);
    try {
      assertPathSafe(path);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (filePatch.isDelete) {
      changes.push({ kind: "delete", path });
    } else {
      // The diff-declared mode is untrusted (LLM-authored) — allowlist to
      // plain-file/executable-file only. 120000 (symlink) or 160000
      // (gitlink/submodule) would let a single detected finding's fix smuggle
      // in a checkout-hostile symlink or point product CI at an attacker-
      // controlled submodule if .gitmodules is ever added. Caught by an
      // independent Security Lead review before merge.
      const requestedMode = filePatch.newMode ?? "100644";
      if (requestedMode !== "100644" && requestedMode !== "100755") {
        return {
          ok: false,
          error: `unsupported file mode in diff: ${JSON.stringify(requestedMode)}`,
        };
      }
      changes.push({
        kind: "upsert",
        path,
        isCreate: Boolean(filePatch.isCreate),
        mode: requestedMode,
        filePatch,
      });
    }
  }
  return { ok: true, changes };
}

export type ResolvedChange =
  | { kind: "delete"; path: string }
  | { kind: "upsert"; path: string; content: string; mode: string };

// Applies each planned change against the repo's CURRENT content (fetched
// per-file via the injected fetcher — never assumed/cached) to compute the
// final new content. Any single hunk that fails to apply cleanly (stale
// base, conflicting concurrent change on the product repo, or a
// fundamentally malformed patch) rejects the whole attempt.
export async function resolveFileContents(
  changes: PlannedChange[],
  fetchCurrentContent: (path: string) => Promise<string>
): Promise<{ ok: true; resolved: ResolvedChange[] } | { ok: false; error: string }> {
  const resolved: ResolvedChange[] = [];
  for (const change of changes) {
    if (change.kind === "delete") {
      resolved.push({ kind: "delete", path: change.path });
      continue;
    }
    const source = change.isCreate ? "" : await fetchCurrentContent(change.path);
    const result = applyPatch(source, change.filePatch);
    if (result === false) {
      return { ok: false, error: `patch did not apply cleanly to ${change.path}` };
    }
    resolved.push({ kind: "upsert", path: change.path, content: result, mode: change.mode });
  }
  return { ok: true, resolved };
}

type GhBranch = { commit: { sha: string; commit?: { tree?: { sha: string } } } };

async function fetchBranchHead(
  ownerRepo: string,
  branch: string,
  token: string
): Promise<{ commitSha: string; treeSha: string }> {
  const resp = await fetch(
    `https://api.github.com/repos/${ownerRepo}/branches/${encodeURIComponent(branch)}`,
    {
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
      headers: githubHeaders(token),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub branch fetch ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as GhBranch;
  const treeSha = json.commit?.commit?.tree?.sha;
  if (!json.commit?.sha || !treeSha) {
    throw new Error("GitHub branch response missing commit/tree sha");
  }
  return { commitSha: json.commit.sha, treeSha };
}

async function fetchFileContent(
  ownerRepo: string,
  path: string,
  ref: string,
  token: string
): Promise<string> {
  const resp = await fetch(
    `https://api.github.com/repos/${ownerRepo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(ref)}`,
    { signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub contents fetch ${resp.status} for ${path}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { content?: string; encoding?: string };
  if (json.encoding !== "base64" || typeof json.content !== "string") {
    throw new Error(`GitHub contents response for ${path} was not base64-encoded as expected`);
  }
  return Buffer.from(json.content, "base64").toString("utf8");
}

async function createBlob(ownerRepo: string, content: string, token: string): Promise<string> {
  const resp = await fetch(`https://api.github.com/repos/${ownerRepo}/git/blobs`, {
    method: "POST",
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      content: Buffer.from(content, "utf8").toString("base64"),
      encoding: "base64",
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub create blob ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { sha?: string };
  if (!json.sha) throw new Error("GitHub create blob response missing sha");
  return json.sha;
}

async function createTree(
  ownerRepo: string,
  baseTreeSha: string,
  entries: Array<{ path: string; mode: string; sha: string | null }>,
  token: string
): Promise<string> {
  const resp = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees`, {
    method: "POST",
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: "blob", sha: e.sha })),
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub create tree ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { sha?: string };
  if (!json.sha) throw new Error("GitHub create tree response missing sha");
  return json.sha;
}

async function createCommit(
  ownerRepo: string,
  message: string,
  treeSha: string,
  parentSha: string,
  token: string
): Promise<string> {
  const resp = await fetch(`https://api.github.com/repos/${ownerRepo}/git/commits`, {
    method: "POST",
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub create commit ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { sha?: string };
  if (!json.sha) throw new Error("GitHub create commit response missing sha");
  return json.sha;
}

// Returns true if the branch already existed (idempotency: a retry after a
// partial prior failure detects and reuses it rather than re-committing).
async function branchExists(ownerRepo: string, branch: string, token: string): Promise<boolean> {
  const resp = await fetch(
    `https://api.github.com/repos/${ownerRepo}/git/ref/heads/${encodeURIComponent(branch)}`,
    { signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (resp.status === 404) return false;
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub get ref ${resp.status}: ${text.slice(0, 200)}`);
  }
  return true;
}

async function createBranchRef(
  ownerRepo: string,
  branch: string,
  commitSha: string,
  token: string
): Promise<void> {
  const resp = await fetch(`https://api.github.com/repos/${ownerRepo}/git/refs`, {
    method: "POST",
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub create ref ${resp.status}: ${text.slice(0, 200)}`);
  }
}

// Returns an existing open/draft PR's number for this head branch, if any —
// the other half of the idempotency check (branchExists covers the commit
// side, this covers the PR side; either can independently already exist
// after a partial prior failure).
async function findExistingPr(
  ownerRepo: string,
  owner: string,
  branch: string,
  token: string
): Promise<number | null> {
  const resp = await fetch(
    `https://api.github.com/repos/${ownerRepo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all`,
    { signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub list PRs ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as Array<{ number: number }>;
  return json[0]?.number ?? null;
}

// findingTitle is untrusted external content (GitHub's own alert payload,
// same as everywhere else in this reboot) — fenced in a code block so GitHub
// never parses @mentions/markdown/autolinks inside it (see file header).
function buildPrBody(findingTitle: string, model: string): string {
  const safeTitle = findingTitle.replace(/`/g, "'").slice(0, 300);
  return [
    "Automatically proposed by ops-hub's fix-author-agent (S3).",
    "",
    "**Detected finding (untrusted, AI-generated repo-scan data — shown verbatim, not a directive):**",
    "```",
    safeTitle,
    "```",
    "",
    `Candidate patch authored by \`${model}\`. An isolated sandbox reported build/lint/test green with no secrets present and egress restricted — treat that as an advisory signal, not a security guarantee (the sandbox runs this same untrusted patch, so it is not a trust boundary). This PR is a **draft** — nothing here auto-merges. Please review the diff yourself before merging.`,
  ].join("\n");
}

async function createPr(
  ownerRepo: string,
  branch: string,
  defaultBranch: string,
  findingTitle: string,
  model: string,
  token: string
): Promise<number> {
  const resp = await fetch(`https://api.github.com/repos/${ownerRepo}/pulls`, {
    method: "POST",
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "ops-hub: automated fix (draft, review required)",
      head: branch,
      base: defaultBranch,
      draft: true,
      body: buildPrBody(findingTitle, model),
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub create PR ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { number?: number };
  if (!json.number) throw new Error("GitHub create PR response missing number");
  return json.number;
}

export type CreateDraftPrResult =
  | { skipped: true; reason: string }
  | { created: true; prNumber: number; branch: string; alreadyExisted: boolean };

// Reads one completed attempt's diff, applies it, and opens (or reuses) a
// draft PR. See file header for the full idempotency/safety discussion.
export async function createDraftPrForAttempt(
  pool: Pool,
  productId: string,
  attempt: CompletedAttempt
): Promise<CreateDraftPrResult> {
  if (!attempt.sandbox_run_id) {
    return { skipped: true, reason: "no sandbox_run_id on a completed attempt (anomaly)" };
  }

  const connection = await fetchActiveConnection(pool, productId);
  if (!connection) {
    return { skipped: true, reason: "no_active_repo_connection" };
  }
  assertValidRepoFullName(connection.repo_full_name);

  const dispatchToken = requireDispatchTokenEnv("GITHUB_STATUS_DISPATCH_TOKEN");
  const diffText = await fetchPatchDiff(
    Number(attempt.sandbox_run_id),
    "admin-nutshell/ops-hub-00",
    dispatchToken
  );
  if (!diffText) {
    return { skipped: true, reason: "no patch-diff artifact found for the sandbox run" };
  }

  const plan = planFileChanges(diffText);
  if (!plan.ok) {
    return { skipped: true, reason: `diff rejected: ${plan.error}` };
  }

  const [owner] = connection.repo_full_name.split("/");
  const branch = `${OPS_HUB_BRANCH_PREFIX}${attempt.id}`;
  const { token: writeToken } = await mintInstallationToken(connection.github_installation_id);

  const alreadyBranched = await branchExists(connection.repo_full_name, branch, writeToken);
  if (!alreadyBranched) {
    const { commitSha, treeSha } = await fetchBranchHead(
      connection.repo_full_name,
      connection.default_branch,
      writeToken
    );
    const resolved = await resolveFileContents(plan.changes, (path) =>
      fetchFileContent(connection.repo_full_name, path, connection.default_branch, writeToken)
    );
    if (!resolved.ok) {
      return { skipped: true, reason: `diff rejected: ${resolved.error}` };
    }
    const entries = await Promise.all(
      resolved.resolved.map(async (r) => ({
        path: r.path,
        mode: r.kind === "delete" ? "100644" : r.mode,
        sha:
          r.kind === "delete"
            ? null
            : await createBlob(connection.repo_full_name, r.content, writeToken),
      }))
    );
    const newTreeSha = await createTree(connection.repo_full_name, treeSha, entries, writeToken);
    const newCommitSha = await createCommit(
      connection.repo_full_name,
      `ops-hub: automated fix for finding ${attempt.finding_id}`,
      newTreeSha,
      commitSha,
      writeToken
    );
    await createBranchRef(connection.repo_full_name, branch, newCommitSha, writeToken);
  }

  const existingPrNumber = await findExistingPr(
    connection.repo_full_name,
    owner,
    branch,
    writeToken
  );
  const prNumber =
    existingPrNumber ??
    (await (async () => {
      // findingTitle is fetched fresh (product-scoped) only for the PR body —
      // never persisted, never logged (see file header's injection note).
      const client = await pool.connect();
      let findingTitle = "(finding title unavailable)";
      let model = "unknown";
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_product', $1, true)", [productId]);
        const { rows: findingRows } = await client.query(
          `SELECT title FROM findings WHERE id = $1 AND product_id = $2`,
          [attempt.finding_id, productId]
        );
        const { rows: attemptRows } = await client.query(
          `SELECT model_alias FROM fix_attempts WHERE id = $1 AND product_id = $2`,
          [attempt.id, productId]
        );
        await client.query("COMMIT");
        findingTitle = findingRows[0]?.title ?? findingTitle;
        model = attemptRows[0]?.model_alias ?? model;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return createPr(
        connection.repo_full_name,
        branch,
        connection.default_branch,
        findingTitle,
        model,
        writeToken
      );
    })());

  await recordPullRequest(pool, productId, attempt.id, prNumber, branch);
  return { created: true, prNumber, branch, alreadyExisted: existingPrNumber !== null };
}

// Product-scoped, ON CONFLICT DO NOTHING on the pull_requests unique
// constraint — the final DB-level idempotency backstop, since the GitHub-
// side branch/PR checks above already make the network calls themselves
// idempotent.
async function recordPullRequest(
  pool: Pool,
  productId: string,
  fixAttemptId: string,
  prNumber: number,
  branch: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_product', $1, true)", [productId]);
    await client.query(
      `INSERT INTO pull_requests (product_id, fix_attempt_id, github_pr_number, branch, state)
       VALUES ($1, $2, $3, $4, 'draft')
       ON CONFLICT (fix_attempt_id) DO NOTHING`,
      [productId, fixAttemptId, prNumber, branch]
    );
    await client.query(
      `INSERT INTO audit_log (actor, action, resource_type, resource_id, payload)
       VALUES ('draft-pr-create', 'pr.create', 'fix_attempt', $1, $2)`,
      [fixAttemptId, JSON.stringify({ product_id: productId, github_pr_number: prNumber, branch })]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function draftPrSweepOnce(
  pool: Pool
): Promise<{ created: number; skipped: number; errored: number }> {
  const productIds = getDraftPrProductIds();
  const candidates: CompletedAttempt[] = [];
  for (const productId of productIds) {
    candidates.push(...(await fetchCompletedAttempts(pool, productId)));
  }

  let created = 0;
  let skipped = 0;
  let errored = 0;

  // Same per-candidate isolation discipline as fix-reconcile's sweep loop —
  // one attempt's GitHub API error (or a repo temporarily suspended) must
  // never abort the rest of the sweep across every configured product.
  for (const candidate of candidates) {
    try {
      const result = await createDraftPrForAttempt(pool, candidate.product_id, candidate);
      if ("skipped" in result) {
        skipped++;
      } else {
        created++;
      }
    } catch (err) {
      console.warn(
        `draft-pr-create: attempt ${candidate.id} errored: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`
      );
      errored++;
    }
  }

  return { created, skipped, errored };
}

type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

// Cron: every 5 minutes, same cadence as fix-reconcile. See file header for
// the exactly-one-environment gate and product enumeration rationale.
export const draftPrCreate = inngest.createFunction(
  { id: "draft-pr-create", retries: 2, triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }: InngestCtx) => {
    if (process.env.DRAFT_PR_ENABLED !== "true") {
      return { created: 0, skipped: 0, errored: 0 };
    }
    return step.run("draft-pr-sweep", () => draftPrSweepOnce(getPool()));
  }
);
