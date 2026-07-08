import { loadFeatureFlags } from "../../lib/queries";
import { ErrorNote } from "../ErrorNote";
import { FeatureFlagsList } from "./FeatureFlagsList";

export async function FeatureFlagsSection() {
  let flags: Awaited<ReturnType<typeof loadFeatureFlags>>;
  try {
    flags = await loadFeatureFlags();
  } catch (error) {
    return <ErrorNote label="Feature flags" error={error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border-soft px-[22px] py-[17px]">
        <h2 className="text-[13px] font-[650]">Feature flags</h2>
        <p className="mt-1 text-xs text-text-muted">
          Toggle existing flags for this project. Flag creation/deletion is not available here.
        </p>
      </div>
      <FeatureFlagsList flags={flags} />
    </div>
  );
}
