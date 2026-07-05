import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseTraceMetadata,
  tracesToRows,
  upsertCostRows,
  fetchLangfuseTraces,
  syncTraceName,
  _resetPool,
} from "../agent-cost-sync";
import { makeClient, makePool } from "./helpers";

const PROJECT_ID = "00000000-0000-0000-0000-000000000002";
const TENANT_ID = "00000000-0000-0000-0000-000000000020";
const TICKET_ID = "00000000-0000-0000-0000-0000000000aa";

describe("parseTraceMetadata", () => {
  it("parses valid metadata", () => {
    const result = parseTraceMetadata({
      ticket_id: TICKET_ID,
      project_id: PROJECT_ID,
      tenant_id: TENANT_ID,
    });
    expect(result).toEqual({ projectId: PROJECT_ID, tenantId: TENANT_ID, ticketId: TICKET_ID });
  });

  it("allows a missing ticket_id (nullable)", () => {
    const result = parseTraceMetadata({ project_id: PROJECT_ID, tenant_id: TENANT_ID });
    expect(result).toEqual({ projectId: PROJECT_ID, tenantId: TENANT_ID, ticketId: null });
  });

  it("returns null when metadata is missing entirely (e.g. emitTrace('health-check'))", () => {
    expect(parseTraceMetadata(undefined)).toBeNull();
    expect(parseTraceMetadata(null)).toBeNull();
  });

  it("returns null when project_id is missing", () => {
    expect(parseTraceMetadata({ tenant_id: TENANT_ID })).toBeNull();
  });

  it("returns null when tenant_id is missing", () => {
    expect(parseTraceMetadata({ project_id: PROJECT_ID })).toBeNull();
  });

  it("returns null when project_id/tenant_id are not well-formed UUIDs", () => {
    expect(parseTraceMetadata({ project_id: "not-a-uuid", tenant_id: TENANT_ID })).toBeNull();
    expect(parseTraceMetadata({ project_id: PROJECT_ID, tenant_id: "not-a-uuid" })).toBeNull();
  });

  it("returns null when ticket_id is present but malformed", () => {
    expect(
      parseTraceMetadata({ project_id: PROJECT_ID, tenant_id: TENANT_ID, ticket_id: "bogus" })
    ).toBeNull();
  });
});

describe("tracesToRows", () => {
  it("maps valid traces and skips traces with unparseable metadata", () => {
    const rows = tracesToRows("ticket-triage", [
      {
        id: "trace-1",
        timestamp: "2026-07-04T12:00:00.000Z",
        name: "ticket-triage",
        metadata: { ticket_id: TICKET_ID, project_id: PROJECT_ID, tenant_id: TENANT_ID },
        totalCost: 0.000123,
      },
      {
        id: "trace-2-no-metadata",
        timestamp: "2026-07-04T12:05:00.000Z",
        name: "ticket-triage",
        metadata: null,
        totalCost: 0.5,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      langfuseTraceId: "trace-1",
      traceName: "ticket-triage",
      projectId: PROJECT_ID,
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      totalCostUsd: 0.000123,
      traceTimestamp: "2026-07-04T12:00:00.000Z",
    });
  });

  it("defaults totalCost to 0 (not skipped) when LangFuse returns null cost", () => {
    const rows = tracesToRows("ticket-respond", [
      {
        id: "trace-3",
        timestamp: "2026-07-04T12:00:00.000Z",
        name: "ticket-respond",
        metadata: { ticket_id: TICKET_ID, project_id: PROJECT_ID, tenant_id: TENANT_ID },
        totalCost: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalCostUsd).toBe(0);
  });
});

describe("upsertCostRows", () => {
  afterEach(() => {
    _resetPool();
    vi.restoreAllMocks();
  });

  it("returns 0 and does not open a connection for an empty batch", async () => {
    const client = makeClient([]);
    const pool = makePool(client);
    const written = await upsertCostRows(pool, []);
    expect(written).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("sets tenant/project GUCs and upserts one row per trace, ON CONFLICT DO UPDATE", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // INSERT ... ON CONFLICT
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    const written = await upsertCostRows(pool, [
      {
        langfuseTraceId: "trace-1",
        traceName: "ticket-triage",
        projectId: PROJECT_ID,
        tenantId: TENANT_ID,
        ticketId: TICKET_ID,
        totalCostUsd: 0.001,
        traceTimestamp: "2026-07-04T12:00:00.000Z",
      },
    ]);
    expect(written).toBe(1);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual(["SELECT set_config('app.current_tenant', $1, true)", [TENANT_ID]]);
    expect(calls[2]).toEqual(["SELECT set_config('app.current_project', $1, true)", [PROJECT_ID]]);
    const insertCall = calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" && args[0].includes("ON CONFLICT (langfuse_trace_id)")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[0]).toContain("DO UPDATE");
  });

  it("groups rows by (project_id, tenant_id) into separate transactions", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN (tenant A)
      { rows: [] }, // set_config tenant A
      { rows: [] }, // set_config project A
      { rows: [] }, // INSERT (tenant A)
      { rows: [] }, // COMMIT (tenant A)
      { rows: [] }, // BEGIN (tenant B)
      { rows: [] }, // set_config tenant B
      { rows: [] }, // set_config project B
      { rows: [] }, // INSERT (tenant B)
      { rows: [] }, // COMMIT (tenant B)
    ]);
    const pool = makePool(client);
    const OTHER_TENANT = "00000000-0000-0000-0000-000000000010";
    const written = await upsertCostRows(pool, [
      {
        langfuseTraceId: "trace-a",
        traceName: "ticket-triage",
        projectId: PROJECT_ID,
        tenantId: TENANT_ID,
        ticketId: null,
        totalCostUsd: 0.001,
        traceTimestamp: "2026-07-04T12:00:00.000Z",
      },
      {
        langfuseTraceId: "trace-b",
        traceName: "kb-learn",
        projectId: PROJECT_ID,
        tenantId: OTHER_TENANT,
        ticketId: null,
        totalCostUsd: 0.002,
        traceTimestamp: "2026-07-04T12:01:00.000Z",
      },
    ]);
    expect(written).toBe(2);
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  it("rolls back and re-throws on DB error", async () => {
    const client = makeClient([{ rows: [] }]);
    (client.query as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve({ rows: [] })) // BEGIN
      .mockImplementationOnce(() => {
        throw new Error("DB down");
      });
    const pool = makePool(client);
    await expect(
      upsertCostRows(pool, [
        {
          langfuseTraceId: "trace-x",
          traceName: "ticket-triage",
          projectId: PROJECT_ID,
          tenantId: TENANT_ID,
          ticketId: null,
          totalCostUsd: 0,
          traceTimestamp: "2026-07-04T12:00:00.000Z",
        },
      ])
    ).rejects.toThrow("DB down");
  });
});

describe("fetchLangfuseTraces", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("throws when LangFuse keys are not configured", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
    await expect(fetchLangfuseTraces("ticket-triage", "2026-07-01T00:00:00.000Z")).rejects.toThrow(
      "LANGFUSE_PUBLIC_KEY"
    );
  });

  it("sends HTTP Basic auth (publicKey:secretKey) and the expected query params", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], meta: { page: 1, limit: 100, totalItems: 0, totalPages: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchLangfuseTraces("ticket-triage", "2026-07-01T00:00:00.000Z", 1, 100);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/public/traces");
    expect(parsed.searchParams.get("name")).toBe("ticket-triage");
    expect(parsed.searchParams.get("fromTimestamp")).toBe("2026-07-01T00:00:00.000Z");
    expect(parsed.searchParams.get("fields")).toBe("core,io,metrics");
    const expectedAuth = `Basic ${Buffer.from("pk-test:sk-test").toString("base64")}`;
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe(expectedAuth);
  });

  it("throws with the response body on a non-OK response", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" })
    );
    await expect(fetchLangfuseTraces("ticket-triage", "2026-07-01T00:00:00.000Z")).rejects.toThrow(
      "LangFuse 401"
    );
  });
});

describe("syncTraceName", () => {
  afterEach(() => {
    _resetPool();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("paginates through multiple pages and upserts each", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");

    const trace = (id: string) => ({
      id,
      timestamp: "2026-07-04T12:00:00.000Z",
      name: "ticket-triage",
      metadata: { ticket_id: TICKET_ID, project_id: PROJECT_ID, tenant_id: TENANT_ID },
      totalCost: 0.001,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [trace("trace-1")],
          meta: { page: 1, limit: 1, totalItems: 2, totalPages: 2 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [trace("trace-2")],
          meta: { page: 2, limit: 1, totalItems: 2, totalPages: 2 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    // 2 traces => 2 upsert transactions (same tenant, but upsertCostRows is
    // called once per fetched page in syncTraceName).
    const client = makeClient([
      { rows: [] }, // page 1: BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // INSERT trace-1
      { rows: [] }, // COMMIT
      { rows: [] }, // page 2: BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // INSERT trace-2
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const written = await syncTraceName(pool, "ticket-triage", "2026-07-01T00:00:00.000Z");
    expect(written).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
