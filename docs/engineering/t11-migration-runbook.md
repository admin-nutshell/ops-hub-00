# T-11 Migration Runbook — Apply Ops Hub Supabase Schema

> **Audience:** Founder (runs this personally).
> **Why founder-run:** Applying these migrations requires the `service_role` /
> superuser connection string, which agents never hold by design (see security
> model below). The founder runs this using credentials only they hold.
>
> **Task:** Apply the two initial Supabase migrations to the Ops Hub project.
> **Files (already on `main`):**
> - `supabase/migrations/20260618120000_initial_schema.sql`
> - `supabase/migrations/20260618120100_enable_rls_policies.sql`

---

## ✅ Security Lead sign-off recorded — migration 2 is cleared to run

> **Security Lead RLS sign-off — `20260618120100_enable_rls_policies.sql`
> (T-03, 2026-06-21): APPROVED WITH CONDITIONS.**
>
> Cross-tenant read isolation on the `ops_hub_app` path is correct and
> fail-closed. Blocking condition C1 applied: `authenticated` removed from
> `audit_log_insert` (portal users must not forge audit entries for other
> tenants via `with check (true)`; SOC-2 evidence integrity violation).
> C1 fix is in the migration file as of the fix/dockerfile-ci-env-rls-c1 commit.
> Follow-ups C2/F1-F6 tracked for M2/prod. T-18 must verify agent-path
> isolation + C1/C2/F2 items.
>
> The gate is cleared. Both migrations may be applied per this runbook.
>
> Migration 1 (`initial_schema.sql`) creates tables only. Migration 2 applies
> the RLS model. Apply them individually with `psql -f` (see Step 2 note).

---

## Security model (why this is gated the way it is)

- **`service_role` BYPASSES RLS entirely.** It is reserved for migrations and
  trusted platform ops ONLY. **Agents must never hold the `service_role` key.**
- These migrations *set up* RLS. Before they run, the `ops_hub_app` role does
  not exist yet — so the connection used to run them **must be a role that can
  bypass / is exempt from RLS** (i.e., `service_role` / the Supabase
  `postgres`/owner connection). The `ops_hub_app` role cannot be used here.
- After these run, agent and Inngest traffic connects as the non-superuser
  `ops_hub_app` role (which does NOT bypass RLS) and sets the per-request
  tenant via session GUCs. Wiring that login role happens later in **T-12**.

---

## 1. Prerequisites

- [x] **Security Lead sign-off** obtained for `20260618120100_enable_rls_policies.sql`
      (APPROVED WITH CONDITIONS, 2026-06-21; C1 fix applied — see sign-off block above).
- [ ] **`psql` available** (recommended), OR the Supabase CLI installed
      (see the caveat in Step 2 before using the CLI).
- [ ] **Connection string** ready. Use the `DATABASE_URL` (service_role /
      owner connection) from the **Coolify env vars** for the Ops Hub Supabase
      project.
      - **Never commit the real value. Never paste it into chat, logs, or
        commits.** Redact it from any output you share.
      - Set it as an environment variable so it does not appear inline in
        command history:

  **PowerShell (founder is on Windows):**
  ```powershell
  $env:SUPABASE_DB_URL = "postgresql://...REDACTED..."   # paste real value from Coolify
  ```

  **bash / WSL (if used instead):**
  ```bash
  export SUPABASE_DB_URL="postgresql://...REDACTED..."    # paste real value from Coolify
  ```

- [ ] The connection role **can bypass RLS** (service_role / postgres owner).
      The `ops_hub_app` role does not exist yet and cannot be used.

> **DB URL scheme note:** use `postgresql://` (not `postgres://`) — some
> tooling is picky about the scheme.

---

## 2. Step 1 — Verify clean state

Connect as the service_role / postgres owner and confirm `public` is empty
(or contains only Supabase built-ins) before the first run.

**PowerShell:**
```powershell
psql "$env:SUPABASE_DB_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

**bash:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

**Expected:** empty result (or only Supabase built-ins) before the first run.
If you see `projects`, `tickets`, etc. already present, the migrations may have
already been applied — STOP and reconcile before re-running.

---

## 3. Step 2 — Apply migration 1 (initial schema)

Creates: extensions (`vector`, `pgcrypto`), the `set_updated_at()` trigger
function, the 6 tables (`projects`, `tenants`, `tickets`, `audit_log`,
`feature_flags`, `kb_articles`), indexes, triggers, and comments.

> **⚠️ Why `psql -f` is the recommended path (not `supabase db push`):**
> `supabase db push` applies **ALL pending migrations in the directory at
> once** and does not accept a single-file argument. If you run `db push` now,
> it will also apply migration 2 (the RLS migration) — **before** Security Lead
> sign-off. That breaks the gate this runbook exists to enforce.
> **Therefore: apply each migration individually with `psql -f`.** Only
> consider `supabase db push` once Security Lead has signed off on migration 2
> AND you intend to apply everything pending.

**PowerShell (recommended):**
```powershell
psql "$env:SUPABASE_DB_URL" -f supabase/migrations/20260618120000_initial_schema.sql
```

**bash (recommended):**
```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260618120000_initial_schema.sql
```

**Expected output:** `CREATE EXTENSION`, `CREATE FUNCTION`, `CREATE TABLE`,
`CREATE INDEX`, `CREATE TRIGGER`, `COMMENT` lines; **no errors.**

---

## 4. Step 3 — Apply migration 2 (RLS policies)

> **Security Lead sign-off is recorded (2026-06-21). C1 fix applied. This step is cleared.**

Enables RLS on all 6 tables, creates the non-superuser `ops_hub_app` role and
grants, creates the `current_tenant_id()` / `current_project_id()` resolver
functions, and creates all fail-closed default-deny RLS policies.

**PowerShell (recommended):**
```powershell
psql "$env:SUPABASE_DB_URL" -f supabase/migrations/20260618120100_enable_rls_policies.sql
```

**bash (recommended):**
```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260618120100_enable_rls_policies.sql
```

**Expected output:** `DO`, `GRANT`, `ALTER DEFAULT PRIVILEGES`,
`CREATE FUNCTION`, `ALTER TABLE` (x6, enabling RLS), `CREATE POLICY` (multiple);
**no errors.**

> **If `create role ops_hub_app` fails on a permissions error:** on hosted
> Supabase, role creation may be restricted (the migration's own header notes
> this — see lines 23–25 of the file). The migration wraps the `create role`
> in a guard so it is skipped if the role already exists. If it fails because
> the connection lacks `CREATEROLE`:
> 1. Create the role manually via the Supabase dashboard (Database → Roles) or
>    CLI: `create role ops_hub_app nologin;`
> 2. Re-run this migration. The remaining `grant`/policy statements are
>    idempotent against an existing role, and the `do $$ ... $$` guard will
>    skip re-creating it.

---

## 5. Verification queries

Run these after both migrations. Use the service_role / postgres connection
(it can `SET ROLE` for the fail-closed test below).

```sql
-- 1. All 6 tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Expected: audit_log, feature_flags, kb_articles, projects, tenants, tickets

-- 2. RLS enabled on all 6 tables (rowsecurity = true)
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- Expected: all 6 rows show rowsecurity = true

-- 3. ops_hub_app role exists
SELECT rolname FROM pg_roles WHERE rolname = 'ops_hub_app';
-- Expected: one row: ops_hub_app

-- 4. Fail-closed test: assume the app role, set no tenant, query tickets.
--    NOTE: ops_hub_app is a NOLOGIN role; we test it via SET ROLE from the
--    service_role/postgres session (no separate connection needed).
SET ROLE ops_hub_app;
SELECT count(*) FROM tickets;
-- Expected: 0 — either the table is empty AND/OR fail-closed RLS returns
--           zero rows because no app.current_tenant is set. Either is correct.
RESET ROLE;

-- 5. RLS policies exist
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
-- Expected: select/insert/update policies per the migration (tickets has
--           select/insert/update; audit_log has insert/select; projects/
--           tenants select; feature_flags/kb_articles select + write).
```

You can run any of these as a one-liner too, e.g. (PowerShell):
```powershell
psql "$env:SUPABASE_DB_URL" -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
```

---

## 6. After success

- [ ] **Update `WORK.md`:** mark **T-11 complete** (all tables created, RLS
      applied, verification passed).
- [ ] **Security Lead:** review the live RLS model and sign off — this is the
      **T-18** gate (cross-tenant isolation test runs against the
      `ops_hub_app` agent path, not just Auth).
- [ ] **Note:** the `ops_hub_app` **login** role wiring (a connectable role +
      its credentials) happens in **T-12** (Vault setup). Until then,
      `ops_hub_app` exists as a `nologin` role only — that is expected.

---

## 7. Rollback note

**Forward-only migration policy** (per `docs/engineering/database-migrations.md`).
There are no `DOWN` migrations.

- If a migration fails part-way, **do not** revert by dropping tables in
  production. Author a **fix-forward** migration that corrects the problem.
- If prod is broken right now, mitigate at the application layer (feature flag)
  while the fix-forward migration is authored.
- This is the staging run first; it must pass for 24h before any prod promotion.

---

## 8. ⚠️ Credential security reminder

> **NEVER commit, paste, or log the `SUPABASE_DB_URL` or the `service_role` key.**
>
> - Store the connection string and `service_role` key in **Coolify env vars only**.
> - Keep them out of git, `.env` files committed to the repo, and chat.
> - The migrations only need `service_role` transiently — they do not store it.
> - **After running**, if you typed the URL inline anywhere, clear shell history:
>
> **PowerShell (Windows):**
> ```powershell
> Clear-History
> Remove-Item (Get-PSReadlineOption).HistorySavePath -ErrorAction SilentlyContinue
> # The second line clears the PSReadLine on-disk history file (where inline
> # commands persist across sessions). Reopen the terminal afterward.
> ```
>
> **bash / WSL:**
> ```bash
> history -c
> ```
>
> Best practice: set `$env:SUPABASE_DB_URL` from a paste (as in Prerequisites)
> rather than typing the literal URL into any command, so it never lands in
> history in the first place.

---

*Runbook owner: Tech Lead. Founder executes. Security Lead gates migration 2
and the T-18 isolation test. Questions → WORK.md → Tech Lead.*
