import type { Pool } from "pg";
import { inngest } from "../inngest/client";
import { SettingsWriteError } from "./settingsWrite";
import type { Severity } from "../inngest/detect-vulnerabilities";

// Dashboard read + trigger surface for the product-domain reboot's S2
// vulnerability-findings feature (src/inngest/detect-vulnerabilities.ts).
// Same own-file convention as src/metrics/repoInspect.ts (S1's precedent) —
// product-scoped only, one GUC: app.current_product — and the same
// discipline: all SQL for this feature lives here, `web/` holds none of it;
// every read/write function takes an already-resolved scope, not raw
// request input.
//
// Read side backs `findings` (finding_type = 'vuln'; product-scoped,
// ops_hub_app-only, may not be migrated live yet — degrades to
// `schema_not_ready` rather than throwing, same convention as
// getRepoSnapshotView). Trigger side sends the
// `ops-hub/vuln.detect.requested` event that detect-vulnerabilities.ts
// listens for — it does NOT touch the database at all (the actual DB write
// happens later, inside that Inngest function, in its own transaction);
// this module's trigger path is nothing more than "ask Inngest Cloud to run
// the workflow."
//
// KNOWN GAP (flagged for the reviewer, not silently papered over):
// detect-vulnerabilitiesForProduct can return a discriminated `{ skipped:
// true, reason }` result (no active repo connection, or the product's
// signal_sources row is suspended) instead of writing anything. That result
// is only ever seen by the Inngest function's own return value / Inngest
// Cloud's run history — inngest.send() below is fire-and-forget and only
// confirms the event was ACCEPTED, never what the function that eventually
// consumes it returned. There is no DB row this dashboard can read at
// dispatch time to distinguish "detection ran and skipped" from "detection
// hasn't run yet" from "detection ran and found nothing" — the
// source_suspended skip path in particular rolls back its transaction
// before writing anything at all (see detect-vulnerabilities.ts), so there
// is no audit_log trace of it either. Surfacing a real skip signal to this
// dashboard would require changing the already-merged detection function to
// persist skip state somewhere durable — out of this module's scope, and a
// real product decision (does a skip deserve its own DB row?), not
// something to guess at here. Given that gap, this module deliberately never
// claims "0 vulnerabilities found" as if a clean scan were confirmed —
// see getVulnFindingsView's `ready` empty-list case and
// VulnFindingsPanel/VulnDetectTrigger's copy, which both say "no findings
// recorded yet" instead.

const UNDEFINED_TABLE = "42P01"; // Postgres SQLSTATE for undefined_table

function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

// ---------------------------------------------------------------------------
// Read: findings rows (finding_type = 'vuln') for one product, severity-then-
// recency ordered.
// ---------------------------------------------------------------------------

export type VulnFindingRow = {
  id: string;
  severity: Severity;
  title: string;
  packageName: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
};

export type VulnFindingsView =
  // findings hasn't been migrated live yet (see
  // supabase/migrations/20260717120000_s1_product_domain_schema.sql), or the
  // S2 signal_sources/findings.source_id migration that this feature's write
  // path depends on hasn't landed. Same "not ready" degrade as
  // RepoSnapshotView's schema_not_ready — never a crash.
  | { status: "schema_not_ready" }
  | { status: "ready"; findings: VulnFindingRow[]; latestUpdatedAt: string | null };

type FindingRow = {
  id: string;
  severity: Severity;
  title: string;
  package_name: string | null;
  state: string;
  created_at: string;
  updated_at: string;
};

// Bounded default — this is a dashboard summary panel, not a full triage
// queue export. Documented cap, not a silent truncation (same discipline as
// repo-inspect.ts's TREE_ENTRY_CAP / detect-vulnerabilities.ts's
// ALERTS_PER_PAGE).
const FINDINGS_LIMIT = 100;

/**
 * Read the vulnerability findings for one product, most-severe first
 * (critical > high > medium > low), most-recently-updated first within a
 * severity tier. Product-scoped via the same transaction-local
 * `app.current_product` GUC detect-vulnerabilities.ts sets before writing —
 * RLS (`findings_select`, `product_id = current_product_id()`) enforces this
 * can never return another product's rows even on a bug here.
 *
 * `packageName` is extracted server-side from `detail` (Dependabot alerts
 * carry it at `dependency.package.name`) rather than returning the raw
 * `detail` blob to the panel — `detail` is UNTRUSTED external content (see
 * the findings.detail column comment) and code-scanning alerts don't share
 * this same shape at all, so extracting just the one displayable field here
 * is both the "don't dump raw JSON" requirement and the safer choice.
 * `packageName` is null for code-scanning-sourced findings (and for any
 * Dependabot alert whose payload happens to omit the field) — the panel
 * renders that case by simply omitting the package chip, not as an error.
 *
 * `latestUpdatedAt` is computed separately (not from the LIMITed page) so a
 * product with more than `FINDINGS_LIMIT` findings still gets an accurate
 * "did a new detection run land" signal for VulnDetectTrigger's poll to
 * baseline on.
 */
export async function getVulnFindingsView(
  pool: Pool,
  productId: string
): Promise<VulnFindingsView> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_product', $1, true)", [productId]);

    let result: VulnFindingsView;
    try {
      const { rows } = await client.query<FindingRow>(
        `SELECT id, severity, title,
                detail -> 'dependency' -> 'package' ->> 'name' AS package_name,
                state, created_at::text, updated_at::text
           FROM findings
          WHERE product_id = $1 AND finding_type = 'vuln'
          ORDER BY CASE severity
                     WHEN 'critical' THEN 0
                     WHEN 'high'     THEN 1
                     WHEN 'medium'   THEN 2
                     WHEN 'low'      THEN 3
                     ELSE 4
                   END,
                   updated_at DESC
          LIMIT ${FINDINGS_LIMIT}`,
        [productId]
      );

      const { rows: latestRows } = await client.query<{ latest: string | null }>(
        `SELECT max(updated_at)::text AS latest
           FROM findings
          WHERE product_id = $1 AND finding_type = 'vuln'`,
        [productId]
      );

      result = {
        status: "ready",
        findings: rows.map((row) => ({
          id: row.id,
          severity: row.severity,
          title: row.title,
          packageName: row.package_name,
          state: row.state,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        latestUpdatedAt: latestRows[0]?.latest ?? null,
      };
    } catch (err) {
      if (!isUndefinedTable(err)) throw err;
      // findings doesn't exist yet in this environment — honest "not ready"
      // state, not a crash. See the schema_not_ready doc comment above.
      result = { status: "schema_not_ready" };
    }

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Trigger: dispatch ops-hub/vuln.detect.requested via the shared Inngest
// client (src/inngest/client.ts) — no DB access on this path at all.
// ---------------------------------------------------------------------------

// Reuses SettingsWriteError purely so web/lib/apiRoute.ts's existing
// errorResponse() can map this failure to a JSON response the same way it
// already maps every settings-write and RepoInspectDispatchError failure —
// one error-mapping code path for every POST route this dashboard has, not a
// second one invented for this feature.
export class VulnDetectDispatchError extends SettingsWriteError {
  constructor(message: string) {
    super(message, 503);
    this.name = "VulnDetectDispatchError";
  }
}

/**
 * Send the `ops-hub/vuln.detect.requested` event for one product.
 *
 * IMPORTANT — a successful dispatch here does NOT mean detection ran, and it
 * carries NO information about a `{ skipped: true, reason }` result from
 * detectVulnerabilitiesForProduct (see this module's KNOWN GAP note above).
 * `inngest.send()` only confirms Inngest Cloud accepted the event over HTTP.
 * The dashboard polls `findings`' latest `updated_at` afterward specifically
 * because dispatch success is not proof of completion — same discipline as
 * triggerRepoInspect (src/metrics/repoInspect.ts).
 *
 * Throws VulnDetectDispatchError (503) — not a raw 500 — if the SDK itself
 * refuses to send (e.g. INNGEST_EVENT_KEY unset in this process; see
 * triggerRepoInspect's doc comment for the full mechanism).
 */
export async function triggerVulnDetect(productId: string): Promise<{ dispatched: true }> {
  try {
    await inngest.send({ name: "ops-hub/vuln.detect.requested", data: { product_id: productId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new VulnDetectDispatchError(
      `Could not dispatch the vulnerability-detection event — is INNGEST_EVENT_KEY provisioned ` +
        `on the dashboard app? — ${message}`
    );
  }
  return { dispatched: true };
}
