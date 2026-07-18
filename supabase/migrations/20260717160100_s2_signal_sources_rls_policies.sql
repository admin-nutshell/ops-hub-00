-- Migration: 20260717160100_s2_signal_sources_rls_policies
-- Ops Hub product-domain reboot — Sprint S2: signal_sources product-scoped RLS
-- Author: Tech Lead  Date: 2026-07-17
-- *** SECURITY LEAD REVIEW REQUIRED (matches the 20260717120100/20260717140100
-- precedent) ***
-- Forward-only. Companion to 20260717160000_s2_signal_sources_schema.sql.
-- Requires that migration applied first. Requires current_product_id()
-- (defined in 20260717120100_s1_product_domain_rls_policies.sql) to exist.
--
-- Re-uses the exact enforcement model already established for
-- repo_connections/repo_snapshots — same fail-closed
-- `using (product_id = current_product_id())` shape, same `ops_hub_app`
-- non-superuser role, same transaction-local GUC convention. No new pattern
-- invented here.
--
-- ops_hub_app needs select + insert + update (no delete): the detection-agent
-- Inngest function upserts (`insert ... on conflict (product_id, kind) do
-- update`) to create-or-reuse a source idempotently, which requires both the
-- insert and update policies under RLS even though the update branch is a
-- no-op in practice (see the schema migration's IDEMPOTENCY DESIGN note).
-- Mirrors repo_connections/repo_snapshots exactly.
--
-- NOT YET APPLIED to the live Supabase project as of this commit — same
-- founder-runs-SQL-Editor workflow as every migration in this repo (see the
-- companion schema migration's header note).

alter table signal_sources enable row level security;

grant select, insert, update on signal_sources to ops_hub_app;
revoke delete on signal_sources from ops_hub_app;

create policy signal_sources_select on signal_sources
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy signal_sources_insert on signal_sources
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy signal_sources_update on signal_sources
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- no delete policy: a source is suspended via status, not hard-deleted —
-- same convention as repo_connections/findings/autonomy_policies/
-- repo_snapshots (state/replacement over deletion). Combined with the
-- REVOKE DELETE above, DELETE from ops_hub_app is doubly denied.

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   -- table present, RLS enabled:
--   select relname, relrowsecurity from pg_class where relname = 'signal_sources';
--   -- policy inventory (expect: signal_sources_select/insert/update):
--   select polname from pg_policy where polrelid = 'signal_sources'::regclass order by 1;
--   -- ops_hub_app has NO delete grant:
--   select privilege_type from information_schema.role_table_grants
--     where table_name = 'signal_sources' and grantee = 'ops_hub_app' and privilege_type = 'DELETE';
--     -- must return 0 rows
--   -- real FK landed on findings.source_id, and it is the COMPOSITE form
--   -- (product_id, source_id) -> signal_sources(product_id, id), not a
--   -- simple FK on source_id alone (CodeRabbit PR #543 finding):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'findings'::regclass and conname = 'findings_source_id_fkey';
--     -- expect exactly 1 row; definition should read
--     -- FOREIGN KEY (product_id, source_id) REFERENCES signal_sources(product_id, id)
--     -- ON DELETE SET NULL (source_id)
--   -- supporting unique(product_id, id) landed on signal_sources:
--   select conname from pg_constraint
--     where conrelid = 'signal_sources'::regclass and contype = 'u';
--     -- expect two rows: the (product_id, kind) idempotency key and the
--     -- (product_id, id) key that makes the composite FK above possible
--   -- fail-closed smoke test (no GUC set => zero rows for a real source):
--   --   set role ops_hub_app; select * from signal_sources; reset role;
--   --   (expect 0 rows with no app.current_product set, even if a row exists)
-- ===========================================================================
