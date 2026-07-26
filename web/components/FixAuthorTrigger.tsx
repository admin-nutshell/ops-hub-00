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
// Shows the button for "detected", "triaged", or "fix_in_progress" —
// "fix_in_progress" was ADDED after the pipeline's first live runs
// (2026-07-24 through 2026-07-26): every one of the first 5 real attempts
// resolved to a TERMINAL fix_attempts status ('failed'), which advances
// findings.state to 'fix_in_progress' and leaves it there permanently — the
// original ELIGIBLE_FOR_IN_PROGRESS-mirroring set (detected/triaged only)
// then hid the button forever for every finding that had ever been tried
// once, even though the server has always permitted a retry: fix-author.ts's
// own TERMINAL_FINDING_STATES only blocks 'shipped'/'dismissed', and its
// separate in-flight-attempt guard only blocks a finding with a
// 'pending'/'running' row, not a terminal one. This was a client-side
// display gap, not a security boundary — the server-side authorization was
// already correct; the dashboard just wasn't reflecting it. Deliberately
// still excludes "pr_open" (an open real PR should never be casually
// re-authored against) and "reopened" (a distinct product-scope question,
// flagged in PR #571's Security Lead review, not decided yet — not the gap
// that was actually blocking real testing).
const ELIGIBLE_STATES = new Set(["detected", "triaged", "fix_in_progress"]);

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

  // KNOWN LIMITATION, disclosed rather than hidden: this poll's whole success
  // signal is "did findings.state change" — but fix-author.ts only ever
  // advances state FROM 'detected'/'triaged' TO 'fix_in_progress' (see its
  // own ELIGIBLE_FOR_IN_PROGRESS gate); nothing in this pipeline yet advances
  // state any further once it's already 'fix_in_progress' (draft-pr.ts/
  // fix-reconcile.ts never touch findings.state at all). So a click on an
  // already-fix_in_progress finding (the exact case this button now allows)
  // is only GUARANTEED to have the event ACCEPTED by Inngest — the handler
  // itself may still legitimately skip (an attempt already pending/running
  // for this finding, the finding vanishing/reaching a terminal state, or no
  // active repo connection, per authorFixForFinding's own re-checks) — and
  // even when it genuinely dispatches and runs, this component can never
  // observe a state change for it. Either way the poll always times out at
  // 90s, whether the click was a no-op skip or a real, successful retry.
  // That's a real gap in this pipeline (findings.state should eventually
  // reflect a completed attempt or an open PR too), not something this
  // component can paper over on its own — flagged for a future pass, not
  // fixed here.
  //
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
            "skipped (e.g. an attempt was already in progress, or no repo is connected), this " +
            "was a retry on a finding already past its first attempt (state can't advance " +
            "again from here — check the finding's actual result elsewhere, this isn't a sign " +
            "of failure), or this environment's backend isn't wired up for it yet. Reload the " +
            "page later to check again.",
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
