# T-12 Vault Setup Runbook — Supabase Vault for LLM Keys & Service Secrets

> **Audience:** Founder (runs this personally).
> **Why founder-run:** Several steps require the `service_role` / superuser
> connection string, which agents never hold by design (see security model
> below). The founder runs those steps using credentials only they hold.
>
> **Task (T-12):** Stand up Supabase Vault as the secret store for the Ops Hub,
> create a connectable `ops_hub_app` login role, migrate LLM/service secrets out
> of Coolify env vars into Vault, and expose a hardened accessor function agents
> can call at runtime.
>
> **Depends on:** T-11 (schema + RLS applied; `ops_hub_app` exists as a
> `nologin` role). **Partially gates:** T-18 (the live agent-path isolation test
> now has a real login role to run against).
>
> **Related:** ADR-0002 §4 (Supabase — database + Vault + vector),
> `docs/engineering/t11-migration-runbook.md`.

---

## ✅ Security Lead sign-off — Vault access model reviewed & APPROVED WITH CONDITIONS

> **Security Lead Vault sign-off (T-12, 2026-06-21): APPROVED WITH CONDITIONS.**
>
> The access model is sound: agents connect as the non-superuser
> `ops_hub_app_login` role, retrieve secrets only through a `security definer`
> accessor owned by a Vault-reading role, and never hold the `service_role` key.
> `ops_hub_app` does **not** bypass RLS, and the login role inherits that
> property. Approved to execute, subject to the conditions below — **these are
> baked into the SQL in Steps 1–3; do not deviate from them.**
>
> - **V1 (blocking) — accessor must not be a public exfiltration endpoint.**
>   Postgres grants `EXECUTE` on new functions to `PUBLIC` by default, and any
>   function in the `public` schema is auto-exposed by PostgREST as an RPC. A
>   `security definer` "return any secret by name" function with those two
>   defaults is a remote secret-exfiltration endpoint (`anon` could call it over
>   the REST API). **Mitigation, applied in Step 3:** the accessor lives in a
>   private `internal` schema (NOT in PostgREST's exposed schema list), and
>   `EXECUTE` is `REVOKE`d from `PUBLIC` and granted only to `ops_hub_app`.
>   Verification §8 check 6 must show `anon` has **no** execute privilege.
> - **V2 — function ownership is load-bearing.** `security definer` runs as the
>   function *owner*. The accessor MUST be created while connected as
>   `postgres`/`service_role` so it is owned by a role that can read
>   `vault.decrypted_secrets`. This is both the correctness condition and the
>   mechanism that gives `ops_hub_app` its *indirect, mediated* Vault access.
> - **V3 — broad accessor, accepted tradeoff.** `get_secret(name)` lets
>   `ops_hub_app` read *every* secret, not a scoped subset. **This is fine
>   because** tenant isolation in the Ops Hub is enforced by RLS, not by secret
>   partitioning, and there is a single `ops_hub_app` principal. If per-agent
>   secret partitioning is ever introduced, this accessor needs a name allowlist
>   — tracked as follow-up F1 below.
> - **V4 — `DATABASE_URL` is a deliberate exception to "zero keys in Coolify".**
>   The login-role password must remain in the Coolify connection string: the
>   app cannot bootstrap its DB password out of a database it cannot yet connect
>   to. Its copy in Vault is a rotation/record reference, not a runtime
>   retrieval path. Step 5 removes only the LLM/service keys, never the DB URL.
> - **V5 — Step 5 (delete from Coolify) is gated on consumer cut-over.** Do not
>   delete `OPENAI_API_KEY` / `LANGFUSE_SECRET_KEY` from Coolify until the
>   consumer (LiteLLM / the app) is verified reading from Vault. Deleting first
>   breaks the running system.
>
> **Follow-ups (non-blocking, tracked):**
> - **F1:** If secrets ever need per-agent scoping, replace `get_secret` with an
>   allowlisted accessor. Re-review required.
> - **F2:** Wire per-key access audit logging (the reason Vault was chosen over
>   Coolify env vars per ADR-0002 §4) — add an audit_log insert inside the
>   accessor or via a LangFuse trace. Tracked for M2.
> - **F3:** Establish Vault rotation cadence (quarterly compliance review item).
>
> The gate is cleared. Proceed per this runbook.

---

## Security model (why this is gated the way it is)

- **`service_role` BYPASSES RLS and can read Vault directly.** Reserved for
  migrations and setup ONLY. **Agents must never hold the `service_role` key.**
  Steps 1, 2, and 3 use it transiently; nothing stores it.
- **Agents connect as `ops_hub_app_login`** — a connectable role that inherits
  the `ops_hub_app` grants. `ops_hub_app` does **not** bypass RLS, so the login
  role does not either. Agents reach Vault only through the mediated
  `internal.get_secret()` accessor (Step 3), never `vault.decrypted_secrets`
  directly.
- **Vault encrypts secrets at rest** (Supabase-managed crypto). We use the
  stable `vault.create_secret()` / `vault.decrypted_secrets` interface and do
  **not** depend on internal crypto mechanics.
- **The accessor is the only seam** between the agent role and plaintext
  secrets, and it is locked down per condition V1.

---

## What gets stored in Vault

| Secret name (Vault `name`) | Source today | Notes |
|---|---|---|
| `openai_api_key` | Coolify env `OPENAI_API_KEY` (or equivalent LLM key used by LiteLLM) | Moves **fully** to Vault; removed from Coolify in Step 5. |
| `langfuse_secret_key` | Coolify env `LANGFUSE_SECRET_KEY` | Moves **fully** to Vault; removed from Coolify in Step 5. |
| *(any other LLM provider keys)* | Coolify env vars behind LiteLLM (e.g. `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` — whatever is configured) | One `create_secret` per key; same treatment. |
| `ops_hub_app_password` | created in Step 1 | Stored in Vault as a **rotation/record reference**. Its runtime home is the Coolify `DATABASE_URL` (condition V4) — it is **not** deleted from Coolify. |

> **Inventory first.** Before Step 2, list the actual LLM-related keys present in
> Coolify for the ops-hub-app service so none are missed. Only LLM/service keys
> that LiteLLM or agents consume belong in Vault; the DB connection credential
> stays in `DATABASE_URL`.

---

## Prerequisites

- [ ] **`psql`** available, OR the Supabase SQL Editor (dashboard). SQL Editor
      is fine for all steps here.
- [ ] **`service_role` / `postgres` owner connection string** ready (the same
      `SUPABASE_DB_URL` used in the T-11 runbook). Used transiently in Steps
      1–3. **Never commit, paste in chat, or log it.**
- [ ] A **strong random password** generated for the login role (Step 1). Do
      **not** invent one by hand and do **not** paste it into chat.

  **WSL / bash:**
  ```bash
  openssl rand -base64 32
  ```
  **PowerShell (Windows, no WSL):**
  ```powershell
  [Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Max 256 }))
  ```
  Keep it in your password manager. You will paste it into Steps 1, 2, and 4.

- [ ] Confirm T-11 is applied: `ops_hub_app` exists as a `nologin` role
      (`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'ops_hub_app';`
      → one row, `rolcanlogin = false`).

> **DB URL scheme note:** use `postgresql://` (not `postgres://`).

---

## Step 1 — Create the `ops_hub_app` login role

Run as **`service_role` / `postgres` owner** (SQL Editor or
`psql "$SUPABASE_DB_URL"`). This creates a connectable user that **inherits**
`ops_hub_app`'s grants — and therefore inherits its RLS behaviour (no bypass).

```sql
-- Connectable login user that inherits ops_hub_app's grants.
-- Replace <STRONG_RANDOM_PASSWORD> with the value from Prerequisites.
-- INHERIT is the default; stated explicitly for the reviewer's benefit.
create user ops_hub_app_login with password '<STRONG_RANDOM_PASSWORD>' login inherit;
grant ops_hub_app to ops_hub_app_login;

-- Defense-in-depth: make sure the login role does NOT bypass RLS.
-- (A plain `create user` does not grant BYPASSRLS, but assert it explicitly.)
alter role ops_hub_app_login nobypassrls;
```

> **Security note.** `ops_hub_app_login` is a thin login wrapper around the
> already-reviewed `ops_hub_app` role. It holds no extra privilege of its own;
> everything it can do flows through the inherited `ops_hub_app` grants and the
> RLS policies from T-11. The `nobypassrls` line is belt-and-suspenders.

---

## Step 2 — Store secrets in Vault

Run as **`service_role` / `postgres` owner**. Paste the **real** secret values in
place of `<...>`; never commit these. One statement per secret.

```sql
-- LLM / service keys (move fully to Vault; deleted from Coolify in Step 5).
select vault.create_secret('<OPENAI_API_KEY_VALUE>',     'openai_api_key',      'OpenAI API key for LiteLLM');
select vault.create_secret('<LANGFUSE_SECRET_KEY_VALUE>','langfuse_secret_key', 'LangFuse secret key');

-- Repeat for any other LLM provider keys configured behind LiteLLM, e.g.:
-- select vault.create_secret('<ANTHROPIC_API_KEY_VALUE>', 'anthropic_api_key', 'Anthropic API key for LiteLLM');
-- select vault.create_secret('<OPENROUTER_API_KEY_VALUE>','openrouter_api_key','OpenRouter API key for LiteLLM');

-- The login role password — stored as a rotation/record reference ONLY.
-- Its runtime home stays in the Coolify DATABASE_URL (condition V4). NOT deleted from Coolify.
select vault.create_secret('<STRONG_RANDOM_PASSWORD>', 'ops_hub_app_password', 'ops_hub_app login role password (rotation reference)');
```

> **Idempotency / re-runs.** `vault.create_secret` errors on a duplicate `name`
> (unique constraint). If you must re-run for one secret, update in place
> instead — look up its id and use `vault.update_secret(id, new_secret, ...)`
> rather than creating a second copy.

---

## Step 3 — Create the hardened Vault accessor function

Run as **`service_role` / `postgres` owner** (condition V2: the function must be
**owned** by a Vault-reading role). The accessor lives in a **private `internal`
schema that is NOT in PostgREST's exposed schema list** (condition V1), so it is
reachable only over the direct `DATABASE_URL` connection agents use — never over
the public REST API.

```sql
-- Private schema, not exposed via PostgREST. Agents reach it over DATABASE_URL only.
create schema if not exists internal;

create or replace function internal.get_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = vault, public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = secret_name
  limit 1;
$$;

-- V1 (blocking): strip the default PUBLIC execute grant, then grant narrowly.
revoke execute on function internal.get_secret(text) from public;
grant  execute on function internal.get_secret(text) to ops_hub_app;

-- Lock down the schema itself: usable by ops_hub_app, not the world.
revoke all on schema internal from public;
grant  usage on schema internal to ops_hub_app;
```

> **Why this is fine (V1/V2 satisfied).**
> - Owned by `postgres`/`service_role` ⇒ `security definer` can read
>   `vault.decrypted_secrets`. `ops_hub_app` itself still cannot read that view
>   directly — only through this mediated call.
> - `EXECUTE` revoked from `PUBLIC` and the function placed outside the exposed
>   schema ⇒ `anon` / `authenticated` cannot call it, and PostgREST does not
>   surface it as RPC. The REST exfiltration surface is gone.
>
> **Agent call pattern at runtime** (connected as `ops_hub_app_login`):
> ```sql
> select internal.get_secret('openai_api_key');
> ```

> **PostgREST exposed-schema note.** If for any reason the function must live in
> `public`, you MUST instead ensure `public` is removed from the PostgREST
> exposed schemas or the function is otherwise hidden — but the `internal`-schema
> approach above is the recommended path and avoids that entirely. Do not place
> a secret-returning `security definer` function in an exposed schema.

---

## Step 4 — Point Coolify `DATABASE_URL` at the login role

Once `ops_hub_app_login` exists (Step 1), the **ops-hub-app** service should
connect as that role — **not** as `postgres` / `service_role`. Update the
Coolify `DATABASE_URL` env var for the service.

**Connection string format:**
```
postgresql://ops_hub_app_login:<STRONG_RANDOM_PASSWORD>@<SUPABASE_DB_HOST>:<PORT>/postgres?sslmode=require
```

- `<SUPABASE_DB_HOST>` / `<PORT>` — from the Supabase project's connection
  settings (same host/port family as the existing `DATABASE_URL`; Canada Central
  region). Use the connection-pooler endpoint if the existing URL uses it.
- `sslmode=require` — keep TLS on (matches `DB_SSL_MODE=require` from the infra
  work).
- The password here is the **same** value stored in Vault as
  `ops_hub_app_password`. **This is the one place the DB credential legitimately
  lives in Coolify (condition V4) — do not remove it in Step 5.**

> After this change, redeploy / restart the ops-hub-app service so it picks up
> the new connection. Confirm it connects (Step 8 check 3) before proceeding.

---

## Step 5 — Remove the LLM/service secrets from Coolify env vars

> **GATED (condition V5):** Do this **only after** the consumer (LiteLLM / the
> app) is verified reading the corresponding secret from Vault via
> `internal.get_secret(...)`. Deleting before cut-over breaks the running
> system.

**Remove from Coolify env vars (after cut-over verified):**
- `OPENAI_API_KEY`
- `LANGFUSE_SECRET_KEY`
- any other LLM provider keys migrated in Step 2 (e.g. `ANTHROPIC_API_KEY`,
  `OPENROUTER_API_KEY`, `GEMINI_API_KEY`)

**Do NOT remove:**
- `DATABASE_URL` — holds the `ops_hub_app_login` credential (condition V4).
- Any non-LLM operational env var unrelated to this migration.

> After removal, redeploy and re-run the consumer-path check. If anything
> breaks, the value is still safe in Vault — re-point the consumer at
> `internal.get_secret(...)` rather than re-adding the raw env var.

**Exit-criteria check:** confirm zero LLM API keys remain in Coolify env vars,
in any committed `.env`, and in git history. (Secrets hygiene is continuously
enforced by the Security Scan CI gate / gitleaks.)

---

## Step 8 — Verification

```sql
-- 1. Secrets exist in Vault (names only; never select decrypted values to a shared log).
select name, description, created_at
from vault.secrets
order by name;
-- Expected: openai_api_key, langfuse_secret_key, ops_hub_app_password (+ any others added).

-- 2. Login role exists, CAN log in, and does NOT bypass RLS.
select rolname, rolcanlogin, rolbypassrls
from pg_roles
where rolname in ('ops_hub_app', 'ops_hub_app_login')
order by rolname;
-- Expected: ops_hub_app_login -> rolcanlogin = true, rolbypassrls = false
--           ops_hub_app       -> rolcanlogin = false, rolbypassrls = false

-- 3. get_secret() returns a non-null value (run as service_role first to prove the function works).
select (internal.get_secret('openai_api_key') is not null) as has_value;
-- Expected: has_value = true   (do NOT print the secret itself)

-- 4. The agent role can call the accessor via SET ROLE (mediated path works).
set role ops_hub_app;
select (internal.get_secret('langfuse_secret_key') is not null) as agent_can_read;
reset role;
-- Expected: agent_can_read = true

-- 5. The agent role CANNOT read the Vault view directly (only via the accessor).
set role ops_hub_app;
select has_table_privilege('ops_hub_app', 'vault.decrypted_secrets', 'select') as direct_read;
reset role;
-- Expected: direct_read = false  (access is mediated, not direct)

-- 6. V1 invariant: anon / authenticated have NO execute on the accessor.
select
  has_function_privilege('anon',          'internal.get_secret(text)', 'execute') as anon_exec,
  has_function_privilege('authenticated', 'internal.get_secret(text)', 'execute') as authn_exec;
-- Expected: both false. If either is true, V1 is violated — STOP and re-run the REVOKE in Step 3.
```

**Real login-path RLS check (do this once the app is connecting as the login
role — proves the live path, not just `SET ROLE`):** with the app pointed at
`ops_hub_app_login` and no tenant GUC set, a query against `tickets` must return
0 rows (fail-closed RLS still applies to the real login role). This is the
seam the **T-18** automated isolation test will exercise.

---

## Step 9 — ⚠️ Credential security reminder

> **NEVER commit, paste, or log:** the `service_role` key / `SUPABASE_DB_URL`,
> the `<STRONG_RANDOM_PASSWORD>`, or any of the raw secret values from Step 2.
>
> - Generate the login password with `openssl rand` (or the PowerShell line
>   above) and keep it **only** in your password manager + the Coolify
>   `DATABASE_URL` + Vault. Three controlled homes, no more.
> - The `service_role` connection is used **transiently** in Steps 1–3 and is
>   never stored by this runbook.
> - Prefer the Supabase **SQL Editor** for Steps 1–3 so secret values do not
>   land in local shell history at all.
> - If you ran any `psql -c "...secret..."` inline, clear shell history:
>
> **PowerShell (Windows):**
> ```powershell
> Clear-History
> Remove-Item (Get-PSReadlineOption).HistorySavePath -ErrorAction SilentlyContinue
> # Clears the on-disk PSReadLine history (where inline commands persist across
> # sessions). Reopen the terminal afterward.
> ```
>
> **bash / WSL:**
> ```bash
> history -c
> ```
>
> Best practice: paste secrets only into the SQL Editor or into a `$env:`
> variable, never as a literal argument on a command line.

---

## After success

- [ ] **Update `WORK.md`:** mark **T-12** progress (all secrets in Vault, login
      role wired, accessor hardened, Coolify cleaned).
- [ ] **Security Lead:** verification §8 checks 2, 5, and 6 are the security
      invariants — confirm all pass before declaring T-12 done.
- [ ] **T-18 unblocked path:** the live `ops_hub_app_login` role now exists, so
      the automated cross-tenant isolation test can run against the real agent
      connection, not just `SET ROLE`.
- [ ] **Follow-ups F1–F3** (above) logged for M2 / quarterly review.

---

*Runbook owner: Security Lead. Founder executes. Security Lead gates the Vault
access model (sign-off above) and the T-18 isolation test. Questions →
WORK.md → Security Lead.*
