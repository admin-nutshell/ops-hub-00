import { loadScopeLabel } from "../lib/queries";

export async function TopBar() {
  let scope: Awaited<ReturnType<typeof loadScopeLabel>> | null = null;
  let loadError: unknown = null;
  try {
    scope = await loadScopeLabel();
  } catch (error) {
    loadError = error;
  }

  return (
    <div className="flex items-center justify-between gap-5 border-b border-border-soft pb-5">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-[#3d7ab8] font-mono text-sm font-bold text-[#0b1017]">
          OH
        </div>
        <div>
          <h1 className="text-[15px] font-semibold">Ops Hub</h1>
          <div className="font-mono text-[11.5px] text-text-faint">
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
      <div className="text-right font-mono text-[11.5px] text-text-faint">
        Read-only console · Sprint 6 (T-59)
      </div>
    </div>
  );
}
