export function MetricCard({
  label,
  value,
  unit,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: React.ReactNode;
  tone?: "good" | "warn" | "critical" | "neutral";
}) {
  const valueColor =
    tone === "good"
      ? "text-good"
      : tone === "warn"
        ? "text-warn"
        : tone === "critical"
          ? "text-critical"
          : "text-text";

  return (
    <div
      className={`card-edge tone-${tone} flex flex-col gap-[11px] rounded-xl border border-border bg-surface px-[22px] pt-5 pb-[22px] shadow-card`}
    >
      <div className="flex items-center justify-between text-[10.5px] font-[650] tracking-[0.08em] text-text-faint uppercase">
        {label}
      </div>
      <div
        className={`flex items-baseline gap-[7px] font-mono text-[32px] font-semibold tracking-[-0.01em] tabular-nums ${valueColor}`}
      >
        {value}
        {unit ? <span className="text-[13px] font-medium text-text-muted">{unit}</span> : null}
      </div>
      {sub ? <div className="text-xs leading-[1.5] text-text-muted">{sub}</div> : null}
    </div>
  );
}
