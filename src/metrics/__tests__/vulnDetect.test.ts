import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeClient, makePool } from "../../inngest/__tests__/helpers";

// Mock the shared Inngest client so triggerVulnDetect never makes a real
// network call — mirrors repoInspect.test.ts's mock of the same client.
vi.mock("../../inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

import { inngest } from "../../inngest/client";
import { getVulnFindingsView, triggerVulnDetect, VulnDetectDispatchError } from "../vulnDetect";

const PRODUCT_ID = "8bafa6a6-4d80-4983-89bc-e536d3dba672";

function txn(rows: Record<string, unknown>[], latest: string | null) {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows }, // SELECT findings
    { rows: [{ latest }] }, // SELECT max(updated_at)
    { rows: [] }, // COMMIT
  ];
}

function undefinedTableTxn() {
  return [{ rows: [] }, { rows: [] }]; // BEGIN, set_config — the SELECT itself rejects
}

describe("getVulnFindingsView", () => {
  it("returns ready with an empty list when the product has no vuln findings yet", async () => {
    const client = makeClient(txn([], null));
    const pool = makePool(client);
    await expect(getVulnFindingsView(pool, PRODUCT_ID)).resolves.toEqual({
      status: "ready",
      findings: [],
      latestUpdatedAt: null,
    });
  });

  it("returns findings ordered as given by the query, with package_name extracted from detail", async () => {
    const rows = [
      {
        id: "f1",
        severity: "critical",
        title: "js-yaml: DoS",
        package_name: "js-yaml",
        state: "detected",
        created_at: "2026-07-17T10:00:00Z",
        updated_at: "2026-07-17T10:00:00Z",
      },
      {
        id: "f2",
        severity: "medium",
        title: "codeql-rule: something",
        package_name: null,
        state: "triaged",
        created_at: "2026-07-16T10:00:00Z",
        updated_at: "2026-07-17T11:00:00Z",
      },
    ];
    const client = makeClient(txn(rows, "2026-07-17T11:00:00Z"));
    const pool = makePool(client);
    await expect(getVulnFindingsView(pool, PRODUCT_ID)).resolves.toEqual({
      status: "ready",
      findings: [
        {
          id: "f1",
          severity: "critical",
          title: "js-yaml: DoS",
          packageName: "js-yaml",
          state: "detected",
          createdAt: "2026-07-17T10:00:00Z",
          updatedAt: "2026-07-17T10:00:00Z",
        },
        {
          id: "f2",
          severity: "medium",
          title: "codeql-rule: something",
          packageName: null,
          state: "triaged",
          createdAt: "2026-07-16T10:00:00Z",
          updatedAt: "2026-07-17T11:00:00Z",
        },
      ],
      latestUpdatedAt: "2026-07-17T11:00:00Z",
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
    await expect(getVulnFindingsView(pool, PRODUCT_ID)).resolves.toEqual({
      status: "schema_not_ready",
    });
    // Still commits (a degrade, not a rollback) — matches getRepoSnapshotView's convention.
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
    await expect(getVulnFindingsView(pool, PRODUCT_ID)).rejects.toThrow("connection reset");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("triggerVulnDetect", () => {
  beforeEach(() => {
    vi.mocked(inngest.send).mockReset();
  });

  it("sends ops-hub/vuln.detect.requested with the product id and returns dispatched:true", async () => {
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-1"] } as never);
    await expect(triggerVulnDetect(PRODUCT_ID)).resolves.toEqual({ dispatched: true });
    expect(inngest.send).toHaveBeenCalledWith({
      name: "ops-hub/vuln.detect.requested",
      data: { product_id: PRODUCT_ID },
    });
  });

  it("wraps an inngest.send failure (e.g. missing INNGEST_EVENT_KEY) as a 503 VulnDetectDispatchError, not a raw crash", async () => {
    vi.mocked(inngest.send).mockRejectedValue(new Error("Event key not found"));
    await expect(triggerVulnDetect(PRODUCT_ID)).rejects.toThrow(VulnDetectDispatchError);
    try {
      await triggerVulnDetect(PRODUCT_ID);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(VulnDetectDispatchError);
      expect((err as VulnDetectDispatchError).httpStatus).toBe(503);
      expect((err as VulnDetectDispatchError).message).toContain("Event key not found");
    }
  });
});
