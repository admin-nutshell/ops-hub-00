import { loadScopeLabel } from "../lib/queries";

// Theme v2 note: the approved mockup (docs/design/ops-dashboard-mockup-v2-dark.html)
// shows a "status-pill" here reading e.g. "All systems nominal". This restyle
// intentionally does NOT add it — the mockup's pill is decorative sample
// data, and fabricating an "all nominal" label with no live signal behind it
// would violate this app's honesty-in-UI rules. A live version (aggregating
// getSystemHealth() from lib/health.ts, already used by SystemHealthPanel)
// is a reasonable fast-follow, but that's a data-fetching decision beyond a
// pure restyle — flagged for Tech Lead / PM rather than added here.
export async function TopBar() {
  let scope: Awaited<ReturnType<typeof loadScopeLabel>> | null = null;
  let loadError: unknown = null;
  try {
    scope = await loadScopeLabel();
  } catch (error) {
    loadError = error;
  }

  return (
    <div className="flex items-center justify-between gap-5 border-b border-border-soft pb-[22px]">
      <div className="flex items-center gap-[13px]">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-[9px] font-mono text-[13px] font-bold text-[#0a0d1a] shadow-[0_4px_14px_-4px_rgba(124,140,248,0.4)]"
          style={{ background: "linear-gradient(155deg, var(--color-accent), #4c56c9)" }}
        >
          OH
        </div>
        <div>
          <h1 className="text-[15.5px] font-[650] tracking-[0.01em]">Ops Hub</h1>
          <div className="mt-px font-mono text-[11.5px] tracking-[0.02em] text-text-faint">
            {loadError ? (
              "scope unavailable"
            ) : (
              <>
                {scope?.projectName} · {scope?.tenantName}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="text-right font-mono text-[11px] text-text-faint">
        Read-only console · Sprint 6 (T-59)
      </div>
    </div>
  );
}
