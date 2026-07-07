import { loadPlatformIncidents } from "../lib/queries";
import { ErrorNote } from "./ErrorNote";

export async function PlatformIncidentsPanel() {
  let incidents: Awaited<ReturnType<typeof loadPlatformIncidents>>;
  try {
    incidents = await loadPlatformIncidents(20);
  } catch (error) {
    return <ErrorNote label="Platform incidents" error={error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border-soft px-[22px] py-[17px]">
        <h2 className="text-[13px] font-[650]">Platform incidents</h2>
        <span className="font-mono text-xs text-text-faint">infra, not ticket QA</span>
      </div>
      {incidents.length === 0 ? (
        <div className="px-[22px] py-5 text-[12.5px] leading-[1.6] text-text-muted">
          No platform incidents recorded in ops-hub&apos;s audit trail. The richer Cstate status
          feed (T-38) tracks real infra incidents today but isn&apos;t wired into this dashboard
          yet — this panel is real and empty, not a stub, until that feed is connected.
        </div>
      ) : (
        <div>
          {incidents.map((i) => (
            <div key={i.id} className="border-b border-border-soft px-[22px] py-3.5 last:border-none">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[12.5px] font-semibold">
                  {(i.payload.title as string | undefined) ?? i.action}
                </div>
                <div className="ml-2.5 shrink-0 font-mono text-[10.5px] text-text-faint">
                  {new Date(i.timestamp).toLocaleString()}
                </div>
              </div>
              {i.payload.description ? (
                <div className="text-xs leading-relaxed text-text-muted">
                  {i.payload.description as string}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
