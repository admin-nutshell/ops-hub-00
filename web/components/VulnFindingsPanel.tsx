import { loadVulnFindingsView } from "../lib/queries";
import { ErrorNote, PendingNote } from "./ErrorNote";
import { VulnDetectTrigger } from "./VulnDetectTrigger";
import { FixAuthorTrigger } from "./FixAuthorTrigger";
import { formatRelativeAge } from "../lib/format";
import type { Severity } from "../../src/inngest/detect-vulnerabilities";

// S2 of the ops-hub reboot's vulnerability-findings panel: dispatches a real
// GitHub App read (src/inngest/detect-vulnerabilities.ts, GitHub's own
// Dependabot + code-scanning alert APIs) and displays the findings it wrote
// to `findings` (finding_type = 'vuln'). Mirrors RepoInspectPanel's shape
// closely (same async Server Component + trigger-with-polling pattern) — see
// that file for the precedent.
//
// S3 adds the one per-finding action this file's own header used to say was
// deferred: an "Actions" column rendering FixAuthorTrigger, so a human can
// dispatch `ops-hub/fix.author.requested` for an eligible finding directly
// from here — this dashboard button was S3's missing entry point (see
// src/metrics/fixAuthor.ts's header for the full context on why nothing
// upstream of this panel could ever start a fix attempt without it).

const SEVERITY_BADGE: Record<Severity, string> = {
  // critical/high both read as "stand out" red — critical the strongest, high
  // a step down but still clearly alarmed, never confused with medium/low.
  critical: "bg-critical/[0.22] text-critical",
  high: "bg-critical/[0.11] text-critical",
  medium: "bg-warn/[0.14] text-warn",
  low: "bg-surface-raised text-text-faint",
};

// findings.state's full lifecycle (see the schema migration's check
// constraint) — every value gets a distinct, low-key chip color so the
// eventual triage workflow (a later sprint) has somewhere to land visually
// without another design pass.
const STATE_BADGE: Record<string, string> = {
  detected: "bg-accent/[0.14] text-accent-text",
  triaged: "bg-triaged/[0.13] text-triaged-text",
  fix_in_progress: "bg-warn/[0.12] text-warn",
  pr_open: "bg-triaged/[0.13] text-triaged-text",
  shipped: "bg-good/[0.12] text-good",
  dismissed: "bg-surface-raised text-text-faint",
  reopened: "bg-critical/[0.16] text-critical",
};

export async function VulnFindingsPanel() {
  let view: Awaited<ReturnType<typeof loadVulnFindingsView>>;
  try {
    view = await loadVulnFindingsView();
  } catch (error) {
    return <ErrorNote label="Vulnerability findings" error={error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex items-start justify-between gap-4 border-b border-border-soft px-[22px] py-[17px]">
        <div>
          <h2 className="text-[13px] font-[650]">Vulnerability findings (pilot)</h2>
          <p className="mt-1 max-w-[560px] text-xs text-text-muted">
            Sourced live from GitHub&apos;s own Dependabot and code-scanning alert APIs for the
            connected repo. A finding a human has already triaged or dismissed keeps that state
            across re-scans — re-scanning only refreshes severity/title/detail, never state.
          </p>
        </div>
        <VulnDetectTrigger view={view} />
      </div>

      {view.status === "schema_not_ready" ? (
        <div className="px-[22px] py-5">
          <PendingNote
            title="Not available in this environment yet"
            message="The product-domain / signal_sources+findings database migrations haven't been applied here yet. Once they are, this panel starts working with no code change."
          />
        </div>
      ) : view.findings.length === 0 ? (
        <div className="px-[22px] py-5 text-[12.5px] leading-[1.6] text-text-muted">
          No vulnerability findings recorded yet. This can mean a scan hasn&apos;t run, a scan ran
          and genuinely found nothing, or a scan skipped (e.g. no repo connected, or this
          product&apos;s detection source is suspended) — a dispatch confirms Inngest accepted the
          request, not which of those happened. Click &ldquo;Scan for vulnerabilities&rdquo; above
          to run a real scan.
        </div>
      ) : (
        <div
          tabIndex={0}
          aria-label="Vulnerability findings list"
          className="max-h-[460px] overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                {["Severity", "Finding", "State", "Detected", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="sticky top-0 border-b border-border-soft bg-surface px-[22px] py-[11px] text-left text-[10.5px] font-[650] tracking-[0.06em] text-text-faint uppercase whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.findings.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-border-soft last:border-none hover:bg-surface-raised"
                >
                  <td className="px-[22px] py-[13px] align-top">
                    <span
                      className={`inline-flex rounded-md px-2.5 py-[3px] text-[11px] font-[650] uppercase tracking-[0.04em] whitespace-nowrap ${SEVERITY_BADGE[f.severity] ?? "bg-surface-raised text-text-faint"}`}
                    >
                      {f.severity}
                    </span>
                  </td>
                  <td className="px-[22px] py-[13px] align-top">
                    <div className="text-[12.5px] text-text">{f.title}</div>
                    {f.packageName ? (
                      <div className="mt-0.5 font-mono text-[10.5px] text-text-faint">
                        {f.packageName}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-[22px] py-[13px] align-top">
                    <span
                      className={`inline-flex rounded-md px-2.5 py-[3px] text-[11px] font-[650] whitespace-nowrap ${STATE_BADGE[f.state] ?? "bg-surface-raised text-text-muted"}`}
                    >
                      {f.state}
                    </span>
                  </td>
                  <td className="px-[22px] py-[13px] align-top font-mono text-xs text-text-muted">
                    <span title={new Date(f.createdAt).toLocaleString()}>
                      {formatRelativeAge(f.createdAt)}
                    </span>
                  </td>
                  <td className="px-[22px] py-[13px] align-top">
                    <FixAuthorTrigger findingId={f.id} state={f.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
