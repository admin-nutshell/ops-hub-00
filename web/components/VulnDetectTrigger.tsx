"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postSettings, friendlyWriteError } from "../lib/apiClient";
import { WriteStatus, type WriteStatusState } from "./settings/WriteStatus";
import type { VulnFindingsView } from "../../src/metrics/vulnDetect";

// Polls via router.refresh() rather than a separate GET/JSON polling
// endpoint — same idiom RepoInspectTrigger established for S1. Requires the
// hosting page to force dynamic rendering (see web/app/page.tsx's `export
// const dynamic`).
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // ~90s — generous for a live GitHub API round trip.

function latestUpdatedAtOf(view: VulnFindingsView): string | null {
  return view.status === "ready" ? view.latestUpdatedAt : null;
}

// friendlyWriteError's 503 branch assumes the T-72 settings-schema-not-applied
// cause — wrong for this route, same reasoning as
// RepoInspectTrigger.tsx's friendlyRepoInspectError. This route's 503s are
// either ProductScopeUnavailableError (DASHBOARD_PRODUCT_ID unset) or
// VulnDetectDispatchError (the Inngest SDK refused to send — see
// triggerVulnDetect's doc comment in src/metrics/vulnDetect.ts). Map each to
// its own plain-language headline rather than either the wrong generic line
// or raw SDK-error jargon.
function friendlyVulnDetectError(status: number, error: string): string {
  if (status !== 503) return friendlyWriteError(status, error);
  if (error.includes("DASHBOARD_PRODUCT_ID")) {
    return "This dashboard isn't configured with a product to scan yet.";
  }
  return "The detection backend isn't connected in this environment yet — nothing's broken, it just hasn't been wired up.";
}

export function VulnDetectTrigger({ view }: { view: VulnFindingsView }) {
  const router = useRouter();
  const [status, setStatus] = useState<WriteStatusState>({ kind: "idle" });
  const [polling, setPolling] = useState(false);
  const pollCountRef = useRef(0);
  const baselineUpdatedAtRef = useRef<string | null>(latestUpdatedAtOf(view));

  // Fires on every re-render this component receives via router.refresh().
  // Stops polling the moment the latest finding's updated_at moves past what
  // it was when the button was clicked — the actual "a detection run landed"
  // signal. A run that found zero findings (or a skipped run — see this
  // module's KNOWN GAP note in src/metrics/vulnDetect.ts) never advances
  // this value, so it times out honestly instead of falsely claiming success.
  useEffect(() => {
    if (!polling) return;
    const current = latestUpdatedAtOf(view);
    if (current && current !== baselineUpdatedAtRef.current) {
      setPolling(false);
      pollCountRef.current = 0;
      setStatus({
        kind: "success",
        message: `Findings updated — latest change at ${new Date(current).toLocaleString()}.`,
      });
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
            "Still no new finding activity after 90s — this can mean the scan is still running, " +
            "it skipped (e.g. no repo connected, or this product's detection source is " +
            "suspended), or this environment's backend isn't wired up for it yet. None of those " +
            "are confirmed from here — reload the page later to check again.",
        });
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [polling, router]);

  async function handleTrigger() {
    baselineUpdatedAtRef.current = latestUpdatedAtOf(view);
    pollCountRef.current = 0;
    setStatus({ kind: "saving" });
    const result = await postSettings("/api/vuln-detect/trigger", {});
    if (result.ok) {
      setPolling(true);
    } else {
      setStatus({
        kind: "error",
        message: friendlyVulnDetectError(result.status, result.error),
        detail: result.error,
      });
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
        {polling ? "Scanning…" : "Scan for vulnerabilities"}
      </button>
      {polling ? (
        <div role="status" aria-live="polite" className="max-w-[260px] text-right text-[11px] text-text-faint">
          Waiting for detection activity — polling every few seconds…
        </div>
      ) : (
        <div className="max-w-[260px] text-right">
          <WriteStatus state={status} />
        </div>
      )}
    </div>
  );
}
