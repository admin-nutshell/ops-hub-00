# T-23 — FreeScout Write-Back Credential Runbook

> **Owner:** Production Manager (provisioning) · **Author:** Security Lead (credential scope)
> **Status:** Ready to execute. Unblocks `FREESCOUT_DB_URL` provisioning for `ticket-respond`.
> **Related:** ADR-0003 (§Security Lead Review, condition **C1**), `src/inngest/ticket-respond.ts` (`postFreeScoutNote`), FQ-34 (owner-grant constraint), FQ-38 (schema-rebuild GRANT re-issue).

---

## Why this runbook exists

`ticket-respond` writes the AI draft as an internal FreeScout **note** by `INSERT`ing one row into FreeScout's `threads` table, using a connection built from `FREESCOUT_DB_URL`.

Security Lead **condition C1 (blocking):** that DSN must **NOT** be `freescout_user`. `freescout_user` is FreeScout's own application login and the **owner** of every FreeScout table — full read/write/DDL over `customers`, `emails`, `users` (password hashes), `mailboxes`, `conversations`, `threads`, settings. The task needs exactly one privilege: `INSERT` on `threads`. So we provision a dedicated least-privilege role.

This is the same least-privilege posture the project already uses for `ops_hub_app` (read-only on FreeScout tables). Do not regress it by reusing the owner credential.

---

## The credential to provision

| Field | Value |
|---|---|
| Role name | `freescout_writer` |
| Login | **yes** (it is a DSN — must authenticate, like `freescout_user`; do **not** model it on `ops_hub_app`, which is `NOLOGIN`) |
| Privileges | `USAGE` on schema `public`; `INSERT` on `threads`; `USAGE, SELECT` on the `threads` id sequence. **Nothing else.** |
| Used by | `FREESCOUT_DB_URL` (Coolify env var on the `ops-hub` app) |
| Companion var | `FREESCOUT_BOT_USER_ID` — the FreeScout staff `users.id` the note is attributed to (`created_by_user_id`); pick an existing staff/bot user |

**Privilege rationale (least privilege):**
- `INSERT` on `threads` — the only write the code performs.
- **No** `SELECT` on `threads`/`conversations` needed: `postFreeScoutNote` does a bare `INSERT` (no `RETURNING`, no `ON CONFLICT`), and the FK from `threads.conversation_id` → `conversations` is enforced by PostgreSQL's internal RI triggers, which run with system privileges and do **not** require the inserting role to hold `SELECT`/`REFERENCES` on `conversations`.
- Sequence `USAGE, SELECT` — **required**, or the `INSERT` fails on the serial `id` default. This is the most common missed grant; do not skip it.
- No `UPDATE`/`DELETE`/`TRUNCATE`, no other tables.

---

## CRITICAL — two execution contexts

There are **two** privilege contexts and mixing them up reproduces FQ-34/FQ-38 exactly. In this Supabase setup, **`postgres`/`service_role` cannot `GRANT` on tables it does not own.** `threads` and its sequence are owned by `freescout_user`, so grants on them must be issued **AS `freescout_user`** via `docker exec ... artisan tinker`.

| Step | Run where | As role |
|---|---|---|
| 1. Create role + schema usage | Supabase **SQL Editor** | `postgres` (admin) |
| 2. Grant `INSERT` on `threads` + sequence | **`docker exec` on the FreeScout container** (artisan tinker) | `freescout_user` (table owner) |
| 3. Build DSN + set Coolify env | Coolify | Production Manager |
| 4. Test INSERT, then verify | psql / SQL Editor as `freescout_writer` | `freescout_writer` |

---

## Step 1 — Create the role (Supabase SQL Editor, as `postgres`)

```sql
-- Run in Supabase SQL Editor (project yocoljutbiizdbfraapx).
-- Schema 'public' is owned by postgres, so USAGE is granted here — NOT as freescout_user.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'freescout_writer') then
    -- LOGIN role: this DSN must authenticate. Replace the placeholder with a
    -- strong generated password; store ONLY in Coolify/Vault, never in the repo.
    create role freescout_writer login password '<SET_IN_COOLIFY_DO_NOT_COMMIT>';
  end if;
end $$;

grant usage on schema public to freescout_writer;

-- Deliberately NO table or sequence grants here — postgres does not own them.
-- Those are Step 2, run as freescout_user.
```

> Set a real password via your secret generator. Do **not** paste a real password into this file, a PR, or chat (CLAUDE.md non-negotiables #1, #4, #9).

---

## Step 2 — Grant the least-privilege write (as `freescout_user`, via `docker exec`)

Same mechanism as the FQ-34 GRANT. Confirm the FreeScout container name first (`docker ps` on the VPS, or Coolify → FreeScout service → Container name).

```bash
# Run on the VPS. Issues the grants AS freescout_user (the table/sequence owner).
# The threads sequence is conventionally 'threads_id_seq' — CONFIRM against the
# live DB first:  \d threads   (look at the id column DEFAULT: nextval('...')).
docker exec <freescout-container-name> php artisan tinker --execute="\
  DB::statement('GRANT INSERT ON threads TO freescout_writer'); \
  DB::statement('GRANT USAGE, SELECT ON SEQUENCE threads_id_seq TO freescout_writer');"
```

If `\d threads` shows a different sequence name (e.g. a non-default serial), substitute it in the second statement before running.

---

## Step 3 — Build the DSN and set Coolify env

Construct `FREESCOUT_DB_URL` for `freescout_writer` using the **same host/port/database and SSL settings** as the existing FreeScout connection (Supabase pooler; mirror whatever `freescout_user` / `OPS_HUB_APP_LOGIN_URL` use — same pooler region, `sslmode=require`, **never** `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized:false`, CLAUDE.md #2).

```
FREESCOUT_DB_URL=postgresql://freescout_writer.<project-ref>:<password>@<pooler-host>:<port>/postgres?sslmode=require
FREESCOUT_BOT_USER_ID=<existing FreeScout staff users.id>
```

Set both in Coolify env for the `ops-hub` app (REPLACE, do not append duplicates). Until both are present, `ticket-respond` stays registered-but-dormant (fail-safe — ticket stays `triaged`).

---

## Step 4 — Verify before opening the gate (blocking pre-enable checks)

These satisfy the ADR's pre-enable verification **and** Security Lead tracked items T1–T2.

1. **Least-privilege confirmed — one test INSERT as `freescout_writer`** (this is where any missing grant surfaces):
   ```sql
   -- Connect AS freescout_writer. Use a real staging conversation_id.
   insert into threads
     (conversation_id, user_id, created_by_user_id, type, status, state,
      source_via, source_type, action_type, body, created_at, updated_at)
   values (<conv_id>::bigint, <bot_user_id>::bigint, <bot_user_id>::bigint,
           3, 1, 2, 1, 1, 0, 'runbook verification note', now(), now());
   ```
   Expect success. Then confirm the role is correctly fenced — each of these must **fail** with a permission error:
   ```sql
   select * from threads limit 1;     -- expect: permission denied (no SELECT)
   select * from customers limit 1;   -- expect: permission denied
   update threads set body = 'x' where false;  -- expect: permission denied
   ```
2. **Schema/constants match live DB** — `\d threads`: confirm the NOT NULL column set matches the `INSERT` and that `type/status/state/source_via/source_type/action_type` constants (3/1/2/1/1/0) are correct for an internal note. The code marks these *unverified against live schema*; this is where they get verified.
3. **Renders correctly + no email (T1/T2):** confirm the inserted note displays correctly in the FreeScout agent UI, that the body is output-sanitized (no stored-XSS — or sanitize the draft before INSERT), and that the raw INSERT triggered **no outgoing customer email** and acceptable conversation counters/last-activity.
4. Delete the verification note when done.

If all pass, the credential scope is approved (C1 satisfied). T3 (dedup guard) and T4 (audit-log entry) remain to be resolved before the dispatch is wired and the path runs unattended — see ADR-0003 §Security Lead Review.

---

## Rollback

Set `FREESCOUT_DB_URL` empty / unset in Coolify → delivery throws "unavailable" before any state change → tickets stay `triaged`, no corruption. To fully revoke: `REVOKE INSERT ON threads FROM freescout_writer;` (as `freescout_user`, via `docker exec`) and `drop role freescout_writer;` (SQL Editor, after revoking).
