-- t98_set_e2e_monitor_password.sql
-- Sprint 10 / T-98: ONE-SITTING founder action to provision the `e2e_monitor`
-- role's password and hand back the exact GitHub secret value to store.
--
-- NOT a schema migration (no DDL on any table) -- this is a founder-run
-- credential-provisioning script, kept in the repo only for provenance and so
-- a re-run (e.g. rotation, or "I closed the tab before copying the value") is
-- a copy-paste of this exact file rather than something reconstructed from
-- memory. Verbatim copy of the T-93 pattern
-- (supabase/ops/t93_set_eval_gate_ci_writer_password.sql), same design origin
-- (the T-93 password-provisioning Security Lead ruling applies identically
-- here: a service_role-class DSN must never sit in GitHub Actions, and
-- workflow_dispatch inputs are shown unmasked, so there is no safe
-- GitHub-Actions-automated path — the SQL-Editor route is the only safe one).
--
-- Author: Production Manager  Date: 2026-07-12
--
-- *** FOUNDER-RUN REQUIRED (Supabase SQL Editor, project yocoljutbiizdbfraapx,
--     signed in as project owner / service_role) *** -- same channel as every
--     migration this project has ever used. Do NOT run this from any CI
--     workflow or agent session -- ALTER ROLE ... PASSWORD requires exactly
--     the privilege level CLAUDE.md non-negotiable #3 says agents never hold
--     at runtime.
--
-- WHAT THIS DOES, AND WHY IT IS SAFE TO PASTE-AND-RUN AS ONE BLOCK:
--   1. Generates a strong random password ENTIRELY INSIDE Postgres (pgcrypto's
--      gen_random_bytes, base64-encoded then made URL-safe) -- the plaintext
--      value never appears as a literal in this file, so nothing here is a
--      credential (safe to commit) and nothing sensitive is saved in the SQL
--      Editor's query-TEXT history.
--   2. Applies it via `execute format('alter role ... password %L', pw)` from
--      INSIDE a session-local (pg_temp) function body -- dynamic SQL, so the
--      password never appears as a literal in a top-level, separately-logged
--      DDL statement either.
--   3. Returns the fully-assembled DSN as the function's single return value,
--      surfaced via a plain SELECT (not a RAISE NOTICE, which can mirror to
--      server logs). This is the ONE thing you copy.
--   4. The helper function lives in `pg_temp` -- it disappears when this SQL
--      Editor tab's connection ends. There is nothing to clean up afterward.
--
-- Idempotent / safe to re-run: ALTER ROLE ... PASSWORD is a reset, not a
-- create -- re-running this (e.g. to rotate, or because you closed the tab
-- before pasting the value into GitHub) simply issues a new password and a
-- new DSN. The OLD value stops working the moment you re-run it, so re-run
-- and re-paste into GitHub together, in the same sitting, exactly like the
-- first time.
--
-- After running: copy the ENTIRE value shown in the result grid (starts with
-- `postgresql://`) and paste it, unmodified, into:
--   GitHub -> this repo -> Settings -> Secrets and variables -> Actions
--   -> "New repository secret" -> Name: E2E_MONITOR_DB_URL -> Value: (paste) -> Add secret
-- That is the credential's ONLY home. It is not written to Vault, Coolify, a
-- password manager, or anywhere else -- if it's ever needed again, re-run
-- this script rather than retrieving a stored copy.
--
-- ============================================================================

create or replace function pg_temp.t98_set_e2e_monitor_password()
returns text
language plpgsql
as $fn$
declare
  pw text;
begin
  -- 24 random bytes, base64-encoded, made URL/DSN-safe (no '+' '/' '=' that
  -- would otherwise need percent-encoding in a postgresql:// URI).
  pw := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  execute format('alter role e2e_monitor password %L', pw);

  -- Session-pooler DSN, explicit :5432 (the known parsing footgun --
  -- DECISIONS.md 2026-06-21), pooler username in the required
  -- <role>.<project-ref> dot-suffix form (DECISIONS.md 2026-06-23),
  -- sslmode=require.
  return format(
    'postgresql://e2e_monitor.yocoljutbiizdbfraapx:%s@aws-1-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require',
    pw
  );
end;
$fn$;

-- Run it. The ONE column in the result grid below is the complete
-- E2E_MONITOR_DB_URL value -- copy it in full, then paste it into the GitHub
-- secret described above.
select pg_temp.t98_set_e2e_monitor_password()
  as "E2E_MONITOR_DB_URL -- copy this ENTIRE value into GitHub -> Settings -> Secrets and variables -> Actions -> New repository secret (name: E2E_MONITOR_DB_URL)";
