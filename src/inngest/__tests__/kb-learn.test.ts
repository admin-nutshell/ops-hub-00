import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKbArticle, learnFromResolvedTicket } from "../kb-learn";
import { makeClient, makePool, mockFetchOk } from "./helpers";

/**
 * T-73 — kb-learn unit tests.
 *
 * kb-learn had no dedicated unit suite before T-73 wired resolveModelRouting
 * into it. These establish baseline coverage AND prove the resolved model is
 * the one actually sent to LiteLLM (replacing the former hardcoded
 * `LITELLM_TRIAGE_MODEL ?? "triage-model"`). KB Learn is primary-only this
 * sprint, so its list allows exactly `triage-model`; the resolver test suite
 * (modelRouting.test.ts) covers precedence/fail-closed independently.
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
