// Per-widget error state. Every async server component that queries the DB
// wraps its query in try/catch and renders THIS instead of throwing — one
// failing query must show its own error, never take down the whole page.
export function ErrorNote({ label, error }: { label: string; error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-xl border border-critical/40 bg-critical/10 p-5 text-sm"
    >
      <span className="font-semibold text-critical">{label} failed to load</span>
      <span className="font-mono text-xs text-text-muted">{message.slice(0, 200)}</span>
    </div>
  );
}

// Honest "not wired up yet" / "no data yet" state — distinct from an error.
// Used by eval-health (pending real gate) and platform-incidents (no writer
// wired yet) so the founder can tell "nothing happened" apart from "broken."
export function PendingNote({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-warn/40 bg-warn/10 p-5 text-sm">
      <span className="font-semibold text-warn">{title}</span>
      <span className="text-text-muted">{message}</span>
    </div>
  );
}
