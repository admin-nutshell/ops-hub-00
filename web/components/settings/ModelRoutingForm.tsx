"use client";

import { useId, useState } from "react";
import { isAllowedModel, type RoutingFunctionKey } from "../../../src/config/model-allowlist";
import { postSettings, friendlyWriteError } from "../../lib/apiClient";
import { WriteStatus, type WriteStatusState } from "./WriteStatus";

const FUNCTION_LABEL: Record<RoutingFunctionKey, string> = {
  triage: "Triage",
  respond: "Respond",
  kb_learn: "KB Learn",
};

const NO_FALLBACK = ""; // sentinel for the fallback <select>'s "none" option

export function ModelRoutingForm({
  functionKey,
  allowedPrimary,
  allowedFallback,
  initialPrimary,
  initialFallback,
}: {
  functionKey: RoutingFunctionKey;
  allowedPrimary: readonly string[];
  /** null for respond/kb_learn — only triage carries fallback logic this sprint (ADR-0006). */
  allowedFallback: readonly string[] | null;
  initialPrimary: string | null;
  initialFallback: string | null;
}) {
  const formId = useId();
  const [primary, setPrimary] = useState(initialPrimary ?? "");
  const [fallback, setFallback] = useState(initialFallback ?? NO_FALLBACK);
  const [status, setStatus] = useState<WriteStatusState>({ kind: "idle" });

  const hasOverride = initialPrimary !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!primary || !isAllowedModel(functionKey, primary)) {
      setStatus({
        kind: "error",
        message: `"${primary || "(none selected)"}" is not an allowlisted model for ${FUNCTION_LABEL[functionKey]}.`,
      });
      return;
    }
    if (fallback && allowedFallback && !isAllowedModel(functionKey, fallback)) {
      setStatus({ kind: "error", message: `"${fallback}" is not an allowlisted fallback model.` });
      return;
    }

    setStatus({ kind: "saving" });
    const result = await postSettings("/api/settings/model-routing", {
      functionKey,
      primaryModel: primary,
      fallbackModel: allowedFallback && fallback ? fallback : null,
    });

    if (result.ok) {
      setStatus({ kind: "success", message: `Saved — ${FUNCTION_LABEL[functionKey]} now pinned to "${primary}".` });
    } else {
      setStatus({ kind: "error", message: friendlyWriteError(result.status, result.error) });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 border-b border-border-soft px-[22px] py-[17px] last:border-none"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-[650]">{FUNCTION_LABEL[functionKey]}</h3>
        <span className="font-mono text-[10.5px] text-text-faint">
          {hasOverride ? "override set" : "no override — using deploy default"}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${formId}-primary`}>
          Primary model
          <select
            id={`${formId}-primary`}
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[12.5px] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="" disabled>
              Select a model…
            </option>
            {allowedPrimary.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>

        {allowedFallback ? (
          <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${formId}-fallback`}>
            Fallback model
            <select
              id={`${formId}-fallback`}
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[12.5px] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value={NO_FALLBACK}>No fallback</option>
              {allowedFallback.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        ) : null}

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
