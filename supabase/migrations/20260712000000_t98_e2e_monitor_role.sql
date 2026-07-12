-- Migration: 20260712000000_t98_e2e_monitor_role
-- Sprint 10 / T-98: narrow DB role for the synthetic-ticket downstream E2E
--   monitor's scheduled workflow (monitor-e2e-pipeline.yml) to read/write ITS
--   OWN sentinel ticket row -- WITHOUT reusing OPS_HUB_APP_LOGIN_URL (that
--   credential's tenant scoping is CLIENT-ASSERTED via a GUC, which in an
--   unattended, 24/7 scheduled context means unbounded prod customer-ticket
--   read/write the moment the credential leaks -- explicitly REJECTED by the
--   Security Lead design review, DECISIONS.md 2026-07-12, Ruling 3 / Amendment
--   A2).
-- Author: Production Manager  Date: 2026-07-12
-- Design origin: Security Lead design review of T-98 (DECISIONS.md 2026-07-12,
--   "T-98 Security Lead design review: synthetic-ticket downstream E2E
--   monitor — APPROVED WITH CONDITIONS", Ruling 3 / SC1). Mirrors the T-93
--   `eval_gate_ci_writer` pattern verbatim (supabase/migrations/
--   20260710000000_t93_eval_gate_ci_writer_role.sql), adapted to this role's
--   grant surface (SELECT+INSERT+UPDATE on tickets, not INSERT-only — this
--   role must read back state to know when to reset/assert, not just write
--   once) and to HARDCODED (not GUC-derived) RLS predicates: the load-bearing
--   property the review specified is that this role is structurally incapable
--   of touching any tenant other than the one synthetic test tenant, no matter
--   what the calling workflow code asserts or how it is compromised.
--
-- *** FOUNDER-APPLY REQUIRED (Supabase SQL Editor, service_role / project owner) — see FQ-75 ***
-- Forward-only. Applied via Supabase SQL Editor as service_role / the project
-- owner (same split-of-duties precedent as every prior role-creation migration
-- this project — T-03's ops_hub_app, T-93's eval_gate_ci_writer). Agents never
-- hold service_role at runtime (CLAUDE.md non-negotiable #3). Do NOT
-- self-apply. This migration changes nothing until a founder runs it.
-- Idempotent / safe to re-run: role-create is guarded by a `pg_roles`
-- existence check + a re-assert `alter role`; `drop policy if exists` precedes
-- `create policy`; REVOKE/GRANT are naturally idempotent.
--
-- Requires 20260618120000_initial_schema.sql (tickets table) and
-- 20260618120100_enable_rls_policies.sql (RLS enabled on tickets) applied
-- first — both already live.
--
-- ============================================================================
-- WHY THIS ROLE, AND WHY IT IS SHAPED EXACTLY LIKE THIS
-- ============================================================================
-- monitor-e2e-pipeline.yml (T-98) is a SCHEDULED (every 6h, SC5) workflow that
-- holds a write-capable DB credential unattended, 24/7 — a materially worse
-- context than eval-gate-live.yml's pull_request trigger (a human opens the
-- PR) or any workflow_dispatch diagnostic (a human clicks "Run"). Threat
-- model: assume this credential leaks (a compromised Action dependency, or
-- code landing on main that exfiltrates it on the next scheduled run). The
-- role must be unable to do anything beyond read/write its own one
-- synthetic-tenant sentinel ticket.
--
--   * LOGIN                — must connect for the scheduled job to use it.
--   * NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION — explicit, not left
--                             to CREATE ROLE defaults, so a re-run of this
--                             migration provably converges a pre-existing role
--                             to this exact shape (defaults would not strip an
--                             attribute a prior create had set).
--   * NOBYPASSRLS           — RLS is a REAL boundary for this role (the entire
--                             point — unlike a superuser/OPS_HUB_APP_LOGIN_URL-
--                             class credential, whose GUC-based scoping this
--                             role structurally cannot rely on or need).
--   * NOINHERIT             — never auto-inherits another role's privileges.
--   * CONNECTION LIMIT 2    — a scheduled job opens ~1 connection at a time;
--                             2 caps a runaway/leak (T-93 used 3 for a single-
--                             INSERT CI job; 2 is tighter here since this role
--                             never needs concurrent connections either).
--   * statement_timeout 15s — a SELECT/INSERT/UPDATE touching one row is
--                             sub-millisecond; 15s bounds how long any leaked
--                             credential could ever run a statement, even
--                             within its already-narrow table scope.
--
-- Privilege surface (the whole point):
--   * GRANT SELECT, INSERT, UPDATE ON tickets ONLY. Deliberately NO DELETE
--     (the sentinel row is reset via UPDATE, never removed — tickets are
--     never hard-deleted anywhere in this schema, per the initial schema's
--     own comment: "no delete policy: tickets are not hard-deleted"), NO
--     audit_log (the workflow's own GitHub Actions run log is this
--     credential's audit trail — same reasoning T-93 used for
--     eval_gate_ci_writer), and no privilege on any other table (no
--     eval_gate_runs, no projects, no tenants, nothing).
--   * GRANT USAGE ON SCHEMA public — prerequisite only; grants nothing on any
--     table (mirrors ops_hub_app / eval_gate_ci_writer).
--
-- RLS policies — HARDCODED (NOT GUC-derived) tenant/project predicate:
--     USING / WITH CHECK
--       (tenant_id  = '00000000-0000-0000-0000-000000000010'::uuid
--        AND project_id = '00000000-0000-0000-0000-000000000001'::uuid)
--   This is the load-bearing security property the review specified: even if
--   the calling workflow code asserted a different tenant (bug, compromise,
--   or a copy-pasted snippet from elsewhere in this repo that sets a
--   set_config GUC), the DATABASE itself refuses any row outside this one
--   synthetic tenant/project pair — there is no GUC in this policy for the
--   role to assert its way around. Separate SELECT/INSERT/UPDATE policies
--   (not one FOR ALL) so each grant is independently auditable, matching the
--   existing ops_hub_app convention (20260618120100).
--
-- Password: intentionally NOT set here (CLAUDE.md non-negotiable #1) — a
--   LOGIN role with no password cannot authenticate, so this role is INERT
--   the moment it is created. Follow-up (Production Manager, after this
--   migration is applied): run
--   supabase/ops/t98_set_e2e_monitor_password.sql (same pg_temp/
--   SELECT-readback pattern T-93 used) and set the result as GitHub secret
--   E2E_MONITOR_DB_URL, then run verify-e2e-monitor-role.yml (the T-90-style
--   dispositive negative-test proof SC1 requires) before the schedule is
--   trusted.

-- ---------------------------------------------------------------------------
-- 1. The role (LOGIN, NOBYPASSRLS, NOINHERIT, CONNECTION LIMIT 2; no password)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'e2e_monitor') then
    create role e2e_monitor with
      login nosuperuser nocreatedb nocreaterole noreplication
      noinherit nobypassrls connection limit 2;
  else
    -- Re-assert the attributes so a re-run converges to the specified shape
    -- regardless of prior state (does NOT touch any password a follow-up
    -- step may have set — `alter role ... with <attrs>` leaves it as-is).
    alter role e2e_monitor with
      login nosuperuser nocreatedb nocreaterole noreplication
      noinherit nobypassrls connection limit 2;
  end if;
end
$$;

-- Per-role hard statement ceiling.
alter role e2e_monitor set statement_timeout = '15s';

-- ---------------------------------------------------------------------------
-- 2. Privileges — SELECT, INSERT, UPDATE on tickets ONLY, plus schema USAGE
-- ---------------------------------------------------------------------------
grant usage on schema public to e2e_monitor;

-- REVOKE ALL first so the final privilege set is provably EXACTLY
-- {SELECT, INSERT, UPDATE}, independent of any inherited/default grant.
revoke all on tickets from e2e_monitor;
grant select, insert, update on tickets to e2e_monitor;

-- ---------------------------------------------------------------------------
-- 3. RLS policies scoped to this role — synthetic tenant/project HARDCODED
-- ---------------------------------------------------------------------------
-- tickets already has RLS enabled (20260618120100). Because e2e_monitor is
-- NOBYPASSRLS and NOINHERIT (not a member of ops_hub_app), the existing
-- ops_hub_app policies do NOT apply to it — without its own policies, RLS
-- default-deny blocks every read/write (fail-closed).
drop policy if exists tickets_select_e2e_monitor on tickets;
create policy tickets_select_e2e_monitor on tickets
  for select to e2e_monitor
  using (
    tenant_id  = '00000000-0000-0000-0000-000000000010'::uuid
    and project_id = '00000000-0000-0000-0000-000000000001'::uuid
  );

drop policy if exists tickets_insert_e2e_monitor on tickets;
create policy tickets_insert_e2e_monitor on tickets
  for insert to e2e_monitor
  with check (
    tenant_id  = '00000000-0000-0000-0000-000000000010'::uuid
    and project_id = '00000000-0000-0000-0000-000000000001'::uuid
  );

drop policy if exists tickets_update_e2e_monitor on tickets;
create policy tickets_update_e2e_monitor on tickets
  for update to e2e_monitor
  using (
    tenant_id  = '00000000-0000-0000-0000-000000000010'::uuid
    and project_id = '00000000-0000-0000-0000-000000000001'::uuid
  )
  with check (
    tenant_id  = '00000000-0000-0000-0000-000000000010'::uuid
    and project_id = '00000000-0000-0000-0000-000000000001'::uuid
  );

comment on policy tickets_select_e2e_monitor on tickets is
  'T-98: role-scoped SELECT for e2e_monitor, hardcoded to the synthetic test '
  'tenant/project (00...0010 / 00...0001). Structurally cannot see any other '
  'tenant''s tickets regardless of GUC state — there is no GUC in this policy.';
comment on policy tickets_insert_e2e_monitor on tickets is
  'T-98: role-scoped INSERT for e2e_monitor, hardcoded to the synthetic test '
  'tenant/project. Cannot insert a row scoped to any other tenant.';
comment on policy tickets_update_e2e_monitor on tickets is
  'T-98: role-scoped UPDATE for e2e_monitor, hardcoded to the synthetic test '
  'tenant/project (both USING and WITH CHECK) — cannot target a real tenant''s '
  'row, and cannot rewrite a synthetic row''s tenant_id/project_id to escape scope.';

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying —
-- these four are also re-proven live by verify-e2e-monitor-role.yml, the
-- SC1 dispositive negative-test workflow, once E2E_MONITOR_DB_URL exists):
--
--   -- (a) role exists with the specified attributes:
--   select rolname, rolcanlogin, rolinherit, rolbypassrls, rolconnlimit
--     from pg_roles where rolname = 'e2e_monitor';
--     -- expect: e2e_monitor | t | f | f | 2
--
--   -- (b) statement_timeout default is 15s:
--   select rolname, rolconfig from pg_roles where rolname = 'e2e_monitor';
--     -- expect rolconfig to contain: statement_timeout=15s
--
--   -- (c) table privileges are EXACTLY {SELECT, INSERT, UPDATE} — no DELETE:
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name = 'tickets' and grantee = 'e2e_monitor'
--     order by privilege_type;
--     -- expect exactly 3 rows: INSERT, SELECT, UPDATE
--
--   -- (d) all three policies exist:
--   select polname from pg_policy
--     where polrelid = 'tickets'::regclass and polname like '%_e2e_monitor'
--     order by polname;
--     -- expect 3 rows: tickets_insert_e2e_monitor, tickets_select_e2e_monitor,
--     --                 tickets_update_e2e_monitor
-- ===========================================================================
