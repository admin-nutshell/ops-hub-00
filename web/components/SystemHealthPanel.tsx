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
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border-soft px-5 py-4">
        <h2 className="text-sm font-semibold">System health</h2>
      </div>
      <div>
        {services.map((s) => (
          <div
            key={s.name}
            className="flex items-center justify-between border-b border-border-soft px-5 py-3 text-[12.5px] last:border-none"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  s.status === "ok" ? "bg-good" : s.status === "degraded" ? "bg-critical" : "bg-text-faint"
                }`}
              />
              {s.name}
            </div>
            <div className="font-mono text-[11px] text-text-faint">{s.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
