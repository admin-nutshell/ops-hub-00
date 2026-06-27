import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOneTicket, _resetPool } from "../ticket-resolve";

import { makeClient, makePool } from "./helpers";

/**
 * ticket-resolve unit tests.
 *
 * Tests: resolveOneTicket idempotency guard, happy-path state advance,
 * and DB error propagation.
 *
 * pg Pool is mocked; no real DB calls.
 */

describe("resolveOneTicket", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    _resetPool();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns { state: 'resolved' } when ticket is in 'responded' state (rowCount=1)", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [], rowCount: 1 }, // UPDATE (1 row affected)
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    _resetPool(pool);

    const result = await resolveOneTicket(pool, "ticket-1", "proj-1", "tenant-1");
    expect(result).toEqual({ state: "resolved" });
  });

  it("returns { skipped } when ticket is already resolved (rowCount=0)", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [], rowCount: 0 }, // UPDATE (0 rows — wrong state)
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    _resetPool(pool);

    const result = await resolveOneTicket(pool, "ticket-1", "proj-1", "tenant-1");
    expect(result).toEqual({ skipped: true, reason: "not_responded" });
  });

  it("rolls back and re-throws on DB error", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
    ]);
    // Make the UPDATE throw
    (client.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // set_config tenant
      .mockResolvedValueOnce({ rows: [] }) // set_config project
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const pool = makePool(client);
    _resetPool(pool);

    await expect(resolveOneTicket(pool, "ticket-1", "proj-1", "tenant-1")).rejects.toThrow(
      "DB connection lost"
    );
  });

  it("passes tenant and project IDs as GUC parameters", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ]);
    const pool = makePool(client);
    _resetPool(pool);

    await resolveOneTicket(pool, "ticket-abc", "proj-xyz", "tenant-def");

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    const tenantCall = calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("current_tenant")
    );
    const projectCall = calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("current_project")
    );
    expect(tenantCall?.[1]).toEqual(["tenant-def"]);
    expect(projectCall?.[1]).toEqual(["proj-xyz"]);
  });
});
