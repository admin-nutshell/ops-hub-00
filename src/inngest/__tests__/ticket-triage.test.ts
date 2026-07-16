import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyTicket, triageOneTicket, triageTicketHandler } from "../ticket-triage";
import type { TriageResult } from "../ticket-triage";
import { makeClient, makePool, mockFetchOk } from "./helpers";

/**
 * T-22 — ticket-triage unit tests.
 *
 * Tests: ticket classification (happy path, parse-fallback, HTTP error),
 * triageOneTicket idempotency guard, full happy-path DB sequence,
 * and LiteLLM error propagation with no UPDATE.
 *
 * pg Pool is mocked; fetch is stubbed globally; no real DB or LLM calls.
 */

// ---------------------------------------------------------------------------
// classifyTicket
// ---------------------------------------------------------------------------

describe("classifyTicket", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_URL", "https://litellm.test");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("parses a clean JSON response and returns urgency/category/routing", async () => {
    mockFetchOk(
      '{"urgency":"high","category":"auth","routing":"engineering","reasoning":"Login service degraded"}'
    );
    const result = await classifyTicket("Login broken", "Cannot login at all");
    expect(result.urgency).toBe("high");
    expect(result.category).toBe("auth");
    expect(result.routing).toBe("engineering");
    expect(result.reasoning).toBe("Login service degraded");
  });

  it("parses markdown-fenced JSON (model ignores format instructions)", async () => {
    mockFetchOk(
      '```json\n{"urgency":"critical","category":"infrastructure","routing":"engineering","reasoning":"Full outage"}\n```'
    );
    const result = await classifyTicket("Site down", null);
    expect(result.urgency).toBe("critical");
  });

  it("falls back to urgency=normal, category=support, routing=support on non-JSON", async () => {
    mockFetchOk("I cannot classify this ticket.");
    const result = await classifyTicket("Weird ticket", null);
    expect(result.urgency).toBe("normal");
    expect(result.category).toBe("support");
    expect(result.routing).toBe("support");
    expect(result.reasoning).toContain("parse-failure");
  });

  it("falls back to urgency=normal when urgency field is an unknown value", async () => {
    mockFetchOk(
      '{"urgency":"critical-plus","category":"ui","routing":"support","reasoning":"Unknown"}'
    );
    const result = await classifyTicket("Odd ticket", null);
    expect(result.urgency).toBe("normal");
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
    await expect(classifyTicket("Test", null)).rejects.toThrow("LiteLLM 500");
  });

  it("throws when LITELLM_URL is not set", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
    await expect(classifyTicket("Test", null)).rejects.toThrow("not configured");
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
    mockFetchOk(
      '{"urgency":"high","category":"auth","routing":"engineering","reasoning":"Login service degraded for multiple users"}'
    );

    const result = await triageOneTicket(pool, "t1", "proj-1", "tenant-1");

    expect(result).toEqual({
      urgency: "high",
      category: "auth",
      routing: "engineering",
      reasoning: "Login service degraded for multiple users",
    });

    // Verify UPDATE was called with the correct urgency/category/routing/id.
    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      string[]?,
    ][];
    const updateCall = queryCalls.find(([q]) => q.includes("UPDATE tickets"));
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toEqual(["high", "auth", "engineering", "t1"]);

    // T-121 follow-up (gap G6): a durable audit record is written in the
    // same transaction as the state update.
    const auditCall = queryCalls.find(([q]) => q.includes("INSERT INTO audit_log"));
    expect(auditCall).toBeTruthy();
    expect(auditCall![1]?.[0]).toBe("proj-1");
    expect(auditCall![1]?.[1]).toBe("tenant-1");
    const payload = JSON.parse(auditCall![1]?.[3] as unknown as string) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({ urgency: "high", category: "auth", routing: "engineering" });
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

  it("falls back to urgency=normal on malformed LLM response but still updates state", async () => {
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

    expect((result as { urgency: string }).urgency).toBe("normal");
    expect((result as { category: string }).category).toBe("support");
    expect((result as { routing: string }).routing).toBe("support");
    expect((result as { reasoning: string }).reasoning).toContain("parse-failure");

    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      string[]?,
    ][];
    const updateCall = queryCalls.find(([q]) => q.includes("UPDATE tickets"));
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toEqual(["normal", "support", "support", "t3"]);
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

  it("falls back to fallback-model when primary model fails (T-46)", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [{ id: "t5", title: "Payment failed", body: "Card declined", state: "new" }] },
      { rows: [] }, // COMMIT
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // UPDATE
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "Service Unavailable" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            model: "claude-haiku-4-5-20251001",
            choices: [
              {
                message: {
                  content:
                    '{"urgency":"high","category":"billing","routing":"billing","reasoning":"Payment failure"}',
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 20 },
          }),
        })
    );

    const result = await triageOneTicket(pool, "t5", "proj-1", "tenant-1");

    expect(result).toMatchObject({ urgency: "high", category: "billing" });
  });

  it("throws primary error when both primary and fallback models fail (T-46)", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [{ id: "t6", title: "Test", body: null, state: "new" }] },
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "Primary down" })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "Fallback rate limited",
        })
    );

    await expect(triageOneTicket(pool, "t6", "proj-1", "tenant-1")).rejects.toThrow("LiteLLM 503");

    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(queryCalls.some(([q]) => q.includes("UPDATE tickets"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// triageTicketHandler — the Inngest function body (activation wire T-22 → T-23)
//
// These tests exercise the real handler with a mock step. step.run is stubbed to
// return a controlled TriageResult (or reject) so we isolate the emit decision
// from the DB/LLM logic already covered above.
// ---------------------------------------------------------------------------

type StepRunFn = (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
type StepSendEventFn = (id: string, events: unknown) => Promise<void>;

// Build the minimal { event, step } context triageTicketHandler reads. step.run
// is stubbed to yield a controlled result WITHOUT executing the real triage
// callback — the DB/LLM path (triageOneTicket) is covered by its own tests
// above, so here we isolate the handler's emit decision. The cast keeps the test
// honest about the fields the handler actually uses without reconstructing
// Inngest's full context type.
function makeCtx(
  data: { ticket_id: string; project_id: string; tenant_id: string },
  runImpl: StepRunFn
) {
  const step = {
    run: vi.fn(runImpl),
    sendEvent: vi.fn<StepSendEventFn>().mockResolvedValue(undefined),
  };
  const ctx = { event: { data }, step } as unknown as Parameters<typeof triageTicketHandler>[0];
  return { ctx, step };
}

describe("triageTicketHandler activation wire", () => {
  const DATA = { ticket_id: "t1", project_id: "proj-1", tenant_id: "tenant-1" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits ops-hub/ticket.respond with the full payload when triage succeeds", async () => {
    const triaged: TriageResult = {
      urgency: "high",
      category: "auth",
      routing: "engineering",
      reasoning: "Login degraded",
    };
    const { ctx, step } = makeCtx(DATA, async () => triaged);

    const result = await triageTicketHandler(ctx);

    expect(result).toEqual(triaged);
    expect(step.sendEvent).toHaveBeenCalledOnce();
    const [stepId, event] = step.sendEvent.mock.calls[0] as [
      string,
      { name: string; data: Record<string, string> },
    ];
    expect(stepId).toBe("dispatch-respond");
    expect(event.name).toBe("ops-hub/ticket.respond");
    expect(event.data).toEqual({
      ticket_id: "t1",
      project_id: "proj-1",
      tenant_id: "tenant-1",
    });
  });

  it("does NOT emit when triage is skipped (already past 'new' — prevents duplicate respond)", async () => {
    const skipped: TriageResult = { skipped: true, reason: "triaged" };
    const { ctx, step } = makeCtx(DATA, async () => skipped);

    const result = await triageTicketHandler(ctx);

    expect(result).toEqual(skipped);
    expect(step.sendEvent).not.toHaveBeenCalled();
  });

  it("does NOT emit when triage fails (error path — handler rejects, no event)", async () => {
    const { ctx, step } = makeCtx(DATA, async () => {
      throw new Error("LiteLLM 429");
    });

    await expect(triageTicketHandler(ctx)).rejects.toThrow("LiteLLM 429");
    expect(step.sendEvent).not.toHaveBeenCalled();
  });
});
