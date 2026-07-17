-- Migration: 20260717120100_s1_product_domain_rls_policies
-- Ops Hub product-domain reboot — Sprint S1: product-scoped RLS
-- Author: Tech Lead  Date: 2026-07-17
-- *** SECURITY LEAD REVIEW REQUIRED (matches the 20260618120100 precedent) ***
-- Forward-only. Companion to 20260717120000_s1_product_domain_schema.sql.
-- Requires that migration applied first.
--
-- This migration re-pivots the EXISTING tenant-isolation model (defined in
-- 20260618120100_enable_rls_policies.sql) from tenant/project to product. It
-- does not invent a new enforcement pattern: same fail-closed
-- `using (col = current_x_id())` shape, same non-superuser `ops_hub_app`
-- role (already created by 20260618120100 — not recreated here), same
-- transaction-local, pooler-safe `set_config(..., true)` GUC convention.
--
-- It does NOT touch `tickets`, `tenants`, `projects`, `audit_log`,
-- `feature_flags`, `kb_articles`, or their existing policies/grants in any way.
--
-- ENFORCEMENT MODEL (unchanged from 20260618120100 — restated for this axis):
--   * service_role BYPASSES RLS entirely. Migrations + trusted platform ops
--     only. Agents must NOT hold the service_role key.
--   * Agent / Inngest traffic connects as `ops_hub_app` and sets the
--     per-request product via:
--         select set_config('app.current_product', '<product-uuid>', true);
--     (transaction-local: `true` as the third arg — pooler-safe, same as the
--     existing app.current_tenant / app.current_project convention.)
--   * Default-deny: RLS on + no permissive policy for a command => zero rows
--     / that command denied, for every non-owner role.

-- ---------------------------------------------------------------------------
-- Resolver helper: current product from JWT claim OR session GUC
-- Mirrors current_tenant_id() / current_project_id() exactly: NULL-safe,
-- never throws (current_setting(..., true) = missing_ok), same casting.
-- ---------------------------------------------------------------------------
create or replace function current_product_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'product_id', '')::uuid,
    nullif(current_setting('app.current_product', true), '')::uuid
  );
$$;

-- ===========================================================================
-- Enable RLS on all four new tables (default-deny floor)
-- ===========================================================================
alter table products           enable row level security;
alter table repo_connections   enable row level security;
alter table findings           enable row level security;
alter table autonomy_policies  enable row level security;

-- ---------------------------------------------------------------------------
-- products  (root entity — mirrors the projects_select / tenants_select
-- pattern for the analogous root table: a caller sees only the one product
-- row it's scoped to, by id, not by a product_id column since products IS
-- the root. No write policy here — writes are service_role only, same as
-- projects/tenants.)
-- ---------------------------------------------------------------------------
-- FAIL CLOSED: no product set in session => zero rows. Platform/migration
-- enumeration of all products goes through service_role (bypasses RLS), so
-- no permissive null-branch is needed here.
--
-- Explicit re-grant (same rationale as the three child tables below, and as
-- t72's agent_model_routing precedent): `alter default privileges` from
-- 20260618120100 only auto-covers tables created by the SAME role that ran
-- it; ops_hub_app must be able to read products at runtime (autonomy_default,
-- product metadata), so this is asserted explicitly rather than trusted.
grant select on products to ops_hub_app;

create policy products_select on products
  for select to ops_hub_app, authenticated
  using (id = current_product_id());

-- ---------------------------------------------------------------------------
-- repo_connections  (product-scoped; ops_hub_app only per the reboot's
-- current write-surface decision — no direct `authenticated` write/read path
-- exists yet for this table; the dashboard reads it via the agent/API layer,
-- not a direct Supabase client. Revisit with a scoped follow-up migration,
-- same discipline as the audit_log_insert C1 precedent, if/when a portal
-- direct-read need is confirmed.)
-- ---------------------------------------------------------------------------
grant select, insert, update on repo_connections to ops_hub_app;
revoke delete on repo_connections from ops_hub_app;

create policy repo_connections_select on repo_connections
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy repo_connections_insert on repo_connections
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy repo_connections_update on repo_connections
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- no delete policy: connections are suspended via status, not hard-deleted
-- (mirrors the tickets convention of state over deletion). Combined with the
-- REVOKE DELETE above, DELETE from ops_hub_app is doubly denied.

-- ---------------------------------------------------------------------------
-- findings  (product-scoped; ops_hub_app only — same write-surface decision
-- as repo_connections. This is the new system-of-record; product_id FK is
-- ON DELETE RESTRICT specifically so a product can't be dropped out from
-- under audit-relevant finding history.)
-- ---------------------------------------------------------------------------
grant select, insert, update on findings to ops_hub_app;
revoke delete on findings from ops_hub_app;

create policy findings_select on findings
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy findings_insert on findings
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy findings_update on findings
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- no delete policy: findings are dismissed/reopened via state, not
-- hard-deleted — same rationale as tickets.

-- ---------------------------------------------------------------------------
-- autonomy_policies  (product-scoped; ops_hub_app only — this is the
-- runtime-consumed gate table itself; it must never be reachable by a
-- portal `authenticated` session directly. Dashboard writes to this table
-- go through the agent/API layer, same posture as feature_flags/
-- agent_model_routing writes today.)
-- ---------------------------------------------------------------------------
grant select, insert, update on autonomy_policies to ops_hub_app;
revoke delete on autonomy_policies from ops_hub_app;

create policy autonomy_policies_select on autonomy_policies
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy autonomy_policies_insert on autonomy_policies
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy autonomy_policies_update on autonomy_policies
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- no delete policy: an autonomy level is set back to 'off', not deleted —
-- the row's history (updated_by/updated_at) plus audit_log is the record of
-- every graduation/demotion decision.

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   -- 4 new tables present, RLS enabled on all:
--   select relname, relrowsecurity from pg_class
--     where relname in ('products','repo_connections','findings','autonomy_policies');
--   -- resolver present:
--   select proname from pg_proc where proname = 'current_product_id';
--   -- policy inventory (expect: products_select; repo_connections_select/insert/update;
--   -- findings_select/insert/update; autonomy_policies_select/insert/update):
--   select polrelid::regclass, polname from pg_policy
--     where polrelid in ('products'::regclass, 'repo_connections'::regclass,
--                         'findings'::regclass, 'autonomy_policies'::regclass)
--     order by 1, 2;
--   -- ops_hub_app has NO delete grant on the three product_id-bearing tables:
--   select table_name, privilege_type from information_schema.role_table_grants
--     where table_name in ('repo_connections','findings','autonomy_policies')
--       and grantee = 'ops_hub_app' and privilege_type = 'DELETE';  -- must return 0 rows
--   -- ops_hub_app HAS explicit SELECT on products (the re-grant above actually landed):
--   select privilege_type from information_schema.role_table_grants
--     where table_name = 'products' and grantee = 'ops_hub_app' and privilege_type = 'SELECT';
--     -- must return exactly one row: SELECT
--   -- fail-closed smoke test (no GUC set => zero rows for a real product row):
--   --   insert a throwaway products row as service_role, then as ops_hub_app with no
--   --   app.current_product set, `select * from products` must return 0 rows.
--   -- isolation smoke test (two products, only one GUC set => only that product's row):
--   --   Run AS ops_hub_app (`set role ops_hub_app;`) — NOT service_role, which bypasses
--   --   RLS and would show every product's rows, falsely reading as a leak.
--   --   set_config(..., true) is transaction-local: run set_config and the select
--   --   in the SAME SQL Editor batch. Then `reset role;`.
--   --   set role ops_hub_app;
--   --   select set_config('app.current_product', '<product-A-uuid>', true);
--   --   select * from findings;  -- must show ONLY product A's findings, never product B's.
--   --   reset role;
--   --
--   -- Confirm untouched: tickets/tenants/projects/audit_log/feature_flags/kb_articles
--   -- policy counts are unchanged from before this migration (diff against
--   -- 20260618120100 + 20260704000000 + 20260706000000 + 20260708000000 + 20260708010000).
-- ===========================================================================
