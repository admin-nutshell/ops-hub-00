export function CardSkeleton() {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 animate-pulse"
      role="status"
      aria-label="Loading metric"
    >
      <div className="h-3 w-24 rounded bg-surface-raised" />
      <div className="h-7 w-16 rounded bg-surface-raised" />
      <div className="h-3 w-32 rounded bg-surface-raised" />
    </div>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 animate-pulse"
      role="status"
      aria-label="Loading panel"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 w-full rounded bg-surface-raised" />
      ))}
    </div>
  );
}
