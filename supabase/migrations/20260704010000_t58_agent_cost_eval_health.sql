-- Migration: 20260704010000_t58_agent_cost_eval_health
-- T-58: Dashboard data feeds — agent cost + eval health (Sprint 6, Data Engineer)
-- Author: Data Engineer  Date: 2026-07-04
-- Forward-only. Requires all prior migrations applied (through
--   20260704000000_fix_kb_articles_write_policy.sql).
-- Run via Supabase SQL Editor as service_role (same pattern as prior migrations).
--
-- Two new tables, both RLS-protected, neither holding any PII (IDs + numeric
-- cost/pass-rate only, per the Data Engineer quality bar: "Zero PII in metrics
-- tables — only IDs and anonymized aggregates"):
--
--   agent_cost_events — per-ticket LLM cost synced from LangFuse Cloud's public
--     Traces API. Populated by the new `agent-cost-sync` Inngest cron
--     (src/inngest/agent-cost-sync.ts). Tenant/project-scoped like every other
--     table (CLAUDE.md non-negotiable #8 — no cross-tenant data leaks).
--
--   eval_gate_runs — store for eval-gate CI run history. IMPORTANT: as of this
--     migration NO WRITER IS WIRED. T-17's `Eval Gate` CI job is schema
--     validation only (`promptfoo validate`) — that is NOT a quality/pass-rate
--     signal and must never be stored here mislabeled as one. This table is
--     ready to receive real LLM-rubric grading runs (run_type='llm_rubric')
--     the day that gate exists (T-17 follow-up, Evals Lead territory); until
--     then it stays EMPTY on purpose. The query layer
--     (src/metrics/evalHealth.ts) returns an explicit "pending real gate"
--     status when no rows exist — never a fabricated pass rate.

-- ---------------------------------------------------------------------------
-- agent_cost_events (tenant-scoped)
-- ---------------------------------------------------------------------------
create table agent_cost_events (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  tenant_id          uuid not null references tenants(id) on delete cascade,
  ticket_id          uuid,  -- NOT a FK on purpose: a LangFuse trace must sync
                             -- successfully even if the ticket it refers to is
                             -- later deleted/renamed — cost history outlives
                             -- the ticket row it was attributed to.
  langfuse_trace_id  text not null,
  trace_name         text not null
                       check (trace_name in ('ticket-triage', 'ticket-respond', 'kb-learn')),
  total_cost_usd     numeric(12, 6) not null default 0,
  trace_timestamp    timestamptz not null,
  synced_at          timestamptz not null default now(),
  unique (langfuse_trace_id)
);

create index agent_cost_events_project_tenant_idx on agent_cost_events (project_id, tenant_id);
create index agent_cost_events_ticket_idx          on agent_cost_events (ticket_id);
create index agent_cost_events_trace_timestamp_idx  on agent_cost_events (trace_timestamp);

comment on table agent_cost_events is
  'Per-ticket LLM cost synced from LangFuse Cloud Traces API (T-58). One row per '
  'LangFuse trace (ticket-triage / ticket-respond / kb-learn). Source of truth for '
  'the agent-cost dashboard pillar and per-project COGS. Upserted on langfuse_trace_id '
  '(cost can settle after a trace closes — later syncs overwrite, never duplicate).';

alter table agent_cost_events enable row level security;

create policy agent_cost_events_select on agent_cost_events
  for select to ops_hub_app, authenticated
  using (tenant_id = current_tenant_id());

-- Writer is the agent-cost-sync cron (ops_hub_app only). Same trust model as
-- sla-monitor's audit_log writes: the GUC is set from the same LangFuse trace
-- metadata being inserted, so WITH CHECK here is a consistency guard, not an
-- isolation boundary — the SELECT policy above is what T-60 must verify.
create policy agent_cost_events_write on agent_cost_events
  for all to ops_hub_app
  using (project_id = current_project_id() and tenant_id = current_tenant_id())
  with check (project_id = current_project_id() and tenant_id = current_tenant_id());

grant select, insert, update, delete on agent_cost_events to ops_hub_app;

-- Rollup view for dashboard consumption: daily cost per tenant/trace_name.
-- security_invoker = true is LOAD-BEARING: without it, a view defaults to
-- running with its OWNER's privileges (which can bypass RLS), silently
-- reopening the exact cross-tenant leak the base-table RLS above just closed.
-- With it, the view enforces RLS as the QUERYING role (ops_hub_app /
-- authenticated) exactly as if agent_cost_events were queried directly.
create view agent_cost_daily
  with (security_invoker = true) as
select
  project_id,
  tenant_id,
  trace_name,
  date_trunc('day', trace_timestamp) as day,
  count(*)            as event_count,
  sum(total_cost_usd) as total_cost_usd
from agent_cost_events
group by project_id, tenant_id, trace_name, date_trunc('day', trace_timestamp);

comment on view agent_cost_daily is
  'Daily per-tenant, per-agent LLM cost rollup for the ops dashboard agent-cost tile. '
  'security_invoker=true respects agent_cost_events RLS for the querying role — '
  'DO NOT recreate this view without that option (T-60 must verify it holds).';

grant select on agent_cost_daily to ops_hub_app;

-- ---------------------------------------------------------------------------
-- eval_gate_runs (platform-level; project_id nullable — same nullable-scope
-- precedent as audit_log's platform events in the initial schema. A CI eval
-- run is not tenant data and today applies to the whole eval suite, not one
-- project, so project_id is null unless/until a per-project suite exists.)
-- ---------------------------------------------------------------------------
create table eval_gate_runs (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references projects(id) on delete set null,
  run_type          text not null check (run_type in ('schema_validation', 'llm_rubric')),
  status            text not null check (status in ('pass', 'fail')),
  total_cases       int,
  passed_cases      int,
  -- GENERATED, not writer-supplied: pass_rate is ALWAYS NULL for
  -- run_type='schema_validation' by construction, no matter what a future
  -- writer passes for total_cases/passed_cases. This is the guardrail that
  -- makes it structurally impossible for a schema-validity check to be read
  -- as the charter's >95% quality pass-rate KPI.
  pass_rate         numeric(5, 4) generated always as (
                      case
                        when run_type = 'llm_rubric'
                             and total_cases is not null and total_cases > 0
                          then round(passed_cases::numeric / total_cases::numeric, 4)
                        else null
                      end
                    ) stored,
  git_sha           text,
  workflow_run_url  text,
  ci_run_at         timestamptz not null,
  recorded_at       timestamptz not null default now(),
  notes             text
);

create index eval_gate_runs_run_type_ci_run_at_idx on eval_gate_runs (run_type, ci_run_at desc);

comment on table eval_gate_runs is
  'Eval-gate CI run history (T-58). pass_rate is a GENERATED column, ALWAYS NULL for '
  'run_type=schema_validation (T-17''s current Eval Gate, promptfoo validate — schema '
  'check only, not a quality signal). Only run_type=llm_rubric rows (the real graded '
  'gate, not yet built) ever carry a pass_rate. Table is intentionally EMPTY as of this '
  'migration — no writer wired yet; src/metrics/evalHealth.ts returns an explicit '
  '"pending real gate" placeholder to the dashboard until one exists. Do not backfill '
  'fabricated or schema-check-derived pass rates into this table.';

alter table eval_gate_runs enable row level security;

-- project_id IS NULL rows are platform-wide CI health data, not a tenant
-- secret — visible to any project-scoped caller by design (unlike
-- tenants/tickets, there is nothing here that could leak across tenants).
create policy eval_gate_runs_select on eval_gate_runs
  for select to ops_hub_app, authenticated
  using (project_id is null or project_id = current_project_id());

create policy eval_gate_runs_write on eval_gate_runs
  for all to ops_hub_app
  using (project_id is null or project_id = current_project_id())
  with check (project_id is null or project_id = current_project_id());

grant select, insert, update, delete on eval_gate_runs to ops_hub_app;
