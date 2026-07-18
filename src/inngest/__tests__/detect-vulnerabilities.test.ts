import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClient, makePool } from "./helpers";

/**
 * S2 — detect-vulnerabilities unit tests.
 *
 * detectVulnerabilitiesForProduct's flow: fetch txn (SELECT active
 * repo_connections row) -> mint installation token -> fetch Dependabot
 * alerts + code-scanning alerts (independently) -> write txn (create-or-
 * reuse signal_sources row, upsert findings without clobbering `state`,
 * INSERT audit_log). appAuth's mintInstallationToken is mocked directly
 * (its own unit tests cover the JWT/exchange mechanics) so these tests focus
 * on severity mapping, fingerprint dedupe, the no-clobber-state upsert
 * shape, and partial-failure handling.
 *
 * pg Pool + fetch are mocked; no real DB, no real GitHub call.
 */

vi.mock("../../github/appAuth", () => ({
  mintInstallationToken: vi.fn(),
  githubHeaders: (bearer: string) => ({ Authorization: `Bearer ${bearer}` }),
}));

import { mintInstallationToken } from "../../github/appAuth";
import { detectVulnerabilitiesForProduct } from "../detect-vulnerabilities";

const CONNECTION_ROW = {
  id: "conn-1",
  github_installation_id: "147237377",
  repo_full_name: "admin-nutshell/web-app-tns-06",
};

function fetchTxn(connectionRow: Record<string, unknown> | null) {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: connectionRow ? [connectionRow] : [] }, // SELECT repo_connections
    { rows: [] }, // COMMIT
  ];
}

function writeTxn(findingInsertedFlags: boolean[], sourceId = "source-1") {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: [{ id: sourceId }] }, // signal_sources upsert
    ...findingInsertedFlags.map((inserted) => ({ rows: [{ inserted }] })), // per-finding upsert
    { rows: [] }, // audit_log INSERT
    { rows: [] }, // COMMIT
  ];
}

// The signal_sources upsert's WHERE clause (status = 'active') returns zero
// rows, rather than an id, when the existing (product_id, kind) row is
// suspended — see the source_suspended handling in
// detectVulnerabilitiesForProduct. No finding upsert, no audit_log write:
// the transaction rolls back immediately after observing the empty result.
function suspendedSourceWriteTxn() {
  return [
    { rows: [] }, // BEGIN
    { rows: [] }, // set_config product
    { rows: [] }, // signal_sources upsert — WHERE status='active' excludes the suspended row
    { rows: [] }, // ROLLBACK
  ];
}

// GitHub's actual response body when code scanning is disabled for a repo
// (confirmed live against the pilot repo, admin-nutshell/web-app-tns-06 —
// HTTP 403, not 404) — see detectCodeScanningAlerts' body-check comment.
const CODE_SCANNING_DISABLED_BODY = JSON.stringify({
  message:
    "Code scanning is not enabled for this repository. Please enable code scanning in the repository settings.",
  documentation_url: "https://docs.github.com/rest/code-scanning/code-scanning",
  status: "403",
});

function mockGithubResponses(opts: {
  dependabot?: { status?: number; body?: unknown[]; errorText?: string };
  codeScanning?: { status?: number; body?: unknown[]; errorText?: string };
}) {
  const dependabotStatus = opts.dependabot?.status ?? 200;
  const dependabotBody = opts.dependabot?.body ?? [];
  const dependabotErrorText = opts.dependabot?.errorText ?? "dependabot error body";
  const codeScanningStatus = opts.codeScanning?.status ?? 200;
  const codeScanningBody = opts.codeScanning?.body ?? [];
  const codeScanningErrorText = opts.codeScanning?.errorText ?? "code-scanning error body";

  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/dependabot/alerts")) {
      return Promise.resolve({
        ok: dependabotStatus >= 200 && dependabotStatus < 300,
        status: dependabotStatus,
        json: async () => dependabotBody,
        text: async () => dependabotErrorText,
      });
    }
    if (url.includes("/code-scanning/alerts")) {
      return Promise.resolve({
        ok: codeScanningStatus >= 200 && codeScanningStatus < 300,
        status: codeScanningStatus,
        json: async () => codeScanningBody,
        text: async () => codeScanningErrorText,
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("detectVulnerabilitiesForProduct", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("OPS_HUB_APP_LOGIN_URL", "postgresql://mock");
    vi.mocked(mintInstallationToken).mockResolvedValue({
      token: "ghs_mocktoken",
      expiresAt: "2026-07-17T15:00:00Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns skipped when there is no active repo connection for the product", async () => {
    const client = makeClient(fetchTxn(null));
    const pool = makePool(client);
    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toEqual({ skipped: true, reason: "no_active_repo_connection" });
    expect(mintInstallationToken).not.toHaveBeenCalled();
  });

  it("mints a token for the connection's installation id, never a hardcoded one", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([])]);
    const pool = makePool(client);
    mockGithubResponses({});

    await detectVulnerabilitiesForProduct(pool, "product-1");

    expect(mintInstallationToken).toHaveBeenCalledWith("147237377");
  });

  it("requests per_page=100 on both alert endpoints", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([])]);
    const pool = makePool(client);
    const fetchMock = mockGithubResponses({});

    await detectVulnerabilitiesForProduct(pool, "product-1");

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/dependabot/alerts") && u.includes("per_page=100"))).toBe(
      true
    );
    expect(
      urls.some((u) => u.includes("/code-scanning/alerts") && u.includes("per_page=100"))
    ).toBe(true);
  });

  it("normalizes a Dependabot alert: fingerprint, direct severity, package-name title", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 7,
            dependency: { package: { name: "lodash" } },
            security_advisory: { summary: "Prototype pollution", severity: "high" },
            security_vulnerability: { severity: "critical" },
          },
        ],
      },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toMatchObject({
      detected: true,
      summary: { dependabot_alert_count: 1, findings_inserted: 1, findings_updated: 0 },
    });

    // finding upsert is call index 3 in the write txn (BEGIN, set_config,
    // signal_sources upsert, THEN the one finding upsert).
    const findingCall = vi.mocked(client.query).mock.calls[7];
    const params = findingCall[1] as unknown[];
    expect(params[3]).toBe("dependabot:7"); // fingerprint
    expect(params[2]).toBe("critical"); // severity: security_vulnerability.severity wins over security_advisory.severity
    expect(params[4]).toBe("lodash: Prototype pollution"); // title
  });

  it("falls back to security_advisory.severity when security_vulnerability.severity is missing", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 8,
            dependency: { package: { name: "left-pad" } },
            security_advisory: { summary: "ReDoS", severity: "medium" },
          },
        ],
      },
    });

    await detectVulnerabilitiesForProduct(pool, "product-1");
    const params = vi.mocked(client.query).mock.calls[7][1] as unknown[];
    expect(params[2]).toBe("medium");
  });

  it("prefers rule.security_severity_level for code-scanning alerts when present", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true])]);
    const pool = makePool(client);
    mockGithubResponses({
      codeScanning: {
        body: [
          {
            number: 3,
            rule: {
              id: "js/sql-injection",
              name: "SQL Injection",
              severity: "error",
              security_severity_level: "critical",
            },
            most_recent_instance: { message: { text: "Untrusted input flows into a query" } },
          },
        ],
      },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toMatchObject({ summary: { code_scanning_alert_count: 1 } });

    const params = vi.mocked(client.query).mock.calls[7][1] as unknown[];
    expect(params[3]).toBe("code-scanning:3"); // fingerprint
    expect(params[2]).toBe("critical"); // security_severity_level wins over the error->high ordinal mapping
    expect(params[4]).toBe("SQL Injection: Untrusted input flows into a query");
  });

  it("maps CodeQL's ordinal severity scale when security_severity_level is absent", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true, true, true])]);
    const pool = makePool(client);
    mockGithubResponses({
      codeScanning: {
        body: [
          { number: 10, rule: { id: "r1", severity: "error" } },
          { number: 11, rule: { id: "r2", severity: "warning" } },
          { number: 12, rule: { id: "r3", severity: "note" } },
        ],
      },
    });

    await detectVulnerabilitiesForProduct(pool, "product-1");
    const calls = vi.mocked(client.query).mock.calls.slice(7, 10);
    expect((calls[0][1] as unknown[])[2]).toBe("high"); // error -> high
    expect((calls[1][1] as unknown[])[2]).toBe("medium"); // warning -> medium
    expect((calls[2][1] as unknown[])[2]).toBe("low"); // note -> low
  });

  it("treats a 404 on code-scanning alerts as zero results when the body confirms it's disabled", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 1,
            dependency: { package: { name: "pkg" } },
            security_advisory: { severity: "low" },
          },
        ],
      },
      codeScanning: { status: 404, errorText: CODE_SCANNING_DISABLED_BODY },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toMatchObject({
      detected: true,
      summary: {
        code_scanning_alert_count: 0,
        code_scanning_error: null,
        dependabot_alert_count: 1,
        findings_inserted: 1,
      },
    });
  });

  it("treats a 403 on code-scanning alerts as zero results when the body confirms it's disabled (the real GitHub shape)", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([])]);
    const pool = makePool(client);
    mockGithubResponses({
      codeScanning: { status: 403, errorText: CODE_SCANNING_DISABLED_BODY },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toMatchObject({
      detected: true,
      summary: { code_scanning_alert_count: 0, code_scanning_error: null },
    });
  });

  it("propagates a 403 on code-scanning alerts as a real error when the body does NOT confirm it's disabled (e.g. rate limit / permission denied)", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 20,
            dependency: { package: { name: "pkg" } },
            security_advisory: { severity: "low" },
          },
        ],
      },
      codeScanning: {
        status: 403,
        errorText: JSON.stringify({ message: "API rate limit exceeded for installation." }),
      },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    // Must NOT be swallowed as zero results — Dependabot's real results
    // still land, but code_scanning_error is populated, not null, and
    // code_scanning_alert_count stays 0 because nothing was actually
    // fetched successfully (this is the pre-fix bug: the old code returned
    // this exact shape as a false-clean run, `code_scanning_error: null`).
    expect(result).toMatchObject({
      detected: true,
      summary: {
        dependabot_alert_count: 1,
        findings_inserted: 1,
        code_scanning_alert_count: 0,
      },
    });
    if ("detected" in result) {
      expect(result.summary.code_scanning_error).not.toBeNull();
      expect(result.summary.code_scanning_error).toMatch(/403/);
    }
  });

  it("propagates a 404 on code-scanning alerts as a real error when the body does NOT confirm it's disabled (e.g. repo not found)", async () => {
    const client = makeClient(fetchTxn(CONNECTION_ROW));
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: { status: 500 },
      codeScanning: {
        status: 404,
        errorText: JSON.stringify({ message: "Not Found" }),
      },
    });

    // Both fetches fail here (dependabot 500, code-scanning 404-but-not-
    // disabled) — the function throws for Inngest retry, same as the
    // existing "both alert fetches failed" case.
    await expect(detectVulnerabilitiesForProduct(pool, "product-1")).rejects.toThrow(
      "Both alert fetches failed"
    );
  });

  it("keeps Dependabot results when code-scanning fails with a real (non-404/403) error", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 2,
            dependency: { package: { name: "pkg" } },
            security_advisory: { severity: "low" },
          },
        ],
      },
      codeScanning: { status: 500 },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toMatchObject({
      detected: true,
      summary: { dependabot_alert_count: 1, findings_inserted: 1 },
    });
    if ("detected" in result) {
      expect(result.summary.code_scanning_error).toMatch(/500/);
    }
  });

  it("keeps code-scanning results when Dependabot fails", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: { status: 500 },
      codeScanning: { body: [{ number: 9, rule: { id: "r9", severity: "error" } }] },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toMatchObject({
      detected: true,
      summary: { code_scanning_alert_count: 1, findings_inserted: 1 },
    });
    if ("detected" in result) {
      expect(result.summary.dependabot_error).toMatch(/500/);
    }
  });

  it("throws (for Inngest retry) when BOTH alert fetches fail, and writes nothing", async () => {
    const client = makeClient(fetchTxn(CONNECTION_ROW));
    const pool = makePool(client);
    mockGithubResponses({ dependabot: { status: 500 }, codeScanning: { status: 500 } });

    await expect(detectVulnerabilitiesForProduct(pool, "product-1")).rejects.toThrow(
      "Both alert fetches failed"
    );
    // Only the fetch txn's 4 calls should have run — no write txn attempted.
    expect(vi.mocked(client.query).mock.calls.length).toBe(4);
  });

  it("upserts the findings row via ON CONFLICT (product_id, fingerprint) without touching `state`", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([false])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 4,
            dependency: { package: { name: "pkg" } },
            security_advisory: { severity: "low" },
          },
        ],
      },
    });

    await detectVulnerabilitiesForProduct(pool, "product-1");

    const findingCall = vi.mocked(client.query).mock.calls[7];
    const sql = String(findingCall[0]);
    expect(sql).toMatch(/ON CONFLICT \(product_id, fingerprint\) DO UPDATE SET/);
    // The DO UPDATE clause must refresh data fields only — `state` must never
    // appear as a SET target, or a human-dismissed finding would silently
    // flip back to 'detected' on re-detection.
    const setClauseMatch = sql.match(/DO UPDATE SET([\s\S]*?)RETURNING/);
    expect(setClauseMatch).not.toBeNull();
    const setClause = setClauseMatch![1];
    expect(setClause).not.toMatch(/\bstate\s*=/);
    expect(setClause).toMatch(/source_id\s*=\s*EXCLUDED\.source_id/);
    expect(setClause).toMatch(/severity\s*=\s*EXCLUDED\.severity/);
    expect(setClause).toMatch(/title\s*=\s*EXCLUDED\.title/);
    expect(setClause).toMatch(/detail\s*=\s*EXCLUDED\.detail/);
  });

  it("creates-or-reuses the signal_sources row idempotently via ON CONFLICT (product_id, kind), gated on status = 'active'", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([])]);
    const pool = makePool(client);
    mockGithubResponses({});

    await detectVulnerabilitiesForProduct(pool, "product-1");

    // signal_sources upsert is write-txn call index 2 (BEGIN=4, set_config=5, upsert=6).
    const sourceCall = vi.mocked(client.query).mock.calls[6];
    const sql = String(sourceCall[0]);
    expect(sql).toMatch(/INSERT INTO signal_sources/);
    expect(sql).toMatch(/ON CONFLICT \(product_id, kind\) DO UPDATE/);
    // 'security_events' is a SQL literal in the VALUES clause, not a bound
    // parameter — only product_id is passed positionally.
    expect(sql).toMatch(/VALUES \(\$1, 'security_events'\)/);
    // The DO UPDATE branch must only match an active row — a suspended
    // source must never return an id via this upsert (CodeRabbit PR #543
    // finding). Without this WHERE clause, a suspended source's row would
    // satisfy the conflict and RETURNING would hand back its id like any
    // other reusable source.
    expect(sql).toMatch(/WHERE signal_sources\.status = 'active'/);
    const params = sourceCall[1] as unknown[];
    expect(params).toEqual(["product-1"]);
  });

  it("skips cleanly with source_suspended and writes nothing when the existing signal_sources row is suspended", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...suspendedSourceWriteTxn()]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 30,
            dependency: { package: { name: "pkg" } },
            security_advisory: { severity: "low" },
          },
        ],
      },
    });

    const result = await detectVulnerabilitiesForProduct(pool, "product-1");
    expect(result).toEqual({ skipped: true, reason: "source_suspended" });

    const calls = vi.mocked(client.query).mock.calls;
    // fetch txn (4 calls) + BEGIN, set_config, upsert (empty), ROLLBACK (4 calls) = 8 total.
    // No finding upsert and no audit_log write happened — the transaction
    // rolled back the moment the upsert came back empty, even though a
    // Dependabot alert was successfully fetched and would otherwise have
    // produced a finding.
    expect(calls.length).toBe(8);
    expect(String(calls[7][0])).toMatch(/ROLLBACK/);
    expect(calls.some((c) => String(c[0]).includes("INSERT INTO findings"))).toBe(false);
    expect(calls.some((c) => String(c[0]).includes("INSERT INTO audit_log"))).toBe(false);
  });

  it("writes an audit_log summary row with counts only, never raw alert payloads", async () => {
    const client = makeClient([...fetchTxn(CONNECTION_ROW), ...writeTxn([true, true])]);
    const pool = makePool(client);
    mockGithubResponses({
      dependabot: {
        body: [
          {
            number: 5,
            dependency: { package: { name: "pkg-a" } },
            security_advisory: { severity: "high" },
          },
        ],
      },
      codeScanning: { body: [{ number: 6, rule: { id: "r6", severity: "warning" } }] },
    });

    await detectVulnerabilitiesForProduct(pool, "product-1");

    const calls = vi.mocked(client.query).mock.calls;
    const auditCall = calls[calls.length - 2]; // ... upserts, audit INSERT, COMMIT
    const auditSql = String(auditCall[0]);
    expect(auditSql).toMatch(/INSERT INTO audit_log/);
    // actor/action/resource_type are literals in the SQL (same convention as
    // repo-inspect.ts), not bound params — only resource_id + payload are.
    expect(auditSql).toMatch(/'detection-agent'/);
    expect(auditSql).toMatch(/'vuln\.detect'/);
    const auditParams = auditCall[1] as unknown[];
    expect(auditParams[0]).toBe("conn-1"); // resource_id = connection.id
    const payload = JSON.parse(auditParams[1] as string);
    expect(payload).toEqual({
      product_id: "product-1",
      repo_full_name: "admin-nutshell/web-app-tns-06",
      dependabot_alert_count: 1,
      code_scanning_alert_count: 1,
      findings_inserted: 2,
      findings_updated: 0,
      dependabot_error: null,
      code_scanning_error: null,
    });
  });

  it("rejects a malformed repo_full_name before minting a token or writing anything", async () => {
    const malformedConnection = { ...CONNECTION_ROW, repo_full_name: "owner/../etc" };
    const client = makeClient(fetchTxn(malformedConnection));
    const pool = makePool(client);
    const mintCallsBefore = vi.mocked(mintInstallationToken).mock.calls.length;

    await expect(detectVulnerabilitiesForProduct(pool, "product-1")).rejects.toThrow(
      "Invalid repo_full_name shape"
    );
    expect(vi.mocked(mintInstallationToken).mock.calls.length).toBe(mintCallsBefore);
    expect(vi.mocked(client.query).mock.calls.length).toBe(4);
  });
});
