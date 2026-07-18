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
  // Amber, not red — for an honest "still nothing to show, but nothing is
  // known to be broken either" state (e.g. src/components/RepoInspectTrigger.tsx's
  // poll-timeout copy). Distinct from "error": a red "error" implies this
  // component KNOWS something failed; "pending" means it genuinely doesn't
  // know yet. Same good/warn/critical semantic split ErrorNote/PendingNote
  // already use for reads (T-59) — this brings it to the write-feedback side.
  | { kind: "pending"; message: string }
  // `detail` is the server's own raw error message, shown underneath the
  // friendly headline whenever it differs from it — apiClient.ts's
  // friendlyWriteError collapses several distinct server error classes
  // (e.g. T-74's SchemaNotReadyError vs. ScopeUnavailableError are both
  // "503" and would otherwise both read as the same generic line even
  // though they mean different things). Never hide the real error — that's
  // the same "honesty over polish" rule this component exists to enforce.
  | { kind: "error"; message: string; detail?: string };

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

  if (state.kind === "pending") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-warn/30 bg-warn/[0.12] px-3 py-2 text-xs text-warn"
      >
        {state.message}
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col gap-1 rounded-lg border border-critical/30 bg-critical/[0.12] px-3 py-2 text-xs text-critical"
    >
      <span>{state.message}</span>
      {state.detail && state.detail !== state.message ? (
        <span className="font-mono text-[10.5px] text-critical/70">{state.detail}</span>
      ) : null}
    </div>
  );
}
