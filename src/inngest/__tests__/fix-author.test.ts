import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClient, makePool } from "./helpers";

/**
 * S3 — fix-author-agent unit tests.
 *
 * authorFixForFinding's flow:
 *   1. fetch txn (SELECT finding, resolve agent_routing, SELECT fix_attempts
 *      pre-check, SELECT repo_connections) — a cheap PRE-CHECK only.
 *   2. LLM call (LiteLLM) -> extract diff.
 *   3. write txn: SELECT ... FOR UPDATE the finding row — the AUTHORITATIVE
 *      re-check, race-free — then INSERT fix_attempts (status 'pending' if a
 *      diff was extracted, else 'failed'), conditionally advance
 *      findings.state, INSERT audit_log.
 *   4. (only if a diff was extracted) OUTSIDE that transaction: dispatch
 *      s3-fix-sandbox.yml via GITHUB_STATUS_DISPATCH_TOKEN, then a small
 *      separate transaction (markDispatchOutcome) updates fix_attempts to
 *      'running' (success) or 'failed' (dispatch error) + an audit_log row.
 *
 * pg Pool + fetch are mocked; no real DB, no real LiteLLM/GitHub calls.
 */

vi.mock("../../langfuse", () => ({ langfuse: null }));

import {
  authorFixForFinding,
  extractDiff,
  getPool,
  _resetPool,
  type AuthorFixResult,
} from "../fix-author";

function assertAuthored(
  result: AuthorFixResult
): asserts result is Extract<AuthorFixResult, { authored: true }> {
  if (!("authored" in result) || !result.authored) {
    throw new Error(`expected an authored result, got ${JSON.stringify(result)}`);
  }
}

function calls(client: unknown): [string, unknown[]?][] {
  return (client as { query: ReturnType<typeof vi.fn> }).query.mock.calls as [string, unknown[]?][];
}

const FINDING_ROW = {
  id: "finding-1",
  finding_type: "vuln",
  severity: "high",
  title: "js-yaml: prototype pollution",
  detail: { advisory: "CVE-2025-XXXX" },
  state: "detected",
};

const CONNECTION_ROW = {
  repo_full_name: "admin-nutshell/web-app-tns-06",
  default_branch: "main",
};

const VALID_DIFF = [
  "diff --git a/package.json b/package.json",
  "index 111..222 100644",
  "--- a/package.json",
  "+++ b/package.json",
  '-  "js-yaml": "3.13.0",',
  '+  "js-yaml": "3.14.1",',
].join("\n");

// The fetch transaction is a cheap PRE-CHECK only (see authorFixForFinding's
// own doc comment) — it exists to skip the LLM call in the common case, not
// to be the safety boundary. `existingAttempt` here simulates what THIS
// pre-check sees; the write-transaction tests below separately simulate what
// the AUTHORITATIVE re-check sees, which can legitimately differ (that's the
// whole point of the race-condition fix carried over from the prior PR).
function fetchTxn(opts: {
  finding?: Record<string, unknown> | null;
  routingRow?: Record<string, unknown> | null;
  existingAttempt?: Record<string, unknown> | null;
  connection?: Record<string, unknown> | null;
}) {
  const finding = opts.finding === undefined ? FINDING_ROW : opts.finding;
  const connection = opts.connection === undefined ? CONNECTION_ROW : opts.connection;
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: finding ? [finding] : [] }, // SELECT findings
    { rows: [] }, // SAVEPOINT agent_routing_read
    { rows: opts.routingRow ? [opts.routingRow] : [] }, // SELECT agent_routing
    { rows: [] }, // RELEASE SAVEPOINT
    ...(finding
      ? [
          { rows: opts.existingAttempt ? [opts.existingAttempt] : [] }, // SELECT fix_attempts (pre-check)
          { rows: connection ? [connection] : [] }, // SELECT repo_connections
        ]
      : []),
    { rows: [] }, // COMMIT
  ];
}

// The write transaction's AUTHORITATIVE re-check: SELECT ... FOR UPDATE the
// finding row, then (only if still eligible) SELECT fix_attempts again, then
// (only if still no in-flight attempt) INSERT fix_attempts, conditionally
// UPDATE findings, INSERT audit_log, COMMIT. Any negative outcome ROLLBACKs
// immediately without inserting anything.
function writeTxnAuthored(opts: { lockedState?: string; advanceState: boolean }) {
  const lockedState = opts.lockedState ?? "detected";
  const rows: { rows: Record<string, unknown>[] }[] = [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: [{ state: lockedState }] }, // SELECT findings FOR UPDATE
    { rows: [] }, // SELECT fix_attempts (authoritative)
    { rows: [] }, // INSERT fix_attempts
  ];
  if (opts.advanceState) rows.push({ rows: [] }); // UPDATE findings
  rows.push({ rows: [] }); // INSERT audit_log
  rows.push({ rows: [] }); // COMMIT
  return rows;
}

function writeTxnRolledBackOnLockedState(lockedState: string | null) {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: lockedState ? [{ state: lockedState }] : [] }, // SELECT findings FOR UPDATE
    { rows: [] }, // ROLLBACK
  ];
}

function writeTxnRolledBackOnRaceAttempt(existingAttempt: Record<string, unknown>) {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: [{ state: "detected" }] }, // SELECT findings FOR UPDATE
    { rows: [existingAttempt] }, // SELECT fix_attempts (authoritative) — a concurrent run beat us to it
    { rows: [] }, // ROLLBACK
  ];
}

// markDispatchOutcome's own small transaction (UPDATE fix_attempts + INSERT
// audit_log), run in a THIRD pool.connect() call after the write txn above.
function dispatchOutcomeTxn() {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: [] }, // UPDATE fix_attempts
    { rows: [] }, // INSERT audit_log
    { rows: [] }, // COMMIT
  ];
}

function poolSequence(...clients: unknown[]) {
  let call = 0;
  return {
    connect: vi
      .fn()
      .mockImplementation(() => Promise.resolve(clients[Math.min(call++, clients.length - 1)])),
  } as unknown as ReturnType<typeof makePool>;
}

function mockSequentialFetch(...responses: Array<Record<string, unknown>>) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function llmResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

function dispatchOk() {
  return { status: 204 };
}

function dispatchFailed(status = 422, text = "Unexpected inputs") {
  return { status, text: async () => text };
}

describe("extractDiff", () => {
  it("accepts a real unified diff", () => {
    expect(extractDiff(VALID_DIFF)).toBe(VALID_DIFF);
  });

  it("strips a markdown fence around a real diff", () => {
    expect(extractDiff("```diff\n" + VALID_DIFF + "\n```")).toBe(VALID_DIFF);
  });

  it("returns null for the NO_FIX_AVAILABLE sentinel", () => {
    expect(extractDiff("NO_FIX_AVAILABLE")).toBeNull();
  });

  it("returns null for output that isn't a diff at all", () => {
    expect(extractDiff("Sure, here is what I'd do: bump the version.")).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(extractDiff("   ")).toBeNull();
  });
});

describe("authorFixForFinding", () => {
  beforeEach(() => {
    vi.stubEnv("LITELLM_URL", "http://litellm-test:4000");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
    vi.stubEnv("GITHUB_STATUS_DISPATCH_TOKEN", "test-dispatch-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _resetPool();
  });

  it("skips when the finding does not exist (pre-check, no LLM call)", async () => {
    const client = makeClient(fetchTxn({ finding: null }));
    const pool = makePool(client);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await authorFixForFinding(pool, "prod-1", "missing-finding");

    expect(result).toEqual({ skipped: true, reason: "finding_not_found" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips a dismissed finding (pre-check, no LLM call)", async () => {
    const client = makeClient(fetchTxn({ finding: { ...FINDING_ROW, state: "dismissed" } }));
    const pool = makePool(client);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "finding_state_dismissed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips when an attempt is already pending/running for this finding (pre-check, no LLM call)", async () => {
    const client = makeClient(fetchTxn({ existingAttempt: { id: "attempt-0" } }));
    const pool = makePool(client);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "attempt_in_progress" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips when the product has no active repo connection (pre-check, no LLM call)", async () => {
    const client = makeClient(fetchTxn({ connection: null }));
    const pool = makePool(client);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "no_active_repo_connection" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("authors, dispatches, and marks 'running' + advances the finding on a successful diff + dispatch", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    mockSequentialFetch(llmResponse(VALID_DIFF), dispatchOk());

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");
    assertAuthored(result);

    expect(result).toMatchObject({
      authored: true,
      model: "triage-model",
      diffExtracted: true,
      dispatched: true,
    });
    expect(typeof result.fixAttemptId).toBe("string");

    const insertCall = calls(writeClient).find(([q]) => q.includes("INSERT INTO fix_attempts"))!;
    expect(insertCall[1]).toEqual([
      result.fixAttemptId,
      "prod-1",
      "finding-1",
      "triage-model",
      "pending",
    ]);
    expect(calls(writeClient).some(([q]) => q.includes("UPDATE findings"))).toBe(true);

    const dispatchUpdateCall = calls(dispatchClient).find(([q]) =>
      q.includes("UPDATE fix_attempts")
    )!;
    expect(dispatchUpdateCall[1]).toEqual(["running", result.fixAttemptId, "prod-1"]);
  });

  it("dispatches with the correct repo/ref/patch_base64/fix_attempt_id payload", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    const fetchMock = mockSequentialFetch(llmResponse(VALID_DIFF), dispatchOk());

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");
    assertAuthored(result);

    const dispatchCall = fetchMock.mock.calls[1];
    expect(dispatchCall[0]).toBe(
      "https://api.github.com/repos/admin-nutshell/ops-hub-00/actions/workflows/s3-fix-sandbox.yml/dispatches"
    );
    const opts = dispatchCall[1] as { headers: Record<string, string>; body: string };
    expect(opts.headers.Authorization).toBe("Bearer test-dispatch-token");
    const body = JSON.parse(opts.body);
    expect(body.ref).toBe("main");
    expect(body.inputs.repo_full_name).toBe(CONNECTION_ROW.repo_full_name);
    expect(body.inputs.ref).toBe(CONNECTION_ROW.default_branch);
    expect(body.inputs.fix_attempt_id).toBe(result.fixAttemptId);
    expect(Buffer.from(body.inputs.patch_base64, "base64").toString("utf8")).toBe(VALID_DIFF);
  });

  it("marks 'failed' (not stuck 'pending') when the dispatch call itself fails", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    mockSequentialFetch(llmResponse(VALID_DIFF), dispatchFailed(422, "Unexpected inputs provided"));

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");
    assertAuthored(result);

    expect(result).toMatchObject({ authored: true, diffExtracted: true, dispatched: false });
    const dispatchUpdateCall = calls(dispatchClient).find(([q]) =>
      q.includes("UPDATE fix_attempts")
    )!;
    expect(dispatchUpdateCall[1]).toEqual(["failed", result.fixAttemptId, "prod-1"]);
    const auditCall = calls(dispatchClient).find(([q]) => q.includes("INSERT INTO audit_log"))!;
    const payload = JSON.parse((auditCall[1] as unknown[])[1] as string);
    expect(payload.dispatched).toBe(false);
    expect(payload.error).toContain("422");
  });

  it("marks 'failed' when the dispatch fetch itself rejects (network error, not an HTTP response)", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    const fn = vi.fn();
    fn.mockResolvedValueOnce(llmResponse(VALID_DIFF));
    fn.mockRejectedValueOnce(new TypeError("fetch failed: ECONNRESET"));
    vi.stubGlobal("fetch", fn);

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");
    assertAuthored(result);

    expect(result).toMatchObject({ authored: true, diffExtracted: true, dispatched: false });
    const dispatchUpdateCall = calls(dispatchClient).find(([q]) =>
      q.includes("UPDATE fix_attempts")
    )!;
    expect(dispatchUpdateCall[1]).toEqual(["failed", result.fixAttemptId, "prod-1"]);
    const auditCall = calls(dispatchClient).find(([q]) => q.includes("INSERT INTO audit_log"))!;
    const payload = JSON.parse((auditCall[1] as unknown[])[1] as string);
    expect(payload.dispatched).toBe(false);
    expect(payload.error).toContain("ECONNRESET");
  });

  it("marks 'failed' (with a clear error, not confused for a GitHub response) when GITHUB_STATUS_DISPATCH_TOKEN is unset", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_URL", "http://litellm-test:4000");
    vi.stubEnv("LITELLM_MASTER_KEY", "test-key");
    // GITHUB_STATUS_DISPATCH_TOKEN deliberately left unset.
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    mockSequentialFetch(llmResponse(VALID_DIFF));

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");
    assertAuthored(result);

    expect(result).toMatchObject({ authored: true, diffExtracted: true, dispatched: false });
    const auditCall = calls(dispatchClient).find(([q]) => q.includes("INSERT INTO audit_log"))!;
    const payload = JSON.parse((auditCall[1] as unknown[])[1] as string);
    expect(payload.error).toContain("GITHUB_STATUS_DISPATCH_TOKEN not configured");
  });

  it("records a 'failed' fix_attempts row with diffExtracted:false and never dispatches when the model returns no fix", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: false }));
    const pool = poolSequence(fetchClient, writeClient);
    const fetchMock = mockSequentialFetch(llmResponse("NO_FIX_AVAILABLE"));

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");
    assertAuthored(result);

    expect(result).toMatchObject({ authored: true, diffExtracted: false, dispatched: false });
    const insertCall = calls(writeClient).find(([q]) => q.includes("INSERT INTO fix_attempts"))!;
    expect(insertCall[1]).toEqual([
      result.fixAttemptId,
      "prod-1",
      "finding-1",
      "triage-model",
      "failed",
    ]);
    expect(calls(writeClient).some(([q]) => q.includes("UPDATE findings"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // LLM only — no dispatch attempted
  });

  it("scopes the fix_attempts INSERT and dispatch UPDATE by product_id, not finding_id alone", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    mockSequentialFetch(llmResponse(VALID_DIFF), dispatchOk());

    await authorFixForFinding(pool, "prod-1", "finding-1");

    const attemptSelectCall = calls(writeClient).find(([q]) => q.includes("FROM fix_attempts"))!;
    expect(attemptSelectCall[1]).toEqual(["prod-1", "finding-1"]);
  });

  it("never writes the raw diff or raw finding.detail into audit_log", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    mockSequentialFetch(llmResponse(VALID_DIFF), dispatchOk());

    await authorFixForFinding(pool, "prod-1", "finding-1");

    const auditCall = calls(writeClient).find(([q]) => q.includes("INSERT INTO audit_log"))!;
    const payloadJson = (auditCall[1] as unknown[])[1] as string;
    expect(payloadJson).not.toContain(VALID_DIFF);
    expect(payloadJson).not.toContain("CVE-2025-XXXX");
    expect(JSON.parse(payloadJson)).toMatchObject({ diff_extracted: true });

    // Same check on the SECOND audit_log write (markDispatchOutcome, a
    // separate transaction/connection) — the diff must never reach it either.
    const dispatchAuditCall = calls(dispatchClient).find(([q]) =>
      q.includes("INSERT INTO audit_log")
    )!;
    const dispatchPayloadJson = (dispatchAuditCall[1] as unknown[])[1] as string;
    expect(dispatchPayloadJson).not.toContain(VALID_DIFF);
    expect(dispatchPayloadJson).not.toContain("CVE-2025-XXXX");
  });

  it("propagates a LiteLLM failure without writing any fix_attempts row", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const pool = makePool(fetchClient);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" })
    );

    await expect(authorFixForFinding(pool, "prod-1", "finding-1")).rejects.toThrow("LiteLLM 500");
  });

  // --- Race-condition regression coverage (security review, carried over) --

  it("RACE: rolls back with no insert when the write-txn re-check finds the finding was dismissed mid-flight", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnRolledBackOnLockedState("dismissed"));
    const pool = poolSequence(fetchClient, writeClient);
    mockSequentialFetch(llmResponse(VALID_DIFF));

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "finding_state_dismissed" });
    expect(calls(writeClient).some(([q]) => q.includes("INSERT INTO fix_attempts"))).toBe(false);
    expect(calls(writeClient).some(([q]) => q === "ROLLBACK")).toBe(true);
  });

  it("RACE: rolls back with no insert when the finding vanishes before the write-txn lock", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnRolledBackOnLockedState(null));
    const pool = poolSequence(fetchClient, writeClient);
    mockSequentialFetch(llmResponse(VALID_DIFF));

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "finding_not_found" });
    expect(calls(writeClient).some(([q]) => q.includes("INSERT INTO fix_attempts"))).toBe(false);
  });

  it("RACE: rolls back with no insert when a concurrent run already committed an in-flight attempt", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnRolledBackOnRaceAttempt({ id: "attempt-winner" }));
    const pool = poolSequence(fetchClient, writeClient);
    mockSequentialFetch(llmResponse(VALID_DIFF));

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "attempt_in_progress" });
    expect(calls(writeClient).some(([q]) => q.includes("INSERT INTO fix_attempts"))).toBe(false);
  });

  it("scopes both the read-txn and write-txn finding lookups by product_id, not id alone", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ advanceState: true }));
    const dispatchClient = makeClient(dispatchOutcomeTxn());
    const pool = poolSequence(fetchClient, writeClient, dispatchClient);
    mockSequentialFetch(llmResponse(VALID_DIFF), dispatchOk());

    await authorFixForFinding(pool, "prod-1", "finding-1");

    const readCall = calls(fetchClient).find(([q]) => q.includes("FROM findings"))!;
    expect(readCall[1]).toEqual(["finding-1", "prod-1"]);
    const lockCall = calls(writeClient).find(([q]) => q.includes("FOR UPDATE"))!;
    expect(lockCall[1]).toEqual(["finding-1", "prod-1"]);
  });

  it("uses the same lazy-pool accessor pattern as other reboot functions", () => {
    const client = makeClient([]);
    const pool = makePool(client);
    _resetPool(pool);
    expect(getPool()).toBe(pool);
  });
});
