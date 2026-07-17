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
      setStatus({ kind: "error", message: friendlyWriteError(result.status, result.error), detail: result.error });
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
