-- Migration: 20260710000000_t93_eval_gate_ci_writer_role
-- Sprint 9 / T-93: A narrowly-scoped Postgres role for the live eval gate's
--   DB-persistence step (eval-gate-live.yml) to write its run record to
--   `eval_gate_runs` — WITHOUT reusing the owner-level, RLS-bypassing
--   SUPABASE_STAGING_DB_URL credential.
-- Author: Tech Lead  Date: 2026-07-10
-- Design origin: Security Lead design review of T-93's CI DB persistence.
--   That review REJECTED reusing the existing `SUPABASE_STAGING_DB_URL` GitHub
--   secret for this write: it turned out to be an owner-level, RLS-BYPASSING
--   superuser credential (not the scoped `ops_hub_app` role it was assumed to
--   be). Handing that to the repo's first `pull_request`-auto-triggered,
--   secret-holding job (eval-gate-live.yml, T-93) would mean an unbounded,
--   RLS-bypassing prod-customer-ticket credential one malicious-PR leak away.
--   The review specified this new, single-purpose role instead. This migration
--   implements that spec verbatim.
--
-- *** FOUNDER-APPLY REQUIRED (Supabase SQL Editor, service_role / project owner) — see FQ-72 ***
-- Forward-only. Applied via Supabase SQL Editor as service_role / the project
-- owner (which can CREATE ROLE — same split-of-duties precedent as ops_hub_app's
-- creation, DECISIONS.md 2026-06-18 T-03). Agents never hold service_role at
-- runtime (CLAUDE.md non-negotiable #3). Do NOT self-apply. This migration
-- changes nothing until a founder runs it in the SQL Editor.
-- Idempotent / safe to re-run: role create is guarded by a `pg_roles` existence
-- check + a re-assert `alter role`; `drop policy if exists` precedes `create
-- policy`; REVOKE/GRANT are naturally idempotent.
--
-- Requires 20260704010000_t58_agent_cost_eval_health.sql applied first (it
-- creates `eval_gate_runs` and enables RLS on it).
--
-- ============================================================================
-- WHY THIS ROLE, AND WHY IT IS SHAPED EXACTLY LIKE THIS
-- ============================================================================
-- eval-gate-live.yml (T-93) is the repo's first job that is BOTH auto-triggered
-- on `pull_request` AND holds a secret. Its DB-persistence step (STEP 6) wants
-- to write ONE row per live eval run to `eval_gate_runs` via
-- recordEvalGateRun() (src/metrics/evalHealth.ts). The threat model: assume the
-- connection string this job uses can leak (a malicious same-repo PR editing
-- the workflow). So the credential it uses must be able to do essentially
-- nothing except that one INSERT.
--
-- The role therefore has, deliberately and minimally:
--   * LOGIN               — it must be able to connect for CI to use it.
--   * NOBYPASSRLS         — it does NOT bypass RLS. The INSERT policy below is a
--                           real boundary for it (unlike SUPABASE_STAGING_DB_URL,
--                           whose superuser bypasses RLS entirely — the exact
--                           property that got that credential rejected here).
--   * NOINHERIT           — never auto-inherits privileges of any role it might
--                           later be granted membership in (defense-in-depth).
--   * CONNECTION LIMIT 3  — a CI job opens ~1 connection; 3 caps a runaway/leak.
--   * statement_timeout 15s (set below) — a single INSERT is sub-millisecond; a
--                           15s ceiling means a leaked cred cannot run long,
--                           resource-heavy queries even within its INSERT scope.
--
-- Privilege surface (the whole point):
--   * GRANT INSERT ON eval_gate_runs ONLY. Deliberately NO SELECT, NO UPDATE, NO
--     DELETE, and no privilege on ANY other table. Verified sufficient against
--     the actual writer: recordEvalGateRun issues a plain `INSERT ... VALUES`
--     with no RETURNING and no ON CONFLICT, and does not supply the generated
--     `pass_rate` column — so table INSERT privilege alone makes the write work.
--     A leaked credential cannot read one row of any table (including this one).
--   * GRANT USAGE ON SCHEMA public — a prerequisite to even reference the table;
--     it is NOT table access and grants nothing on any table. Mirrors the
--     ops_hub_app schema-usage grant (20260618120100).
--
-- RLS INSERT policy predicate — `project_id is null and run_type = 'llm_rubric'`:
--   VERIFIED against the actual insert shape, not taken on trust. The live gate's
--   write path (eval-gate-live.yml STEP 6 -> compare-baseline.py `capture` ->
--   recordEvalGateRun) produces project_id = NULL (the payload never sets
--   projectId, so recordEvalGateRun's `run.projectId ?? null` yields NULL — the
--   eval gate is platform-wide CI health data, not tenant/project data, exactly
--   as T-58 designed eval_gate_runs' nullable project_id) and run_type =
--   'llm_rubric' (compare-baseline.py line ~255; the real graded gate is always
--   llm_rubric). The predicate matches reality exactly — NO correction needed.
--   It is INTENTIONALLY unable to write schema_validation rows or project-scoped
--   rows: this credential exists for exactly one caller writing exactly one
--   row-shape. A future per-project eval suite (project_id not null) or a writer
--   for schema_validation rows would require DELIBERATELY widening this policy —
--   that narrowness is the security property, not an oversight.
--
-- Password: intentionally NOT set here (and never committed anywhere — CLAUDE.md
--   non-negotiable #1). A LOGIN role with no password cannot authenticate, so
--   this role is INERT the moment it is created — it exists but can do nothing
--   until the follow-up task (with Production Manager) sets a password and builds
--   the `EVAL_GATE_DB_URL` GitHub secret (explicit `:5432` port) + wires the
--   INSERT into eval-gate-live.yml STEP 6. That is a separate, deliberate step;
--   applying THIS migration alone does not make the gate write to the DB.

-- ---------------------------------------------------------------------------
-- 1. The role (LOGIN, NOBYPASSRLS, NOINHERIT, CONNECTION LIMIT 3; no password)
-- ---------------------------------------------------------------------------
-- The full explicit negative attribute set (NOSUPERUSER/NOCREATEDB/NOCREATEROLE/
-- NOREPLICATION) is spelled out verbatim per the Security Lead review spec — not
-- left to CREATE ROLE defaults — so the `alter role` re-assert branch below
-- provably converges a pre-existing role to the exact specified shape (defaults
-- would NOT strip an attribute a prior create had set).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'eval_gate_ci_writer') then
    create role eval_gate_ci_writer with
      login nosuperuser nocreatedb nocreaterole noreplication
      noinherit nobypassrls connection limit 3;
  else
    -- Re-assert the attributes so a re-run converges to the specified shape
    -- regardless of prior state (does NOT touch any password that a follow-up
    -- step may have set — `alter role ... with <attrs>` leaves the password as-is).
    alter role eval_gate_ci_writer with
      login nosuperuser nocreatedb nocreaterole noreplication
      noinherit nobypassrls connection limit 3;
  end if;
end
$$;

-- Per-role hard statement ceiling. A single-row INSERT is sub-millisecond; 15s
-- bounds how long a leaked credential could ever run any statement.
alter role eval_gate_ci_writer set statement_timeout = '15s';

-- ---------------------------------------------------------------------------
-- 2. Privileges — INSERT on eval_gate_runs ONLY, plus the schema-usage prereq
-- ---------------------------------------------------------------------------
-- Schema USAGE is the minimum needed to reference the table; it is not table
-- access and grants zero privilege on any table (mirrors ops_hub_app,
-- 20260618120100). The spec's "INSERT only" is about TABLE privileges.
grant usage on schema public to eval_gate_ci_writer;

-- REVOKE ALL first so the final privilege set is provably EXACTLY {INSERT},
-- independent of any inherited/default grant that might otherwise be present.
revoke all on eval_gate_runs from eval_gate_ci_writer;
grant insert on eval_gate_runs to eval_gate_ci_writer;

-- ---------------------------------------------------------------------------
-- 3. RLS INSERT policy scoped to this role (predicate verified against the
--    actual recordEvalGateRun insert shape — see header)
-- ---------------------------------------------------------------------------
-- eval_gate_runs already has RLS enabled (20260704010000_t58). Because
-- eval_gate_ci_writer is NOBYPASSRLS and NOINHERIT (not a member of ops_hub_app),
-- the existing ops_hub_app policies do NOT apply to it — it needs its own policy,
-- and without one RLS default-deny blocks every INSERT (fail-closed).
drop policy if exists eval_gate_runs_insert_ci on eval_gate_runs;
create policy eval_gate_runs_insert_ci on eval_gate_runs
  for insert to eval_gate_ci_writer
  with check (project_id is null and run_type = 'llm_rubric');

comment on policy eval_gate_runs_insert_ci on eval_gate_runs is
  'T-93: INSERT-only policy for the scoped CI role eval_gate_ci_writer (live eval '
  'gate DB persistence). Predicate project_id IS NULL AND run_type=''llm_rubric'' '
  'matches the exact row recordEvalGateRun writes (platform-wide, real graded gate). '
  'Intentionally cannot write schema_validation or project-scoped rows — widening '
  'requires a deliberate policy change. Paired with GRANT INSERT (no SELECT) so a '
  'leaked CI credential can write one run row and read nothing.';

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--
--   -- (a) Role exists with the specified attributes:
--   select rolname, rolcanlogin, rolinherit, rolbypassrls, rolconnlimit
--     from pg_roles where rolname = 'eval_gate_ci_writer';
--     -- expect: eval_gate_ci_writer | t | f | f | 3
--     --         (canlogin=t, inherit=f, bypassrls=f, connlimit=3)
--
--   -- (b) statement_timeout default is 15s:
--   select rolname, rolconfig from pg_roles where rolname = 'eval_gate_ci_writer';
--     -- expect rolconfig to contain: statement_timeout=15s
--
--   -- (c) Table privileges are EXACTLY {INSERT} — no SELECT/UPDATE/DELETE:
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name = 'eval_gate_runs' and grantee = 'eval_gate_ci_writer';
--     -- expect EXACTLY one row: eval_gate_ci_writer | INSERT
--
--   -- (d) The INSERT policy exists on eval_gate_runs:
--   select polname from pg_policy
--     where polrelid = 'eval_gate_runs'::regclass
--       and polname = 'eval_gate_runs_insert_ci';
--     -- expect one row.
-- ===========================================================================
