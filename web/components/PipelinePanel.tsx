import { loadPipelineStageCounts } from "../lib/queries";
import { ErrorNote } from "./ErrorNote";

const STAGES: {
  key: "new" | "triaged" | "responded" | "in_progress" | "resolved";
  label: string;
  color: string;
}[] = [
  { key: "new", label: "New", color: "bg-accent" },
  { key: "triaged", label: "Triaged", color: "bg-triaged-text" },
  { key: "responded", label: "Responded", color: "bg-good" },
  { key: "in_progress", label: "In progress", color: "bg-warn" },
  { key: "resolved", label: "Resolved", color: "bg-text-faint" },
];

export async function PipelinePanel() {
  let counts: Awaited<ReturnType<typeof loadPipelineStageCounts>>;
  try {
    counts = await loadPipelineStageCounts();
  } catch (error) {
    return <ErrorNote label="Pipeline" error={error} />;
  }

  const max = Math.max(1, ...STAGES.map((s) => counts[s.key]));

  return (
    <div className="flex flex-col gap-[13px] rounded-xl border border-border bg-surface px-[22px] pt-[19px] pb-[22px] shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-[650]">Pipeline</h2>
        <span className="font-mono text-xs text-text-faint">all tickets</span>
      </div>
      {STAGES.map((s) => {
        const count = counts[s.key];
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className="w-[88px] shrink-0 text-[11.5px] font-medium text-text-muted">
              {s.label}
            </div>
            <div className="h-[7px] flex-1 overflow-hidden rounded bg-surface-raised">
              <div
                className={`h-full rounded ${s.color}`}
                style={{ width: `${Math.round((count / max) * 100)}%` }}
              />
            </div>
            <div className="w-[30px] text-right font-mono text-[12.5px] font-[650] tabular-nums">
              {count}
            </div>
          </div>
        );
      })}
    </div>
  );
}
