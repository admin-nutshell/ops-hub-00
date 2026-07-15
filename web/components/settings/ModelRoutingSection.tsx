import { MODEL_ROUTING_ALLOWLIST, type RoutingFunctionKey } from "../../../src/config/model-allowlist";
import { loadModelRoutingOverrides } from "../../lib/queries";
import { ErrorNote } from "../ErrorNote";
import { ModelRoutingForm } from "./ModelRoutingForm";

const ORDER: readonly RoutingFunctionKey[] = ["triage", "respond", "kb_learn"];

// Per-function model-routing editor (ADR-0006 Decision A, T-75). Dropdown
// options come ONLY from src/config/model-allowlist.ts (T-79's curated
// allowlist) — never a separately-hardcoded list that could drift from the
// backend's own isAllowedModel() validation. All three functions carry a
// fallback slot as of T-121 (DECISIONS.md 2026-07-15).
export async function ModelRoutingSection() {
  let overrides: Awaited<ReturnType<typeof loadModelRoutingOverrides>>;
  try {
    overrides = await loadModelRoutingOverrides();
  } catch (error) {
    return <ErrorNote label="Model routing" error={error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border-soft px-[22px] py-[17px]">
        <h2 className="text-[13px] font-[650]">Model routing</h2>
        <p className="mt-1 text-xs text-text-muted">
          Which LiteLLM alias each agent function calls. Choices are limited to a curated,
          production-vetted allowlist (T-79) — a model can&apos;t be introduced here, only selected
          among ones already running in production.
        </p>
      </div>
      {ORDER.map((functionKey) => (
        <ModelRoutingForm
          key={functionKey}
          functionKey={functionKey}
          allowedPrimary={MODEL_ROUTING_ALLOWLIST[functionKey]}
          allowedFallback={MODEL_ROUTING_ALLOWLIST[functionKey]}
          initialPrimary={overrides[functionKey]?.primaryModel ?? null}
          initialFallback={overrides[functionKey]?.fallbackModel ?? null}
        />
      ))}
    </div>
  );
}
