import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClient, makePool, mockFetchOk } from "./helpers";

/**
 * S3 — fix-author-agent (authoring half) unit tests.
 *
 * authorFixForFinding's flow: fetch txn (SELECT finding, resolve
 * agent_routing) — a cheap PRE-CHECK only — -> LLM call (LiteLLM) -> write
 * txn (SELECT ... FOR UPDATE the finding row — the AUTHORITATIVE re-check,
 * race-free against concurrent dispatches/retries and mid-flight human
 * dismissals — then INSERT fix_attempts, INSERT audit_log). pg Pool + fetch
 * are mocked; no real DB, no real LiteLLM call. The sandbox-dispatch half
 * does not exist yet (see the file's own header — founder-gated, FQ-79) so
 * this only covers authoring.
 *
 * fix_attempts.status is ALWAYS 'failed' in this PR (even when a valid diff
 * was extracted) and findings.state is NEVER advanced — see the file's own
 * "STATUS IS ALWAYS 'failed'" comment for why (CodeRabbit review: a
 * 'pending'/in-progress row here would be unrecoverable, since nothing in
 * this PR persists or dispatches the diff). `diffExtracted` in the return
 * value and `diff_extracted` in the audit_log payload are what distinguish
 * a real candidate fix from "no fix found."
 */

vi.mock("../../langfuse", () => ({ langfuse: null }));

import { authorFixForFinding, extractDiff, getPool, _resetPool } from "../fix-author";

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
// whole point of the race-condition fix).
function fetchTxn(opts: {
  finding?: Record<string, unknown> | null;
  routingRow?: Record<string, unknown> | null;
  existingAttempt?: Record<string, unknown> | null;
}) {
  const finding = opts.finding === undefined ? FINDING_ROW : opts.finding;
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: finding ? [finding] : [] }, // SELECT findings
    { rows: [] }, // SAVEPOINT agent_routing_read
    { rows: opts.routingRow ? [opts.routingRow] : [] }, // SELECT agent_routing
    { rows: [] }, // RELEASE SAVEPOINT
    ...(finding ? [{ rows: opts.existingAttempt ? [opts.existingAttempt] : [] }] : []), // SELECT fix_attempts (pre-check)
    { rows: [] }, // COMMIT
  ];
}

// The write transaction's AUTHORITATIVE re-check: SELECT ... FOR UPDATE the
// finding row, then (only if still eligible) SELECT fix_attempts again, then
// (only if still no in-flight attempt) INSERT fix_attempts (status always
// 'failed' — see file header), INSERT audit_log, COMMIT. Any negative
// outcome ROLLBACKs immediately without inserting anything.
function writeTxnAuthored(opts: { lockedState?: string; fixAttemptId?: string }) {
  const lockedState = opts.lockedState ?? "detected";
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: [{ state: lockedState }] }, // SELECT findings FOR UPDATE
    { rows: [] }, // SELECT fix_attempts (authoritative)
    { rows: [{ id: opts.fixAttemptId ?? "attempt-1" }] }, // INSERT fix_attempts
    { rows: [] }, // INSERT audit_log
    { rows: [] }, // COMMIT
  ];
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

function poolAlternating(fetchClient: unknown, writeClient: unknown) {
  let call = 0;
  return {
    connect: vi
      .fn()
      .mockImplementation(() => Promise.resolve(call++ === 0 ? fetchClient : writeClient)),
  } as unknown as ReturnType<typeof makePool>;
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

  it("records a 'failed' fix_attempts row with diffExtracted:true when the model returns a valid diff", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ fixAttemptId: "attempt-1" }));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk(VALID_DIFF);

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({
      authored: true,
      fixAttemptId: "attempt-1",
      model: "triage-model",
      diffExtracted: true,
    });
    const insertCall = calls(writeClient).find(([q]) => q.includes("INSERT INTO fix_attempts"))!;
    expect(insertCall[0]).toContain("'failed'");
    expect(insertCall[1]).toEqual(["prod-1", "finding-1", "triage-model"]);
    expect(calls(writeClient).some(([q]) => q.includes("UPDATE findings"))).toBe(false);
  });

  it("records a 'failed' fix_attempts row with diffExtracted:false when the model returns no fix", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ fixAttemptId: "attempt-2" }));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk("NO_FIX_AVAILABLE");

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({
      authored: true,
      fixAttemptId: "attempt-2",
      model: "triage-model",
      diffExtracted: false,
    });
    const insertCall = calls(writeClient).find(([q]) => q.includes("INSERT INTO fix_attempts"))!;
    expect(insertCall[1]).toEqual(["prod-1", "finding-1", "triage-model"]);
    expect(calls(writeClient).some(([q]) => q.includes("UPDATE findings"))).toBe(false);
  });

  it("scopes the write-txn fix_attempts lookup and insert by product_id, not finding_id alone", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ fixAttemptId: "attempt-1" }));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk(VALID_DIFF);

    await authorFixForFinding(pool, "prod-1", "finding-1");

    const attemptSelectCall = calls(writeClient).find(([q]) => q.includes("FROM fix_attempts"))!;
    expect(attemptSelectCall[1]).toEqual(["prod-1", "finding-1"]);
    const insertCall = calls(writeClient).find(([q]) => q.includes("INSERT INTO fix_attempts"))!;
    expect(insertCall[1]).toEqual(["prod-1", "finding-1", "triage-model"]);
  });

  it("never writes the raw diff or raw finding.detail into audit_log", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ fixAttemptId: "attempt-1" }));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk(VALID_DIFF);

    await authorFixForFinding(pool, "prod-1", "finding-1");

    const auditCall = calls(writeClient).find(([q]) => q.includes("INSERT INTO audit_log"))!;
    const payloadJson = (auditCall[1] as unknown[])[1] as string;
    expect(payloadJson).not.toContain(VALID_DIFF);
    expect(payloadJson).not.toContain("CVE-2025-XXXX");
    expect(JSON.parse(payloadJson)).toMatchObject({ diff_extracted: true });
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

  // --- Race-condition regression coverage (security review, pre-merge) ------

  it("RACE: rolls back with no insert when the write-txn re-check finds the finding was dismissed mid-flight", async () => {
    // Read-txn pre-check saw an eligible 'detected' finding (so the LLM call
    // happens); by the time the write txn takes the row lock, a human has
    // dismissed it. The authoritative re-check must catch this — never
    // commit a fix_attempts row against a dismissed finding.
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnRolledBackOnLockedState("dismissed"));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk(VALID_DIFF);

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "finding_state_dismissed" });
    expect(calls(writeClient).some(([q]) => q.includes("INSERT INTO fix_attempts"))).toBe(false);
    expect(calls(writeClient).some(([q]) => q === "ROLLBACK")).toBe(true);
  });

  it("RACE: rolls back with no insert when the finding vanishes before the write-txn lock", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnRolledBackOnLockedState(null));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk(VALID_DIFF);

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "finding_not_found" });
    expect(calls(writeClient).some(([q]) => q.includes("INSERT INTO fix_attempts"))).toBe(false);
  });

  it("RACE: rolls back with no insert when a concurrent run already committed an in-flight attempt", async () => {
    // Read-txn pre-check saw no in-flight attempt; a concurrent dispatch for
    // the SAME finding_id won the race and committed one first. The
    // write-txn's FOR UPDATE lock serializes us behind that commit, so the
    // authoritative re-check now sees it — we must skip, not double-insert.
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnRolledBackOnRaceAttempt({ id: "attempt-winner" }));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk(VALID_DIFF);

    const result = await authorFixForFinding(pool, "prod-1", "finding-1");

    expect(result).toEqual({ skipped: true, reason: "attempt_in_progress" });
    expect(calls(writeClient).some(([q]) => q.includes("INSERT INTO fix_attempts"))).toBe(false);
  });

  it("scopes both the read-txn and write-txn finding lookups by product_id, not id alone", async () => {
    const fetchClient = makeClient(fetchTxn({}));
    const writeClient = makeClient(writeTxnAuthored({ fixAttemptId: "attempt-1" }));
    const pool = poolAlternating(fetchClient, writeClient);
    mockFetchOk(VALID_DIFF);

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
