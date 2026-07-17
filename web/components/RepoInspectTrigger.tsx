"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postSettings, friendlyWriteError } from "../lib/apiClient";
import { WriteStatus, type WriteStatusState } from "./settings/WriteStatus";
import type { RepoSnapshotView } from "../../src/metrics/repoInspect";

// Polls via router.refresh() (re-runs the hosting Server Component,
// including RepoInspectPanel's loadRepoSnapshotView call, and passes fresh
// props back down) rather than a separate GET/JSON polling endpoint — same
// "re-fetch through the server component" idiom this app already uses after
// a settings write (see FeatureFlagsList's router.refresh() call), just on a
// timer instead of a single post-submit call. Requires the hosting page to
// force dynamic rendering (see web/app/page.tsx's `export const dynamic`) —
// a statically-prerendered page would refresh but keep serving the same
// build-time snapshot.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // ~90s — generous for a live GitHub API round trip.

function fetchedAtOf(view: RepoSnapshotView): string | null {
  return view.status === "ready" ? view.fetchedAt : null;
}

// friendlyWriteError's 503 branch assumes the one cause it was written for —
// the T-72 settings schema not yet applied (true for the three settings
// write routes it's shared with: FeatureFlagsList/ModelRoutingForm/SlaForm).
// This route's 503s never come from that cause at all: they're either
// ProductScopeUnavailableError (DASHBOARD_PRODUCT_ID unset — see
// requireProductScope() in web/lib/writeQueries.ts) or
// RepoInspectDispatchError (the Inngest SDK refused to send — currently
// always this one in practice, since INNGEST_EVENT_KEY is not yet
// provisioned on the dashboard app; see triggerRepoInspect()'s doc comment
// in src/metrics/repoInspect.ts). Flattening both into the generic
// "migration hasn't been applied" line would actively mislead debugging —
// someone would go chasing a DB migration for what's really a missing env
// var. Map each to its own plain-language headline instead of either the
// wrong generic line or the raw SDK-error jargon (`is INNGEST_EVENT_KEY
// provisioned...`) — this dashboard also has a non-technical reader. The raw
// server message still reaches the screen via WriteStatus's `detail` line
// (handleTrigger below), so nothing engineering needs is lost. Every other
// status (403 origin check, 400 validation, 0 network, etc.) still goes
// through the shared mapping unchanged.
function friendlyRepoInspectError(status: number, error: string): string {
  if (status !== 503) return friendlyWriteError(status, error);
  if (error.includes("DASHBOARD_PRODUCT_ID")) {
    return "This dashboard isn't configured with a product to inspect yet.";
  }
  return "The inspection backend isn't connected in this environment yet — nothing's broken, it just hasn't been wired up.";
}

export function RepoInspectTrigger({ view }: { view: RepoSnapshotView }) {
  const router = useRouter();
  const [status, setStatus] = useState<WriteStatusState>({ kind: "idle" });
  const [polling, setPolling] = useState(false);
  const pollCountRef = useRef(0);
  const baselineFetchedAtRef = useRef<string | null>(fetchedAtOf(view));

  // Fires on every re-render this component receives via router.refresh()
  // (its `view` prop is re-supplied by the parent Server Component each
  // time). Stops polling the moment fetched_at moves past what it was when
  // the button was clicked — that's the actual "a NEW snapshot landed"
  // signal, not just "a snapshot exists" (one may have already existed from
  // a prior run).
  useEffect(() => {
    if (!polling) return;
    const current = fetchedAtOf(view);
    if (current && current !== baselineFetchedAtRef.current) {
      setPolling(false);
      pollCountRef.current = 0;
      setStatus({ kind: "success", message: `New snapshot fetched at ${new Date(current).toLocaleString()}.` });
    }
  }, [view, polling]);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current > POLL_MAX_ATTEMPTS) {
        setPolling(false);
        setStatus({
          kind: "pending",
          message:
            "Still no new snapshot after 90s — dispatched, still running, or this environment's " +
            "backend isn't wired up for it yet (nothing is known to be broken; it's just not " +
            "confirmed done). Reload the page later to check again.",
        });
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [polling, router]);

  async function handleTrigger() {
    baselineFetchedAtRef.current = fetchedAtOf(view);
    pollCountRef.current = 0;
    setStatus({ kind: "saving" });
    const result = await postSettings("/api/repo-inspect/trigger", {});
    if (result.ok) {
      setPolling(true);
    } else {
      setStatus({ kind: "error", message: friendlyRepoInspectError(result.status, result.error), detail: result.error });
    }
  }

  const busy = status.kind === "saving" || polling;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleTrigger}
        disabled={busy}
        className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-[600] text-[#0a0d1a] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {polling ? "Inspecting…" : view.status === "ready" ? "Re-inspect repo" : "Inspect repo"}
      </button>
      {polling ? (
        <div role="status" aria-live="polite" className="max-w-[260px] text-right text-[11px] text-text-faint">
          Waiting for a fresh snapshot — polling every few seconds…
        </div>
      ) : (
        <div className="max-w-[260px] text-right">
          <WriteStatus state={status} />
        </div>
      )}
    </div>
  );
}
