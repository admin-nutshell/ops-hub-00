export function CardSkeleton() {
  return (
    <div
      className="flex flex-col gap-[10px] rounded-xl border border-border bg-surface p-5 shadow-card"
      role="status"
      aria-label="Loading metric"
    >
      <div className="skeleton-line h-[10px] w-2/5 rounded-[5px]" />
      <div className="skeleton-line h-[26px] w-16 rounded-[5px]" />
      <div className="skeleton-line h-[10px] w-4/5 rounded-[5px]" />
    </div>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="flex flex-col gap-[10px] rounded-xl border border-border bg-surface p-5 shadow-card"
      role="status"
      aria-label="Loading panel"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-line h-[10px] w-full rounded-[5px]" />
      ))}
    </div>
  );
}
