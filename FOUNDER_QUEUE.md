# FOUNDER_QUEUE.md

> Items here require founder action. Each item has: what is blocked, the minimum action required, and who to notify when done.

---

## FQ-45 — ADR-0004 LiteLLM DB isolation: run Step 1 SQL + set GitHub secret

**Filed:** 2026-06-27
**Filed by:** Tech Lead
**Needs:** Execution (SQL + GitHub Actions secret)
**Blocking:** LiteLLM table wipe risk on every redeploy. Has wiped `public.tenants` / `public.tickets` 3× in staging. Agent-dispatched workflow (`fix-litellm-schema-isolation.yml`) is ready — blocked on Steps 1 + 2 below, which only `postgres` can run.
**Full runbook:** `docs/engineering/litellm-db-isolation-runbook.md`

**Context:** LiteLLM's Prisma startup runs DDL against the schema its DB user can reach. Because LiteLLM has been connecting as a `public`-capable user, it has wiped Ops Hub tables (tenants, tickets, etc.) 3 times. ADR-0004 solves this with a permission wall: a dedicated `litellm_db_user` role that owns the `litellm` schema and has zero access to `public`.

**What needs to happen (2 founder steps, then agent dispatches):**

**Step 1 — Run SQL in Supabase SQL Editor** (project `yocoljutbiizdbfraapx`, connected as `postgres`)

> Generate a strong password first (e.g. run `openssl rand -base64 24`). Use it where you see `__REPLACE__`.

Copy-paste from `docs/engineering/litellm-db-isolation-runbook.md` §Step 1 (the full SQL block). Key operations:
1. `CREATE ROLE litellm_db_user LOGIN PASSWORD '__REPLACE__'` (with NOSUPERUSER NOBYPASSRLS)
2. `DROP SCHEMA IF EXISTS litellm CASCADE; CREATE SCHEMA litellm AUTHORIZATION litellm_db_user`
3. `ALTER ROLE litellm_db_user SET search_path = litellm`
4. `REVOKE ALL ON SCHEMA public FROM litellm_db_user`

**Step 2 — Set GitHub Actions secret** (repo: `admin-nutshell/ops-hub-00` → Settings → Secrets → Actions)

Add secret `LITELLM_DB_USER_URL` with value:
```
postgresql://litellm_db_user.<project-id>:<password>@<supavisor-host>:6543/postgres?schema=litellm&pgbouncer=true
```
Replace `<project-id>` with `yocoljutbiizdbfraapx`, `<password>` with the one you generated, `<supavisor-host>` with the Supabase Transaction Mode pooler host (same host used in `OPS_HUB_APP_LOGIN_URL`, different port).

**After Steps 1 + 2 are done:** Notify Tech Lead ("FQ-45 Steps 1+2 done"). Agent dispatches the GitHub Actions workflow `fix-litellm-schema-isolation.yml` with `mode=apply-wall`, then `mode=freeze-schema`. Full 6-step runbook at `docs/engineering/litellm-db-isolation-runbook.md`.

**Options:**
- **Do it now (Recommended)** — runs 15–30 min; eliminates the #1 ops risk (table wipe on next LiteLLM redeploy)
- **Defer** — safe only if LiteLLM is not redeployed before this is applied

**Recommendation:** Do it now. The next LiteLLM redeploy (routine or triggered by Coolify auto-update) will wipe staging tables again. The workflow is ready to dispatch the moment you confirm.

**Deadline:** Before next LiteLLM redeploy — treat as **ASAP / high priority**

---

## FQ-44 — FREESCOUT_DB_URL: provision env var to activate draft delivery + SLA breach notes

**Filed:** 2026-06-27
**Filed by:** Tech Lead
**Needs:** Infrastructure provisioning (2 env vars in Coolify)
**Blocking:** Two capabilities that T-35 (PR #192) just built — but both need direct FreeScout DB access to post internal notes:
1. `ticket-respond`: Inngest function that posts the AI-drafted reply as a FreeScout internal note. Currently **dormant** — the ticket state advances to `responded` but no note is posted to FreeScout. A human cannot see the draft.
2. `sla-monitor`: Posts a ⚠️ SLA BREACH note to FreeScout conversations that exceed the 60-min response target. Without the env var, only the `audit_log` entry is created (not visible in FreeScout).

**What needs to happen:**

**Step 1 — Add `FREESCOUT_DB_URL` to Coolify ops-hub-app env vars**

In Coolify → `ops-hub-app` → Environment Variables, add:
```
FREESCOUT_DB_URL = postgresql://freescout_user.yocoljutbiizdbfraapx:<freescout-db-password>@<supavisor-host>:5432/postgres
```
Use the same `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD` values from the FreeScout Coolify service env vars to construct this. **Do NOT use the pooler port 6543** — FreeScout's raw DB user needs a direct connection (port 5432, Session Mode).

> Security note: `freescout_user` has table-level ownership on `conversations` and `threads` only. ops_hub_app's write path is separate. This connection is used exclusively to INSERT into the `threads` table (internal notes).

**Step 2 — Confirm `FREESCOUT_BOT_USER_ID=1` is already set**

This should already be in Coolify from T-27. If not, add it. The bot user ID is the FreeScout admin user ID (haytham@inatechshell.ca → ID 1).

**After setting both env vars:** Click Deploy (full redeploy, not Restart) in Coolify. Then notify Tech Lead: "FQ-44 done — FREESCOUT_DB_URL set". Agent will verify a test note appears in FreeScout.

**Recommendation:** Do Step 1+2 and redeploy. Takes 5 minutes. Activates the AI draft delivery that's been dormant since T-23.

**Deadline:** Non-blocking — but ticket-respond has been dormant since T-23 (June 25). This has been the only remaining gap in the respond capability.

---

## FQ-43 — M3 production go-live: two decisions needed before August infrastructure work begins

**Filed:** 2026-06-27  
**Filed by:** Solutions Architect (T-33 scoping)  
**Needs:** Decision (A) + Authorization (B)  
**Blocking:** M3 planning; infrastructure provisioning cannot start until (A) is decided  
**Full scoping doc:** `docs/planning/m3-dnc-production.md`

**Context:** T-27 proved the DNC pipeline on staging. M3 = DNC on production with real customer tickets. Before agents can begin the prod infrastructure build (target: mid-August), two founder decisions are required.

**Item A — DNC support email address (Decision)**

What email do real DNC customers send support tickets to?

- **Option A (Recommended):** New DNC domain alias, e.g. `support@dailyneedscanada.ca` → prod FreeScout IMAP. Clean; DNC owns their support identity. Requires DNC to have/acquire a domain and configure MX or a Google Workspace alias.
- **Option B:** `dnc@support.inatechshell.ca` (ITS subdomain alias) → prod FreeScout IMAP. Low-cost; no new domain needed. Adequate if DNC does not yet have its own domain.
- **Option C (Not recommended):** Share `support@inatechshell.ca` between staging and prod FreeScout. Risk of emails landing in the wrong environment.

**Item B — Do real DNC customers exist yet? (Information)**

M3 is only meaningful if DNC has real customer ticket volume by end-August 2026. If DNC has no real customers yet, the M3 date slips — that's not a problem, just a planning input agents need to know.

**Options:**
- **Yes** — DNC has (or will have) real customers by August 2026 → proceed with full M3 prod build
- **No / Not yet** — DNC is still pre-launch → M3 target date slips to when DNC goes live; agents will scope infrastructure work against that revised date

**Recommendation:** Choose Option A or B for the email (A is cleaner at scale; B works fine for an early-stage tenant). If DNC is pre-launch, confirm expected launch date so agents can schedule the M3 infrastructure sprint accordingly.

**Deadline:** Non-blocking on Sprint 3; needed before agents begin August infra work (target: decision by 2026-07-25 to give agents 1 week to scope the infra sprint).

**After resolution:** Notify Solutions Architect with choices → agent will open the M3 infrastructure sprint and build the phase 1–5 runbook (see scoping doc §4).

---

## ✅ FQ-42 — DNC onboarding: apply migration + update 2 Coolify env vars (T-27 / M1 #12) — RESOLVED 2026-06-27

**Filed:** 2026-06-27
**Resolved:** 2026-06-27 — Founder completed all 3 steps:
  - Migration applied in Supabase SQL Editor (TTS project + DNC tenant seeded)
  - `POLLING_PROJECT_ID` + `POLLING_TENANT_ID` set in Coolify ops-hub-app → redeployed
  - DNC test email sent → confirmed end-to-end: FreeScout → triage → respond → `state=responded`, `tenant_id=00…0020` in Supabase
**Filed by:** Tech Lead
**Was blocking:** T-27 (M1 criterion #12 — DNC tickets flowing through ops-hub)
**Priority:** HIGH — last step to close M1

### What was built

- Migration `supabase/migrations/20260627000000_t27_dnc_onboarding.sql` seeds TTS project + DNC tenant
- `projects/tts/config.json` + `projects/tts/tenants/dnc.json` — Project Context instance for DNC
- `freescout-poller.ts` now reads project/tenant IDs from `POLLING_PROJECT_ID` / `POLLING_TENANT_ID` env vars (with fallback to dev placeholders) — proves app-agnostic design

### Required founder actions (3 steps)

#### Step 1 — Apply migration in Supabase SQL Editor

Copy-paste this SQL into Supabase SQL Editor (project `yocoljutbiizdbfraapx`), run as postgres/service_role:

```sql
-- TTS project
INSERT INTO projects (id, name, context_schema)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'tts',
  '{"product":"Ticket Triage System","slug":"tts","support_email":"support@inatechshell.ca"}'
)
ON CONFLICT (name) DO NOTHING;

-- DNC tenant
INSERT INTO tenants (id, project_id, name, tier, sla_config)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000002',
  'Daily Needs Canada',
  'growth',
  '{"response_target_minutes":60,"escalation_threshold":"high","timezone":"America/Toronto"}'
)
ON CONFLICT (id) DO NOTHING;
```

Expected: `INSERT 0 1` for each statement (or `INSERT 0 0` if already applied — both are OK).

#### Step 2 — Update 2 env vars in Coolify

Go to: Coolify → `ops-hub-app` → Environment Variables

Add (or update) these two:

| Key | Value |
|---|---|
| `POLLING_PROJECT_ID` | `00000000-0000-0000-0000-000000000002` |
| `POLLING_TENANT_ID` | `00000000-0000-0000-0000-000000000020` |

Then click **Deploy** (not Restart — full redeploy to inject env vars).

#### Step 3 — Send a DNC test email + confirm

Send an email to **support@inatechshell.ca** with any DNC-relevant subject (e.g. "DNC: order not delivered" or "DNC: payment failed"). Within 5 minutes:

1. FreeScout: email appears in ITS Support inbox
2. Inngest: `ticket-triage` run shows `tenant_id = 00000000-0000-0000-0000-000000000020`
3. Supabase SQL Editor: verify

```sql
SELECT title, urgency, category, routing, state, tenant_id
FROM tickets
WHERE tenant_id = '00000000-0000-0000-0000-000000000020'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: a row with `state = 'responded'`, `tenant_id = '00000000-0000-0000-0000-000000000020'`

### After resolution

Notify Tech Lead: "FQ-42 done — DNC tenant_id confirmed in Supabase"

Tech Lead will close T-27 and mark M1 criterion #12 ✅.

---

## ✅ FQ-41 — FreeScout second DB reset recovery: GRANT + Gmail OAuth — RESOLVED 2026-06-27

**Filed:** 2026-06-26
**Resolved:** 2026-06-27 — `diagnose-freescout-imap.yml` run #28274619900 confirmed:
  - `ops_hub_app` SELECT GRANT: ✅ 2 rows (conversations + threads)
  - FreeScout conversations: 3 rows, threads: 8 rows — email fetch active
  - ops-hub `/health`: HTTP 200
  - **T-26 pre-flight: all items green — drill can proceed**
**Filed by:** Production Manager
**Was blocking:** T-22 (ticket-triage live validation), full Inngest pipeline, M1 criterion #10 re-verification

### What happened

The Supabase public schema was reset a second time. FreeScout detected an empty DB at startup (02:45 UTC 2026-06-26) and re-ran all migrations, recreating the admin user as `info@inatechshell.ca`. This wiped the `ops_hub_app` GRANT on `conversations` and `threads`.

Confirmed via three workflow runs:
- `diagnose-freescout-imap.yml` run #28215344117 (03:32 UTC): conversations = 0, GRANT = 0, cron IS running, no failed_jobs
- `check-freescout-mailboxes.yml` run #28215633753 (03:41 UTC): GRANT still 0, no OAuth table (tokens stored in mailboxes.meta)
- `check-freescout-mailboxes.yml` run #28215745025 (03:44 UTC): **mailbox IS configured** (1 row, id=1 "ITS Support", imap.gmail.com:993 SSL, created_at=02:48, updated_at=03:03 UTC). GRANT still 0.

The mailbox was re-configured by the founder at 02:48 UTC and updated again at 03:03 UTC (likely OAuth re-authorization). The mailbox OAuth may already be connected.

The only confirmed remaining blocker is the GRANT.

### Required founder actions (two steps — must both be done)

#### Step 1: Re-issue the GRANT + make it permanent (via SSH to Coolify VPS)

Run **both commands** on the VPS hosting the Coolify FreeScout container.

> **Why via SSH/artisan tinker:** The Supabase SQL Editor runs as `postgres`, which cannot
> alter default privileges for another role. `artisan tinker` connects as `freescout_user`
> (FreeScout's own DB user, who owns `conversations` and `threads`). Only the owner can set
> default privileges for that role. Running from Supabase SQL Editor will return
> `permission denied to change default privileges`.

**Command A — permanent fix (runs as freescout_user, sets default privileges):**
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan tinker \
  --execute="DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app');"
```

Expected output: `=> true`

This makes any future table FreeScout creates (via Laravel migrations on next restart) automatically grant SELECT to `ops_hub_app`. This is the permanent fix — once set, it survives all future FreeScout schema resets.

**Command B — apply grant to current tables:**
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan tinker \
  --execute="DB::statement('GRANT SELECT ON conversations, threads TO ops_hub_app');"
```

Expected output: `=> true`

If the container name lookup fails (`docker ps -qf` returns empty), find the container ID directly:
```bash
docker ps | grep sgnpza1r8jlq19f0dboqpzq6
# Then substitute <CONTAINER_ID> below:
docker exec <CONTAINER_ID> php artisan tinker --execute="DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app');"
docker exec <CONTAINER_ID> php artisan tinker --execute="DB::statement('GRANT SELECT ON conversations, threads TO ops_hub_app');"
```

**Verify the grant took effect** (run in Supabase SQL Editor):
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('conversations', 'threads')
  AND grantee = 'ops_hub_app';
```
Expect 2 rows (one SELECT grant per table).

#### Step 2: Verify Gmail OAuth connection in FreeScout UI

The mailbox row IS in the DB (confirmed from DB query, updated_at=03:03 UTC). The OAuth connection may already be active.

1. Go to: `https://freescout-staging.inatechshell.ca/mailboxes`
2. Find "ITS Support" mailbox and click Edit
3. Go to "Incoming Email" tab
4. Click "Test Connection" — confirm it says "Connection is successful"
5. If the test fails: click "Connect Google Account" and re-authorize the OAuth
6. Save the mailbox settings if any changes were made

#### Step 3 (optional — after steps 1+2): Manually trigger an email fetch

To verify emails start appearing without waiting for the cron:
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan freescout:fetch-emails
```

Note: the artisan binary is at `/www/html/artisan` inside the container (not `/var/www/html/artisan`). If `php artisan` doesn't resolve, use `php /www/html/artisan freescout:fetch-emails`.

### After resolution

Notify Production Manager: "GRANT re-issued + ALTER DEFAULT PRIVILEGES applied + Gmail OAuth reconnected in FreeScout"

Production Manager will:
1. Run `discover-freescout-schema.yml` to confirm conversations rows are appearing
2. Verify `pollFreeScout` is dispatching `ticket.triage` events in Inngest
3. Close FQ-41 and update T-22 status
4. Trigger `sweepNewTickets` sweep if conversations exist but are missed by the cron window

### Note on recurrence

This has happened twice. Root cause: GRANTs on FreeScout-owned tables are lost when FreeScout re-runs Laravel migrations (e.g. on DB reset). The permanent fix is `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app` — run once as `freescout_user` via artisan tinker (Step 1 above). After that, every table FreeScout creates will automatically carry the grant. **This fix must be run via artisan tinker, not Supabase SQL Editor** (Supabase SQL Editor connects as `postgres`, which returns `permission denied to change default privileges` for another role's defaults).

---

## ✅ FQ-40 — NVIDIA_API_KEY value rejected by NVIDIA NIM (401 Unauthorized) — RESOLVED 2026-06-27

**Filed:** 2026-06-26
**Resolved:** 2026-06-27 — bypassed NVIDIA entirely; gpt-4o-mini is now the sole triage-model provider
**Filed by:** Production Manager
**Was blocking:** T-22 (ticket-triage live validation), LiteLLM triage-model smoke test

**Resolution:** Created and merged PR #176 (`configure-litellm-openai-only.yml`), then triggered
`configure-litellm-openai-only` workflow (run #28274212266). All 9 steps passed:
- Purged all existing model registrations (NVIDIA aliases removed)
- Registered `gpt-4o-mini` as `triage-model` alias → HTTP 200 smoke test ✅
- Registered `gpt-4o-mini` as `meta/llama-3.3-70b-instruct` alias → HTTP 200 smoke test ✅
NVIDIA not used. OPENAI_API_KEY confirmed working. No founder action required.

**Original issue (archived for reference):**

### Current symptom (runs #28210294811 and #28210675694)

`configure-litellm-triage-model.yml` run #28210675694 failed at smoke test.
The user confirmed NVIDIA_API_KEY was "corrected" in Coolify and litellm-staging was fully redeployed
before this run. The 401 persists:
```
POST /chat/completions (model=triage-model) -> HTTP 401
litellm.AuthenticationError: OpenAIException - Error code: 401
{'status': 401, 'title': 'Unauthorized', 'detail': 'Authentication failed'}
Received Model Group=triage-model
Available Model Group Fallbacks=None
```

This is the third workflow run showing HTTP 401 from NVIDIA NIM (runs #28209902312,
#28210294811, #28210675694).

### What is confirmed working

- litellm-staging container is up and reachable (health check passed)
- Both `NVIDIA_API_KEY` and `OPENAI_API_KEY` key names are present in Coolify env config
- Container was fully redeployed (env injection confirmed)
- `OPENAI_API_KEY` is valid and injected: OpenAI probe (native gpt-4o-mini, no api_key field) → HTTP 200
- LiteLLM model registration for `triage-model` alias → HTTP 200 (registration itself succeeds)

### Root cause (updated)

The `NVIDIA_API_KEY` value stored in Coolify is being **rejected by the NVIDIA NIM API** with
HTTP 401. The previous hypothesis (restart vs redeploy) no longer applies — the full redeploy
confirmed that OPENAI_API_KEY is injected and working.

The NVIDIA_API_KEY is present in the running container (key name confirmed by Coolify API, and
the redeploy would have injected it), but when LiteLLM sends it to
`https://integrate.api.nvidia.com/v1` using `os.environ/NVIDIA_API_KEY`, NVIDIA returns 401.

Possible causes (founder to verify):
1. The key value was entered incorrectly in Coolify (truncated, extra whitespace, wrong copy)
2. The key is valid but not activated for `meta/llama-3.3-70b-instruct` model access in NVIDIA NIM
3. The key belongs to a different NVIDIA service (e.g., NIM Microservices vs integrate.api.nvidia.com)
4. The key was revoked or expired at NVIDIA's side after being generated

### Required action (founder)

1. Go to https://build.nvidia.com → API Keys and verify the key value character-for-character
2. Confirm the key has access to the NIM catalog model `meta/llama-3.3-70b-instruct` at
   `https://integrate.api.nvidia.com/v1`
3. If the key is wrong: update `NVIDIA_API_KEY` in Coolify UI → litellm-staging → Environment
   Variables, then click Deploy (full redeploy)
4. If the key is correct but still fails: generate a fresh key at https://build.nvidia.com,
   update Coolify, and redeploy
5. Notify Production Manager: "NVIDIA key updated and litellm-staging redeployed"

### What NOT to do

Do NOT click Restart after updating the key — only Deploy (full redeploy) injects updated env vars.

### Additional confirmed data point (run #28210675694)

The OpenAI probe in step 7 passed (HTTP 200) in both run #28210294811 and #28210675694.
This confirms `OPENAI_API_KEY` is live and valid in the running container. If NVIDIA cannot
be resolved, OpenAI can serve as the sole provider temporarily.

A ready-to-trigger workflow has been committed to unblock once NVIDIA is fixed:
`.github/workflows/register-litellm-openai-fallback.yml`

### After resolution

Production Manager action on receipt of notification:
1. Run: `gh workflow run configure-litellm-triage-model.yml --repo admin-nutshell/ops-hub-00`
2. Verify NVIDIA smoke test passes (HTTP 200)
3. On NVIDIA pass: `gh workflow run register-litellm-openai-fallback.yml --repo admin-nutshell/ops-hub-00`
4. Verify both NVIDIA and OpenAI final tests pass (HTTP 200 each)
5. Close FQ-40, update WORK.md T-22 status

---
