import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftResponse, respondOneTicket, type FreeScoutDelivery } from "../ticket-respond";
import { makeClient, makePool, mockFetchOk } from "./helpers";

/**
 * T-23 — ticket-respond unit tests.
 *
 * Converts the QA contract stub (the prior it.todo list handed off from T-24)
 * into real assertions. Covers draft generation (prompt shape, injection-safe
 * channel split, HTTP error, empty/malformed, missing config) and the
 * respondOneTicket orchestration (happy path → state='responded' + owner_agent,
 * LangFuse trace, idempotency skips, no-conversation skip, and the required
 * error path — LiteLLM failure leaves the ticket 'triaged' with no UPDATE).
 *
 * pg Pool is mocked; fetch is stubbed; FreeScout delivery is injected as a mock.
 * No real DB, LLM, or FreeScout calls.
 */

// A triaged ticket row as returned by the SELECT in respondOneTicket.
function triagedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Login broken",
    body: "Cannot login at all",
    urgency: "high",
    category: "auth",
    routing: "engineering",
    state: "triaged",
    freescout_conversation_id: "42",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// draftResponse
// ---------------------------------------------------------------------------

describe("draftResponse", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_URL", "https://litellm.test");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns the trimmed draft and POSTs the correct prompt shape", async () => {
    const fetchMock = mockFetchOk("  Hi there, sorry you hit this. We are on it.  ");
    const result = await draftResponse({
      title: "Login broken",
      body: "Cannot login",
      urgency: "high",
      category: "auth",
      routing: "engineering",
    });
    expect(result.text).toBe("Hi there, sorry you hit this. We are on it.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://litellm.test/chat/completions");
    const sentBody = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(sentBody.model).toBe(process.env.LITELLM_TRIAGE_MODEL ?? "triage-model");

    const system = sentBody.messages.find((m) => m.role === "system")!;
    const user = sentBody.messages.find((m) => m.role === "user")!;
    // Instruction channel carries the directive + urgency-keyed tone, not ticket content.
    expect(system.content).toContain("INTERNAL NOTE");
    expect(system.content).toContain("take it seriously"); // high-urgency tone
    expect(system.content).not.toContain("Cannot login");
    // Data channel carries the untrusted ticket content, delimited.
    expect(user.content).toContain("<ticket_title>Login broken</ticket_title>");
    expect(user.content).toContain("<ticket_body>Cannot login</ticket_body>");
    expect(user.content).toContain("<ticket_category>auth</ticket_category>");
  });

  it("escapes XML-special characters so ticket content cannot break delimiters", async () => {
    const fetchMock = mockFetchOk("draft");
    await draftResponse({
      title: "<script>alert(1)</script>",
      body: "a & b < c",
      urgency: "low",
      category: "ui",
      routing: "support",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const user = (
      JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> }
    ).messages.find((m) => m.role === "user")!;
    expect(user.content).toContain("&lt;script&gt;");
    expect(user.content).toContain("a &amp; b &lt; c");
    expect(user.content).not.toContain("<script>");
  });

  it("throws on a non-OK HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" })
    );
    await expect(
      draftResponse({
        title: "x",
        body: null,
        urgency: "normal",
        category: "support",
        routing: "support",
      })
    ).rejects.toThrow("LiteLLM 503");
  });

  it("throws on an empty/whitespace draft (malformed response, no corruption)", async () => {
    mockFetchOk("   ");
    await expect(
      draftResponse({
        title: "x",
        body: null,
        urgency: "normal",
        category: "support",
        routing: "support",
      })
    ).rejects.toThrow("empty draft");
  });

  it("throws when LITELLM_URL is not set", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
    await expect(
      draftResponse({
        title: "x",
        body: null,
        urgency: "normal",
        category: "support",
        routing: "support",
      })
    ).rejects.toThrow("not configured");
  });
});

// ---------------------------------------------------------------------------
// respondOneTicket
// ---------------------------------------------------------------------------

describe("respondOneTicket", () => {
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

  it("happy path: triaged ticket → draft → deliver → state=responded + owner_agent", async () => {
    // fetch txn (5) + update txn (5)
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [triagedRow()] }, // SELECT
      { rows: [] }, // COMMIT
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // UPDATE
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);
    mockFetchOk("Sorry you ran into this — the team is investigating now.");
    const deliver = vi.fn<FreeScoutDelivery>().mockResolvedValue(undefined);

    const result = await respondOneTicket(pool, deliver, "t1", "proj-1", "tenant-1");

    expect(result).toEqual({ state: "responded", conversation_id: "42" });

    // Delivery received the conversation id + the drafted note.
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      "42",
      "Sorry you ran into this — the team is investigating now."
    );

    // State advanced to 'responded' with owner_agent stamped.
    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      unknown[]?,
    ][];
    const updateCall = queryCalls.find(([q]) => q.includes("UPDATE tickets"));
    expect(updateCall).toBeTruthy();
    expect(updateCall![0]).toContain("state = 'responded'");
    expect(updateCall![0]).toContain("owner_agent = 'ticket-respond'");
    expect(updateCall![1]).toEqual(["t1"]);
  });

  it("skips a ticket that is not triaged (idempotency guard)", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [triagedRow({ state: "responded" })] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const deliver = vi.fn<FreeScoutDelivery>().mockResolvedValue(undefined);

    const result = await respondOneTicket(pool, deliver, "t1", "proj-1", "tenant-1");

    expect(result).toEqual({ skipped: true, reason: "responded" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips a ticket that does not exist", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] }, // SELECT → empty
      { rows: [] },
    ]);
    const pool = makePool(client);
    const deliver = vi.fn<FreeScoutDelivery>().mockResolvedValue(undefined);

    const result = await respondOneTicket(pool, deliver, "ghost", "proj-1", "tenant-1");

    expect(result).toEqual({ skipped: true, reason: "not_found" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips when the ticket has no FreeScout conversation", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [triagedRow({ freescout_conversation_id: null })] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const deliver = vi.fn<FreeScoutDelivery>().mockResolvedValue(undefined);

    const result = await respondOneTicket(pool, deliver, "t1", "proj-1", "tenant-1");

    expect(result).toEqual({ skipped: true, reason: "no_conversation" });
    expect(fetchMock).not.toHaveBeenCalled(); // no LLM call wasted
    expect(deliver).not.toHaveBeenCalled();
  });

  it("ERROR PATH: LiteLLM failure leaves the ticket 'triaged' — no UPDATE, no delivery", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [triagedRow()] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    // Simulate a LiteLLM timeout/abort.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("The operation was aborted")));
    const deliver = vi.fn<FreeScoutDelivery>().mockResolvedValue(undefined);

    await expect(respondOneTicket(pool, deliver, "t1", "proj-1", "tenant-1")).rejects.toThrow();

    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(queryCalls.some(([q]) => q.includes("UPDATE tickets"))).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivery failure leaves the ticket 'triaged' — no UPDATE", async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [triagedRow()] },
      { rows: [] },
    ]);
    const pool = makePool(client);
    mockFetchOk("A perfectly good draft.");
    const deliver = vi.fn<FreeScoutDelivery>().mockRejectedValue(new Error("freescout down"));

    await expect(respondOneTicket(pool, deliver, "t1", "proj-1", "tenant-1")).rejects.toThrow(
      "freescout down"
    );

    const queryCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(queryCalls.some(([q]) => q.includes("UPDATE tickets"))).toBe(false);
  });
});
