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
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className={`flex items-baseline gap-1.5 font-mono text-3xl font-semibold ${valueColor}`}>
        {value}
        {unit ? <span className="text-sm font-medium text-text-muted">{unit}</span> : null}
      </div>
      {sub ? <div className="text-xs text-text-muted">{sub}</div> : null}
    </div>
  );
}
