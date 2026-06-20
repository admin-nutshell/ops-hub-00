-- Migration: 20260618120100_enable_rls_policies
-- Ops Hub RLS + tenant-isolation policies — M1 / Sprint 1 (T-03)
-- Author: Tech Lead  Date: 2026-06-18
-- *** SECURITY LEAD REVIEW REQUIRED (T-03, gates T-18) ***
-- Forward-only. Companion to 20260618120000_initial_schema.sql.
-- See docs/engineering/database-schema.md §2 and §6 for the enforcement model.
--
-- ENFORCEMENT MODEL (the load-bearing decision):
--   * service_role BYPASSES RLS entirely. Reserve it for migrations + trusted
--     platform ops ONLY. Agents must NOT hold the service_role key.
--   * Agent / Inngest traffic connects as a dedicated NON-SUPERUSER role
--     `ops_hub_app` (does not bypass RLS) and sets the per-request tenant via:
--         select set_config('app.current_tenant', '<tenant-uuid>', true);
--         select set_config('app.current_project', '<project-uuid>', true);
--   * Portal traffic connects as `authenticated` (Supabase Auth) and carries
--     tenant_id as a JWT claim.
--   * "current tenant"/"current project" resolve from EITHER source via the
--     helper functions below, so one policy serves both paths.
--   * Default-deny: RLS on + no permissive policy => zero rows.

-- ---------------------------------------------------------------------------
-- Application role (non-superuser; does NOT bypass RLS)
-- NOTE: role creation may be managed outside migrations on hosted Supabase.
-- If `create role` is not permitted in this environment, create `ops_hub_app`
-- via the Supabase dashboard / CLI and keep the grants below.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ops_hub_app') then
    create role ops_hub_app nologin;  -- a connectable login role is layered on in infra (T-12)
  end if;
end
$$;

grant usage on schema public to ops_hub_app;
grant select, insert, update, delete on all tables in schema public to ops_hub_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to ops_hub_app;

-- ---------------------------------------------------------------------------
-- Resolver helpers: current tenant / project from JWT claim OR session GUC
-- ---------------------------------------------------------------------------
create or replace function current_tenant_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
    nullif(current_setting('app.current_tenant', true), '')::uuid
  );
$$;

create or replace function current_project_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'project_id', '')::uuid,
    nullif(current_setting('app.current_project', true), '')::uuid
  );
$$;

-- ===========================================================================
-- Enable RLS on ALL six tables (default-deny floor)
-- ===========================================================================
alter table projects      enable row level security;
alter table tenants       enable row level security;
alter table tickets       enable row level security;
alter table audit_log     enable row level security;
alter table feature_flags enable row level security;
alter table kb_articles   enable row level security;

-- ---------------------------------------------------------------------------
-- projects  (project-scoped registry)
--   read: any app/portal caller may read the project(s) in their scope.
--   write: service_role only (bypasses RLS) — no write policy granted here.
-- ---------------------------------------------------------------------------
-- FAIL CLOSED: no project set in session => zero rows. Platform/migration
-- enumeration of all projects goes through service_role (which bypasses RLS),
-- so no permissive null-branch is needed here.
create policy projects_select on projects
  for select to ops_hub_app, authenticated
  using (id = current_project_id());

-- ---------------------------------------------------------------------------
-- tenants  (tenant-scoped: a tenant sees only its own row)
-- ---------------------------------------------------------------------------
create policy tenants_select on tenants
  for select to ops_hub_app, authenticated
  using (id = current_tenant_id());

-- writes to tenants are platform operations (service_role) — no app write policy.

-- ---------------------------------------------------------------------------
-- tickets  (tenant-scoped, full CRUD within the tenant)
-- ---------------------------------------------------------------------------
create policy tickets_select on tickets
  for select to ops_hub_app, authenticated
  using (tenant_id = current_tenant_id());

create policy tickets_insert on tickets
  for insert to ops_hub_app, authenticated
  with check (tenant_id = current_tenant_id());

create policy tickets_update on tickets
  for update to ops_hub_app, authenticated
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- no delete policy: tickets are not hard-deleted (use wont_fix/duplicate/closed states).

-- ---------------------------------------------------------------------------
-- audit_log  (APPEND-ONLY: insert only; tenant-scoped reads)
--   INSERT allowed; SELECT scoped to current tenant; NO update/delete policy
--   => updates/deletes denied for ops_hub_app (service_role can still modify;
--      residual noted in schema doc §6 / flag #2 for Security Lead).
-- ---------------------------------------------------------------------------
create policy audit_log_insert on audit_log
  for insert to ops_hub_app, authenticated
  with check (true);   -- writers may stamp any tenant they are acting for; the
                       -- actor/tenant_id are recorded; cross-tenant write abuse
                       -- is mitigated by the agent role being trusted + audited.

create policy audit_log_select on audit_log
  for select to ops_hub_app, authenticated
  using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- feature_flags  (project-scoped)
-- ---------------------------------------------------------------------------
-- FAIL CLOSED (see projects_select). Platform-wide flag reads use service_role.
create policy feature_flags_select on feature_flags
  for select to ops_hub_app, authenticated
  using (project_id = current_project_id());

-- flag writes follow the authority table in feature-flags.md; for now restrict
-- app-role writes to the caller's project scope. Cross-env toggling discipline
-- is enforced at the application layer per that policy doc.
create policy feature_flags_write on feature_flags
  for all to ops_hub_app
  using (project_id = current_project_id())
  with check (project_id = current_project_id());

-- ---------------------------------------------------------------------------
-- kb_articles  (project-scoped; per-project vector namespace)
-- ---------------------------------------------------------------------------
-- FAIL CLOSED (see projects_select). Platform-wide KB reads use service_role.
create policy kb_articles_select on kb_articles
  for select to ops_hub_app, authenticated
  using (project_id = current_project_id());

create policy kb_articles_write on kb_articles
  for all to ops_hub_app
  using (project_id = current_project_id())
  with check (project_id = current_project_id());
