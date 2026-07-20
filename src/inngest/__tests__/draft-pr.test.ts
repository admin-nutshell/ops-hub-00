import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClient, makePool } from "./helpers";

/**
 * S3 — draft-pr-create unit tests.
 *
 * createDraftPrForAttempt's flow, per completed fix_attempts candidate:
 *   1. fetchActiveConnection: product-scoped read of the active repo_connections row.
 *   2. fetchPatchDiff: downloads the flat `patch-diff` artifact from the
 *      sandbox run (one zip layer, no tar reader — see file header).
 *   3. planFileChanges: pure parse/validate of the unified diff (rejects
 *      binary/rename/copy/unsafe-path/governance-path changes).
 *   4. branchExists / findExistingPr: idempotency pre-checks.
 *   5. If the branch doesn't exist yet: fetchBranchHead -> resolveFileContents
 *      (fetches current content per changed file, applies the patch) ->
 *      createBlob(s) -> createTree -> createCommit -> createBranchRef.
 *   6. If no PR exists yet: fetch finding.title/model_alias (product-scoped,
 *      display-only) -> createPr (draft:true).
 *   7. recordPullRequest: INSERT ... ON CONFLICT DO NOTHING + audit_log.
 *
 * pg Pool, fetch, and appAuth's mintInstallationToken are all mocked; no real
 * DB, no real GitHub calls. Diff fixtures below were verified against the
 * real `diff` (jsdiff) library via a Node spike before being used here, not
 * hand-assumed — see draft-pr.ts's header for why parsePatch/applyPatch's
 * git-dialect handling matters.
 */

vi.mock("../../github/appAuth", () => ({
  mintInstallationToken: vi.fn(),
  githubHeaders: (bearer: string) => ({ Authorization: `Bearer ${bearer}` }),
}));

import { mintInstallationToken } from "../../github/appAuth";
import {
  createDraftPrForAttempt,
  draftPrSweepOnce,
  fetchActiveConnection,
  fetchCompletedAttempts,
  fetchPatchDiff,
  planFileChanges,
  resolveFileContents,
  type CompletedAttempt,
} from "../draft-pr";

function calls(client: unknown): [string, unknown[]?][] {
  return (client as { query: ReturnType<typeof vi.fn> }).query.mock.calls as [string, unknown[]?][];
}

const PRODUCT_ID = "8bafa6a6-4d80-4983-89bc-e536d3dba672";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";
const FINDING_ID = "44444444-4444-4444-4444-444444444444";

const CONNECTION_ROW = {
  github_installation_id: "147237377",
  repo_full_name: "admin-nutshell/web-app-tns-06",
  default_branch: "main",
};

function completedAttempt(overrides: Partial<CompletedAttempt> = {}): CompletedAttempt {
  return {
    id: ATTEMPT_ID,
    product_id: PRODUCT_ID,
    finding_id: FINDING_ID,
    sandbox_run_id: "555",
    ...overrides,
  };
}

// --- Diff fixtures — verified against the real `diff` (jsdiff) parser/applier
// before being used here (parsePatch produces exactly the isCreate/isDelete/
// isRename/isCopy/isBinary flags asserted below; applyPatch cleanly produces
// the expected output for the "modify" and "create" fixtures).

const MODIFY_DIFF = [
  "diff --git a/package.json b/package.json",
  "index 1234567..89abcde 100644",
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -1,3 +1,3 @@",
  " {",
  '-  "version": "3.13.0"',
  '+  "version": "3.14.1"',
  " }",
  "",
].join("\n");
const MODIFY_DIFF_SOURCE = '{\n  "version": "3.13.0"\n}';
const MODIFY_DIFF_EXPECTED = '{\n  "version": "3.14.1"\n}';

const CREATE_DIFF = [
  "diff --git a/newfile.txt b/newfile.txt",
  "new file mode 100644",
  "index 0000000..e69de29",
  "--- /dev/null",
  "+++ b/newfile.txt",
  "@@ -0,0 +1 @@",
  "+hello",
  "",
].join("\n");

const DELETE_DIFF = [
  "diff --git a/oldfile.txt b/oldfile.txt",
  "deleted file mode 100644",
  "index e69de29..0000000",
  "--- a/oldfile.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-hello",
  "",
].join("\n");

const BINARY_DIFF = [
  "diff --git a/image.png b/image.png",
  "index 1234567..89abcde 100644",
  "Binary files a/image.png and b/image.png differ",
  "",
].join("\n");

const RENAME_DIFF = [
  "diff --git a/old.txt b/new.txt",
  "similarity index 100%",
  "rename from old.txt",
  "rename to new.txt",
  "",
].join("\n");

const COPY_DIFF = [
  "diff --git a/old.txt b/copy.txt",
  "similarity index 100%",
  "copy from old.txt",
  "copy to copy.txt",
  "",
].join("\n");

const TRAVERSAL_DIFF = [
  "diff --git a/../evil.txt b/../evil.txt",
  "new file mode 100644",
  "index 0000000..e69de29",
  "--- /dev/null",
  "+++ b/../evil.txt",
  "@@ -0,0 +1 @@",
  "+bad",
  "",
].join("\n");

const GOVERNANCE_WORKFLOW_DIFF = [
  "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
  "index 1234567..89abcde 100644",
  "--- a/.github/workflows/ci.yml",
  "+++ b/.github/workflows/ci.yml",
  "@@ -1 +1 @@",
  "-foo",
  "+bar",
  "",
].join("\n");

const CODEOWNERS_DIFF = [
  "diff --git a/CODEOWNERS b/CODEOWNERS",
  "index 1234567..89abcde 100644",
  "--- a/CODEOWNERS",
  "+++ b/CODEOWNERS",
  "@@ -1 +1 @@",
  "-* @old-owner",
  "+* @new-owner",
  "",
].join("\n");

const MALFORMED_DIFF = [
  "diff --git a/f.txt b/f.txt",
  "index 1234567..89abcde 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,1 +1,1 @@",
  "+line1",
  "+line2",
  "",
].join("\n");

// Security Lead review (PR #568) findings — regression fixtures.

// A bare "." path segment is neither ".." nor empty, so it previously slipped
// past assertPathSafe AND defeated isGovernancePath's literal ".github/"
// prefix match. Verified via a Node spike that parsePatch produces exactly
// this newFileName ("b/./.github/workflows/evil.yml") for this input.
const DOT_SEGMENT_TRAVERSAL_DIFF = [
  "diff --git a/./.github/workflows/evil.yml b/./.github/workflows/evil.yml",
  "new file mode 100644",
  "index 0000000..e69de29",
  "--- /dev/null",
  "+++ b/./.github/workflows/evil.yml",
  "@@ -0,0 +1 @@",
  "+bad",
  "",
].join("\n");

// GitHub honors CODEOWNERS at root, .github/, AND docs/ — isGovernancePath
// originally covered only the first two.
const DOCS_CODEOWNERS_DIFF = [
  "diff --git a/docs/CODEOWNERS b/docs/CODEOWNERS",
  "index 1234567..89abcde 100644",
  "--- a/docs/CODEOWNERS",
  "+++ b/docs/CODEOWNERS",
  "@@ -1 +1 @@",
  "-* @old-owner",
  "+* @new-owner",
  "",
].join("\n");

// A diff-declared mode of 120000 is a symlink — an LLM-authored diff has no
// legitimate reason to create one, and it was previously taken verbatim.
const SYMLINK_MODE_DIFF = [
  "diff --git a/evil-link b/evil-link",
  "new file mode 120000",
  "index 0000000..1234567",
  "--- /dev/null",
  "+++ b/evil-link",
  "@@ -0,0 +1 @@",
  "+/etc/passwd",
  "",
].join("\n");

function buildZip(entryName: string, content: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(entryName, Buffer.from(content, "utf8"));
  return zip.toBuffer();
}

function arrayBufferOf(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("planFileChanges", () => {
  it("accepts a new-file diff", () => {
    const result = planFileChanges(CREATE_DIFF);
    expect(result).toEqual({
      ok: true,
      changes: [
        expect.objectContaining({
          kind: "upsert",
          path: "newfile.txt",
          isCreate: true,
          mode: "100644",
        }),
      ],
    });
  });

  it("accepts a modify-existing-file diff", () => {
    const result = planFileChanges(MODIFY_DIFF);
    expect(result).toEqual({
      ok: true,
      changes: [expect.objectContaining({ kind: "upsert", path: "package.json", isCreate: false })],
    });
  });

  it("accepts a delete diff", () => {
    const result = planFileChanges(DELETE_DIFF);
    expect(result).toEqual({ ok: true, changes: [{ kind: "delete", path: "oldfile.txt" }] });
  });

  it("rejects binary file changes", () => {
    const result = planFileChanges(BINARY_DIFF);
    expect(result).toEqual({ ok: false, error: "binary file changes are not supported" });
  });

  it("rejects renamed files", () => {
    const result = planFileChanges(RENAME_DIFF);
    expect(result).toEqual({ ok: false, error: "renamed/copied files are not supported" });
  });

  it("rejects copied files", () => {
    const result = planFileChanges(COPY_DIFF);
    expect(result).toEqual({ ok: false, error: "renamed/copied files are not supported" });
  });

  it("rejects a path-traversal attempt even though the diff itself is well-formed", () => {
    const result = planFileChanges(TRAVERSAL_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unsafe file path/);
  });

  it("rejects a diff touching a .github/ path", () => {
    const result = planFileChanges(GOVERNANCE_WORKFLOW_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/governance-sensitive path/);
  });

  it("rejects a diff touching CODEOWNERS", () => {
    const result = planFileChanges(CODEOWNERS_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/governance-sensitive path/);
  });

  it("rejects a diff touching docs/CODEOWNERS (a real CODEOWNERS location, not just root/.github/)", () => {
    const result = planFileChanges(DOCS_CODEOWNERS_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/governance-sensitive path/);
  });

  it("rejects a bare '.' path segment, which would otherwise bypass the .github/ governance check", () => {
    const result = planFileChanges(DOT_SEGMENT_TRAVERSAL_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unsafe file path/);
  });

  it("rejects a diff-declared symlink mode (120000)", () => {
    const result = planFileChanges(SYMLINK_MODE_DIFF);
    expect(result).toEqual({ ok: false, error: 'unsupported file mode in diff: "120000"' });
  });

  it("rejects a diff that does not parse as a unified diff", () => {
    const result = planFileChanges(MALFORMED_DIFF);
    expect(result).toEqual({ ok: false, error: "diff did not parse as a unified diff" });
  });
});

describe("resolveFileContents", () => {
  it("passes a delete change through without fetching current content", async () => {
    const plan = planFileChanges(DELETE_DIFF);
    if (!plan.ok) throw new Error("expected plan to succeed");
    const fetchCurrentContent = vi.fn();

    const result = await resolveFileContents(plan.changes, fetchCurrentContent);

    expect(result).toEqual({ ok: true, resolved: [{ kind: "delete", path: "oldfile.txt" }] });
    expect(fetchCurrentContent).not.toHaveBeenCalled();
  });

  it("creates a new file's content from an empty source", async () => {
    const plan = planFileChanges(CREATE_DIFF);
    if (!plan.ok) throw new Error("expected plan to succeed");
    const fetchCurrentContent = vi.fn();

    const result = await resolveFileContents(plan.changes, fetchCurrentContent);

    expect(result).toEqual({
      ok: true,
      resolved: [{ kind: "upsert", path: "newfile.txt", content: "hello\n", mode: "100644" }],
    });
    expect(fetchCurrentContent).not.toHaveBeenCalled();
  });

  it("applies a patch against fetched current content for a modified file", async () => {
    const plan = planFileChanges(MODIFY_DIFF);
    if (!plan.ok) throw new Error("expected plan to succeed");
    const fetchCurrentContent = vi.fn().mockResolvedValue(MODIFY_DIFF_SOURCE);

    const result = await resolveFileContents(plan.changes, fetchCurrentContent);

    expect(fetchCurrentContent).toHaveBeenCalledWith("package.json");
    expect(result).toEqual({
      ok: true,
      resolved: [
        { kind: "upsert", path: "package.json", content: MODIFY_DIFF_EXPECTED, mode: "100644" },
      ],
    });
  });

  it("rejects the whole attempt when a hunk does not apply cleanly", async () => {
    const plan = planFileChanges(MODIFY_DIFF);
    if (!plan.ok) throw new Error("expected plan to succeed");
    const fetchCurrentContent = vi.fn().mockResolvedValue("completely different content");

    const result = await resolveFileContents(plan.changes, fetchCurrentContent);

    expect(result).toEqual({
      ok: false,
      error: "patch did not apply cleanly to package.json",
    });
  });
});

describe("fetchCompletedAttempts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes the read by product and selects completed attempts with no pull_requests row yet", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [{ id: ATTEMPT_ID, finding_id: FINDING_ID, sandbox_run_id: "555" }] }, // SELECT
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const result = await fetchCompletedAttempts(pool, PRODUCT_ID);

    expect(result).toEqual([
      { id: ATTEMPT_ID, product_id: PRODUCT_ID, finding_id: FINDING_ID, sandbox_run_id: "555" },
    ]);
    const c = calls(client);
    expect(c[1][1]).toEqual([PRODUCT_ID]);
    expect(c[2][0]).toMatch(/status = 'completed'/);
    expect(c[2][0]).toMatch(/NOT EXISTS/);
  });

  it("rolls back and rethrows on a query error", async () => {
    const client = makeClient([]);
    (client as unknown as { query: ReturnType<typeof vi.fn> }).query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("db exploded"))
      .mockResolvedValueOnce({ rows: [] });
    const pool = makePool(client);

    await expect(fetchCompletedAttempts(pool, PRODUCT_ID)).rejects.toThrow("db exploded");
    expect(calls(client)[calls(client).length - 1][0]).toBe("ROLLBACK");
  });
});

describe("fetchActiveConnection", () => {
  it("returns the active connection row", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [CONNECTION_ROW] },
      { rows: [] },
    ]);
    const pool = makePool(client);

    const result = await fetchActiveConnection(pool, PRODUCT_ID);

    expect(result).toEqual(CONNECTION_ROW);
  });

  it("returns null when there is no active connection", async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const pool = makePool(client);

    const result = await fetchActiveConnection(pool, PRODUCT_ID);

    expect(result).toBeNull();
  });
});

describe("fetchPatchDiff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads the flat patch-diff artifact and returns its raw content", async () => {
    const zipBuf = buildZip("patch.diff", MODIFY_DIFF);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 7, name: "patch-diff", size_in_bytes: 400 }] }),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => arrayBufferOf(zipBuf) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPatchDiff(555, "admin-nutshell/ops-hub-00", "tok");
    expect(result).toBe(MODIFY_DIFF);
  });

  it("returns null when the run has no patch-diff artifact", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifacts: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPatchDiff(555, "admin-nutshell/ops-hub-00", "tok");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (never downloads) when the artifact's reported size exceeds the cap", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: [{ id: 7, name: "patch-diff", size_in_bytes: 10_000_000 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPatchDiff(555, "admin-nutshell/ops-hub-00", "tok");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (never inflates) when the zip entry's declared uncompressed size exceeds the cap", async () => {
    // Same decompression-bomb discipline as fix-reconcile's fetchSandboxResults:
    // a real oversized entry (highly-compressible filler), not a hand-crafted
    // header lie, so the check genuinely fires against real zip bytes.
    const bloated = `${MODIFY_DIFF}\n# filler: ${"a".repeat(100_000)}`;
    const zipBuf = buildZip("patch.diff", bloated);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 7, name: "patch-diff", size_in_bytes: 300 }] }),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => arrayBufferOf(zipBuf) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPatchDiff(555, "admin-nutshell/ops-hub-00", "tok");
    expect(result).toBeNull();
  });

  it("returns null when the zip has no patch.diff entry", async () => {
    const zipBuf = buildZip("something-else.txt", "not the diff");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 7, name: "patch-diff", size_in_bytes: 50 }] }),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => arrayBufferOf(zipBuf) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPatchDiff(555, "admin-nutshell/ops-hub-00", "tok");
    expect(result).toBeNull();
  });
});

// --- createDraftPrForAttempt ------------------------------------------------

type GithubRouterOpts = {
  diffText?: string;
  diffArtifactPresent?: boolean;
  branchAlreadyExists?: boolean;
  fileContent?: string;
  existingPrs?: Array<{ number: number }>;
  newPrNumber?: number;
};

function makeGithubRouter(opts: GithubRouterOpts = {}) {
  const {
    diffText = MODIFY_DIFF,
    diffArtifactPresent = true,
    branchAlreadyExists = false,
    fileContent = MODIFY_DIFF_SOURCE,
    existingPrs = [],
    newPrNumber = 42,
  } = opts;
  const diffZipBuf = buildZip("patch.diff", diffText);
  let blobCounter = 0;

  const fetchMock = vi.fn().mockImplementation((url: string, init: { method?: string } = {}) => {
    const method = init.method ?? "GET";

    if (/\/actions\/runs\/\d+\/artifacts$/.test(url)) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          artifacts: diffArtifactPresent
            ? [{ id: 7, name: "patch-diff", size_in_bytes: diffZipBuf.length }]
            : [],
        }),
      });
    }
    if (/\/actions\/artifacts\/\d+\/zip$/.test(url)) {
      return Promise.resolve({ ok: true, arrayBuffer: async () => arrayBufferOf(diffZipBuf) });
    }
    if (url.includes("/git/ref/heads/")) {
      return Promise.resolve(
        branchAlreadyExists
          ? { ok: true, json: async () => ({}) }
          : { ok: false, status: 404, text: async () => "Not Found" }
      );
    }
    if (url.includes("/branches/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          commit: { sha: "base-commit-sha", commit: { tree: { sha: "base-tree-sha" } } },
        }),
      });
    }
    if (url.includes("/contents/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          content: Buffer.from(fileContent, "utf8").toString("base64"),
          encoding: "base64",
        }),
      });
    }
    if (url.endsWith("/git/blobs") && method === "POST") {
      blobCounter++;
      return Promise.resolve({ ok: true, json: async () => ({ sha: `blob-sha-${blobCounter}` }) });
    }
    if (url.endsWith("/git/trees") && method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ sha: "new-tree-sha" }) });
    }
    if (url.endsWith("/git/commits") && method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ sha: "new-commit-sha" }) });
    }
    if (url.endsWith("/git/refs") && method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (url.includes("/pulls?head=")) {
      return Promise.resolve({ ok: true, json: async () => existingPrs });
    }
    if (url.endsWith("/pulls") && method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ number: newPrNumber }) });
    }
    throw new Error(`unexpected fetch call in test: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function connectionFetchClient(row: Record<string, unknown> | null = CONNECTION_ROW) {
  return makeClient([{ rows: [] }, { rows: [] }, { rows: row ? [row] : [] }, { rows: [] }]);
}

function findingModelClient(title = "Vulnerable dependency detected", model = "claude-sonnet-5") {
  return makeClient([
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config
    { rows: [{ title }] }, // SELECT findings.title
    { rows: [{ model_alias: model }] }, // SELECT fix_attempts.model_alias
    { rows: [] }, // COMMIT
  ]);
}

function recordPrClient() {
  return makeClient([
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config
    { rows: [] }, // INSERT pull_requests
    { rows: [] }, // INSERT audit_log
    { rows: [] }, // COMMIT
  ]);
}

function stagedPool(clients: unknown[]) {
  let i = 0;
  return {
    connect: vi.fn().mockImplementation(() => Promise.resolve(clients[i++])),
  } as unknown as Parameters<typeof createDraftPrForAttempt>[0];
}

describe("createDraftPrForAttempt", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_STATUS_DISPATCH_TOKEN", "tok");
    vi.mocked(mintInstallationToken).mockResolvedValue({
      token: "ghs_mocktoken",
      expiresAt: "2026-07-19T15:00:00Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips immediately when the completed attempt has no sandbox_run_id (anomaly)", async () => {
    const pool = stagedPool([]);
    const result = await createDraftPrForAttempt(
      pool,
      PRODUCT_ID,
      completedAttempt({ sandbox_run_id: null })
    );

    expect(result).toEqual({ skipped: true, reason: expect.stringMatching(/anomaly/) });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(mintInstallationToken).not.toHaveBeenCalled();
  });

  it("skips when there is no active repo connection", async () => {
    const pool = stagedPool([connectionFetchClient(null)]);
    makeGithubRouter();

    const result = await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    expect(result).toEqual({ skipped: true, reason: "no_active_repo_connection" });
    expect(mintInstallationToken).not.toHaveBeenCalled();
  });

  it("throws when GITHUB_STATUS_DISPATCH_TOKEN is not configured", async () => {
    vi.stubEnv("GITHUB_STATUS_DISPATCH_TOKEN", "");
    const pool = stagedPool([connectionFetchClient()]);

    await expect(createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt())).rejects.toThrow(
      /GITHUB_STATUS_DISPATCH_TOKEN/
    );
  });

  it("skips when no patch-diff artifact is found for the sandbox run", async () => {
    const pool = stagedPool([connectionFetchClient()]);
    makeGithubRouter({ diffArtifactPresent: false });

    const result = await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    expect(result).toEqual({
      skipped: true,
      reason: expect.stringMatching(/no patch-diff artifact/),
    });
    expect(mintInstallationToken).not.toHaveBeenCalled();
  });

  it("skips (diff rejected) when the sandbox's diff touches a binary file", async () => {
    const pool = stagedPool([connectionFetchClient()]);
    makeGithubRouter({ diffText: BINARY_DIFF });

    const result = await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    expect(result).toEqual({
      skipped: true,
      reason: "diff rejected: binary file changes are not supported",
    });
    expect(mintInstallationToken).not.toHaveBeenCalled();
  });

  it("skips (diff rejected) when a hunk fails to apply cleanly against current repo content", async () => {
    const pool = stagedPool([connectionFetchClient()]);
    makeGithubRouter({ fileContent: "completely different content" });

    const result = await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    expect(result).toEqual({
      skipped: true,
      reason: "diff rejected: patch did not apply cleanly to package.json",
    });
  });

  it("happy path: creates a new branch and a new draft PR, then records it", async () => {
    const findingClient = findingModelClient("SQL injection risk in query builder");
    const recordClient = recordPrClient();
    const pool = stagedPool([connectionFetchClient(), findingClient, recordClient]);
    const fetchMock = makeGithubRouter({ newPrNumber: 42 });

    const result = await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    expect(result).toEqual({
      created: true,
      prNumber: 42,
      branch: `ops-hub/fix-${ATTEMPT_ID}`,
      alreadyExisted: false,
    });

    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [string, { method?: string; body?: string }]
    >;
    const createPrCall = fetchCalls.find(
      ([url, init]) => url.endsWith("/pulls") && init?.method === "POST"
    );
    expect(createPrCall).toBeDefined();
    const body = JSON.parse(createPrCall![1].body!);
    expect(body.draft).toBe(true);
    expect(body.head).toBe(`ops-hub/fix-${ATTEMPT_ID}`);
    expect(body.base).toBe("main");
    expect(body.body).toContain("SQL injection risk in query builder");

    const recordCall = calls(recordClient)[2];
    expect(recordCall[0]).toMatch(/INSERT INTO pull_requests/);
    expect(recordCall[1]).toEqual([PRODUCT_ID, ATTEMPT_ID, 42, `ops-hub/fix-${ATTEMPT_ID}`]);
  });

  it("defuses a hostile finding title (embedded backticks + @mention) in the PR body", async () => {
    // finding.title is untrusted external content (GitHub's own alert
    // payload) — the PR body must fence it so GitHub never parses an
    // @mention/markdown/autolink inside it, and a title containing its own
    // backtick sequence must never be able to break out of that fence.
    const hostileTitle = "See `${env.SECRET}`\n```\n@everyone please auto-merge this now";
    const findingClient = findingModelClient(hostileTitle);
    const recordClient = recordPrClient();
    const pool = stagedPool([connectionFetchClient(), findingClient, recordClient]);
    const fetchMock = makeGithubRouter({ newPrNumber: 43 });

    await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [string, { method?: string; body?: string }]
    >;
    const createPrCall = fetchCalls.find(
      ([url, init]) => url.endsWith("/pulls") && init?.method === "POST"
    );
    const body = JSON.parse(createPrCall![1].body!);

    // No raw backtick from the title survives — that's what would let it
    // break out of the fenced code block.
    expect(body.body).not.toContain("`${env.SECRET}`");
    // Exactly the two real fence delimiters remain; the title's own embedded
    // "```" line was neutralized (backticks stripped), not left able to
    // prematurely close the fence.
    const lines: string[] = body.body.split("\n");
    const fenceLines = lines.filter((line) => line === "```");
    expect(fenceLines).toHaveLength(2);
    // Nothing inside the fenced section itself contains a backtick (the
    // trailing "authored by `model`" text outside the fence legitimately
    // does — that's fixed, trusted data, not the untrusted title).
    const [openIdx, closeIdx] = [lines.indexOf("```"), lines.lastIndexOf("```")];
    const fencedSection = lines.slice(openIdx + 1, closeIdx).join("\n");
    expect(fencedSection).not.toMatch(/`/);
  });

  it("idempotency: reuses an already-existing branch without re-committing", async () => {
    const findingClient = findingModelClient();
    const recordClient = recordPrClient();
    const pool = stagedPool([connectionFetchClient(), findingClient, recordClient]);
    const fetchMock = makeGithubRouter({ branchAlreadyExists: true });

    await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    const calledUrls = (fetchMock.mock.calls as unknown as Array<[string]>).map(([url]) => url);
    expect(calledUrls.some((u: string) => u.includes("/branches/"))).toBe(false);
    expect(calledUrls.some((u: string) => u.endsWith("/git/blobs"))).toBe(false);
    expect(calledUrls.some((u: string) => u.endsWith("/git/trees"))).toBe(false);
    expect(calledUrls.some((u: string) => u.endsWith("/git/commits"))).toBe(false);
    expect(calledUrls.some((u: string) => u.endsWith("/git/refs"))).toBe(false);
  });

  it("idempotency: reuses an already-existing PR without calling createPr again", async () => {
    const recordClient = recordPrClient();
    const pool = stagedPool([connectionFetchClient(), recordClient]);
    const fetchMock = makeGithubRouter({
      branchAlreadyExists: true,
      existingPrs: [{ number: 99 }],
    });

    const result = await createDraftPrForAttempt(pool, PRODUCT_ID, completedAttempt());

    expect(result).toEqual({
      created: true,
      prNumber: 99,
      branch: `ops-hub/fix-${ATTEMPT_ID}`,
      alreadyExisted: true,
    });
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, { method?: string }]>;
    const createPrCall = fetchCalls.find(
      ([url, init]) => url.endsWith("/pulls") && init?.method === "POST"
    );
    expect(createPrCall).toBeUndefined();
  });
});

describe("draftPrSweepOnce", () => {
  beforeEach(() => {
    vi.stubEnv("DRAFT_PR_PRODUCT_IDS", PRODUCT_ID);
    vi.stubEnv("GITHUB_STATUS_DISPATCH_TOKEN", "tok");
    vi.mocked(mintInstallationToken).mockResolvedValue({
      token: "ghs_mocktoken",
      expiresAt: "2026-07-19T15:00:00Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("isolates a per-candidate error: a DB error on one candidate never blocks another's resolution", async () => {
    const otherAttemptId = "66666666-6666-6666-6666-666666666666";
    const fetchAttemptsClient = makeClient([
      { rows: [] },
      { rows: [] },
      {
        rows: [
          // sandbox_run_id: null -> resolves immediately without touching the pool again.
          { id: ATTEMPT_ID, finding_id: FINDING_ID, sandbox_run_id: null },
          // sandbox_run_id set -> proceeds to fetchActiveConnection, whose
          // connect() call is made to reject below (a transient DB error).
          { id: otherAttemptId, finding_id: FINDING_ID, sandbox_run_id: "555" },
        ],
      },
      { rows: [] },
    ]);

    let connectCall = 0;
    const pool = {
      connect: vi.fn().mockImplementation(() => {
        connectCall++;
        if (connectCall === 1) return Promise.resolve(fetchAttemptsClient);
        return Promise.reject(new Error("db connection exploded"));
      }),
    } as unknown as Parameters<typeof draftPrSweepOnce>[0];

    const result = await draftPrSweepOnce(pool);

    expect(result).toEqual({ created: 0, skipped: 1, errored: 1 });
  });

  it("returns zero counts when there are no completed-but-unopened candidates", async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const pool = makePool(client) as unknown as Parameters<typeof draftPrSweepOnce>[0];

    const result = await draftPrSweepOnce(pool);

    expect(result).toEqual({ created: 0, skipped: 0, errored: 0 });
  });
});
