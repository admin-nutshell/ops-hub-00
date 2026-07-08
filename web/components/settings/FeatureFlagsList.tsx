"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postSettings, friendlyWriteError } from "../../lib/apiClient";
import { WriteStatus, type WriteStatusState } from "./WriteStatus";
import type { FeatureFlagListItem } from "../../../src/metrics/dashboard";

const MIN_PCT = 0;
const MAX_PCT = 100;

function FeatureFlagRow({ flag }: { flag: FeatureFlagListItem }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(flag.enabled);
  const [rollout, setRollout] = useState(String(flag.rolloutPercentage));
  const [status, setStatus] = useState<WriteStatusState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(rollout);
    if (!Number.isInteger(pct) || pct < MIN_PCT || pct > MAX_PCT) {
      setStatus({ kind: "error", message: `Rollout must be a whole number between ${MIN_PCT} and ${MAX_PCT}.` });
      return;
    }

    setStatus({ kind: "saving" });
    const result = await postSettings("/api/settings/feature-flags", {
      id: flag.id,
      enabled,
      rolloutPercentage: pct,
    });

    if (result.ok) {
      setStatus({ kind: "success", message: `Saved — ${flag.flagKey} is now ${enabled ? "enabled" : "disabled"} at ${pct}%.` });
      router.refresh();
    } else {
      const friendly = friendlyWriteError(result.status, result.error);
      setStatus({ kind: "error", message: friendly, detail: result.error });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 border-b border-border-soft px-[22px] py-[15px] last:border-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12.5px] font-[600] text-text">{flag.flagKey}</span>
          <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
            {flag.environment}
          </span>
        </div>
        {flag.description ? (
          <span className="text-xs text-text-muted">{flag.description}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs text-text-muted" htmlFor={`ff-enabled-${flag.id}`}>
          <input
            id={`ff-enabled-${flag.id}`}
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-[var(--color-accent)]"
          />
          Enabled
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`ff-rollout-${flag.id}`}>
          Rollout %
          <input
            id={`ff-rollout-${flag.id}`}
            type="number"
            inputMode="numeric"
            min={MIN_PCT}
            max={MAX_PCT}
            step={1}
            value={rollout}
            onChange={(e) => setRollout(e.target.value)}
            className="w-20 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 font-mono text-[12.5px] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>

        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-[600] text-[#0a0d1a] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
      </div>

      <WriteStatus state={status} />
    </form>
  );
}

// Feature-flag toggles (ADR-0006 Decision B Surface 3, T-75). UPDATE-only on
// EXISTING rows — this list can never create or delete a flag (T-74's route
// has no INSERT/DELETE statement on this path; flag creation stays a
// Tech-Lead/migration action per docs/engineering/feature-flags.md's
// authority table). `environment` is shown as an informational badge per row
// (see getFeatureFlags's doc comment) — it is not a filter or a security
// boundary here.
export function FeatureFlagsList({ flags }: { flags: FeatureFlagListItem[] }) {
  if (flags.length === 0) {
    return (
      <div className="px-[22px] py-[17px] text-xs text-text-muted">
        No feature flags exist for this project yet. Creating a flag is a Tech-Lead/migration
        action (see <code className="font-mono">docs/engineering/feature-flags.md</code>) — this
        console can only toggle flags that already exist.
      </div>
    );
  }

  return (
    <div>
      {flags.map((flag) => (
        <FeatureFlagRow key={flag.id} flag={flag} />
      ))}
    </div>
  );
}
