import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOpenTicketCounts,
  getSlaAttainment,
  getDeflectionRate,
  getPipelineStageCounts,
  getTicketQueue,
  getPlatformIncidents,
  getScopeLabel,
  getModelRoutingOverrides,
  getCurrentSlaConfig,
  getFeatureFlags,
} from "../dashboard";
import { makeClient, makePool } from "../../inngest/__tests__/helpers";

const PROJECT_ID = "00000000-0000-0000-0000-000000000003";
const TENANT_ID = "00000000-0000-0000-0000-000000000030";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getScopeLabel", () => {
  it("reads the real project/tenant name — never a hardcoded string", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ project_name: "tts-prod", tenant_name: "Daily Needs Canada" }] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    const label = await getScopeLabel(pool, PROJECT_ID, TENANT_ID);
    expect(label).toEqual({ projectName: "tts-prod", tenantName: "Daily Needs Canada" });
  });

  it("falls back to an explicit unknown label rather than throwing when no row matches", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    const label = await getScopeLabel(pool, PROJECT_ID, TENANT_ID);
    expect(label).toEqual({ projectName: "(unknown project)", tenantName: "(unknown tenant)" });
  });
});

describe("getOpenTicketCounts", () => {
  it("sets tenant/project GUCs and buckets counts by urgency, including untriaged", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      {
        rows: [
          { urgency: "critical", count: "1" },
          { urgency: "high", count: "2" },
          { urgency: null, count: "1" },
        ],
      },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const counts = await getOpenTicketCounts(pool, PROJECT_ID, TENANT_ID);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual(["SELECT set_config('app.current_tenant', $1, true)", [TENANT_ID]]);
    expect(calls[2]).toEqual(["SELECT set_config('app.current_project', $1, true)", [PROJECT_ID]]);

    expect(counts).toEqual({
      total: 4,
      critical: 1,
      high: 2,
      normal: 0,
      low: 0,
      untriaged: 1,
    });
  });

  it("rolls back and re-throws on DB error", async () => {
    const client = makeClient([{ rows: [] }]);
    (client.query as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve({ rows: [] })) // BEGIN
      .mockImplementationOnce(() => {
        throw new Error("DB down");
      });
    const pool = makePool(client);
    await expect(getOpenTicketCounts(pool, PROJECT_ID, TENANT_ID)).rejects.toThrow("DB down");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("getSlaAttainment", () => {
  it("computes attainmentPct from met/considered and reports live at-risk/breached counts", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // tenant GUC
      { rows: [] }, // project GUC
      { rows: [{ met: "3", considered: "4" }] }, // attainment query
      { rows: [{ at_risk: "1", breached: "0" }] }, // risk query
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const result = await getSlaAttainment(pool, PROJECT_ID, TENANT_ID, 30);

    expect(result).toEqual({
      windowDays: 30,
      consideredCount: 4,
      metCount: 3,
      attainmentPct: 75,
      openAtRiskCount: 1,
      openBreachedCount: 0,
    });
  });

  it("returns null attainmentPct (not 0 or 100) when nothing has been considered yet", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ met: "0", considered: "0" }] },
      { rows: [{ at_risk: "0", breached: "0" }] },
      { rows: [] },
    ]);
    const pool = makePool(client);

    const result = await getSlaAttainment(pool, PROJECT_ID, TENANT_ID);
    expect(result.attainmentPct).toBeNull();
    expect(result.consideredCount).toBe(0);
  });
});

describe("getDeflectionRate", () => {
  it("computes ratePct from auto-handled / total", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total: "10", auto_handled: "8" }] },
      { rows: [] },
    ]);
    const pool = makePool(client);

    const result = await getDeflectionRate(pool, PROJECT_ID, TENANT_ID, 30);
    expect(result).toEqual({
      windowDays: 30,
      totalCount: 10,
      autoHandledCount: 8,
      ratePct: 80,
    });
  });

  it("returns null ratePct when no tickets exist in the window", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total: "0", auto_handled: "0" }] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    const result = await getDeflectionRate(pool, PROJECT_ID, TENANT_ID);
    expect(result.ratePct).toBeNull();
  });
});

describe("getPipelineStageCounts", () => {
  it("buckets raw ticket states into the 5 pipeline stages", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          { state: "new", count: "2" },
          { state: "triaged", count: "1" },
          { state: "responded", count: "3" },
          { state: "investigating", count: "1" },
          { state: "blocked", count: "1" },
          { state: "resolved", count: "5" },
          { state: "closed", count: "2" },
        ],
      },
      { rows: [] },
    ]);
    const pool = makePool(client);

    const counts = await getPipelineStageCounts(pool, PROJECT_ID, TENANT_ID);
    expect(counts).toEqual({
      new: 2,
      triaged: 1,
      responded: 3,
      in_progress: 2, // investigating + blocked
      resolved: 7, // resolved + closed
    });
  });
});

describe("getTicketQueue", () => {
  it("maps rows and computes minutesRemaining from target vs. minutes open", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            title: "Checkout fails on payment step",
            category: "billing",
            urgency: "critical",
            state: "investigating",
            tenant_name: "Daily Needs Canada",
            created_at: "2026-07-04T09:00:00.000Z",
            updated_at: "2026-07-04T09:10:00.000Z",
            target_minutes: "30",
            minutes_open: "34",
          },
        ],
      },
      { rows: [] },
    ]);
    const pool = makePool(client);

    const rows = await getTicketQueue(pool, PROJECT_ID, TENANT_ID, 50);
    expect(rows).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Checkout fails on payment step",
        category: "billing",
        urgency: "critical",
        state: "investigating",
        tenantName: "Daily Needs Canada",
        createdAt: "2026-07-04T09:00:00.000Z",
        updatedAt: "2026-07-04T09:10:00.000Z",
        targetMinutes: 30,
        minutesOpen: 34,
        minutesRemaining: -4,
      },
    ]);
  });
});

describe("getPlatformIncidents", () => {
  it("sets only the project GUC (not tenant) and maps rows", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // project GUC
      {
        rows: [
          {
            id: "22222222-2222-2222-2222-222222222222",
            timestamp: "2026-07-04T05:00:00.000Z",
            action: "platform_incident",
            payload: { title: "Deploy dispatch collision" },
          },
        ],
      },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const rows = await getPlatformIncidents(pool, PROJECT_ID, 20);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual(["SELECT set_config('app.current_project', $1, true)", [PROJECT_ID]]);
    // BEGIN, project GUC, SELECT, COMMIT — no tenant GUC call. Tenant scoping
    // for this feed comes from the RLS policy (audit_log_select_platform,
    // migration 20260706000000 / T-66: tenant_id IS NULL AND project_id =
    // current_project_id()), not from a GUC set in this function.
    expect(calls.length).toBe(4);

    expect(rows).toEqual([
      {
        id: "22222222-2222-2222-2222-222222222222",
        timestamp: "2026-07-04T05:00:00.000Z",
        action: "platform_incident",
        payload: { title: "Deploy dispatch collision" },
      },
    ]);
  });

  it("maps an empty result set to [] (shape), never fabricates rows", async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const pool = makePool(client);
    const rows = await getPlatformIncidents(pool, PROJECT_ID);
    expect(rows).toEqual([]);
  });
});

// =============================================================================
// T-75 — settings reads
// =============================================================================

// A client whose query rejects once it sees `matchSql` in the statement text,
// with every other statement succeeding — mirrors
// settingsWrite.test.ts's makeRejectingClient, used here to simulate T-72's
// migration not yet being applied (agent_model_routing undefined_table).
function makeRejectingClient(matchSql: string, code: string) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes(matchSql)) {
      return Promise.reject(Object.assign(new Error(`pg error ${code}`), { code }));
    }
    return Promise.resolve({ rows: [] });
  });
  return { query, release: vi.fn() };
}

describe("getModelRoutingOverrides", () => {
  it("returns each function's override row, keyed by function_key", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // project GUC
      {
        rows: [
          {
            function_key: "triage",
            primary_model: "triage-model",
            fallback_model: "fallback-model",
          },
          { function_key: "respond", primary_model: "triage-model", fallback_model: null },
        ],
      },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const overrides = await getModelRoutingOverrides(pool, PROJECT_ID);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual(["SELECT set_config('app.current_project', $1, true)", [PROJECT_ID]]);

    expect(overrides).toEqual({
      triage: { primaryModel: "triage-model", fallbackModel: "fallback-model" },
      respond: { primaryModel: "triage-model", fallbackModel: null },
      kb_learn: null,
    });
  });

  it("returns all-null (never throws) when agent_model_routing doesn't exist yet (T-72 pending)", async () => {
    const { client } = { client: makeRejectingClient("FROM agent_model_routing", "42P01") };
    const pool = makePool(client as unknown as Parameters<typeof makePool>[0]);

    const overrides = await getModelRoutingOverrides(pool, PROJECT_ID);

    expect(overrides).toEqual({ triage: null, respond: null, kb_learn: null });
    // Degraded gracefully — still COMMITs the (now-empty) transaction rather
    // than leaving it hanging or rolling back a page load into an error.
    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls[calls.length - 1]).toBe("COMMIT");
  });

  it("propagates a real (non-42P01) error rather than swallowing it", async () => {
    const client = makeRejectingClient("FROM agent_model_routing", "42501"); // insufficient_privilege
    const pool = makePool(client as unknown as Parameters<typeof makePool>[0]);

    await expect(getModelRoutingOverrides(pool, PROJECT_ID)).rejects.toThrow();
  });
});

describe("getCurrentSlaConfig", () => {
  it("reads sla_tier and the parsed response_target_minutes for a standard tenant", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // tenant GUC
      { rows: [] }, // project GUC
      { rows: [{ sla_tier: "standard", response_target_minutes: "120" }] },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const result = await getCurrentSlaConfig(pool, PROJECT_ID, TENANT_ID);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual(["SELECT set_config('app.current_tenant', $1, true)", [TENANT_ID]]);
    expect(calls[2]).toEqual(["SELECT set_config('app.current_project', $1, true)", [PROJECT_ID]]);

    expect(result).toEqual({ slaTier: "standard", responseTargetMinutes: 120 });
  });

  it("returns null minutes (not a fabricated 240) when the key was never set", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ sla_tier: "standard", response_target_minutes: null }] },
      { rows: [] },
    ]);
    const pool = makePool(client);

    const result = await getCurrentSlaConfig(pool, PROJECT_ID, TENANT_ID);

    expect(result).toEqual({ slaTier: "standard", responseTargetMinutes: null });
  });

  it("surfaces premium tier so the UI can flag the editor as having no effect", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ sla_tier: "premium", response_target_minutes: null }] },
      { rows: [] },
    ]);
    const pool = makePool(client);

    const result = await getCurrentSlaConfig(pool, PROJECT_ID, TENANT_ID);

    expect(result.slaTier).toBe("premium");
  });
});

describe("getFeatureFlags", () => {
  it("lists every flag row in project scope, across environments, mapped to camelCase", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // project GUC
      {
        rows: [
          {
            id: "33333333-3333-3333-3333-333333333333",
            flag_key: "enable_byok_tenant",
            environment: "staging",
            enabled: true,
            rollout_percentage: 50,
            description: "Gradual BYOK rollout",
          },
        ],
      },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const flags = await getFeatureFlags(pool, PROJECT_ID);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]).toEqual(["SELECT set_config('app.current_project', $1, true)", [PROJECT_ID]]);

    expect(flags).toEqual([
      {
        id: "33333333-3333-3333-3333-333333333333",
        flagKey: "enable_byok_tenant",
        environment: "staging",
        enabled: true,
        rolloutPercentage: 50,
        description: "Gradual BYOK rollout",
      },
    ]);
  });

  it("maps zero rows to [] — the honest, expected state until a flag is ever created", async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const pool = makePool(client);
    const flags = await getFeatureFlags(pool, PROJECT_ID);
    expect(flags).toEqual([]);
  });
});
