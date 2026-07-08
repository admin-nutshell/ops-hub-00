"use client";

// Shared write-feedback region for every settings form (T-75). Real
// success/error feedback, never an optimistic UI (ADR-0006 "honesty over
// polish", the same rule T-59's ErrorNote enforces for reads). Announced to
// assistive tech via aria-live — a color change alone is not accessible
// feedback (WCAG AA, this app's standing accessibility bar).
export type WriteStatusState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function WriteStatus({ state }: { state: WriteStatusState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "saving") {
    return (
      <div role="status" aria-live="polite" className="text-xs text-text-faint">
        Saving…
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-good/30 bg-good/[0.12] px-3 py-2 text-xs text-good"
      >
        {state.message}
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-lg border border-critical/30 bg-critical/[0.12] px-3 py-2 text-xs text-critical"
    >
      {state.message}
    </div>
  );
}
