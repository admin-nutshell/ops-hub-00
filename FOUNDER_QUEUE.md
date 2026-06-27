# FOUNDER_QUEUE.md

> Items here require founder action. Each item has: what is blocked, the minimum action required, and who to notify when done.

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
