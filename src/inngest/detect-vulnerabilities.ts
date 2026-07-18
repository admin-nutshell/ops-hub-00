import { Pool } from "pg";
import { inngest } from "./client";
import { createLazyPool } from "./utils";
import { mintInstallationToken, githubHeaders } from "../github/appAuth";
import { assertValidRepoFullName } from "./repo-inspect";

// S2 of the ops-hub reboot — vulnerability detection ONLY (bug detection via
// Sentry is deferred; no Sentry credential exists yet). Follows the exact
// fetch-txn -> network -> write-txn / GUC / audit shape of
// src/inngest/repo-inspect.ts (the S1 precedent), re-used rather than
// re-derived: same product-scoped repo_connections read, same
// never-cached-never-persisted installation token discipline (see
// src/github/appAuth.ts), same in-transaction audit_log summary-only row.
//
// Signal source: GitHub's OWN security alert APIs (Dependabot alerts +
// code-scanning alerts) against the repo the S1 GitHub App connection already
// covers (security_events: read scope already live, no new credential). This
// is deliberately NOT a separate `npm audit` runner — the pilot repo
// (web-app-tns-06) uses npm/package-lock.json, and Dependabot alerts already
// surface the same vulnerability signal npm audit would, so a second runner
// would be redundant. Out of scope for this task; see the S2 plan note.

type DetectEventData = { product_id: string };

type RepoConnectionRow = {
  id: string;
  github_installation_id: string; // bigint comes back as text from pg by default
  repo_full_name: string;
};

export type Severity = "critical" | "high" | "medium" | "low";
const SEVERITIES: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);

// Raw GitHub API shapes — deliberately loose/partial. The full raw object is
// what we store in findings.detail (UNTRUSTED external content, stored as
// DATA, never sanitized/stripped — see findings.detail's column comment), so
// these types only declare the fields normalization actually reads.
export type DependabotAlert = {
  number: number;
  dependency?: { package?: { name?: string; ecosystem?: string } };
  security_advisory?: { summary?: string; severity?: string };
  security_vulnerability?: { severity?: string };
  [key: string]: unknown;
};

export type CodeScanningAlert = {
  number: number;
  rule?: {
    id?: string;
    name?: string;
    description?: string;
    severity?: string; // CodeQL's own scale: none/note/warning/error — NOT our scale
    security_severity_level?: string; // optional CVSS-style critical/high/medium/low, when the tool provides it
  };
  most_recent_instance?: { message?: { text?: string } };
  [key: string]: unknown;
};

type NormalizedFinding = {
  fingerprint: string;
  severity: Severity;
  title: string;
  detail: unknown;
};

export type DetectResult =
  | { skipped: true; reason: string }
  | {
      detected: true;
      summary: {
        dependabot_alert_count: number;
        code_scanning_alert_count: number;
        findings_inserted: number;
        findings_updated: number;
        dependabot_error: string | null;
        code_scanning_error: string | null;
      };
    };

type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

const _opsPool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
export function getPool(): Pool {
  return _opsPool.get();
}
export function _resetPool(mock?: Pool): void {
  _opsPool.reset(mock);
}

const GITHUB_FETCH_TIMEOUT_MS = 20_000;
const TITLE_MAX_LEN = 200;
// GitHub's default page size is 30 — a detection function whose entire job is
// "don't miss vulnerabilities" must never silently cap at that. 100 is
// GitHub's own per-page maximum; the pilot repo is far below that, so no
// pagination loop is built this sprint (documented cap, not silently
// truncated — same discipline as repo-inspect.ts's TREE_ENTRY_CAP).
const ALERTS_PER_PAGE = 100;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function repoApiPath(repoFullName: string): string {
  const [owner, repo] = repoFullName.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

// --- Dependabot alerts -------------------------------------------------

async function fetchDependabotAlerts(
  repoFullName: string,
  token: string
): Promise<DependabotAlert[]> {
  const resp = await fetch(
    `https://api.github.com/repos/${repoApiPath(repoFullName)}/dependabot/alerts?state=open&per_page=${ALERTS_PER_PAGE}`,
    { signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub dependabot alerts fetch ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as DependabotAlert[];
}

// GitHub's own severity terms for Dependabot alerts already match our
// findings.severity enum directly (critical/high/medium/low) — no mapping
// table needed, just a defensive validate-and-default. Prefer
// security_vulnerability.severity (the specific affected version range this
// alert instance covers) over security_advisory.severity (the advisory's
// overall severity, which can span multiple ranges) — falls back to the
// advisory-level value if the vulnerability-level one is missing.
function mapDependabotSeverity(alert: DependabotAlert): Severity {
  const raw = (
    alert.security_vulnerability?.severity ??
    alert.security_advisory?.severity ??
    ""
  ).toLowerCase();
  if (SEVERITIES.has(raw)) return raw as Severity;
  // GitHub omitting severity entirely on a Dependabot alert is not expected
  // in practice; default to 'medium' (a conservative middle, not silently
  // 'low') rather than throwing and losing every other alert in the batch.
  return "medium";
}

function normalizeDependabotAlert(alert: DependabotAlert): NormalizedFinding {
  const pkgName = alert.dependency?.package?.name ?? "unknown-package";
  const summary = alert.security_advisory?.summary ?? "Dependabot alert";
  return {
    fingerprint: `dependabot:${alert.number}`,
    severity: mapDependabotSeverity(alert),
    title: truncate(`${pkgName}: ${summary}`, TITLE_MAX_LEN),
    detail: alert,
  };
}

// --- Code-scanning alerts -----------------------------------------------

async function fetchCodeScanningAlerts(
  repoFullName: string,
  token: string
): Promise<CodeScanningAlert[]> {
  const resp = await fetch(
    `https://api.github.com/repos/${repoApiPath(repoFullName)}/code-scanning/alerts?state=open&per_page=${ALERTS_PER_PAGE}`,
    { signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!resp.ok) {
    const text = await resp.text();
    // Code scanning is commonly not enabled on a repo at all (unlike
    // Dependabot alerts, which the S2 task confirms this App already has
    // access to). Confirmed live against the pilot repo
    // (admin-nutshell/web-app-tns-06): GitHub signals that specific case
    // with HTTP 403 (NOT 404 — no live case observed for that status) and a
    // JSON body whose `message` field reads "Code scanning is not enabled
    // for this repository...". That exact, body-verified case is the only
    // valid "zero results" — CodeRabbit correctly flagged that blindly
    // swallowing ANY 403/404 (rate limit, auth failure, wrong permissions,
    // a genuinely missing repo, etc.) as zero findings would mask a real
    // failure as a false-clean run. Every other status/body propagates as a
    // real error below, same discipline as the Dependabot path.
    if (resp.status === 403 || resp.status === 404) {
      let disabled = false;
      try {
        const body = JSON.parse(text) as { message?: string };
        disabled = /code scanning is not enabled/i.test(body.message ?? "");
      } catch {
        // Non-JSON body on a 403/404 is not the known "disabled" shape —
        // fall through and treat it as a real error below.
      }
      if (disabled) {
        return [];
      }
    }
    throw new Error(`GitHub code-scanning alerts fetch ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as CodeScanningAlert[];
}

// CodeQL's own `rule.severity` is an ordinal code-quality scale
// (none/note/warning/error), NOT a CVSS-style severity scale — it does not
// mean the same thing as findings.severity. Prefer
// `rule.security_severity_level` when the tool supplies it (CodeQL's own
// *security* queries often do — already critical/high/medium/low). Only fall
// back to mapping the ordinal scale when that field is absent, and treat that
// mapping as a documented, conservative approximation, not an equivalence:
// error -> high, warning -> medium, note/none -> low.
const CODEQL_ORDINAL_SEVERITY_MAP: Record<string, Severity> = {
  error: "high",
  warning: "medium",
  note: "low",
  none: "low",
};

function mapCodeScanningSeverity(alert: CodeScanningAlert): Severity {
  const level = alert.rule?.security_severity_level?.toLowerCase();
  if (level && SEVERITIES.has(level)) return level as Severity;
  const ordinal = alert.rule?.severity?.toLowerCase() ?? "";
  return CODEQL_ORDINAL_SEVERITY_MAP[ordinal] ?? "medium";
}

function normalizeCodeScanningAlert(alert: CodeScanningAlert): NormalizedFinding {
  const ruleName = alert.rule?.name ?? alert.rule?.id ?? "code-scanning-alert";
  const message =
    alert.most_recent_instance?.message?.text ?? alert.rule?.description ?? "Code scanning alert";
  return {
    fingerprint: `code-scanning:${alert.number}`,
    severity: mapCodeScanningSeverity(alert),
    title: truncate(`${ruleName}: ${message}`, TITLE_MAX_LEN),
    detail: alert,
  };
}

// Read the product's active repo connection, mint a fresh installation
// token, fetch Dependabot + code-scanning alerts (independently — a partial
// GitHub API failure on one must not lose results from the other), normalize
// into findings rows, and upsert them (create-or-reuse the signal_sources
// row, insert/update findings without ever clobbering a human-set `state`,
// write an audit_log summary) in one transaction.
export async function detectVulnerabilitiesForProduct(
  pool: Pool,
  productId: string
): Promise<DetectResult> {
  // 1. Read the product's active repo connection — identical read shape to
  // repo-inspect.ts's step 1 (product-scoped GUC, ops_hub_app-only table).
  const fetchClient = await pool.connect();
  let connection: RepoConnectionRow | null = null;
  try {
    await fetchClient.query("BEGIN");
    await fetchClient.query("SELECT set_config('app.current_product', $1, true)", [productId]);
    const { rows } = await fetchClient.query<RepoConnectionRow>(
      `SELECT id, github_installation_id::text, repo_full_name
       FROM repo_connections
       WHERE product_id = $1 AND status = 'active'
       LIMIT 1`,
      [productId]
    );
    await fetchClient.query("COMMIT");
    connection = rows[0] ?? null;
  } catch (err) {
    await fetchClient.query("ROLLBACK");
    throw err;
  } finally {
    fetchClient.release();
  }

  if (!connection) {
    return { skipped: true, reason: "no_active_repo_connection" };
  }

  // repo_full_name is DB-sourced but interpolated into GitHub API URLs below
  // — validate its shape before minting a token or making any network call.
  // Reused directly from repo-inspect.ts, not re-derived.
  assertValidRepoFullName(connection.repo_full_name);

  // 2. Mint a fresh installation token for THIS connection's installation id
  // — never cached, never persisted (see src/github/appAuth.ts).
  const { token } = await mintInstallationToken(connection.github_installation_id);

  // 3. Fetch both alert types INDEPENDENTLY. Decision: independent try/catch
  // per alert type, not a shared try/catch around both calls — a
  // code-scanning 403 (common: feature not enabled on the repo) must never
  // discard real Dependabot results, and vice versa. If BOTH fail, there is
  // nothing to write and no reason to believe the run is healthy — throw so
  // Inngest's retry (2x, below) kicks in, rather than silently succeeding
  // with zero findings.
  let dependabotAlerts: DependabotAlert[] = [];
  let dependabotError: string | null = null;
  try {
    dependabotAlerts = await fetchDependabotAlerts(connection.repo_full_name, token);
  } catch (err) {
    dependabotError = err instanceof Error ? err.message : String(err);
  }

  let codeScanningAlerts: CodeScanningAlert[] = [];
  let codeScanningError: string | null = null;
  try {
    codeScanningAlerts = await fetchCodeScanningAlerts(connection.repo_full_name, token);
  } catch (err) {
    codeScanningError = err instanceof Error ? err.message : String(err);
  }

  if (dependabotError !== null && codeScanningError !== null) {
    throw new Error(
      `Both alert fetches failed — dependabot: ${dependabotError}; code-scanning: ${codeScanningError}`
    );
  }

  const normalized: NormalizedFinding[] = [
    ...dependabotAlerts.map(normalizeDependabotAlert),
    ...codeScanningAlerts.map(normalizeCodeScanningAlert),
  ];

  // 4. Persist: create-or-reuse the signal_sources row for this product,
  // upsert every normalized finding against it (without clobbering `state`
  // on conflict — a human-triaged/dismissed finding must not silently flip
  // back to 'detected' just because detection re-ran), plus an
  // in-transaction audit_log summary row (counts only — NEVER the raw alert
  // payloads; Gap G6 convention, same as repo-inspect.ts).
  const writeClient = await pool.connect();
  let findingsInserted = 0;
  let findingsUpdated = 0;
  try {
    await writeClient.query("BEGIN");
    await writeClient.query("SELECT set_config('app.current_product', $1, true)", [productId]);

    // Idempotent create-or-reuse via a real upsert (unique(product_id, kind)
    // — see the schema migration's IDEMPOTENCY DESIGN note) rather than a
    // bare select-then-insert, which would race under Inngest retries. The
    // DO UPDATE branch is a no-op write (kind = its own current value) whose
    // only purpose is to make RETURNING id fire on the conflict path too —
    // ON CONFLICT DO NOTHING RETURNING would return no row at all here.
    //
    // The WHERE clause on the DO UPDATE branch gates this on the existing
    // row's status: a source is suspended via status (see the schema
    // migration's status check constraint), never hard-deleted, and a
    // suspended source must not silently keep being used to write findings.
    // When the existing (product_id, kind) row is suspended, the WHERE
    // condition is false, so Postgres neither inserts (conflict) nor
    // updates (WHERE false) — RETURNING yields zero rows. That is how the
    // suspended case is detected below; it is NOT an error path.
    const { rows: sourceRows } = await writeClient.query<{ id: string }>(
      `INSERT INTO signal_sources (product_id, kind)
       VALUES ($1, 'security_events')
       ON CONFLICT (product_id, kind) DO UPDATE SET kind = signal_sources.kind
       WHERE signal_sources.status = 'active'
       RETURNING id`,
      [productId]
    );
    if (sourceRows.length === 0) {
      // Existing source is suspended (or, in principle, some other row
      // vanished from under us mid-transaction) — skip cleanly rather than
      // writing findings against a source that isn't active. Roll back
      // (nothing else has been written yet) and return the same
      // discriminated skip shape the no-connection path already uses.
      await writeClient.query("ROLLBACK");
      return { skipped: true, reason: "source_suspended" };
    }
    const sourceId = sourceRows[0].id;

    for (const finding of normalized) {
      const { rows } = await writeClient.query<{ inserted: boolean }>(
        `INSERT INTO findings (product_id, source_id, finding_type, severity, fingerprint, title, detail)
         VALUES ($1, $2, 'vuln', $3, $4, $5, $6::jsonb)
         ON CONFLICT (product_id, fingerprint) DO UPDATE SET
           source_id = EXCLUDED.source_id,
           severity  = EXCLUDED.severity,
           title     = EXCLUDED.title,
           detail    = EXCLUDED.detail
         RETURNING (xmax = 0) AS inserted`,
        [
          productId,
          sourceId,
          finding.severity,
          finding.fingerprint,
          finding.title,
          JSON.stringify(finding.detail),
        ]
      );
      // NOTE: `state` is deliberately absent from the DO UPDATE SET clause
      // above — a finding a human already triaged/dismissed keeps its state
      // across re-detection; only the data fields refresh. `updated_at` is
      // also deliberately absent — the findings_set_updated_at trigger
      // (20260717120000) already stamps it on every UPDATE.
      if (rows[0]?.inserted) findingsInserted++;
      else findingsUpdated++;
    }

    await writeClient.query(
      `INSERT INTO audit_log (actor, action, resource_type, resource_id, payload)
       VALUES ('detection-agent', 'vuln.detect', 'repo_connection', $1, $2)`,
      [
        connection.id,
        JSON.stringify({
          product_id: productId,
          repo_full_name: connection.repo_full_name,
          dependabot_alert_count: dependabotAlerts.length,
          code_scanning_alert_count: codeScanningAlerts.length,
          findings_inserted: findingsInserted,
          findings_updated: findingsUpdated,
          dependabot_error: dependabotError,
          code_scanning_error: codeScanningError,
        }),
      ]
    );

    await writeClient.query("COMMIT");
  } catch (err) {
    await writeClient.query("ROLLBACK");
    throw err;
  } finally {
    writeClient.release();
  }

  return {
    detected: true,
    summary: {
      dependabot_alert_count: dependabotAlerts.length,
      code_scanning_alert_count: codeScanningAlerts.length,
      findings_inserted: findingsInserted,
      findings_updated: findingsUpdated,
      dependabot_error: dependabotError,
      code_scanning_error: codeScanningError,
    },
  };
}

// Event-driven: dispatched with { product_id } for the product whose
// connected repo should be scanned for vulnerabilities. No cron sweep in S2
// — one pilot product, dispatched deliberately, not on a schedule yet
// (mirrors repo-inspect.ts's S1 scope decision).
export const detectVulnerabilities = inngest.createFunction(
  {
    id: "detect-vulnerabilities",
    retries: 2,
    triggers: [{ event: "ops-hub/vuln.detect.requested" }],
  },
  async ({ event, step }: InngestCtx) => {
    const { product_id } = event.data as DetectEventData;
    return await step.run("detect-vulnerabilities", () =>
      detectVulnerabilitiesForProduct(getPool(), product_id)
    );
  }
);
