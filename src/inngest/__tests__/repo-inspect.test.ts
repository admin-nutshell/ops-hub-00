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
import { inspectProductRepo } from "../repo-inspect";

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
