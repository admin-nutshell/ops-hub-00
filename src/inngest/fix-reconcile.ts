import AdmZip from "adm-zip";
import { Pool } from "pg";
import { inngest } from "./client";
import { createLazyPool } from "./utils";
import { githubHeaders } from "../github/appAuth";

// S3 of the ops-hub reboot — fix-reconcile.
//
// fix-author-agent (fix-author.ts) dispatches s3-fix-sandbox.yml and returns
// immediately — it does not poll the sandbox run to completion (see that
// file's header for why: workflow_dispatch's own API returns HTTP 204 with
// no run id, and holding an Inngest step open for the sandbox job's full
// 20-minute timeout would be a different execution model than every other
// function in this reboot). This cron is the "separate reconciliation
// mechanism" that file's header promises: it finds each 'pending'/'running'
// fix_attempts row's actual sandbox run (by the fix_attempt_id/run-name
// correlation added in PR #559), reads its outcome, and resolves the row to
// 'completed'/'failed' + sandbox_run_id + diff_ref.
//
// THE TWO REQUIREMENTS FROM THE SECURITY LEAD REVIEW THAT SHAPED THIS FILE
// (fix-author.ts's header records them; restated here against the actual
// implementation):
// (1) sweep 'pending' as well as 'running' — a crash between fix-author's
// write-transaction commit and the dispatch call (or between a successful
// dispatch and markDispatchOutcome's own commit) leaves a real 'pending' row
// that may or may not have a run behind it. This file does not special-case
// on status at all: both 'pending' and 'running' rows are looked up by the
// SAME run-name search, because the search result (found-and-completed,
// found-and-still-running, or not-found) is what actually determines the
// right outcome, not whichever status happened to be recorded at crash time.
// (2) do not trust run-name matching alone. `fix_attempt_id` is not an
// authenticated channel — workflow_dispatch (including its manual UI) lets
// anyone able to dispatch this workflow supply an arbitrary value. This file
// treats a run-name match as a LOOKUP aid only, never as identity: before
// resolving anything, it re-reads results.json from the run's own artifact
// and checks the fix_attempt_id echoed there still matches. IMPORTANT — this
// is NOT a spoofing defense (a party able to spoof run-name can just as
// easily set the same value in the patch it dispatches, since results.json's
// fix_attempt_id is itself only an echo of the workflow_dispatch input, not
// independently derived). What this check actually buys: a guard against an
// ACCIDENTAL run-name collision (two attempts racing to the same id space,
// or a stale/manual test run reusing an id), combined with only reading
// runs of this exact workflow file in the first place. The real boundary
// against a hostile dispatch is that only holders of
// GITHUB_STATUS_DISPATCH_TOKEN (or a repo-write GitHub identity) can call
// workflow_dispatch at all — same trust boundary as any other repo secret.
//
// A THIRD THING results.json IS NOT A DEFENSE AGAINST (Security Lead review,
// this PR): the sandbox job's own `sandbox` job runs the AI-authored,
// untrusted-content-derived patch (npm ci / build / lint / test) in the SAME
// job, same VM, same user as the later steps that write and upload
// results.json. GitHub Actions does not kill background processes between
// steps of one job — a malicious/prompt-injected patch could background a
// process that overwrites results.json after the legitimate write step, or
// interferes with it, before upload. This file's status resolution is
// therefore an ADVISORY signal, forgeable from inside the sandbox itself —
// NOT a trust boundary. The authoritative gates for a fix remain (per the
// reboot plan) the product repo's own real CI and a human opening/reviewing/
// merging the draft PR; this reconciliation mechanism's job is triage
// (which attempts are even worth a human looking at), not a security
// verdict. A follow-up (not this PR) could derive build/lint/test outcomes
// from GitHub's jobs API (control-plane data, not runner-writable) instead
// of trusting the artifact's own content — raises the bar from "write a
// file" to "compromise the runner agent," though full tamper-proofing from
// inside a VM running untrusted code is impossible in principle regardless.
//
// WHY A SECOND, FLAT ARTIFACT (`sandbox-results-summary`): the existing
// `sandbox-results` artifact is a GitHub-Actions zip wrapping a single
// `sandbox-results.tar.gz` file (diff + logs + results.json) — a human
// inspects it via the Actions UI. Parsing that from code would need both a
// zip reader AND a tar+gzip reader for a result this file only needs one
// field out of (results.json). s3-fix-sandbox.yml (PR after #560) now also
// uploads results.json alone as `sandbox-results-summary` — still one zip
// layer (GitHub always zips an uploaded artifact), never a tar layer. This
// file depends on `adm-zip` for that one layer only.
//
// PRODUCT ENUMERATION (a real RLS constraint, not a style choice): every
// product-scoped table (fix_attempts included) is fail-closed under RLS via
// a transaction-local `app.current_product` GUC — see
// 20260718120200_s3_fix_attempts_pull_requests_rls_policies.sql. There is no
// "list all products" query available to `ops_hub_app` (only service_role,
// which no agent holds at runtime, bypasses RLS that way — see
// 20260717120100_s1_product_domain_rls_policies.sql's own comment on this).
// So this cron cannot discover which products exist; it must be told, via
// RECONCILE_PRODUCT_IDS (comma-separated), same shape and same single-pilot
// default as the dashboard's own DASHBOARD_PRODUCT_ID (web/lib/project.ts) —
// config-only to widen when S6 onboards a second product, no code change.
//
// EXACTLY-ONE-ENVIRONMENT GATE: ops-hub-staging and ops-hub-prod share one
// Supabase database and would both try to reconcile the same rows and make
// the same duplicate GitHub API calls if both ran this cron — same fail-
// closed-by-default reasoning as agent-cost-sync.ts's AGENT_COST_SYNC_ENABLED
// gate. FIX_RECONCILE_ENABLED must be set to "true" on exactly one
// environment's Coolify env vars.
//
// NEVER LOGS RAW DIFF/LOG CONTENT: every audit_log payload here is metadata
// only (outcome, run id, reason strings) — same discipline as fix-author.ts.

const OPS_HUB_REPO_OWNER = "admin-nutshell";
const OPS_HUB_REPO_NAME = "ops-hub-00";
const SANDBOX_WORKFLOW_FILE = "s3-fix-sandbox.yml";
const GITHUB_API_TIMEOUT_MS = 15_000;
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;

// Same pilot product id as web/lib/project.ts's DASHBOARD_PRODUCT_ID default
// — this cron and the dashboard trigger both default to the one pilot
// product until S6 onboards a second one.
const DEFAULT_RECONCILE_PRODUCT_IDS = "8bafa6a6-4d80-4983-89bc-e536d3dba672";

// Don't touch anything younger than this — avoids racing fix-author's own
// same-invocation dispatch (its dispatch call has a 15s timeout; 2 minutes
// is a generous multiple of that with room for markDispatchOutcome's own
// small commit).
const RECONCILE_GRACE_MS = 2 * 60 * 1000;

// Past this age with no resolution, treat a candidate as abandoned rather
// than keep waiting: the sandbox job's own timeout-minutes is 20, the
// checkout job's is 15, and they run sequentially (needs: checkout) — 45
// minutes leaves real headroom for GH Actions queueing delay on top of both
// jobs' worst case, so a false "abandoned" verdict on a merely-slow-to-start
// run is unlikely. Erring toward "skip, try again next tick" over "fail" is
// deliberate: a wrongly-failed attempt is a worse outcome than one more
// 5-minute wait.
const RECONCILE_ABANDON_MS = 45 * 60 * 1000;

const RECONCILE_BATCH_SIZE = 20;

function getReconcileProductIds(): string[] {
  const raw = process.env.RECONCILE_PRODUCT_IDS ?? DEFAULT_RECONCILE_PRODUCT_IDS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const _opsPool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
export function getPool(): Pool {
  return _opsPool.get();
}
export function _resetPool(mock?: Pool): void {
  _opsPool.reset(mock);
}

export type CandidateAttempt = {
  id: string;
  product_id: string;
  created_at: string;
};

// Cheap read: candidates a product's fix_attempts currently has stuck at
// 'pending'/'running', past the grace window. Read-only — no FOR UPDATE
// needed here (the resolving UPDATE below re-checks status itself, so a
// stale read here just means "skip this tick, retry next" at worst).
export async function fetchCandidates(pool: Pool, productId: string): Promise<CandidateAttempt[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_product', $1, true)", [productId]);
    const result = await client.query(
      `SELECT id, created_at FROM fix_attempts
       WHERE status IN ('pending', 'running')
         AND created_at < now() - make_interval(secs => $1)
       ORDER BY created_at ASC
       LIMIT $2`,
      [RECONCILE_GRACE_MS / 1000, RECONCILE_BATCH_SIZE]
    );
    await client.query("COMMIT");
    return result.rows.map((r) => ({
      id: String(r.id),
      product_id: productId,
      created_at: String(r.created_at),
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

type GhRun = {
  id: number;
  status: string | null; // "queued" | "in_progress" | "completed" | ...
  conclusion: string | null;
  display_title: string;
};

type GhArtifact = {
  id: number;
  name: string;
  size_in_bytes: number;
};

// The real results.json is ~200 bytes. 64KB is generous headroom while still
// rejecting a decompression-bomb-style artifact well before it's downloaded
// or decompressed — see fetchSandboxResults for the two checks this caps
// (the artifact's own reported size, then the zip entry's declared
// uncompressed size, checked before AdmZip actually inflates it).
const MAX_RESULTS_ARTIFACT_BYTES = 64 * 1024;

function requireDispatchToken(): string {
  const token = process.env.GITHUB_STATUS_DISPATCH_TOKEN;
  if (!token) {
    throw new Error("GITHUB_STATUS_DISPATCH_TOKEN not configured");
  }
  return token;
}

// Fetches recent sandbox-workflow runs ONCE per tick (not once per
// candidate) — every candidate this tick is matched against the same list in
// memory, which keeps GitHub API usage to O(1) calls per tick regardless of
// batch size.
export async function listRecentSandboxRuns(): Promise<GhRun[]> {
  const token = requireDispatchToken();
  const url = new URL(
    `https://api.github.com/repos/${OPS_HUB_REPO_OWNER}/${OPS_HUB_REPO_NAME}/actions/workflows/${SANDBOX_WORKFLOW_FILE}/runs`
  );
  url.searchParams.set("event", "workflow_dispatch");
  url.searchParams.set("per_page", "50");

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    headers: githubHeaders(token),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub list runs ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { workflow_runs?: GhRun[] };
  return json.workflow_runs ?? [];
}

// Matches by UUID substring, not exact equality against the full run-name
// string — robust to however GitHub renders the em-dash/whitespace in
// run-name, since only the id substring itself is load-bearing for lookup
// (see the file header on why this is a lookup aid, not an auth boundary).
export function findMatchingRuns(runs: GhRun[], fixAttemptId: string): GhRun[] {
  return runs.filter(
    (r) => typeof r.display_title === "string" && r.display_title.includes(fixAttemptId)
  );
}

type SandboxResults = {
  fix_attempt_id: string;
  build_outcome: string;
  lint_outcome: string;
  test_outcome: string;
  // A JSON STRING "true"/"false", NOT a boolean — s3-fix-sandbox.yml's
  // results.json step wraps this field's GitHub-expression in quotes
  // (`"test_skipped": "${{ ... }}"`), unlike egress_canary_blocked below
  // (no quotes — a real JSON boolean literal). Get this backwards and every
  // test-skipped attempt (the pilot repo defines no test script) reads as
  // build-only-outcome instead of a legitimate pass.
  test_skipped: string;
  egress_canary_blocked: boolean;
};

function isSandboxResults(v: unknown): v is SandboxResults {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.fix_attempt_id === "string" &&
    typeof r.build_outcome === "string" &&
    typeof r.lint_outcome === "string" &&
    typeof r.test_outcome === "string" &&
    typeof r.test_skipped === "string" &&
    typeof r.egress_canary_blocked === "boolean"
  );
}

// Downloads the flat sandbox-results-summary artifact (one zip layer, see
// file header) and parses results.json out of it. Returns null if the run
// completed with no such artifact (e.g. it failed before the results-writing
// step ever ran — a legitimate "no result to reconcile from" case, not an
// error), if the artifact/entry is larger than expected (a possible
// decompression-bomb-style artifact — see MAX_RESULTS_ARTIFACT_BYTES; the
// sandbox runs untrusted, AI-authored code and could in principle try to
// substitute a hostile artifact, same threat class as the file header's
// forgeability note), or if the entry doesn't parse as JSON at all.
export async function fetchSandboxResults(runId: number): Promise<SandboxResults | null> {
  const token = requireDispatchToken();
  const listResp = await fetch(
    `https://api.github.com/repos/${OPS_HUB_REPO_OWNER}/${OPS_HUB_REPO_NAME}/actions/runs/${runId}/artifacts`,
    { signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!listResp.ok) {
    const text = await listResp.text();
    throw new Error(`GitHub list artifacts ${listResp.status}: ${text.slice(0, 200)}`);
  }
  const listJson = (await listResp.json()) as { artifacts?: GhArtifact[] };
  const artifact = (listJson.artifacts ?? []).find((a) => a.name === "sandbox-results-summary");
  if (!artifact) return null;
  if (artifact.size_in_bytes > MAX_RESULTS_ARTIFACT_BYTES) return null;

  const zipResp = await fetch(
    `https://api.github.com/repos/${OPS_HUB_REPO_OWNER}/${OPS_HUB_REPO_NAME}/actions/artifacts/${artifact.id}/zip`,
    { signal: AbortSignal.timeout(ARTIFACT_DOWNLOAD_TIMEOUT_MS), headers: githubHeaders(token) }
  );
  if (!zipResp.ok) {
    const text = await zipResp.text();
    throw new Error(`GitHub download artifact ${zipResp.status}: ${text.slice(0, 200)}`);
  }
  const zipBuf = Buffer.from(await zipResp.arrayBuffer());
  const zip = new AdmZip(zipBuf);
  const entry = zip.getEntry("results.json");
  if (!entry) return null;
  // Declared uncompressed size, checked BEFORE getData() actually inflates
  // it — the whole point of this check is to never decompress an oversized
  // entry in the first place.
  if (entry.header.size > MAX_RESULTS_ARTIFACT_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(entry.getData().toString("utf8"));
    return isSandboxResults(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// success = build clean, lint clean, test either passed or was legitimately
// skipped (this pilot repo defines no test script — see s3-fix-sandbox.yml's
// own header), AND the egress canary actually confirmed blocking (a failed
// canary means the sandbox's core containment guarantee didn't hold this
// run, regardless of build/lint/test — never treated as a pass).
export function deriveOutcome(r: SandboxResults): "completed" | "failed" {
  const testOk = r.test_outcome === "success" || r.test_skipped === "true";
  const ok =
    r.build_outcome === "success" &&
    r.lint_outcome === "success" &&
    testOk &&
    r.egress_canary_blocked === true;
  return ok ? "completed" : "failed";
}

type Resolution =
  | { kind: "resolve"; status: "completed" | "failed"; sandboxRunId: string; diffRef: string }
  | { kind: "fail"; reason: string; sandboxRunId?: string }
  | { kind: "skip" };

// Pure decision function — given the matching runs for one candidate and its
// age, decides what to do. Kept separate from the actual GitHub artifact
// fetch (fetchSandboxResults) so this is unit-testable without a real fetch
// call for the found-runs-but-still-in-progress / zero-match / multi-match
// branches.
export function decideForCandidate(params: {
  candidate: CandidateAttempt;
  matches: GhRun[];
  nowMs: number;
}): { decision: "need-results"; run: GhRun } | { decision: "resolved"; resolution: Resolution } {
  const { candidate, matches, nowMs } = params;
  const ageMs = nowMs - new Date(candidate.created_at).getTime();
  const abandoned = ageMs > RECONCILE_ABANDON_MS;

  if (matches.length === 0) {
    if (abandoned) {
      return {
        decision: "resolved",
        resolution: { kind: "fail", reason: "no matching sandbox run found within abandon window" },
      };
    }
    return { decision: "resolved", resolution: { kind: "skip" } };
  }

  if (matches.length > 1) {
    return {
      decision: "resolved",
      resolution: {
        kind: "fail",
        reason: "multiple sandbox runs matched this fix_attempt_id (anomaly)",
      },
    };
  }

  const run = matches[0];
  if (run.status !== "completed") {
    if (abandoned) {
      return {
        decision: "resolved",
        resolution: {
          kind: "fail",
          reason: "matching run still not completed past abandon window",
        },
      };
    }
    return { decision: "resolved", resolution: { kind: "skip" } };
  }

  return { decision: "need-results", run };
}

// Product-scoped, conditional on current status (a no-op if another process
// already resolved this row — e.g. an overlapping reconciliation tick, or a
// human dismissal path added later). The audit_log insert is itself gated on
// the UPDATE's rowCount: if the conditional UPDATE matched zero rows, this
// resolution never actually applied, and writing an audit entry anyway would
// assert a state change that didn't happen — a real integrity problem for a
// platform whose audit trail is meant to be a truthful record of every
// autonomous action, not just of every attempt (Security Lead review, this
// PR).
async function resolveAttempt(
  pool: Pool,
  candidate: CandidateAttempt,
  resolution: Extract<Resolution, { kind: "resolve" }> | Extract<Resolution, { kind: "fail" }>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_product', $1, true)", [
      candidate.product_id,
    ]);

    if (resolution.kind === "resolve") {
      const updateResult = await client.query(
        `UPDATE fix_attempts
         SET status = $1, sandbox_run_id = $2, diff_ref = $3, updated_at = now()
         WHERE id = $4 AND product_id = $5 AND status IN ('pending', 'running')`,
        [
          resolution.status,
          resolution.sandboxRunId,
          resolution.diffRef,
          candidate.id,
          candidate.product_id,
        ]
      );
      if (updateResult.rowCount) {
        await client.query(
          `INSERT INTO audit_log (actor, action, resource_type, resource_id, payload)
           VALUES ('fix-reconcile', 'fix.reconcile', 'fix_attempt', $1, $2)`,
          [
            candidate.id,
            JSON.stringify({
              product_id: candidate.product_id,
              outcome: resolution.status,
              sandbox_run_id: resolution.sandboxRunId,
            }),
          ]
        );
      }
    } else {
      const updateResult = await client.query(
        `UPDATE fix_attempts
         SET status = 'failed', sandbox_run_id = COALESCE($1, sandbox_run_id), updated_at = now()
         WHERE id = $2 AND product_id = $3 AND status IN ('pending', 'running')`,
        [resolution.sandboxRunId ?? null, candidate.id, candidate.product_id]
      );
      if (updateResult.rowCount) {
        await client.query(
          `INSERT INTO audit_log (actor, action, resource_type, resource_id, payload)
           VALUES ('fix-reconcile', 'fix.reconcile.anomaly', 'fix_attempt', $1, $2)`,
          [
            candidate.id,
            JSON.stringify({ product_id: candidate.product_id, reason: resolution.reason }),
          ]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function reconcileOnce(
  pool: Pool
): Promise<{ resolved: number; skipped: number; errored: number }> {
  const productIds = getReconcileProductIds();
  const candidates: CandidateAttempt[] = [];
  for (const productId of productIds) {
    candidates.push(...(await fetchCandidates(pool, productId)));
  }
  if (candidates.length === 0) {
    return { resolved: 0, skipped: 0, errored: 0 };
  }

  const runs = await listRecentSandboxRuns();
  const nowMs = Date.now();
  let resolved = 0;
  let skipped = 0;
  let errored = 0;

  // Each candidate is isolated in its own try/catch: one candidate hitting a
  // transient GitHub API error (or, before the JSON.parse guard above
  // existed, a malformed artifact) must never abort the rest of the sweep —
  // an unhandled throw here previously took down every other candidate AND
  // every other configured product for the remainder of this tick (Security
  // Lead review, this PR). An errored candidate is simply left unresolved —
  // it's still 'pending'/'running' in the DB and will be re-evaluated next
  // tick, same as if this tick had never run for it at all.
  for (const candidate of candidates) {
    try {
      const matches = findMatchingRuns(runs, candidate.id);
      const decision = decideForCandidate({ candidate, matches, nowMs });

      if (decision.decision === "resolved") {
        if (decision.resolution.kind === "skip") {
          skipped++;
          continue;
        }
        await resolveAttempt(pool, candidate, decision.resolution);
        resolved++;
        continue;
      }

      // decision.decision === "need-results": the matched run completed;
      // fetch+parse its results artifact before deciding the final outcome.
      const results = await fetchSandboxResults(decision.run.id);
      if (!results) {
        await resolveAttempt(pool, candidate, {
          kind: "fail",
          reason: "sandbox run completed but no results artifact found",
          sandboxRunId: String(decision.run.id),
        });
        resolved++;
        continue;
      }
      if (results.fix_attempt_id !== candidate.id) {
        // Not a spoofing defense (see file header) — guards accidental
        // run-name collision only. This DOES resolve the attempt to
        // 'failed' (terminal, audited) rather than leaving it unresolved:
        // guessing which of two candidates a run actually belongs to would
        // be worse than treating an unattributable result as a failure and
        // letting a human/future attempt re-examine it via the audit trail.
        await resolveAttempt(pool, candidate, {
          kind: "fail",
          reason: `results.json fix_attempt_id mismatch (run ${decision.run.id})`,
          sandboxRunId: String(decision.run.id),
        });
        resolved++;
        continue;
      }

      const outcome = deriveOutcome(results);
      await resolveAttempt(pool, candidate, {
        kind: "resolve",
        status: outcome,
        sandboxRunId: String(decision.run.id),
        diffRef: `gha-run:${decision.run.id}`,
      });
      resolved++;
    } catch {
      errored++;
    }
  }

  return { resolved, skipped, errored };
}

type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

// Cron: every 5 minutes. See file header for the exactly-one-environment
// gate and why RECONCILE_PRODUCT_IDS must be set (defaults to the one pilot
// product). One step.run wrapping the whole sweep — same granularity as
// fix-author.ts's single "author-fix" step (a cron tick is naturally
// re-runnable and every DB write here is already conditional/idempotent, so
// there's no partial-progress case worth splitting into finer steps).
export const fixReconcile = inngest.createFunction(
  { id: "fix-reconcile", retries: 2, triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }: InngestCtx) => {
    if (process.env.FIX_RECONCILE_ENABLED !== "true") {
      return { resolved: 0, skipped: 0, errored: 0 };
    }
    return step.run("reconcile", () => reconcileOnce(getPool()));
  }
);
