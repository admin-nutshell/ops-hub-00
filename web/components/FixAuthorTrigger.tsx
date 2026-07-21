"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postSettings, friendlyWriteError } from "../lib/apiClient";
import { WriteStatus, type WriteStatusState } from "./settings/WriteStatus";

// S3 of the ops-hub reboot — per-finding "Propose a fix" trigger. Same
// dispatch-then-poll idiom as VulnDetectTrigger (S2's precedent): a click
// posts to /api/fix-author/trigger, then polls via router.refresh() until
// THIS finding's own `state` column moves off its baseline value — the same
// honest "dispatch success != completion" signal discipline, applied at the
// single-row level instead of the whole-list level.
//
// Only shows the button for a finding whose state is "detected" or
// "triaged" — mirrors fix-author.ts's own ELIGIBLE_FOR_IN_PROGRESS set
// exactly (not re-derived independently). Any other state
// (fix_in_progress, pr_open, shipped, dismissed, reopened) renders nothing,
// since the backend would just skip a dispatch against it anyway
// (TERMINAL_FINDING_STATES, or an attempt already in progress) — no point
// offering a click that's a guaranteed no-op.
const ELIGIBLE_STATES = new Set(["detected", "triaged"]);

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // ~90s — same generous window as VulnDetectTrigger.

// friendlyWriteError's 503 branch assumes the T-72 settings-schema-not-applied
// cause — wrong for this route, same reasoning as VulnDetectTrigger's
// friendlyVulnDetectError. This route's 503s are either
// ProductScopeUnavailableError (DASHBOARD_PRODUCT_ID unset) or
// FixAuthorDispatchError (the Inngest SDK refused to send).
function friendlyFixAuthorError(status: number, error: string): string {
  if (status !== 503) return friendlyWriteError(status, error);
  if (error.includes("DASHBOARD_PRODUCT_ID")) {
    return "This dashboard isn't configured with a product to propose fixes for yet.";
  }
  return "The fix-author backend isn't connected in this environment yet — nothing's broken, it just hasn't been wired up.";
}

export function FixAuthorTrigger({ findingId, state }: { findingId: string; state: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<WriteStatusState>({ kind: "idle" });
  const [polling, setPolling] = useState(false);
  const pollCountRef = useRef(0);
  const baselineStateRef = useRef(state);

  // Fires on every re-render this component receives via router.refresh()
  // (VulnFindingsPanel re-renders the whole list server-side; React matches
  // this row's component instance by key, so it just receives a fresh
  // `state` prop). Stops polling the moment THIS finding's own state moves
  // past its baseline — the real "something happened to THIS finding"
  // signal, not just "some finding somewhere changed."
  useEffect(() => {
    if (!polling) return;
    if (state !== baselineStateRef.current) {
      setPolling(false);
      pollCountRef.current = 0;
      setStatus({ kind: "success", message: `Finding state advanced to "${state}".` });
    }
  }, [state, polling]);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current > POLL_MAX_ATTEMPTS) {
        setPolling(false);
        setStatus({
          kind: "pending",
          message:
            "Still no state change after 90s — this can mean authoring is still running, it " +
            "skipped (e.g. an attempt was already in progress, or no repo is connected), or this " +
            "environment's backend isn't wired up for it yet. Reload the page later to check again.",
        });
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [polling, router]);

  async function handleTrigger() {
    baselineStateRef.current = state;
    pollCountRef.current = 0;
    setStatus({ kind: "saving" });
    const result = await postSettings("/api/fix-author/trigger", { findingId });
    if (result.ok) {
      setPolling(true);
    } else {
      setStatus({
        kind: "error",
        message: friendlyFixAuthorError(result.status, result.error),
        detail: result.error,
      });
    }
  }

  // Once a click has happened, keep showing the status even if `state` has
  // since moved out of ELIGIBLE_STATES (that IS the success case) — only
  // hide the button entirely for a row nothing has ever been clicked on.
  if (!ELIGIBLE_STATES.has(state) && status.kind === "idle") {
    return null;
  }

  const busy = status.kind === "saving" || polling;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleTrigger}
        disabled={busy}
        className="rounded-md bg-surface-raised px-2.5 py-1 text-[11px] font-[600] text-text hover:bg-border-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {polling ? "Proposing…" : "Propose a fix"}
      </button>
      {polling ? (
        <div
          role="status"
          aria-live="polite"
          className="max-w-[220px] text-[10.5px] text-text-faint"
        >
          Waiting for state change — polling every few seconds…
        </div>
      ) : (
        <div className="max-w-[220px]">
          <WriteStatus state={status} />
        </div>
      )}
    </div>
  );
}
