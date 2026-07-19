import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClient, makePool } from "./helpers";

/**
 * S3 — fix-reconcile unit tests.
 *
 * reconcileOnce's flow, per configured product id:
 *   1. fetchCandidates: SELECT fix_attempts WHERE status IN ('pending',
 *      'running') AND created_at < now() - grace, product-scoped read txn.
 *   2. listRecentSandboxRuns: ONE GitHub API call per tick (not per
 *      candidate), matched in memory via findMatchingRuns (UUID substring,
 *      not exact run-name string — see file header on why).
 *   3. decideForCandidate: pure decision (skip / fail-as-abandoned /
 *      need-results) from the match count + run status + candidate age.
 *   4. fetchSandboxResults: only called when a match has completed — reads
 *      the flat `sandbox-results-summary` artifact (one zip layer, no tar).
 *   5. resolveAttempt: product-scoped, status-conditional UPDATE + audit_log.
 *
 * pg Pool + fetch are mocked; no real DB, no real GitHub calls. A couple of
 * fetchSandboxResults tests build a REAL zip via AdmZip (not hand-crafted
 * binary) so the parsing path is exercised against actual zip bytes.
 */

import {
  decideForCandidate,
  deriveOutcome,
  fetchCandidates,
  fetchSandboxResults,
  findMatchingRuns,
  reconcileOnce,
  _resetPool,
  type CandidateAttempt,
} from "../fix-reconcile";

function calls(client: unknown): [string, unknown[]?][] {
  return (client as { query: ReturnType<typeof vi.fn> }).query.mock.calls as [string, unknown[]?][];
}

const ATTEMPT_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "8bafa6a6-4d80-4983-89bc-e536d3dba672";

function candidate(overrides: Partial<CandidateAttempt> = {}): CandidateAttempt {
  return {
    id: ATTEMPT_ID,
    product_id: PRODUCT_ID,
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min old by default
    ...overrides,
  };
}

function ghRun(
  overrides: Partial<{ id: number; status: string | null; display_title: string }> = {}
) {
  return {
    id: 999,
    status: "completed",
    conclusion: "success",
    display_title: `S3 Fix Sandbox — attempt ${ATTEMPT_ID}`,
    ...overrides,
  };
}

function buildResultsZip(results: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  zip.addFile("results.json", Buffer.from(JSON.stringify(results), "utf8"));
  return zip.toBuffer();
}

const PASSING_RESULTS = {
  fix_attempt_id: ATTEMPT_ID,
  build_outcome: "success",
  lint_outcome: "success",
  test_outcome: "success",
  test_skipped: "false",
  egress_canary_blocked: true,
};

describe("findMatchingRuns", () => {
  it("matches on the attempt id substring, not exact run-name equality", () => {
    const runs = [ghRun({ id: 1, display_title: `weird — attempt ${ATTEMPT_ID} — extra text` })];
    expect(findMatchingRuns(runs, ATTEMPT_ID)).toHaveLength(1);
  });

  it("does not match a run whose display_title lacks the id", () => {
    const runs = [ghRun({ id: 1, display_title: "unrelated run" })];
    expect(findMatchingRuns(runs, ATTEMPT_ID)).toHaveLength(0);
  });

  it("returns every match when more than one run shares the id (anomaly upstream)", () => {
    const runs = [ghRun({ id: 1 }), ghRun({ id: 2 })];
    expect(findMatchingRuns(runs, ATTEMPT_ID)).toHaveLength(2);
  });
});

describe("deriveOutcome", () => {
  it("completed: build/lint/test all pass, canary confirmed blocking", () => {
    expect(deriveOutcome(PASSING_RESULTS)).toBe("completed");
  });

  it("completed: test legitimately skipped (test_skipped is the STRING 'true')", () => {
    expect(
      deriveOutcome({ ...PASSING_RESULTS, test_outcome: "skipped", test_skipped: "true" })
    ).toBe("completed");
  });

  it("failed: build failed", () => {
    expect(deriveOutcome({ ...PASSING_RESULTS, build_outcome: "failure" })).toBe("failed");
  });

  it("failed: lint failed", () => {
    expect(deriveOutcome({ ...PASSING_RESULTS, lint_outcome: "failure" })).toBe("failed");
  });

  it("failed: test failed and was not skipped", () => {
    expect(
      deriveOutcome({ ...PASSING_RESULTS, test_outcome: "failure", test_skipped: "false" })
    ).toBe("failed");
  });

  it("failed: egress canary did not confirm blocking, even if build/lint/test all passed", () => {
    expect(deriveOutcome({ ...PASSING_RESULTS, egress_canary_blocked: false })).toBe("failed");
  });
});

describe("decideForCandidate", () => {
  const nowMs = Date.now();

  it("skip: zero matches, still within the abandon window", () => {
    const result = decideForCandidate({ candidate: candidate(), matches: [], nowMs });
    expect(result).toEqual({ decision: "resolved", resolution: { kind: "skip" } });
  });

  it("fail: zero matches, past the abandon window", () => {
    const old = candidate({ created_at: new Date(nowMs - 60 * 60 * 1000).toISOString() }); // 60 min old
    const result = decideForCandidate({ candidate: old, matches: [], nowMs });
    expect(result.decision).toBe("resolved");
    if (result.decision === "resolved" && result.resolution.kind === "fail") {
      expect(result.resolution.reason).toMatch(/no matching sandbox run/);
    } else {
      throw new Error("expected a fail resolution");
    }
  });

  it("fail (anomaly): more than one run matches", () => {
    const result = decideForCandidate({
      candidate: candidate(),
      matches: [ghRun({ id: 1 }), ghRun({ id: 2 })],
      nowMs,
    });
    expect(result.decision).toBe("resolved");
    if (result.decision === "resolved" && result.resolution.kind === "fail") {
      expect(result.resolution.reason).toMatch(/multiple sandbox runs/);
    } else {
      throw new Error("expected a fail resolution");
    }
  });

  it("skip: exactly one match, still in progress, within the abandon window", () => {
    const result = decideForCandidate({
      candidate: candidate(),
      matches: [ghRun({ status: "in_progress" })],
      nowMs,
    });
    expect(result).toEqual({ decision: "resolved", resolution: { kind: "skip" } });
  });

  it("fail: exactly one match, still not completed, past the abandon window", () => {
    const old = candidate({ created_at: new Date(nowMs - 60 * 60 * 1000).toISOString() });
    const result = decideForCandidate({
      candidate: old,
      matches: [ghRun({ status: "in_progress" })],
      nowMs,
    });
    expect(result.decision).toBe("resolved");
    if (result.decision === "resolved" && result.resolution.kind === "fail") {
      expect(result.resolution.reason).toMatch(/not completed/);
    } else {
      throw new Error("expected a fail resolution");
    }
  });

  it("need-results: exactly one match, completed", () => {
    const run = ghRun({ status: "completed" });
    const result = decideForCandidate({ candidate: candidate(), matches: [run], nowMs });
    expect(result).toEqual({ decision: "need-results", run });
  });
});

describe("fetchCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes the read by product via set_config, then SELECTs pending/running past the grace window", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [{ id: ATTEMPT_ID, created_at: "2026-07-19T00:00:00.000Z" }] }, // SELECT
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const result = await fetchCandidates(pool, PRODUCT_ID);

    expect(result).toEqual([
      { id: ATTEMPT_ID, product_id: PRODUCT_ID, created_at: "2026-07-19T00:00:00.000Z" },
    ]);
    const c = calls(client);
    expect(c[1][0]).toMatch(/set_config/);
    expect(c[1][1]).toEqual([PRODUCT_ID]);
    expect(c[2][0]).toMatch(/status IN \('pending', 'running'\)/);
  });

  it("rolls back and rethrows on a query error", async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }]);
    (client as unknown as { query: ReturnType<typeof vi.fn> }).query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // set_config
      .mockRejectedValueOnce(new Error("db exploded")) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const pool = makePool(client);

    await expect(fetchCandidates(pool, PRODUCT_ID)).rejects.toThrow("db exploded");
    const c = calls(client);
    expect(c[c.length - 1][0]).toBe("ROLLBACK");
  });
});

describe("fetchSandboxResults", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads the flat sandbox-results-summary artifact and parses results.json", async () => {
    const zipBuf = buildResultsZip(PASSING_RESULTS);
    const fetchMock = vi
      .fn()
      // list artifacts
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 42, name: "sandbox-results-summary" }] }),
      })
      // download zip
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("process", {
      ...process,
      env: { ...process.env, GITHUB_STATUS_DISPATCH_TOKEN: "tok" },
    });

    const results = await fetchSandboxResults(999);
    expect(results).toEqual(PASSING_RESULTS);
  });

  it("returns null when the run has no sandbox-results-summary artifact", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifacts: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("process", {
      ...process,
      env: { ...process.env, GITHUB_STATUS_DISPATCH_TOKEN: "tok" },
    });

    const results = await fetchSandboxResults(999);
    expect(results).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when GITHUB_STATUS_DISPATCH_TOKEN is not configured", async () => {
    vi.stubGlobal("process", {
      ...process,
      env: { ...process.env, GITHUB_STATUS_DISPATCH_TOKEN: undefined },
    });
    await expect(fetchSandboxResults(999)).rejects.toThrow(/GITHUB_STATUS_DISPATCH_TOKEN/);
  });
});

describe("reconcileOnce", () => {
  beforeEach(() => {
    _resetPool();
    vi.stubEnv("RECONCILE_PRODUCT_IDS", PRODUCT_ID);
    vi.stubEnv("GITHUB_STATUS_DISPATCH_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves a completed, passing run to status='completed' with sandbox_run_id + diff_ref", async () => {
    const fetchClient = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      {
        rows: [{ id: ATTEMPT_ID, created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }],
      },
      { rows: [] }, // COMMIT
    ]);
    const resolveClient = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [] }, // UPDATE
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    let connectCall = 0;
    const pool = {
      connect: vi.fn().mockImplementation(() => {
        connectCall++;
        return Promise.resolve(connectCall === 1 ? fetchClient : resolveClient);
      }),
    } as unknown as Parameters<typeof reconcileOnce>[0];

    const zipBuf = buildResultsZip(PASSING_RESULTS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [ghRun()] }) }) // list runs
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 42, name: "sandbox-results-summary" }] }),
      }) // list artifacts
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength),
      }); // download zip
    vi.stubGlobal("fetch", fetchMock);

    const result = await reconcileOnce(pool);
    expect(result).toEqual({ resolved: 1, skipped: 0 });

    const updateCall = calls(resolveClient)[2];
    expect(updateCall[0]).toMatch(/UPDATE fix_attempts/);
    expect(updateCall[1]).toEqual(["completed", "999", "gha-run:999", ATTEMPT_ID, PRODUCT_ID]);

    const auditCall = calls(resolveClient)[3];
    expect(auditCall[0]).toMatch(/fix\.reconcile'/);
    expect(JSON.parse((auditCall[1] as unknown[])[1] as string)).toEqual({
      product_id: PRODUCT_ID,
      outcome: "completed",
      sandbox_run_id: "999",
    });
  });

  it("resolves a completed, failing run to status='failed'", async () => {
    const fetchClient = makeClient([
      { rows: [] },
      { rows: [] },
      {
        rows: [{ id: ATTEMPT_ID, created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }],
      },
      { rows: [] },
    ]);
    const resolveClient = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    let connectCall = 0;
    const pool = {
      connect: vi.fn().mockImplementation(() => {
        connectCall++;
        return Promise.resolve(connectCall === 1 ? fetchClient : resolveClient);
      }),
    } as unknown as Parameters<typeof reconcileOnce>[0];

    const zipBuf = buildResultsZip({ ...PASSING_RESULTS, build_outcome: "failure" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [ghRun()] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 42, name: "sandbox-results-summary" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await reconcileOnce(pool);
    expect(result).toEqual({ resolved: 1, skipped: 0 });
    const updateCall = calls(resolveClient)[2];
    expect(updateCall[1]).toEqual(["failed", "999", "gha-run:999", ATTEMPT_ID, PRODUCT_ID]);
  });

  it("flags a fix_attempt_id mismatch as an anomaly rather than trusting run-name alone", async () => {
    const fetchClient = makeClient([
      { rows: [] },
      { rows: [] },
      {
        rows: [{ id: ATTEMPT_ID, created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }],
      },
      { rows: [] },
    ]);
    const resolveClient = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    let connectCall = 0;
    const pool = {
      connect: vi.fn().mockImplementation(() => {
        connectCall++;
        return Promise.resolve(connectCall === 1 ? fetchClient : resolveClient);
      }),
    } as unknown as Parameters<typeof reconcileOnce>[0];

    const zipBuf = buildResultsZip({ ...PASSING_RESULTS, fix_attempt_id: "other-attempt-id" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [ghRun()] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 42, name: "sandbox-results-summary" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await reconcileOnce(pool);
    expect(result).toEqual({ resolved: 1, skipped: 0 });
    const auditCall = calls(resolveClient)[3];
    expect(auditCall[0]).toMatch(/fix\.reconcile\.anomaly/);
    expect(JSON.parse((auditCall[1] as unknown[])[1] as string).reason).toMatch(/mismatch/);
  });

  it("skips (no DB write, no GitHub artifact call) when the matching run is still in progress", async () => {
    const fetchClient = makeClient([
      { rows: [] },
      { rows: [] },
      {
        rows: [{ id: ATTEMPT_ID, created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }],
      },
      { rows: [] },
    ]);
    const pool = { connect: vi.fn().mockResolvedValue(fetchClient) } as unknown as Parameters<
      typeof reconcileOnce
    >[0];

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ workflow_runs: [ghRun({ status: "in_progress" })] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await reconcileOnce(pool);
    expect(result).toEqual({ resolved: 0, skipped: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the list-runs call, never artifacts
  });

  it("never logs raw diff/log content in any audit_log payload", async () => {
    const fetchClient = makeClient([
      { rows: [] },
      { rows: [] },
      {
        rows: [{ id: ATTEMPT_ID, created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }],
      },
      { rows: [] },
    ]);
    const resolveClient = makeClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    let connectCall = 0;
    const pool = {
      connect: vi.fn().mockImplementation(() => {
        connectCall++;
        return Promise.resolve(connectCall === 1 ? fetchClient : resolveClient);
      }),
    } as unknown as Parameters<typeof reconcileOnce>[0];

    const zipBuf = buildResultsZip(PASSING_RESULTS);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [ghRun()] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ artifacts: [{ id: 42, name: "sandbox-results-summary" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength),
      });
    vi.stubGlobal("fetch", fetchMock);

    await reconcileOnce(pool);
    const auditPayload = JSON.parse((calls(resolveClient)[3][1] as unknown[])[1] as string);
    const serialized = JSON.stringify(auditPayload);
    expect(serialized).not.toMatch(/diff --git/);
    expect(Object.keys(auditPayload).sort()).toEqual(["outcome", "product_id", "sandbox_run_id"]);
  });

  it("returns early with zero work when there are no eligible candidates", async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const pool = makePool(client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await reconcileOnce(pool);
    expect(result).toEqual({ resolved: 0, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled(); // no candidates => never calls GitHub at all
  });
});
