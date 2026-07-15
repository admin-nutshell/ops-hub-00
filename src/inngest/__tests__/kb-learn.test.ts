import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPiiKind, generateKbArticle, learnFromResolvedTicket } from "../kb-learn";
import { makeClient, makePool, mockFetchOk } from "./helpers";

/**
 * T-73 — kb-learn unit tests.
 *
 * kb-learn had no dedicated unit suite before T-73 wired resolveModelRouting
 * into it. These establish baseline coverage AND prove the resolved model is
 * the one actually sent to LiteLLM (replacing the former hardcoded
 * `LITELLM_TRIAGE_MODEL ?? "triage-model"`). The resolver test suite
 * (modelRouting.test.ts) covers precedence/fail-closed independently.
 * As of T-121, kb_learn carries a fallback slot too — covered below by the
 * fallback-retry tests, mirroring ticket-triage's/-respond's pattern.
 *
 * pg Pool + fetch are mocked; no real DB or LLM.
 */

const KB_JSON = JSON.stringify({
  title: "Auth: password reset email not received",
  body: "User did not receive the reset email; routed to auth; resolved by re-verifying the address and re-sending.",
});

function resolvedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Reset email missing",
    body: "No reset email arrives",
    urgency: "normal",
    category: "auth",
    routing: "support",
    ...overrides,
  };
}

// kb-learn fetch txn query order after T-73:
//   [0] BEGIN [1] set tenant [2] set project [3] SELECT ticket
//   [4] SAVEPOINT [5] SELECT routing [6] RELEASE [7] COMMIT
// then insert txn: [8] BEGIN [9] set tenant [10] set project [11] INSERT [12] COMMIT
function fetchTxn(
  ticketRow: Record<string, unknown> | null,
  routingRows: Record<string, unknown>[]
) {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set tenant
    { rows: [] }, // set project
    { rows: ticketRow ? [ticketRow] : [] }, // SELECT ticket
    { rows: [] }, // SAVEPOINT
    { rows: routingRows }, // SELECT routing
    { rows: [] }, // RELEASE
    { rows: [] }, // COMMIT
    { rows: [] }, // BEGIN (insert)
    { rows: [] }, // set tenant
    { rows: [] }, // set project
    { rows: [] }, // INSERT
    { rows: [] }, // COMMIT
  ];
}

describe("generateKbArticle", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_URL", "https://litellm.test");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends the provided model alias to LiteLLM (not a hardcoded default)", async () => {
    const fetchMock = mockFetchOk(KB_JSON);
    await generateKbArticle(resolvedRow(), "triage-model");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { model: string };
    expect(sent.model).toBe("triage-model");
  });

  it("defaults to the alias literal when no model is passed", async () => {
    const fetchMock = mockFetchOk(KB_JSON);
    await generateKbArticle(resolvedRow());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe("triage-model");
  });
});

/**
 * T-88 — defense-in-depth PII guard.
 *
 * The system prompt forbids identifiers, but a live eval against the production
 * model still leaked a customer name/email/account/ticket-ID verbatim. The prompt
 * was hardened, but prompts are not a safety boundary — a future regression or
 * model drift must not be able to silently persist PII into kb_articles (a durable,
 * cross-ticket artifact). generateKbArticle() now re-scans the parsed title/body
 * for mechanically-detectable identifiers and fails closed (throw → no INSERT,
 * same fail-closed mode as the existing JSON-parse-failure path) if any are found.
 */
describe("findPiiKind (PII guard)", () => {
  it("returns null for clean, fully-anonymised article text", () => {
    expect(
      findPiiKind(
        "Billing: duplicate subscription charge\nA customer was charged twice; support refunded the duplicate."
      )
    ).toBeNull();
  });

  it("flags an embedded email address", () => {
    expect(findPiiKind("Contact maria.gonzalez@example.com for details")).toBe("email");
  });

  it("flags a bare #NNNN ticket reference (4+ digits)", () => {
    expect(findPiiKind("Resolved under ticket #48210")).toBe("ticket-id");
  });

  it("flags a keyworded case/account number", () => {
    expect(findPiiKind("See account ACME 771 — case 48210 refunded")).toBe("ticket-id");
  });

  it("flags a phone-shaped digit run", () => {
    expect(findPiiKind("Called the customer back on +1 (555) 123-4567 to confirm")).toBe("phone");
  });

  it("does NOT flag a 3-digit HTTP status code written as #NNN", () => {
    // #500 is an HTTP status, not a ticket ID — the bare-# pattern requires 4+ digits.
    expect(findPiiKind("The endpoint returned a #500 error until the fix")).toBeNull();
  });
});

describe("generateKbArticle PII guard (fail-closed before INSERT)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_URL", "https://litellm.test");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns a clean article unchanged (guard is a no-op on anonymised output)", async () => {
    mockFetchOk(KB_JSON);
    const article = await generateKbArticle(resolvedRow(), "triage-model");
    expect(article.title).toBe("Auth: password reset email not received");
  });

  it("rejects an article whose body embeds an email address", async () => {
    mockFetchOk(
      JSON.stringify({
        title: "Billing: duplicate charge",
        body: "Refunded the duplicate charge; confirmed with maria.gonzalez@example.com.",
      })
    );
    await expect(generateKbArticle(resolvedRow(), "triage-model")).rejects.toThrow(
      /rejected: embedded email/
    );
  });

  it("rejects an article whose title embeds a ticket-ID-shaped string", async () => {
    mockFetchOk(
      JSON.stringify({
        title: "Billing: duplicate charge (ticket #48210)",
        body: "Refunded the duplicate charge and confirmed with the customer.",
      })
    );
    await expect(generateKbArticle(resolvedRow(), "triage-model")).rejects.toThrow(
      /rejected: embedded ticket-id/
    );
  });

  it("error message reports only the identifier KIND, never the matched value", async () => {
    // The error is recorded to LangFuse via String(err); it must not re-leak PII.
    mockFetchOk(
      JSON.stringify({
        title: "Billing: duplicate charge",
        body: "Emailed secret.person@private.example to confirm the refund.",
      })
    );
    await expect(generateKbArticle(resolvedRow(), "triage-model")).rejects.toThrow(
      /^KB article rejected: embedded email in generated content$/
    );
  });
});

describe("learnFromResolvedTicket", () => {
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

  it("happy path: fetch → generate → INSERT, using the resolved routing model", async () => {
    const client = makeClient(fetchTxn(resolvedRow(), []));
    const pool = makePool(client);
    const fetchMock = mockFetchOk(KB_JSON);

    const result = await learnFromResolvedTicket(pool, "t1", "proj-1", "tenant-1");

    expect(result).toEqual({ created: true, title: "Auth: password reset email not received" });

    // Resolved model (default literal, no routing row) reached the LLM call.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe("triage-model");

    // Article was inserted.
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([q]) => q.includes("INSERT INTO kb_articles"))).toBe(true);
  });

  it("uses the agent_model_routing override when present and allowlisted", async () => {
    const client = makeClient(
      fetchTxn(resolvedRow(), [{ primary_model: "triage-model", fallback_model: null }])
    );
    const pool = makePool(client);
    const fetchMock = mockFetchOk(KB_JSON);

    await learnFromResolvedTicket(pool, "t1", "proj-1", "tenant-1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe("triage-model");
  });

  it("falls back to the fallback model when the primary generation fails (T-121)", async () => {
    const client = makeClient(fetchTxn(resolvedRow(), []));
    const pool = makePool(client);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "Primary down" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ model: "meta/llama-3.3-70b-instruct", choices: [{ message: { content: KB_JSON } }] }),
        })
    );

    const result = await learnFromResolvedTicket(pool, "t1", "proj-1", "tenant-1");

    expect(result).toEqual({ created: true, title: "Auth: password reset email not received" });
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([q]) => q.includes("INSERT INTO kb_articles"))).toBe(true);
  });

  it("throws the PRIMARY error when both primary and fallback generation fail (T-121)", async () => {
    const client = makeClient(fetchTxn(resolvedRow(), []));
    const pool = makePool(client);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "Primary down" })
        .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "Fallback rate limited" })
    );

    await expect(learnFromResolvedTicket(pool, "t1", "proj-1", "tenant-1")).rejects.toThrow(
      "LiteLLM 503"
    );

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([q]) => q.includes("INSERT INTO kb_articles"))).toBe(false);
  });

  it("a PII-leak rejection from the primary is NOT masked when the fallback also leaks (T-121)", async () => {
    const client = makeClient(fetchTxn(resolvedRow(), []));
    const pool = makePool(client);
    const leaky = JSON.stringify({
      title: "Billing: duplicate charge",
      body: "Confirmed with maria.gonzalez@example.com.",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: leaky } }] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: leaky } }] }) })
    );

    await expect(learnFromResolvedTicket(pool, "t1", "proj-1", "tenant-1")).rejects.toThrow(
      /rejected: embedded email/
    );

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([q]) => q.includes("INSERT INTO kb_articles"))).toBe(false);
  });

  it("skips a ticket that does not exist (no LLM call, no INSERT)", async () => {
    const client = makeClient(fetchTxn(null, []));
    const pool = makePool(client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await learnFromResolvedTicket(pool, "ghost", "proj-1", "tenant-1");

    expect(result).toEqual({ skipped: true, reason: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(calls.some(([q]) => q.includes("INSERT INTO kb_articles"))).toBe(false);
  });
});
