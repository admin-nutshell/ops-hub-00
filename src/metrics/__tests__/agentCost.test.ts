import { afterEach, describe, expect, it, vi } from "vitest";
import { getDailyCostForTenant, getTotalCostForTenant } from "../agentCost";
import { makeClient, makePool } from "../../inngest/__tests__/helpers";

const PROJECT_ID = "00000000-0000-0000-0000-000000000002";
const TENANT_ID = "00000000-0000-0000-0000-000000000020";

describe("getDailyCostForTenant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets tenant/project GUCs transaction-local and returns mapped rows", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      {
        rows: [
          {
            day: "2026-07-04",
            trace_name: "ticket-triage",
            event_count: "3",
            total_cost_usd: "0.001200",
          },
          {
            day: "2026-07-04",
            trace_name: "ticket-respond",
            event_count: "2",
            total_cost_usd: "0.002400",
          },
        ],
      },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const rows = await getDailyCostForTenant(pool, PROJECT_ID, TENANT_ID, 30);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual(["SELECT set_config('app.current_tenant', $1, true)", [TENANT_ID]]);
    expect(calls[2]).toEqual(["SELECT set_config('app.current_project', $1, true)", [PROJECT_ID]]);

    expect(rows).toEqual([
      { day: "2026-07-04", traceName: "ticket-triage", eventCount: 3, totalCostUsd: 0.0012 },
      { day: "2026-07-04", traceName: "ticket-respond", eventCount: 2, totalCostUsd: 0.0024 },
    ]);
  });

  it("rolls back and re-throws on DB error", async () => {
    const client = makeClient([{ rows: [] }]);
    (client.query as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve({ rows: [] })) // BEGIN
      .mockImplementationOnce(() => {
        throw new Error("DB down");
      });
    const pool = makePool(client);
    await expect(getDailyCostForTenant(pool, PROJECT_ID, TENANT_ID)).rejects.toThrow("DB down");
  });
});

describe("getTotalCostForTenant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sums totalCostUsd across all returned rows", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            day: "2026-07-04",
            trace_name: "ticket-triage",
            event_count: "1",
            total_cost_usd: "0.001",
          },
          { day: "2026-07-03", trace_name: "kb-learn", event_count: "1", total_cost_usd: "0.002" },
        ],
      },
      { rows: [] },
    ]);
    const pool = makePool(client);
    const total = await getTotalCostForTenant(pool, PROJECT_ID, TENANT_ID);
    expect(total).toBeCloseTo(0.003, 6);
  });
});
