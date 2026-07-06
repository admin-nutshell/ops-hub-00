-- Migration: 20260706000000_t66_widen_audit_log_select_platform
-- Fix (T-66): platform-incident rows (audit_log where tenant_id IS NULL) are
-- unreadable through RLS, so getPlatformIncidents can never surface data.
-- Author: Security Lead  Date: 2026-07-06
-- Forward-only. Requires 20260618120100_enable_rls_policies.sql applied first
-- (defines current_tenant_id()/current_project_id() and audit_log_select).
-- Independent of 20260704010000 (T-58) / FQ-61 — audit_log predates both.
--
-- WHY: audit_log_select is `using (tenant_id = current_tenant_id())`. For a
-- platform-level row (tenant_id IS NULL), `NULL = current_tenant_id()` is NULL
-- (never true), so RLS denied every such row unconditionally. getPlatformIncidents
-- (src/metrics/dashboard.ts) sets only the project GUC and reads
-- `WHERE project_id=$1 AND tenant_id IS NULL AND action=ANY(...)`, so the feed
-- was permanently empty (dead code, deny-direction — NOT a leak). Proven live
-- in T-60 Check 2 (a real NULL-tenant platform_incident row inserted; feed
-- returned 0).
--
-- FIX: add a second, ops_hub_app-only permissive SELECT policy exposing
-- NULL-tenant rows only when the caller's project GUC matches the row's
-- project_id. Permissive policies OR together, so ops_hub_app now sees
-- (tenant branch) OR (platform branch). Deliberately does NOT extend the
-- `authenticated` role's access — authenticated already has tenant-scoped
-- SELECT via the original audit_log_select policy, but gains nothing new
-- here; there is no current authenticated consumer of platform incidents,
-- so this keeps blast radius minimal (decision recorded in DECISIONS.md
-- 2026-07-06 T-66).
--
-- FAIL-CLOSED (derivable from 20260618120100 L43-63): current_project_id()
-- is coalesce(jwt, nullif(GUC,''))::uuid → NULL when no project scope is
-- set, and `project_id = NULL` is NULL (never true), so an unscoped session
-- matches nothing. A NULL-tenant + NULL-project row also stays hidden.
-- Normal tenant rows are untouched (this branch requires tenant_id IS NULL).
-- No cross-tenant/cross-project read is introduced. Predicate is covered by
-- audit_log_project_tenant_ts_idx.
--
-- Idempotent (drop-if-exists then create). Run via Supabase SQL Editor as
-- service_role — agents never hold service_role at runtime (CLAUDE.md #3,
-- ADR-0005 risk #2). See docs/engineering/t11-migration-runbook.md.

drop policy if exists audit_log_select_platform on audit_log;

create policy audit_log_select_platform on audit_log
  for select to ops_hub_app
  using (tenant_id is null and project_id = current_project_id());
