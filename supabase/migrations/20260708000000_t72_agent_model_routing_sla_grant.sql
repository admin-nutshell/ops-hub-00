-- Migration: 20260708000000_t72_agent_model_routing_sla_grant
-- Sprint 7 / T-72: Dashboard settings write surface — schema + least-privilege grants + RLS write policies
-- Author: Tech Lead  Date: 2026-07-08
-- Implements ADR-0006 (Dashboard Settings Write Surface). See docs/adr/0006-dashboard-settings-write-surface.md.
--
-- *** SECURITY LEAD REVIEW REQUIRED (T-76) — GATES the apply ***
-- Forward-only. Applied via Supabase SQL Editor as service_role AFTER T-76 sign-off.
-- Agents never hold service_role at runtime (CLAUDE.md non-negotiable #3, ADR-0005 risk #2).
-- Idempotent / safe to re-run: `create table if not exists`, `drop policy if exists`
-- before every `create policy`, and REVOKE/GRANT statements are naturally idempotent.
--
-- Requires 20260618120100_enable_rls_policies.sql applied first — it defines
-- current_tenant_id() / current_project_id() and creates the `ops_hub_app` role.
--
-- THREE things this migration does (ADR-0006 §Decision A + §Decision B, Surfaces 1 & 2):
--   1. New project-scoped table `agent_model_routing` (per-function model selection).
--   2. RLS write policies for that table (amr_select/insert/update) + explicit REVOKE DELETE.
--   3. SLA least-privilege tightening on `tenants`: replace the broad table-level UPDATE
--      grant with a column-scoped grant on `sla_config` ONLY, + a scoped update policy.
--
-- What this migration deliberately does NOT touch:
--   * feature_flags — its `feature_flags_write FOR ALL to ops_hub_app` policy
--     (20260618120100) is already sufficient; ADR-0006 constrains that surface at the
--     API layer, not the DB layer. No change here.

-- ===========================================================================
-- 1. agent_model_routing  (project-scoped; per-function LiteLLM alias selection)
-- ===========================================================================
-- Single source of truth for which LiteLLM alias each agent function names.
-- Values are LiteLLM alias STRINGS only (e.g. 'triage-model', 'fallback-model',
-- 'meta/llama-3.3-70b-instruct') — never raw provider model ids. LiteLLM owns the
-- alias->provider mapping (ADR-0004), so storing aliases keeps business logic
-- provider-neutral by construction and app-agnostic (Project #2 brings its own aliases).
--
-- NO `environment` column by design: per ADR-0005 staging and prod are the same
-- physical Supabase project distinguished by ROWS, and the prod/staging agent
-- containers run with different POLLING_PROJECT_ID values. `project_id` therefore
-- already IS the environment/scope boundary and is the axis RLS gates on. Adding a
-- second, un-gated `environment` axis would let config desync from what RLS enforces.
create table if not exists agent_model_routing (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  function_key   text not null check (function_key in ('triage', 'respond', 'kb_learn')),
  primary_model  text not null,                 -- registered LiteLLM alias string (never a raw provider id)
  fallback_model text,                          -- nullable; populated/consumed for 'triage' only this sprint (ADR-0006)
  updated_at     timestamptz not null default now(),
  updated_by     text,                          -- audit convenience; authoritative record is audit_log
  unique (project_id, function_key)
);

comment on table agent_model_routing is
  'Per-function LiteLLM alias selection (triage/respond/kb_learn), project-scoped. '
  'Values are LiteLLM alias strings only (never raw provider ids). No environment '
  'column: project_id is the env/scope axis (ADR-0005). Dashboard-editable override; '
  'backend falls back to per-function env defaults then the alias literal (ADR-0006).';

-- Keep updated_at fresh on every edit (matches the tickets / feature_flags convention;
-- reuses the shared set_updated_at() helper from 20260618120000_initial_schema.sql).
drop trigger if exists agent_model_routing_set_updated_at on agent_model_routing;
create trigger agent_model_routing_set_updated_at
  before update on agent_model_routing
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: default-deny floor + project-scoped write policies
-- ---------------------------------------------------------------------------
alter table agent_model_routing enable row level security;

-- The `alter default privileges` in 20260618120100 auto-grants all four verbs to
-- ops_hub_app on any new public table. We (a) re-assert the three verbs this table
-- needs explicitly so the grant is robust regardless of which role created the table,
-- and (b) explicitly REVOKE DELETE so routing rows can be edited but never deleted.
grant select, insert, update on agent_model_routing to ops_hub_app;
revoke delete on agent_model_routing from ops_hub_app;

drop policy if exists amr_select on agent_model_routing;
create policy amr_select on agent_model_routing
  for select to ops_hub_app, authenticated
  using (project_id = current_project_id());

drop policy if exists amr_insert on agent_model_routing;
create policy amr_insert on agent_model_routing
  for insert to ops_hub_app
  with check (project_id = current_project_id());

drop policy if exists amr_update on agent_model_routing;
create policy amr_update on agent_model_routing
  for update to ops_hub_app
  using (project_id = current_project_id())
  with check (project_id = current_project_id());

-- NO delete policy: routing rows are edited, not deleted. Combined with the REVOKE
-- DELETE above, DELETE from ops_hub_app is doubly denied (grant-level AND RLS default-deny).

-- ===========================================================================
-- 2. SLA least-privilege tightening on `tenants` (Surface 1, ADR-0006)
-- ===========================================================================
-- Today `tenants` has only a tenants_select policy (no write policy), but the initial
-- migration granted ops_hub_app table-level UPDATE on ALL public tables. Naively adding
-- an update policy would therefore open EVERY tenants column. Instead: strip the broad
-- table-level UPDATE and re-grant UPDATE on the sla_config column ONLY.
--
-- T-B3: `sla_tier` is the +$200 CAD/mo premium billing lever (DECISIONS.md Pricing
-- Option D), NOT an SLA target. It is deliberately EXCLUDED from this grant — the
-- column list below is `sla_config` only, so name / tier / project_id / sla_tier / id
-- all remain unwritable by ops_hub_app even via a compromised app path.
revoke update on tenants from ops_hub_app;
grant update (sla_config) on tenants to ops_hub_app;

drop policy if exists tenants_update_sla on tenants;
create policy tenants_update_sla on tenants
  for update to ops_hub_app
  using (id = current_tenant_id())
  with check (id = current_tenant_id());

-- ===========================================================================
-- 3. feature_flags — INTENTIONALLY UNCHANGED
-- ===========================================================================
-- feature_flags_write (FOR ALL to ops_hub_app, project-scoped with-check) already
-- exists (20260618120100) and is the path agents legitimately use. ADR-0006 constrains
-- the dashboard's flag surface at the API layer (UPDATE (enabled, rollout_percentage)
-- on existing rows only), NOT the DB layer. No DB change here by design.

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   -- 3 new objects present:
--   select relname from pg_class where relname = 'agent_model_routing';                     -- table
--   select polname from pg_policy where polrelid = 'agent_model_routing'::regclass;          -- amr_select/insert/update
--   select polname from pg_policy where polrelid = 'tenants'::regclass;                       -- includes tenants_update_sla
--   -- tenants UPDATE grant is column-scoped to sla_config ONLY (must return exactly one
--   -- row: sla_config; sla_tier / name / tier / project_id / id must NOT appear):
--   select column_name from information_schema.column_privileges
--     where table_name = 'tenants' and grantee = 'ops_hub_app' and privilege_type = 'UPDATE';
--   -- ops_hub_app has NO table-level UPDATE on tenants (column-scoped only):
--   select privilege_type from information_schema.role_table_grants
--     where table_name = 'tenants' and grantee = 'ops_hub_app';  -- UPDATE must be absent
-- ===========================================================================
