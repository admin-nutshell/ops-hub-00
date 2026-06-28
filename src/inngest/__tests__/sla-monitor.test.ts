import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findAndLogBreaches, _resetPool } from "../sla-monitor";
import { makeClient, makePool } from "./helpers";

const TICKET_ID = "ticket-aaa";
const PROJECT_ID = "proj-aaa";
const TENANT_ID = "tenant-aaa";

function makeBreachRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    project_id: PROJECT_ID,
    tenant_id: TENANT_ID,
    title: "Test ticket",
    urgency: "high",
    freescout_conversation_id: "42",
    minutes_open: 65,
    response_target_minutes: 60,
    ...overrides,
  };
}

describe("findAndLogBreaches", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    _resetPool();
    vi.restoreAllMocks();
  });

  it("returns empty array when no tickets are breached", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // SELECT (no breaches)
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    const result = await findAndLogBreaches(pool);
    expect(result).toEqual([]);
  });

  it("returns breach rows and inserts audit_log for a standard-tier ticket", async () => {
    const breachRow = makeBreachRow({ urgency: "high", response_target_minutes: 120 });
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [breachRow] }, // SELECT — 1 breach
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    const result = await findAndLogBreaches(pool);
    expect(result).toHaveLength(1);
    expect(result[0].response_target_minutes).toBe(120);
    // Verify the audit_log INSERT was called with correct payload
    const insertCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && args[0].includes("INSERT INTO audit_log")
    );
    expect(insertCall).toBeDefined();
    const payload = JSON.parse(insertCall?.[1]?.[3] as string);
    expect(payload.response_target_minutes).toBe(120);
    expect(payload.urgency).toBe("high");
  });

  it("returns breach rows for a premium-tier ticket with critical urgency (30 min target)", async () => {
    // The SQL CASE computes response_target_minutes=30 for premium+critical.
    // The unit test verifies the TypeScript correctly handles the row returned by that SQL.
    const breachRow = makeBreachRow({
      urgency: "critical",
      minutes_open: 31,
      response_target_minutes: 30,
    });
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [breachRow] }, // SELECT — premium breach (critical)
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    const result = await findAndLogBreaches(pool);
    expect(result).toHaveLength(1);
    expect(result[0].urgency).toBe("critical");
    expect(result[0].response_target_minutes).toBe(30);
    expect(result[0].minutes_open).toBe(31);
  });

  it("handles multiple breaches — inserts one audit_log row per ticket", async () => {
    const rows = [
      makeBreachRow({ id: "t1", urgency: "critical", response_target_minutes: 30 }),
      makeBreachRow({ id: "t2", urgency: "high", response_target_minutes: 60 }),
    ];
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows }, // SELECT — 2 breaches
      { rows: [] }, // INSERT audit_log t1
      { rows: [] }, // INSERT audit_log t2
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    const result = await findAndLogBreaches(pool);
    expect(result).toHaveLength(2);
    const insertCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => typeof args[0] === "string" && args[0].includes("INSERT INTO audit_log")
    );
    expect(insertCalls).toHaveLength(2);
  });

  it("rolls back and re-throws on DB error", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
    ]);
    (client.query as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("DB down");
    });
    const pool = makePool(client);
    await expect(findAndLogBreaches(pool)).rejects.toThrow("DB down");
  });
});
