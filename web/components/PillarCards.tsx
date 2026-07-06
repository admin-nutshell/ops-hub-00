import { MetricCard } from "./MetricCard";
import { ErrorNote, PendingNote } from "./ErrorNote";
import {
  loadSlaAttainment,
  loadOpenTicketCounts,
  loadAgentCostTotal,
  loadEvalHealth,
  loadDeflectionRate,
} from "../lib/queries";
import { formatUsd } from "../lib/format";

// The 4 charter-mandated daily pillars (02_stakeholders.md) — SLA attainment,
// open tickets, agent cost, eval health — plus the 5th industry-standard
// metric, deflection rate. Each is its own async Server Component so one
// failing query renders ONLY that card's error, never a blank page (see
// ErrorNote). Each is meant to sit inside its own <Suspense> in page.tsx so
// they stream in independently instead of blocking on the slowest query.

export async function SlaAttainmentCard() {
  try {
    const sla = await loadSlaAttainment(30);
    const pct = sla.attainmentPct;
    const tone = pct === null ? "neutral" : pct >= 95 ? "good" : pct >= 85 ? "warn" : "critical";
    return (
      <MetricCard
        label="SLA attainment"
        value={pct === null ? "—" : pct.toFixed(1)}
        unit={pct === null ? undefined : "%"}
        tone={tone}
        sub={
          pct === null ? (
            <span>No responded tickets in the last {sla.windowDays} days yet</span>
          ) : (
            <span>
              {sla.metCount} of {sla.consideredCount} within target, last {sla.windowDays}d ·{" "}
              <strong className="text-text">{sla.openBreachedCount}</strong> breached now,{" "}
              <strong className="text-text">{sla.openAtRiskCount}</strong> at risk
            </span>
          )
        }
      />
    );
  } catch (error) {
    return <ErrorNote label="SLA attainment" error={error} />;
  }
}

export async function OpenTicketsCard() {
  try {
    const counts = await loadOpenTicketCounts();
    return (
      <MetricCard
        label="Open tickets"
        value={String(counts.total)}
        sub={
          <span>
            <strong className="text-critical">{counts.critical}</strong> critical ·{" "}
            <strong className="text-warn">{counts.high}</strong> high · {counts.normal} normal ·{" "}
            {counts.low} low
            {counts.untriaged > 0 ? ` · ${counts.untriaged} untriaged` : ""}
          </span>
        }
      />
    );
  } catch (error) {
    return <ErrorNote label="Open tickets" error={error} />;
  }
}

export async function AgentCostCard() {
  try {
    const totalUsd = await loadAgentCostTotal(30);
    return (
      <MetricCard
        label="Agent cost (30d)"
        value={formatUsd(totalUsd)}
        unit="USD"
        tone={totalUsd === 0 ? "warn" : "neutral"}
        sub={
          totalUsd === 0 ? (
            <span>
              $0 across all synced traces — known gap (T-58): LangFuse has no pricing entry
              registered for the LiteLLM-routed model names yet, not zero real usage.
            </span>
          ) : (
            <span>Synced from LangFuse Cloud traces every 10 min (agent-cost-sync)</span>
          )
        }
      />
    );
  } catch (error) {
    return <ErrorNote label="Agent cost" error={error} />;
  }
}

export async function EvalHealthCard() {
  try {
    const health = await loadEvalHealth();
    if (health.status === "pending") {
      return <PendingNote title="Eval health — pending real gate" message={health.message} />;
    }
    const pct = health.passRate !== null ? (health.passRate * 100).toFixed(1) : "—";
    return (
      <MetricCard
        label="Eval pass rate"
        value={pct}
        unit={health.passRate !== null ? "%" : undefined}
        tone={health.status === "pass" ? "good" : "critical"}
        sub={
          <span>
            {health.passedCases ?? "—"} / {health.totalCases ?? "—"} cases · run{" "}
            {new Date(health.ciRunAt).toLocaleString()}
          </span>
        }
      />
    );
  } catch (error) {
    return <ErrorNote label="Eval health" error={error} />;
  }
}

export async function DeflectionCard() {
  try {
    const deflection = await loadDeflectionRate(30);
    const pct = deflection.ratePct;
    return (
      <MetricCard
        label="Auto-resolved"
        value={pct === null ? "—" : pct.toFixed(1)}
        unit={pct === null ? undefined : "%"}
        tone={pct === null ? "neutral" : pct >= 80 ? "good" : "neutral"}
        sub={
          pct === null ? (
            <span>No tickets in the last {deflection.windowDays} days yet</span>
          ) : (
            <span>
              {deflection.autoHandledCount} of {deflection.totalCount} reached an agent-delivered
              response with no human touch — no human-handoff path exists yet, so this is an
              upper-bound proxy, not a true deflection split.
            </span>
          )
        }
      />
    );
  } catch (error) {
    return <ErrorNote label="Auto-resolved rate" error={error} />;
  }
}
