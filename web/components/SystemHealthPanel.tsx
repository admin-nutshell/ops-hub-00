import { getSystemHealth } from "../lib/health";
import { ErrorNote } from "./ErrorNote";

export async function SystemHealthPanel() {
  let services: Awaited<ReturnType<typeof getSystemHealth>>;
  try {
    services = await getSystemHealth();
  } catch (error) {
    return <ErrorNote label="System health" error={error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border-soft px-[22px] py-[17px]">
        <h2 className="text-[13px] font-[650]">System health</h2>
      </div>
      <div>
        {services.map((s) => (
          <div
            key={s.name}
            className="flex items-center justify-between border-b border-border-soft px-[22px] py-[13px] text-[12.5px] last:border-none"
          >
            <div className="flex items-center gap-[9px]">
              <span
                className={`h-[7px] w-[7px] rounded-full ring-[3px] ${
                  s.status === "ok"
                    ? "bg-good ring-good/20"
                    : s.status === "degraded"
                      ? "bg-critical ring-critical/20"
                      : "bg-text-faint ring-text-faint/20"
                }`}
              />
              {s.name}
            </div>
            <div className="font-mono text-[11px] text-text-faint tabular-nums">{s.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
