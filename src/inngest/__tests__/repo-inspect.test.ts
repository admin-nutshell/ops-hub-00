import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClient, makePool } from "./helpers";

/**
 * S1 — repo-inspect unit tests.
 *
 * inspectProductRepo's flow: fetch txn (SELECT active repo_connections row)
 * -> mint installation token -> fetch tree -> fetch commits -> write txn
 * (UPSERT repo_snapshots + audit_log INSERT). appAuth's mintInstallationToken
 * is mocked directly (its own unit tests in src/github/appAuth.test.ts cover
 * the JWT/exchange mechanics) so these tests focus on the Inngest
 * transaction/GUC/audit shape and the tree cap/filter behavior.
 *
 * pg Pool + fetch are mocked; no real DB, no real GitHub call.
 */

vi.mock("../../github/appAuth", () => ({
  mintInstallationToken: vi.fn(),
  githubHeaders: (bearer: string) => ({ Authorization: `Bearer ${bearer}` }),
}));

import { mintInstallationToken } from "../../github/appAuth";
import { assertValidRepoFullName, inspectProductRepo } from "../repo-inspect";

const CONNECTION_ROW = {
  id: "conn-1",
  github_installation_id: "147237377",
  repo_full_name: "admin-nutshell/web-app-tns-06",
  default_branch: "main",
};

function fetchTxn(connectionRow: Record<string, unknown> | null) {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: connectionRow ? [connectionRow] : [] }, // SELECT repo_connections
    { rows: [] }, // COMMIT
  ];
}

function writeTxn() {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: [] }, // INSERT ... repo_snapshots UPSERT
    { rows: [] }, // INSERT audit_log
    { rows: [] }, // COMMIT
  ];
}

function mockGithubResponses(
  treeEntries: Array<{ path: string; type: string; size?: number }>,
  opts: { truncated?: boolean } = {}
) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/git/trees/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ tree: treeEntries, truncated: opts.truncated ?? false }),
      });
    }
    if (url.includes("/commits")) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            sha: "abc123",
            commit: {
              message: "Fix bug\n\nLonger body",
              author: { name: "Dev One", date: "2026-07-17T00:00:00Z" },
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("assertValidRepoFullName", () => {
  it("accepts a clean owner/repo shape", () => {
    expect(() => assertValidRepoFullName("admin-nutshell/web-app-tns-06")).not.toThrow();
  });

  it("rejects a dot-segment path-traversal attempt (../etc)", () => {
    // The naive shape regex some reviewers reach for (/^[\w.-]+\/[\w.-]+$/)
    // would WRONGLY ACCEPT this — "." is inside the character class, so
    // ".." is a legal single component under that regex alone. This case
    // exists specifically to prove the dot-segment guard fires, not just
    // the two-component shape check.
    expect(() => assertValidRepoFullName("../etc")).toThrow(/Invalid repo_full_name/);
  });

  it("rejects a trailing .. component (owner/..)", () => {
    expect(() => assertValidRepoFullName("owner/..")).toThrow(/Invalid repo_full_name/);
  });

  it("rejects extra path segments (owner/repo/extra)", () => {
    expect(() => assertValidRepoFullName("owner/repo/extra")).toThrow(/Invalid repo_full_name/);
  });

  it("rejects a single component with no slash", () => {
    expect(() => assertValidRepoFullName("owner-only")).toThrow(/Invalid repo_full_name/);
  });

  it("rejects characters that could alter URL meaning (?, #)", () => {
    expect(() => assertValidRepoFullName("owner/repo?x=1")).toThrow(/Invalid repo_full_name/);
    expect(() => assertValidRepoFullName("owner/repo#frag")).toThrow(/Invalid repo_full_name/);
  });
});

describe("inspectProductRepo", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("OPS_HUB_APP_LOGIN_URL", "postgresql://mock");
    vi.mocked(mintInstallationToken).mockResolvedValue({
      token: "ghs_mocktoken",
      expiresAt: "2026-07-17T15:00:00Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns skipped when there is no active repo connection for the product", async () => {
    const client = makeClient(fetchTxn(null));
    const pool = makePool(client);
    const result = await inspectProductRepo(pool, "product-1");
    expect(result).toEqual({ skipped: true, reason: "no_active_repo_connection" });
    expect(mintInstallationToken).not.toHaveBeenCalled();
  });

  it("mints a token for the connection's installation id, never a hardcoded one", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn()]);
    const pool = makePool(client);
    mockGithubResponses([{ path: "src/index.ts", type: "blob", size: 100 }]);

    await inspectProductRepo(pool, "product-1");

    expect(mintInstallationToken).toHaveBeenCalledWith("147237377");
  });

  it("full happy path: fetches tree + commits and writes snapshot + audit row", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn()]);
    const pool = makePool(client);
    mockGithubResponses([
      { path: "src/index.ts", type: "blob", size: 100 },
      { path: "README.md", type: "blob", size: 50 },
    ]);

    const result = await inspectProductRepo(pool, "product-1");

    expect(result).toEqual({
      inspected: true,
      snapshot: {
        repo_full_name: "admin-nutshell/web-app-tns-06",
        default_branch: "main",
        tree: {
          entries: [
            { path: "src/index.ts", type: "blob", size: 100 },
            { path: "README.md", type: "blob", size: 50 },
          ],
          entry_count: 2,
          truncated: false,
        },
        commits: [
          { sha: "abc123", message: "Fix bug", author: "Dev One", date: "2026-07-17T00:00:00Z" },
        ],
      },
    });

    // Write txn: BEGIN, set_config, repo_snapshots UPSERT, audit_log INSERT, COMMIT.
    const writeCalls = vi.mocked(client.query).mock.calls.slice(4);
    expect(String(writeCalls[2][0])).toMatch(/INSERT INTO repo_snapshots/);
    expect(String(writeCalls[3][0])).toMatch(/INSERT INTO audit_log/);
    // audit_log payload must be a summary only — never the raw tree/commits array.
    const auditParams = writeCalls[3][1] as unknown[];
    const auditPayload = JSON.parse(auditParams[1] as string);
    expect(auditPayload).toEqual({
      product_id: "product-1",
      repo_full_name: "admin-nutshell/web-app-tns-06",
      default_branch: "main",
      tree_entry_count: 2,
      tree_truncated: false,
      commit_count: 1,
    });
  });

  it("filters node_modules/.git noise out of the tree", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn()]);
    const pool = makePool(client);
    mockGithubResponses([
      { path: "src/index.ts", type: "blob" },
      { path: "node_modules/lodash/index.js", type: "blob" },
      { path: ".git/HEAD", type: "blob" },
    ]);

    const result = await inspectProductRepo(pool, "product-1");
    expect(result).toMatchObject({
      inspected: true,
      snapshot: { tree: { entry_count: 1, entries: [{ path: "src/index.ts", type: "blob" }] } },
    });
  });

  it("caps stored tree entries and marks truncated when the filtered tree exceeds the cap", async () => {
    const bigTree = Array.from({ length: 2000 }, (_, i) => ({
      path: `file-${i}.ts`,
      type: "blob",
    }));
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn()]);
    const pool = makePool(client);
    mockGithubResponses(bigTree);

    const result = await inspectProductRepo(pool, "product-1");
    expect(result).toMatchObject({ inspected: true });
    if ("inspected" in result) {
      expect(result.snapshot.tree.entries.length).toBe(1500);
      expect(result.snapshot.tree.entry_count).toBe(2000);
      expect(result.snapshot.tree.truncated).toBe(true);
    }
  });

  it("rejects a malformed repo_full_name before minting a token or writing anything", async () => {
    const malformedConnection = { ...CONNECTION_ROW, repo_full_name: "owner/../etc" };
    const client = makeClient(fetchTxn(malformedConnection));
    const pool = makePool(client);
    // mintInstallationToken's mock.calls accumulate across cases in this
    // describe block (vi.restoreAllMocks() does not clear call history for
    // a vi.mock()-factory-produced vi.fn()) — snapshot the count rather than
    // assert an absolute zero, so this assertion means "this call made no
    // NEW mint attempt," not "no prior test in this file ever minted."
    const mintCallsBefore = vi.mocked(mintInstallationToken).mock.calls.length;

    await expect(inspectProductRepo(pool, "product-1")).rejects.toThrow(
      "Invalid repo_full_name shape"
    );
    expect(vi.mocked(mintInstallationToken).mock.calls.length).toBe(mintCallsBefore);
    // Only the fetch txn's 4 calls should have run — no write txn attempted.
    expect(vi.mocked(client.query).mock.calls.length).toBe(4);
  });

  it("propagates a GitHub API error without writing anything", async () => {
    const client = makeClient(fetchTxn(CONNECTION_ROW));
    const pool = makePool(client);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "rate limited" })
    );

    await expect(inspectProductRepo(pool, "product-1")).rejects.toThrow("GitHub tree fetch 403");
    // Only the fetch txn's 4 calls should have run — no write txn attempted.
    expect(vi.mocked(client.query).mock.calls.length).toBe(4);
  });
});
