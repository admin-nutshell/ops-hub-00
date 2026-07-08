"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postSettings, friendlyWriteError } from "../../lib/apiClient";
import { WriteStatus, type WriteStatusState } from "./WriteStatus";

// Mirrors src/metrics/settingsWrite.ts's SLA_ALLOWED_KEYS / SLA_BOUNDS
// (client-side defense-in-depth per ADR-0006 — the API is the real gate).
// Not imported directly: that module also carries `pg`-shaped SQL/query code
// that has no reason to ship in the browser bundle. Source of truth is
// src/metrics/settingsWrite.ts — if the bounds change there, change them here
// too.
const MIN_MINUTES = 1;
const MAX_MINUTES = 10080; // 7 days

export function SlaForm({
  slaTier,
  initialMinutes,
}: {
  slaTier: "standard" | "premium";
  initialMinutes: number | null;
}) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(String(initialMinutes ?? 240));
  const [status, setStatus] = useState<WriteStatusState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < MIN_MINUTES || value > MAX_MINUTES) {
      setStatus({
        kind: "error",
        message: `Enter a whole number of minutes between ${MIN_MINUTES} and ${MAX_MINUTES}.`,
      });
      return;
    }

    setStatus({ kind: "saving" });
    const result = await postSettings("/api/settings/sla", { response_target_minutes: value });

    if (result.ok) {
      setStatus({ kind: "success", message: `Saved — response target is now ${value} minutes.` });
      router.refresh();
    } else {
      const friendly = friendlyWriteError(result.status, result.error);
      setStatus({ kind: "error", message: friendly, detail: result.error });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-[22px] py-[17px]">
      {slaTier === "premium" ? (
        <div
          role="note"
          className="rounded-lg border border-warn/30 bg-warn/[0.12] px-3 py-2 text-xs text-warn"
        >
          This tenant is on the <strong>premium</strong> SLA tier, which uses fixed per-urgency
          targets (critical 30m / high 60m / normal 240m / low 480m). The response-target value
          below has <strong>no effect</strong> while premium is active — it only applies to
          standard-tier tenants.
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor="sla-response-target">
          Response target (minutes)
          <input
            id="sla-response-target"
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-32 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 font-mono text-[12.5px] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
