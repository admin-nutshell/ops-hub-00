# FOUNDER_QUEUE.md

> Items here require founder action. Each item has: what is blocked, the minimum action required, and who to notify when done.

---

## FQ-53 — LiteLLM /model/new broken: fix Prisma migration before T-48

**Filed:** 2026-07-01
**Filed by:** Tech Lead (T-46)
**Needs:** Diagnosis + fix of LiteLLM DB write API
**Deadline:** Before T-48 (LiteLLM production instance)

T-46 is done — `LITELLM_FALLBACK_MODEL=anthropic/claude-haiku-4-5-20251001` set in ops-hub-app (founder action complete 2026-07-01). Fallback path is live.

**Remaining issue:** LiteLLM's management API (`POST /model/new`) returns HTTP 500 "Failed to add model to db" since the ANTHROPIC_API_KEY redeploy. Reads work (`GET /model/info` → 200) but writes fail. This means the registered triage-model alias may have been lost on redeploy (in-memory only). Current workaround: `LITELLM_FALLBACK_MODEL` uses direct model name, bypassing aliases. **This must be fixed before T-48** — the prod LiteLLM instance needs reliable alias management.

**To diagnose (5 min):**
```
docker logs <litellm-container-name> 2>&1 | grep -i "prisma\|migration\|error" | head -20
```
Look for Prisma migration errors at startup. If found, run:
```
docker exec <litellm-container-name> python -c "from litellm.proxy.proxy_server import *; asyncio.run(prisma_setup(None))"
```
Or redeploy LiteLLM with `DATABASE_URL` pointing to a fresh schema and let it auto-migrate.

**Notify:** Tech Lead when resolved — T-48 can then proceed with alias-based model management.

---

## ✅ FQ-51 — T-46 Second LLM provider: add ANTHROPIC_API_KEY to LiteLLM staging

**Filed:** 2026-06-29 | **Closed:** 2026-07-01
**Filed by:** Tech Lead (T-46)
**Status:** RESOLVED

`ANTHROPIC_API_KEY` added to litellm-staging and container redeployed. T-45 suffix workflow updated LITELLM_URL after the redeploy (run #28495829624). LiteLLM `/health/readiness` confirmed healthy.

**New issue discovered post-redeploy:** LiteLLM `/model/new` API returning HTTP 500 "Failed to add model to db" — DB write broken. See FQ-53 for the workaround that completes T-46 without needing the alias API.

---

## ✅ FQ-50 — T-45 LiteLLM suffix automation: add SSH_PRIVATE_KEY + VPS_HOST GitHub secrets

**Filed:** 2026-06-29 | **Closed:** 2026-07-01
**Filed by:** Tech Lead (T-45)
**Status:** RESOLVED

T-45 builds a `workflow_dispatch` workflow that SSHs to the Coolify VPS, detects the current LiteLLM container suffix, and updates `LITELLM_URL` in ops-hub-app automatically. This eliminates the manual suffix-tracking step after every LiteLLM redeploy.

**Action (10 min):**

1. **Generate an SSH key pair** (if you don't already have one for CI):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-ops-hub" -f ~/.ssh/ops_hub_ci -N ""
   ```

2. **Add the public key to the VPS** (authorized_keys for the user that runs Docker commands — likely `root` or `coolify`):
   ```bash
   cat ~/.ssh/ops_hub_ci.pub >> ~/.ssh/authorized_keys
   ```
   Or paste it via your VPS provider's SSH key management UI.

3. **Add GitHub secrets** (repo Settings → Secrets and variables → Actions):
   - Name: `SSH_PRIVATE_KEY` — Value: contents of `~/.ssh/ops_hub_ci` (the private key)
   - Name: `VPS_HOST` — Value: `187.124.76.235` (Coolify VPS IP)

**Notify:** Tech Lead "FQ-50 complete" — T-45 workflow can be built and tested.

---

## FQ-48 — T-40 Backup verification: add SUPABASE_ACCESS_TOKEN secret

**Filed:** 2026-06-28
**Filed by:** Tech Lead (T-40)
**Needs:** One-time secret creation
**Deadline:** July 9, 2026 (T-40 target)

`verify-backup.yml` runs monthly and calls the Supabase Management API to confirm the last database backup is < 25 hours old. It needs a personal access token with read access to project `yocoljutbiizdbfraapx`.

**Action (5 min):**
1. Go to [Supabase → Account → Access tokens](https://app.supabase.com/account/tokens)
2. Generate new token → name: `ops-hub-backup-verify` → copy it
3. Go to GitHub → repo `admin-nutshell/ops-hub-00` → Settings → Secrets and variables → Actions → New repository secret
   - Name: `SUPABASE_ACCESS_TOKEN`
   - Value: the token you just copied

After adding the secret, trigger a one-time test run:
```
gh workflow run verify-backup.yml --repo admin-nutshell/ops-hub-00
```

**Notify:** PM "FQ-48 complete" — T-40 declared done once a manual run returns ✅.

---

## FQ-49 — T-41 DR drill: LiteLLM external URL unreachable

**Filed:** 2026-06-28 | **Closed:** 2026-06-29
**Filed by:** Production Manager (T-41 DR drill)
**Status:** RESOLVED

**Root cause (not a proxy issue):** LiteLLM was crash-looping with `FATAL: (ENOIDENTIFIER) no tenant identifier provided` from Supavisor. The `DATABASE_URL` username was `postgres` — missing the required project ref suffix. Supavisor requires `postgres.yocoljutbiizdbfraapx`. The bad value persisted because Coolify had accumulated 3 duplicate `DATABASE_URL` rows in its internal `environment_variables` table; the last row (with no project ref) always won on deploy.

**Resolution (2026-06-29):**
1. Connected to `coolify-db` Docker container: `docker exec -it coolify-db psql -U coolify -d coolify`
2. Deleted all 3 duplicate rows: `DELETE FROM environment_variables WHERE resourceable_id=4 AND key='DATABASE_URL'`
3. Re-entered `DATABASE_URL` once via Coolify UI with `postgres.yocoljutbiizdbfraapx` as username
4. Fixed P1000 auth failure (postgres password had been rotated): updated `DATABASE_URL`, `DB_PASSWORD`, and Supabase database password
5. LiteLLM reached `Application startup complete`

**Verification:** `https://litellm-staging.inatechshell.ca/health` returns HTTP 401 (correct — API key enforcement active). `https://ops-hub-staging.inatechshell.ca/health` returns `{"status":"ok"}`.

**Container suffix updated:** Full redeploy changed suffix to `170111887056`. `LITELLM_URL` in Coolify ops-hub-app and CLAUDE.md updated (PR #205).

---

## FQ-47 — T-38 Cstate status page: 4 founder actions to go live

**Filed:** 2026-06-28
**Filed by:** Production Manager (T-38)
**Needs:** Authorization + 4 one-time setup actions
**Deadline:** July 7, 2026 (T-38 target)

Code is merged and the Hugo site is built and deployed by CI. Four actions are needed before `status.inatechshell.ca` is reachable and UptimeRobot alerts are automated:

**Action 1 — Enable GitHub Pages on the repo (2 min)**
Repo Settings → Pages → Source → "GitHub Actions". This is blocked on GitHub Team plan (already active). Without this, `deploy-status.yml` will fail.

**Action 2 — Add DNS CNAME record (5 min)**
In your DNS provider (for `inatechshell.ca`), add:
```
CNAME  status  admin-nutshell.github.io
```
After Pages is enabled, GitHub will also verify the custom domain. If prompted, confirm HTTPS enforcement.

**Action 3 — Create a GitHub fine-grained PAT for dispatch (5 min)**
Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
- Repository: `admin-nutshell/ops-hub-00`
- Permissions: **Actions → Read and Write** (only this — do NOT grant repo contents write)
- Set as Coolify env var `GITHUB_STATUS_DISPATCH_TOKEN` in the `ops-hub-staging` project

**Action 4 — Set secret + configure UptimeRobot webhook (10 min)**
a) Add a random secret string as Coolify env var `STATUS_WEBHOOK_SECRET` (e.g. 32-char random hex — `openssl rand -hex 16`)
b) In UptimeRobot, for each monitored URL (Ops Hub, LiteLLM, FreeScout), add an Alert Contact:
- Type: Webhook
- URL: `https://ops-hub-staging.inatechshell.ca/api/status/webhook?secret=<STATUS_WEBHOOK_SECRET>`
- POST Value (JSON): `{"monitorFriendlyName":"*friendlyname*","monitorURL":"*url*","alertType":*alerttype*}`

Note on secret-in-query-string: UptimeRobot free tier does not support custom HTTP request headers, so the shared secret rides in the URL query parameter rather than an Authorization header. The endpoint is HTTPS-only (TLS in transit), which prevents interception. This is a known limitation of the free tier; upgrading to UptimeRobot Pro would allow header-based auth.

**Notify:** PM "FQ-47 complete" — T-38 will be declared done once status page is confirmed live at `status.inatechshell.ca`.

---

## FQ-46 — Monthly Briefing #1: read and acknowledge

**Filed:** 2026-06-27
**Filed by:** PM (T-29)
**Needs:** Read only — no action required
**Deadline:** July 31, 2026

Monthly briefing #1 is ready: `docs/briefings/2026-07-31-m1-briefing.md`

Covers: M1 complete confirmation, what the platform does today, M2 status, key decisions made, open risks, and next 30 days.

**No founder action needed** — this is an informational briefing. Reading it closes M1 criterion #13 and unblocks T-34 (M2 close).

After reading: notify PM "T-29 read" and M1 #13 will be marked ✅.

---

## FQ-45 — ADR-0004 LiteLLM DB isolation: run Step 1 SQL + set GitHub secret

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** RESOLVED

- `litellm_db_user` role exists, owns `litellm` schema, zero access to `public.*` tables (verified)
- `LITELLM_DB_USER_URL` GitHub secret set
- `fix-litellm-schema-isolation.yml apply-wall` ran (run 28221261717 — DB swap succeeded; health-check timed out during LiteLLM restart but swap applied)
- `fix-litellm-schema-isolation.yml freeze-schema` ran and passed (run 28221681598)

ADR-0004 is fully in force. LiteLLM cannot wipe ops-hub tables on redeploy.

---

## FQ-44 — FREESCOUT_DB_URL: provision env var to activate draft delivery + SLA breach notes

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** RESOLVED

`FREESCOUT_DB_URL` confirmed present in Coolify ops-hub-app env vars. Ticket-respond draft delivery and SLA breach notes are active after PR #192 deploy.

---

## FQ-43 — M3 production go-live: two decisions needed before August infrastructure work begins

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** DEFERRED — founder decision

**Decision:** DNC production go-live is deferred indefinitely. Build the platform to full capability first; tenant production onboarding (DNC or any other) comes after. M3 scope is on hold until the platform is mature and the founder re-opens it.

**Impact:** T-33 scoping doc (`docs/planning/m3-dnc-production.md`) remains valid as a reference — no work needed on it now. Solutions Architect will revisit when founder signals readiness to onboard a tenant to production.

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
