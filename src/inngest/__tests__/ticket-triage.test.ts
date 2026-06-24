import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { classifySeverity, triageOneTicket } from "../ticket-triage";

/**
 * T-22 — ticket-triage unit tests.
 *
 * Tests: severity classification (happy path, parse-fallback, HTTP error),
 * triageOneTicket idempotency guard, full happy-path DB sequence,
 * and LiteLLM error propagation with no UPDATE.
 *
 * pg Pool is mocked; fetch is stubbed globally; no real DB or LLM calls.
 */

// ---------------------------------------------------------------------------
// Helpers — reused from freescout-poller test pattern
// ---------------------------------------------------------------------------

type QueryResponse = { rows: Record<string, unknown>[] };

function makeClient(queryResponses: QueryResponse[]): PoolClient {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const resp = queryResponses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(resp);
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function makePool(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

function mockFetchOk(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content } }],
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// classifySeverity
// ---------------------------------------------------------------------------

describe("classifySeverity", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_URL", "https://litellm.test");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("parses a clean JSON response and returns the severity", async () => {
    mockFetchOk('{"severity":"P2","reasoning":"Login service degraded"}');
    const result = await classifySeverity("Login broken", "Cannot login at all");
    expect(result.severity).toBe("P2");
    expect(result.reasoning).toBe("Login service degraded");
  });

  it("parses markdown-fenced JSON (model ignores format instructions)", async () => {
    mockFetchOk('```json\n{"severity":"P1","reasoning":"Full outage"}\n```');
    const result = await classifySeverity("Site down", null);
    expect(result.severity).toBe("P1");
  });

  it("falls back to P3 when the model returns non-JSON", async () => {
    mockFetchOk("I cannot classify this ticket.");
    const result = await classifySeverity("Weird ticket", null);
    expect(result.severity).toBe("P3");
    expect(result.reasoning).toContain("parse-failure");
  });

  it("falls back to P3 when severity field is an unknown value", async () => {
    mockFetchOk('{"severity":"P4","reasoning":"Unknown severity"}');
    const result = await classifySeverity("Odd ticket", null);
    expect(result.severity).toBe("P3");
  });

  it("throws on a non-OK HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      })
    );
    await expect(classifySeverity("Test", null)).rejects.toThrow("LiteLLM 500");
  });

  it("throws when LITELLM_URL is not set", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
    await expect(classifySeverity("Test", null)).rejects.toThrow("not configured");
  });
});

// ---------------------------------------------------------------------------
// triageOneTicket
// ---------------------------------------------------------------------------

describe("triageOneTicket", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("OPS_HUB_APP_LOGIN_URL", "postgresql://mock");
    vi.stubEnv("LITELLM_URL", "https://litellm.test");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("full happy path: new ticket → classified → state=triaged", async () => {
    // Sequence: BEGIN, tenant GUC, project GUC, SELECT, COMMIT (fetch txn)
    //           BEGIN, tenant GUC, project GUC, UPDATE, COMMIT (update txn)
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [{ id: "t1", title: "Login broken", body: "Cannot login", state: "new" }] },
      { rows: [] }, // COMMIT
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // UPDATE
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    mockFetchOk('{"severity":"P2","reasoning":"Login service degraded for multiple users"}');

    const result = await triageOneTicket(pool, "t1", "proj-1", "tenant-1");

    expect(result).toEqual({
      severity: "P2",
      reasoning: "Login service degraded for multiple users",
    });

    // Verify UPDATE was called with the correct severity and ticket ID.
    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      string[]?,
    ][];
    const updateCall = queryCalls.find(([q]) => q.includes("UPDATE tickets"));
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toEqual(["P2", "t1"]);
  });

  it("skips a ticket that is already triaged (idempotency guard)", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [{ id: "t2", title: "Old", body: null, state: "triaged" }] },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await triageOneTicket(pool, "t2", "proj-1", "tenant-1");

    expect(result).toEqual({ skipped: true, reason: "triaged" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a ticket that does not exist", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // SELECT → empty
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await triageOneTicket(pool, "ghost", "proj-1", "tenant-1");

    expect(result).toEqual({ skipped: true, reason: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to P3 on malformed LLM response but still updates state", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: "t3", title: "Glitch", body: null, state: "new" }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    mockFetchOk("not valid json");

    const result = await triageOneTicket(pool, "t3", "proj-1", "tenant-1");

    expect((result as { severity: string }).severity).toBe("P3");
    expect((result as { reasoning: string }).reasoning).toContain("parse-failure");

    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      string[]?,
    ][];
    const updateCall = queryCalls.find(([q]) => q.includes("UPDATE tickets"));
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]![0]).toBe("P3");
  });

  it("propagates LiteLLM HTTP errors and does not UPDATE the ticket", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: "t4", title: "Test", body: null, state: "new" }] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limited",
      })
    );

    await expect(triageOneTicket(pool, "t4", "proj-1", "tenant-1")).rejects.toThrow("LiteLLM 429");

    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(queryCalls.some(([q]) => q.includes("UPDATE tickets"))).toBe(false);
  });
});
