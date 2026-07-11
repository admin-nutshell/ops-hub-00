-- t93_set_eval_gate_ci_writer_password.sql
-- Sprint 9 / T-93: ONE-SITTING founder action to provision the `eval_gate_ci_writer`
-- role's password and hand back the exact GitHub secret value to store.
--
-- NOT a schema migration (no DDL on any table) -- this is a founder-run
-- credential-provisioning script, kept in the repo only for provenance and so a
-- re-run (e.g. rotation, or "I closed the tab before copying the value") is a
-- copy-paste of this exact file rather than something reconstructed from memory.
--
-- Author: Production Manager  Date: 2026-07-10
-- Design origin: Security Lead ruling on T-93 password-provisioning mechanism
--   (DECISIONS.md, "T-93 eval_gate_ci_writer password provisioning" entry).
--   That ruling REJECTED a GitHub-Actions-automated path (Option A: any
--   workflow -- even workflow_dispatch-only -- that holds a service_role/owner
--   DSN as a persistent secret) because it recreates the exact "owner-class
--   credential lying around in CI" footgun the T-93 credential review (the one
--   that specified eval_gate_ci_writer in the first place) closed, and because
--   workflow_dispatch INPUT values are shown unmasked in the run's UI/API --
--   there is no safe way to hand a service_role DSN to a workflow via an input
--   box. The ruling APPROVED this SQL-Editor path (Option B) instead: it is the
--   SAME channel (Supabase Dashboard -> SQL Editor, signed in as project
--   owner/service_role) already used for every prior founder action this sprint
--   (FQ-45/61/62/67/68/71/72), and it never puts a service_role-class secret
--   into GitHub Actions at all.
--
-- *** FOUNDER-RUN REQUIRED (Supabase SQL Editor, project yocoljutbiizdbfraapx,
--     signed in as project owner / service_role) *** -- same channel as every
--     migration this sprint. Do NOT run this from any CI workflow or agent
--     session -- ALTER ROLE ... PASSWORD requires exactly the privilege level
--     CLAUDE.md non-negotiable #3 says agents never hold at runtime.
--
-- WHAT THIS DOES, AND WHY IT IS SAFE TO PASTE-AND-RUN AS ONE BLOCK:
--   1. Generates a strong random password ENTIRELY INSIDE Postgres (pgcrypto's
--      gen_random_bytes, base64-encoded then made URL-safe) -- the plaintext
--      value never appears as a literal in this file, so nothing here is a
--      credential (safe to commit) and nothing sensitive is saved in the SQL
--      Editor's query-TEXT history (only this template, with no secret in it,
--      is ever "the query you ran").
--   2. Applies it via `execute format('alter role ... password %L', pw)` from
--      INSIDE a session-local (pg_temp) function body -- dynamic SQL, so the
--      password never appears as a literal in a top-level, separately-logged
--      DDL statement either (Postgres can log `ALTER ROLE ... PASSWORD '...'`
--      verbatim at higher log_statement levels if it is the literal statement
--      submitted; wrapping it in EXECUTE inside a function avoids that).
--   3. Returns the fully-assembled DSN as the function's single return value,
--      surfaced via a plain SELECT (a normal query result, not a RAISE NOTICE
--      -- notices can be mirrored to server logs depending on log_min_messages;
--      a SELECT result is not). This is the ONE thing you copy.
--   4. The helper function lives in `pg_temp` (this session's temp schema) --
--      it is never a persisted catalog object; it disappears when this SQL
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
--   -> "New repository secret" -> Name: EVAL_GATE_DB_URL -> Value: (paste) -> Add secret
-- That is the credential's ONLY home. It is not written to Vault, Coolify, a
-- password manager, or anywhere else -- if it's ever needed again, re-run this
-- script rather than retrieving a stored copy.
--
-- ============================================================================

create or replace function pg_temp.t93_set_eval_gate_ci_writer_password()
returns text
language plpgsql
as $fn$
declare
  pw text;
begin
  -- 24 random bytes, base64-encoded, made URL/DSN-safe (no '+' '/' '=' that
  -- would otherwise need percent-encoding in a postgresql:// URI).
  pw := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  execute format('alter role eval_gate_ci_writer password %L', pw);

  -- Session-pooler DSN, explicit :5432 (the known parsing footgun --
  -- DECISIONS.md 2026-06-21), pooler username in the required
  -- <role>.<project-ref> dot-suffix form (DECISIONS.md 2026-06-23),
  -- sslmode=require.
  return format(
    'postgresql://eval_gate_ci_writer.yocoljutbiizdbfraapx:%s@aws-1-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require',
    pw
  );
end;
$fn$;

-- Run it. The ONE column in the result grid below is the complete
-- EVAL_GATE_DB_URL value -- copy it in full, then paste it into the GitHub
-- secret described above.
select pg_temp.t93_set_eval_gate_ci_writer_password()
  as "EVAL_GATE_DB_URL -- copy this ENTIRE value into GitHub -> Settings -> Secrets and variables -> Actions -> New repository secret (name: EVAL_GATE_DB_URL)";
