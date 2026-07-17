-- Migration: 20260717140100_s1_repo_snapshots_rls_policies
-- Ops Hub product-domain reboot — Sprint S1: repo_snapshots product-scoped RLS
-- Author: Tech Lead  Date: 2026-07-17
-- *** SECURITY LEAD REVIEW REQUIRED (matches the 20260717120100 precedent) ***
-- Forward-only. Companion to 20260717140000_s1_repo_snapshots_schema.sql.
-- Requires that migration applied first. Requires current_product_id()
-- (defined in 20260717120100_s1_product_domain_rls_policies.sql) to exist.
--
-- Re-uses the exact enforcement model already established for repo_connections
-- in 20260717120100 — same fail-closed `using (product_id = current_product_id())`
-- shape, same `ops_hub_app` non-superuser role, same transaction-local GUC
-- convention. No new pattern invented here.
--
-- ops_hub_app needs select + insert + update (no delete): the Inngest
-- function upserts (`insert ... on conflict (repo_connection_id) do update`),
-- which requires both the insert and update policies under RLS even though
-- callers never do a plain UPDATE directly. Mirrors repo_connections exactly.
--
-- NOT YET APPLIED to the live Supabase project as of this commit — same
-- founder-runs-SQL-Editor workflow as every migration in this repo (see the
-- companion schema migration's header note).

alter table repo_snapshots enable row level security;

grant select, insert, update on repo_snapshots to ops_hub_app;
revoke delete on repo_snapshots from ops_hub_app;

create policy repo_snapshots_select on repo_snapshots
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy repo_snapshots_insert on repo_snapshots
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy repo_snapshots_update on repo_snapshots
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- no delete policy: a stale snapshot is superseded by the next inspection's
-- UPSERT, never hard-deleted — same convention as repo_connections/findings/
-- autonomy_policies (state/replacement over deletion).

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   -- table present, RLS enabled:
--   select relname, relrowsecurity from pg_class where relname = 'repo_snapshots';
--   -- policy inventory (expect: repo_snapshots_select/insert/update):
--   select polname from pg_policy where polrelid = 'repo_snapshots'::regclass order by 1;
--   -- ops_hub_app has NO delete grant:
--   select privilege_type from information_schema.role_table_grants
--     where table_name = 'repo_snapshots' and grantee = 'ops_hub_app' and privilege_type = 'DELETE';
--     -- must return 0 rows
--   -- fail-closed smoke test (no GUC set => zero rows for a real snapshot):
--   --   set role ops_hub_app; select * from repo_snapshots; reset role;
--   --   (expect 0 rows with no app.current_product set, even if a row exists)
-- ===========================================================================
