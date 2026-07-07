// Per-widget error state. Every async server component that queries the DB
// wraps its query in try/catch and renders THIS instead of throwing — one
// failing query must show its own error, never take down the whole page.
// Sized and shadowed to match MetricCard so a failing pillar doesn't break
// the uniform look of the metric strip it sits in.
export function ErrorNote({ label, error }: { label: string; error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="flex flex-col gap-[5px] rounded-xl border border-critical/30 bg-critical/[0.12] p-5 text-sm shadow-card"
    >
      <span className="font-[650] text-critical">{label} failed to load</span>
      <span className="font-mono text-[11.5px] text-text-muted">{message.slice(0, 200)}</span>
    </div>
  );
}

// Honest "not wired up yet" / "no data yet" state — distinct from an error
// (amber, not red) so the founder can tell "nothing happened" apart from
// "broken." Used by eval-health (pending real gate) and, structurally,
// anywhere else a widget has no number to show yet.
export function PendingNote({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col gap-[5px] rounded-xl border border-warn/30 bg-warn/[0.12] p-5 text-sm shadow-card">
      <span className="text-sm font-[650] text-warn">{title}</span>
      <span className="text-text-muted">{message}</span>
    </div>
  );
}
