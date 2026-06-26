# LiteLLM DB Isolation Runbook — Restricted Role + Schema Wall

> **Audience:** Founder (runs the SQL personally in Supabase SQL Editor).
> **Why founder-run:** Creating a role and reassigning schema ownership requires
> the `postgres` / `service_role` superuser connection, which agents never hold
> by design (CLAUDE.md security non-negotiable #3). Agents own only the Coolify
> env-var change (the GitHub Actions workflow), never the DB grant.
>
> **Problem this fixes:** LiteLLM and Ops Hub share one Supabase PostgreSQL
> database (project `yocoljutbiizdbfraapx`). On every LiteLLM redeploy, its Prisma
> startup runs DDL against the schema its DB user can reach. Because LiteLLM has
> been connecting with a `public`-capable user, that DDL has repeatedly wiped the
> Ops Hub tables (`tenants`, `tickets`, …) in `public`. This has happened 3×.
>
> **The fix (ADR-0004):** give LiteLLM a dedicated PostgreSQL login role that
> **owns the `litellm` schema and has zero ability to drop/alter anything in
> `public`**. After this, LiteLLM redeploys can run any Prisma migration they
> like — the role is a permission wall; it physically cannot touch `public`.
>
> **Related:** `docs/adr/0004-litellm-schema-isolation-restricted-role.md`,
> `.github/workflows/fix-litellm-schema-isolation.yml`, `DECISIONS.md`.

---

## Order of operations (read before starting)

1. **Step 1 — SQL (you, in Supabase SQL Editor).** Create the restricted role and
   the `litellm`-owned schema. ~2 min.
2. **Step 2 — GitHub secret (you).** Build the new `DATABASE_URL` for LiteLLM and
   store it as the `LITELLM_DB_USER_URL` GitHub Actions secret. Never paste it in
   chat; never commit it.
3. **Step 3 — Workflow `mode=apply-wall` (agent/you dispatch).** Points
   litellm-staging at the restricted role, restarts it, and verifies LiteLLM comes
   up healthy **and** that `public.tenants` survived.
4. **Step 4 — Verify the wall (you).** Confirm Ops Hub tables still exist and that
   LiteLLM's new tables landed in `litellm`, not `public`.
5. **Step 5 — Workflow `mode=freeze-schema` (agent/you dispatch).** Sets
   `DISABLE_SCHEMA_UPDATE=true` so future redeploys make **zero** DDL attempts.
   Belt-and-suspenders on top of the role wall.
6. **Step 6 — (optional, later) Clean up orphaned `public` LiteLLM tables.** Do
   **not** bundle this with Step 1 — it is the only step that can itself lose data
   on a bad filter, and the orphans are harmless once LiteLLM points at `litellm`.

> **Do the steps in order.** Do not run Step 5 (freeze) before Step 4 confirms
> LiteLLM is healthy under the restricted role — freezing a broken first boot
> would leave LiteLLM unable to build its schema.

---

## Step 1 — SQL (Supabase SQL Editor, connected as `postgres`)

> Generate a strong password first (e.g. `openssl rand -base64 24`). Paste it in
> place of `__REPLACE_WITH_STRONG_PASSWORD__` **in the SQL Editor only** — never
> commit it, never paste it in chat. You will reuse the same password in Step 2.

```sql
-- ============================================================================
-- LiteLLM DB isolation — restricted role + schema wall   (ADR-0004)
-- Run AS postgres in the Supabase SQL Editor. Idempotent where safe.
-- ============================================================================

-- 1) Create the restricted LOGIN role.
--    No SUPERUSER, no CREATEDB, no CREATEROLE, no BYPASSRLS — CREATE ROLE
--    defaults to none of these. This role's ONLY power is what we grant below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'litellm_db_user') THEN
    CREATE ROLE litellm_db_user LOGIN PASSWORD '__REPLACE_WITH_STRONG_PASSWORD__';
  END IF;
END$$;

-- Force-set the safe attribute set on EVERY run (idempotent). This guarantees that
-- even a pre-existing or later-elevated role is brought back to least-privilege —
-- a plain `ALTER ROLE ... LOGIN PASSWORD` would NOT strip SUPERUSER/BYPASSRLS.
-- (Security Lead Condition 1.)
ALTER ROLE litellm_db_user
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION
  LOGIN PASSWORD '__REPLACE_WITH_STRONG_PASSWORD__';

-- 2) Recreate the `litellm` schema OWNED BY the restricted role.
--    The existing litellm.* tables (created by the earlier ?schema=litellm
--    attempt) are throwaway duplicates owned by postgres. Dropping the schema
--    and recreating it under litellm_db_user is the clean way to transfer
--    ownership of the whole schema in one statement.
--    DO NOT use `REASSIGN OWNED BY postgres TO litellm_db_user` — that would
--    reassign EVERY postgres-owned object including public.tenants/public.tickets,
--    i.e. it would hand LiteLLM the keys to the exact tables we are protecting.
--
--    Safety pre-check (Security Lead Condition 3): DROP SCHEMA ... CASCADE follows
--    dependencies. Confirm NOTHING in `public` (a view, FK, etc.) depends on a
--    `litellm` object before dropping. Expect 0 rows; if any appear, STOP and
--    inspect — do not CASCADE-drop a dependency of a public object.
SELECT DISTINCT dn.nspname AS dependent_schema, dc.relname AS dependent_object
FROM pg_depend d
JOIN pg_class dc ON dc.oid = d.objid
JOIN pg_namespace dn ON dn.oid = dc.relnamespace
JOIN pg_class rc ON rc.oid = d.refobjid
JOIN pg_namespace rn ON rn.oid = rc.relnamespace
WHERE rn.nspname = 'litellm' AND dn.nspname = 'public';

DROP SCHEMA IF EXISTS litellm CASCADE;
CREATE SCHEMA litellm AUTHORIZATION litellm_db_user;

-- 3) Pin the role's search_path to `litellm` so LiteLLM's unqualified Prisma DDL
--    (CREATE TABLE foo ...) lands in `litellm`, never `public`. Role-level
--    search_path always applies, even when the Supabase pooler drops libpq
--    `options=` params — this is the reliable belt to the `?schema=litellm` URL
--    suspenders.
ALTER ROLE litellm_db_user SET search_path = litellm;

-- 4) The wall: ensure the role has NO standing privilege on `public`.
--    A fresh PG15 role already lacks CREATE on `public` (PG15 removed the old
--    default PUBLIC CREATE grant) and is NOT the owner of any public table, so
--    it cannot DROP/ALTER/TRUNCATE them. These REVOKEs make that explicit and
--    are safe no-ops if nothing was granted. We deliberately do NOT revoke from
--    the PUBLIC pseudo-role (that would hit ops_hub_app and every other role).
REVOKE ALL ON SCHEMA public               FROM litellm_db_user;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM litellm_db_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM litellm_db_user;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM litellm_db_user;

-- 5) Connect privilege on the database (LOGIN alone is not enough on some setups).
GRANT CONNECT ON DATABASE postgres TO litellm_db_user;

-- ============================================================================
-- Verification (run after the block above; all should return the expected value)
-- ============================================================================

-- a) Role exists, is LOGIN, and has NO scary attributes (all 'f' = false except
--    rolcanlogin = 't').
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolname = 'litellm_db_user';

-- b) The litellm schema is owned by litellm_db_user.
SELECT nspname AS schema, pg_get_userbyid(nspowner) AS owner
FROM pg_namespace WHERE nspname = 'litellm';   -- owner must be litellm_db_user

-- c) CREATE-in-public check (clutter-prevention only — NOT the wall).
--    On PG15 (Supabase) this is 'f'. The destroy-guarantee does NOT depend on it:
--    even a role WITH create-in-public still cannot DROP/ALTER tables it does not own.
--    So a 't' here means "LiteLLM could create stray tables in public" (cosmetic),
--    NOT "the wall failed". The wall is checks (b)+(d)+(e): owns litellm, owns no
--    public table. Do not abort on (c) alone.
SELECT has_schema_privilege('litellm_db_user', 'public', 'CREATE') AS can_create_in_public;

-- d) The role does NOT own any public table (expect: 0 rows).
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tableowner = 'litellm_db_user';

-- e) Core Ops Hub tables are present and owned by postgres (NOT by litellm_db_user).
--    NOTE: this lists whatever exists — it does NOT assert a fixed table set, because
--    CLAUDE.md and the applied migration disagree on the non-core table names
--    (audit_log/feature_flags vs ticket_events/agent_actions). Reconcile that
--    separately against the live schema. (e) is an OWNERSHIP confirmation, NOT the
--    survival test — the real survival proof is Step 4's canary on tenants/tickets/
--    kb_articles/conversations (names that exist regardless). (Security Lead Condition 2.)
SELECT tablename, tableowner FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('tenants','projects','tickets','kb_articles')
ORDER BY tablename;
```

**Expected verification results**

- (a) `rolcanlogin = t`; **every other attribute (`rolsuper`, `rolcreatedb`,
  `rolcreaterole`, `rolbypassrls`) MUST be `f`.** (Security Lead Condition 1 —
  this is a hard gate.)
- (b) `owner = litellm_db_user`.
- (c) `can_create_in_public = f` on PG15 (Supabase). A `t` (PG14 default) is
  cosmetic only — see the note in the query; it is **not** a wall failure.
- (d) zero rows.
- (e) the 4 core Ops Hub tables present, `tableowner = postgres` (or `supabase_admin`).

**Hard-stop gate — do not proceed to Step 2 if ANY of these is true:**
- (a) shows `litellm_db_user` with `rolsuper`/`rolcreatedb`/`rolcreaterole`/`rolbypassrls = t`;
- (b) owner is not `litellm_db_user`;
- (d) or (e) show `litellm_db_user` owning any `public` table.

Check (c) alone does **not** gate the rollout.

---

## Step 2 — Build `DATABASE_URL` and store it as a GitHub secret

> **Do not reconstruct the host/port from memory.** DECISIONS.md records ~10 PRs
> burned on Supabase pooler URL format (aws-0 vs aws-1, port, the `.PROJECTREF`
> username suffix). Start from the **current working** LiteLLM `DATABASE_URL` (read
> it in Coolify → litellm-staging → Environment Variables) and change **only**
> two things: the username and the password. Then append `?schema=litellm`.

Take the current working URL, which looks like:

```
postgresql://<OLD_USER>.yocoljutbiizdbfraapx:<OLD_PASS>@aws-1-ca-central-1.pooler.supabase.com:5432/postgres
```

Change **only** the username and password (keep host, port, dbname byte-identical),
and append `?schema=litellm`:

```
postgresql://litellm_db_user.yocoljutbiizdbfraapx:__YOUR_PASSWORD__@aws-1-ca-central-1.pooler.supabase.com:5432/postgres?schema=litellm
```

Notes:

- The `.yocoljutbiizdbfraapx` suffix on the username is **required** by the
  Supabase session pooler (Supavisor) to identify the project — same pattern as
  `ops_hub_app_login.yocoljutbiizdbfraapx` and `freescout_user.yocoljutbiizdbfraapx`
  already in use. Without it you get `ENOIDENTIFIER / no tenant identifier`.
- `?schema=litellm` tells Prisma to use `litellm` as its default schema. It is
  backed up by the role-level `search_path` from Step 1 §3, so isolation holds
  even if the pooler ignores the URL param.

Store it as a GitHub Actions secret (do **not** commit it, do **not** paste it in
chat):

```
Repo → Settings → Secrets and variables → Actions → New repository secret
  Name:  LITELLM_DB_USER_URL
  Value: <the postgresql://litellm_db_user....?schema=litellm string above>
```

---

## Step 3 — Apply the wall (workflow `mode=apply-wall`)

Dispatch `.github/workflows/fix-litellm-schema-isolation.yml` with `mode=apply-wall`.
It will:

1. Refuse to run unless `LITELLM_DB_USER_URL` looks correct (username starts with
   `litellm_db_user.` **and** the URL contains `schema=litellm`) — a guard so a
   `postgres`/`service_role` URL can never be pushed by mistake.
2. Delete every existing `DATABASE_URL` entry on litellm-staging and set the new one.
3. Ensure `DISABLE_SCHEMA_UPDATE` is **not** set for this phase, so Prisma builds
   the `litellm` schema once under the restricted role.
4. Restart litellm-staging and verify it returns healthy.
5. **Canary:** if the optional `OPS_HUB_CANARY_DB_URL` secret is set, it runs a
   read-only `SELECT to_regclass(...)` to assert `public.tenants`, `public.tickets`
   and `public.conversations` all survived the redeploy. If that secret is absent,
   it prints the SQL for you to run manually in Step 4.

---

## Step 4 — Verify the wall held (Supabase SQL Editor)

Run this **after** the `apply-wall` workflow finishes and LiteLLM is healthy:

```sql
-- Ops Hub + FreeScout tables MUST still exist (non-null = present):
SELECT
  to_regclass('public.tenants')       AS tenants,
  to_regclass('public.tickets')       AS tickets,
  to_regclass('public.kb_articles')   AS kb_articles,
  to_regclass('public.conversations') AS fs_conversations;

-- LiteLLM's tables should now live in `litellm`, NOT `public`:
SELECT count(*) AS litellm_tables_in_litellm_schema
FROM pg_tables WHERE schemaname = 'litellm';   -- expect > 0 after first boot

-- And LiteLLM should have created NO new tables it owns in public:
SELECT count(*) AS litellm_owned_tables_in_public
FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'litellm_db_user';
-- expect 0
```

If all four `public` tables are non-null and `litellm_owned_tables_in_public = 0`,
the wall is proven. Proceed to Step 5.

---

## Step 5 — Freeze schema updates (workflow `mode=freeze-schema`)

Dispatch the same workflow with `mode=freeze-schema`. It sets
`DISABLE_SCHEMA_UPDATE=true` on litellm-staging and restarts it. After this, future
LiteLLM redeploys make **zero** DDL attempts at all — the role wall is the hard
guarantee, and the frozen schema means LiteLLM does not even try.

> **Secondary benefit:** because the `litellm` schema now lives in external Supabase
> (not container-local) and migrations are frozen, LiteLLM's model registrations
> (`STORE_MODEL_IN_DB=True`) should also persist across redeploys now — eliminating
> the re-registration churn noted in DECISIONS.md (2026-06-25). Verify this holds;
> if a future LiteLLM image version needs a schema change, temporarily flip
> `DISABLE_SCHEMA_UPDATE=false`, redeploy once, verify `public` survived, re-freeze.

---

## Step 6 — (Optional, later) clean up orphaned `public` LiteLLM tables

The 66 orphaned LiteLLM tables left in `public` from before this fix are harmless
once LiteLLM points at `litellm`, but they clutter the schema. Clean them up only
as a **separate, deliberate** action — never bundled with Step 1 — because a
mis-scoped `DROP` here is the one move in this whole runbook that could itself lose
data. When you do it, list them first, eyeball the list, and only then drop. This is
explicitly out of scope for the wall and not required for the guarantee.

---

## Rollback

- **Wall causes a LiteLLM boot failure** (e.g. an unexpected hardcoded `public.`
  reference in a future image): re-dispatch `apply-wall` is idempotent; or, as an
  emergency, point `DATABASE_URL` back at the previous user in Coolify. **Do not**
  revert to a `public`-capable user as a standing config — that re-opens the exact
  hole. If a boot genuinely needs `public`, escalate via FOUNDER_QUEUE rather than
  widening the role.
- **Freeze causes a needed migration to be skipped:** set `DISABLE_SCHEMA_UPDATE=false`,
  redeploy once, verify `public` survived (Step 4), re-freeze.
