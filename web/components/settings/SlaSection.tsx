import { loadCurrentSlaConfig } from "../../lib/queries";
import { ErrorNote } from "../ErrorNote";
import { SlaForm } from "./SlaForm";

// SLA-target editor (ADR-0006 Decision B Surface 1, T-75). Writes only
// `sla_config.response_target_minutes` via T-74's route (jsonb_set on that
// key only) — `sla_tier` is shown for context but is NEVER submitted by this
// form (T-B3: it's the +$200 CAD/mo billing lever, out of scope for this
// surface; the API rejects it even if a client tried).
export async function SlaSection() {
  let current: Awaited<ReturnType<typeof loadCurrentSlaConfig>>;
  try {
    current = await loadCurrentSlaConfig();
  } catch (error) {
    return <ErrorNote label="SLA target" error={error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border-soft px-[22px] py-[17px]">
        <h2 className="text-[13px] font-[650]">SLA target</h2>
        <p className="mt-1 text-xs text-text-muted">
          Standard-tier response-time target. SLA tier itself (standard/premium — the billing
          add-on) is not editable here.
        </p>
      </div>
      <SlaForm slaTier={current.slaTier} initialMinutes={current.responseTargetMinutes} />
    </div>
  );
}
