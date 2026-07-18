-- Migration: 20260718120200_s3_fix_attempts_pull_requests_rls_policies
-- Ops Hub product-domain reboot — Sprint S3: product-scoped RLS
-- Author: Tech Lead  Date: 2026-07-18
-- *** SECURITY LEAD REVIEW REQUIRED (matches the 20260717120100/20260717160100
-- precedent) ***
-- Forward-only. Companion to 20260718120100_s3_fix_attempts_pull_requests_schema.sql.
-- Requires that migration (and its own prerequisites, 20260718115900 and
-- 20260718120000) applied first.
--
-- Same enforcement model as every prior S1/S2 product-scoped table: fail-closed
-- `using (product_id = current_product_id())`, non-superuser `ops_hub_app` role
-- (already created — not recreated here), transaction-local pooler-safe GUC.
-- Does NOT touch tickets, tenants, projects, audit_log, feature_flags,
-- kb_articles, or any existing table's policies/grants.
--
-- WRITE-SURFACE DECISION (same as findings/autonomy_policies): ops_hub_app
-- only. No direct `authenticated` read/write path — the dashboard reads
-- fix_attempts/pull_requests via the agent/API layer, not a direct Supabase
-- client. Revisit with a scoped follow-up migration if/when a portal
-- direct-read need is confirmed.
--
-- NO DELETE POLICY on either table (combined with REVOKE DELETE below): a
-- fix_attempt or pull_request is audit-relevant history — it moves through
-- its status/state machine, it is never hard-deleted. Same rationale as
-- findings.

alter table fix_attempts   enable row level security;
alter table pull_requests  enable row level security;

-- ---------------------------------------------------------------------------
-- fix_attempts
-- ---------------------------------------------------------------------------
grant select, insert, update on fix_attempts to ops_hub_app;
revoke delete on fix_attempts from ops_hub_app;

create policy fix_attempts_select on fix_attempts
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy fix_attempts_insert on fix_attempts
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy fix_attempts_update on fix_attempts
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- ---------------------------------------------------------------------------
-- pull_requests
-- ---------------------------------------------------------------------------
grant select, insert, update on pull_requests to ops_hub_app;
revoke delete on pull_requests from ops_hub_app;

create policy pull_requests_select on pull_requests
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy pull_requests_insert on pull_requests
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy pull_requests_update on pull_requests
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   -- 2 new tables present, RLS enabled on both:
--   select relname, relrowsecurity from pg_class
--     where relname in ('fix_attempts','pull_requests');
--   -- policy inventory (expect: fix_attempts_select/insert/update;
--   -- pull_requests_select/insert/update):
--   select polrelid::regclass, polname from pg_policy
--     where polrelid in ('fix_attempts'::regclass, 'pull_requests'::regclass)
--     order by 1, 2;
--   -- ops_hub_app has NO delete grant on either table:
--   select table_name, privilege_type from information_schema.role_table_grants
--     where table_name in ('fix_attempts','pull_requests')
--       and grantee = 'ops_hub_app' and privilege_type = 'DELETE';  -- must return 0 rows
--   -- fail-closed smoke test (no GUC set => zero rows for a real row):
--   --   insert a throwaway fix_attempts row as service_role (against a real finding),
--   --   then as ops_hub_app with no app.current_product set,
--   --   `select * from fix_attempts` must return 0 rows.
--   -- isolation smoke test (two products, only one GUC set => only that product's rows):
--   --   set role ops_hub_app;
--   --   select set_config('app.current_product', '<product-A-uuid>', true);
--   --   select * from fix_attempts;  -- must show ONLY product A's rows, never product B's.
--   --   reset role;
--   --
--   -- Confirm untouched: tickets/tenants/projects/audit_log/feature_flags/kb_articles/
--   -- products/repo_connections/findings/autonomy_policies/signal_sources policy counts
--   -- are unchanged from before this migration.
-- ===========================================================================
