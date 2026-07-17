import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeClient, makePool } from "../../inngest/__tests__/helpers";

// Mock the shared Inngest client so triggerRepoInspect never makes a real
// network call — mirrors how repo-inspect.test.ts mocks appAuth rather than
// hitting GitHub for real.
vi.mock("../../inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

import { inngest } from "../../inngest/client";
import { getRepoSnapshotView, triggerRepoInspect, RepoInspectDispatchError } from "../repoInspect";

const PRODUCT_ID = "8bafa6a6-4d80-4983-89bc-e536d3dba672";

function txn(rows: Record<string, unknown>[]) {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows }, // SELECT
    { rows: [] }, // COMMIT
  ];
}

function undefinedTableTxn() {
  return [{ rows: [] }, { rows: [] }]; // BEGIN, set_config — the SELECT itself rejects
}

describe("getRepoSnapshotView", () => {
  it("returns no_connection when the product has no active repo_connections row", async () => {
    const client = makeClient(txn([]));
    const pool = makePool(client);
    await expect(getRepoSnapshotView(pool, PRODUCT_ID)).resolves.toEqual({
      status: "no_connection",
    });
  });

  it("returns no_snapshot when connected but never inspected (fetched_at IS NULL)", async () => {
    const client = makeClient(
      txn([
        {
          repo_full_name: "admin-nutshell/web-app-tns-06",
          default_branch: "main",
          fetched_at: null,
          tree_entry_count: null,
          tree_truncated: null,
          tree: null,
          commits: null,
        },
      ])
    );
    const pool = makePool(client);
    await expect(getRepoSnapshotView(pool, PRODUCT_ID)).resolves.toEqual({
      status: "no_snapshot",
      repoFullName: "admin-nutshell/web-app-tns-06",
      defaultBranch: "main",
    });
  });

  it("returns the ready snapshot when one exists", async () => {
    const tree = [{ path: "src/index.ts", type: "blob" }];
    const commits = [
      { sha: "abc123", message: "fix: thing", author: "a", date: "2026-07-17T00:00:00Z" },
    ];
    const client = makeClient(
      txn([
        {
          repo_full_name: "admin-nutshell/web-app-tns-06",
          default_branch: "main",
          fetched_at: "2026-07-17T12:00:00Z",
          tree_entry_count: 1,
          tree_truncated: false,
          tree,
          commits,
        },
      ])
    );
    const pool = makePool(client);
    await expect(getRepoSnapshotView(pool, PRODUCT_ID)).resolves.toEqual({
      status: "ready",
      repoFullName: "admin-nutshell/web-app-tns-06",
      defaultBranch: "main",
      fetchedAt: "2026-07-17T12:00:00Z",
      treeEntryCount: 1,
      treeTruncated: false,
      tree,
      commits,
    });
  });

  it("SCHEMA-NOT-READY — degrades to schema_not_ready on 42P01 rather than throwing", async () => {
    const responses = undefinedTableTxn();
    let callIndex = 0;
    const query = vi.fn().mockImplementation(() => {
      if (callIndex === 2) {
        callIndex++;
        return Promise.reject(
          Object.assign(new Error("relation does not exist"), { code: "42P01" })
        );
      }
      const resp = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(resp);
    });
    const client = { query, release: vi.fn() } as unknown as Parameters<typeof makePool>[0];
    const pool = makePool(client);
    await expect(getRepoSnapshotView(pool, PRODUCT_ID)).resolves.toEqual({
      status: "schema_not_ready",
    });
    // Still commits (a degrade, not a rollback) — matches getModelRoutingOverrides's convention.
    expect(query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("re-throws a non-42P01 error and rolls back", async () => {
    let callIndex = 0;
    const query = vi.fn().mockImplementation(() => {
      if (callIndex === 2) {
        callIndex++;
        return Promise.reject(new Error("connection reset"));
      }
      callIndex++;
      return Promise.resolve({ rows: [] });
    });
    const client = { query, release: vi.fn() } as unknown as Parameters<typeof makePool>[0];
    const pool = makePool(client);
    await expect(getRepoSnapshotView(pool, PRODUCT_ID)).rejects.toThrow("connection reset");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("triggerRepoInspect", () => {
  beforeEach(() => {
    vi.mocked(inngest.send).mockReset();
  });

  it("sends ops-hub/repo.inspect.requested with the product id and returns dispatched:true", async () => {
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-1"] } as never);
    await expect(triggerRepoInspect(PRODUCT_ID)).resolves.toEqual({ dispatched: true });
    expect(inngest.send).toHaveBeenCalledWith({
      name: "ops-hub/repo.inspect.requested",
      data: { product_id: PRODUCT_ID },
    });
  });

  it("wraps an inngest.send failure (e.g. missing INNGEST_EVENT_KEY) as a 503 RepoInspectDispatchError, not a raw crash", async () => {
    vi.mocked(inngest.send).mockRejectedValue(new Error("Event key not found"));
    await expect(triggerRepoInspect(PRODUCT_ID)).rejects.toThrow(RepoInspectDispatchError);
    try {
      await triggerRepoInspect(PRODUCT_ID);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RepoInspectDispatchError);
      expect((err as RepoInspectDispatchError).httpStatus).toBe(503);
      expect((err as RepoInspectDispatchError).message).toContain("Event key not found");
    }
  });
});
