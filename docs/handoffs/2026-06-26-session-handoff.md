Session Handoff — ops-hub Sprint 2 (2026-06-26 evening)

---

## What was accomplished this session

### Pipeline unblocked — full end-to-end validated

The AI triage pipeline was blocked at the start of this session by a cascade of four distinct issues. All four are now resolved and the pipeline is running live.

**Issue 1 — LiteLLM model registry wiped on redeploy (root blocker)**
Every LiteLLM redeploy resets the model registry. The `meta/llama-3.3-70b-instruct` alias no longer existed, causing HTTP 400 on every `classifyTicket()` call.
- Fixed by running `configure-litellm-triage-model.yml` from branch `fix/litellm-triage-model-env`, which re-registered both aliases.

**Issue 2 — Hardcoded model name in application code**
`ticket-triage.ts` (lines 71, 173) and `ticket-respond.ts` (line 64) hardcoded `"meta/llama-3.3-70b-instruct"` directly in the fetch body and LangFuse metadata. Every LiteLLM redeploy would break the app if the alias was not re-registered with that exact name.
- Fixed in PR #174: replaced all three with `process.env.LITELLM_TRIAGE_MODEL ?? "triage-model"`.
- `LITELLM_TRIAGE_MODEL=triage-model` set manually in Coolify ops-hub-app env vars.

**Issue 3 — Missing DB columns (urgency, category, routing)**
Migration `20260624000000_t22_ticket_triage_columns.sql` had never been applied to the staging Supabase instance. The `UPDATE tickets SET state='triaged', urgency=...` query failed immediately.
- Applied via Supabase SQL Editor (service_role):
  ```sql
  alter table tickets add column if not exists urgency text
    check (urgency in ('critical', 'high', 'normal', 'low'));
  alter table tickets add column if not exists category text;
  alter table tickets add column if not exists routing text;
  create index if not exists tickets_urgency_idx on tickets (urgency);
  ```
- Also applied `20260625000000_t23_responded_state.sql` (adds `'responded'` to state CHECK).

**Issue 4 — OpenAI fallback added to LiteLLM**
NVIDIA NIM was giving HTTP 401 (FQ-40). Added OpenAI `gpt-4o-mini` as a fallback under both LiteLLM aliases (no `api_key` field — LiteLLM reads `OPENAI_API_KEY` from env automatically for native OpenAI). LiteLLM load-balances; NVIDIA 4xx/5xx automatically retries via OpenAI.

### Pipeline validation confirmed

Test ticket "Test 06 pipeline check - DB":
- Triaged: `urgency=normal, category=support, routing=support, state=triaged`
- Responded: AI draft posted as internal FreeScout note, `state=responded, owner_agent=ticket-respond`
- FreeScout note visible in UI (internal only, not sent to customer)

### Workflow fixes

`configure-litellm-triage-model.yml` required three fixes before succeeding:
1. `/model/info` returns HTTP 500 (not 200 + empty list) when registry is empty → added 500-as-empty-registry handling in purge step
2. `https://litellm-staging.inatechshell.ca` returns HTTP 000 from GitHub Actions runners → reverted to sslip.io URL, extracted IP to `LITELLM_SSLIP_IP` env var at top of file
3. Old probe step replaced with actual OpenAI fallback registration (steps 6 + 7)

### PRs merged / closed

| PR | Action | Notes |
|---|---|---|
| #174 | ✅ Merged | Hardcoded model fix + new provision workflow + test fix |
| #173 | ✅ Merged | CLAUDE.md LiteLLM URL suffix update |
| #154 | ✅ Merged | T-25 evals |
| #153 | ✅ Merged | Sprint 1 retrospective |
| #148 | ✅ Merged | T-24 integration tests |
| #164 | ❌ Closed | Superseded by #174's OpenAI fallback |
| #87  | ❌ Closed | Empty after rebase — content already in main |

---

## Current environment state

| Var | Value | Status |
|---|---|---|
| `LITELLM_URL` | `http://h12xz8887fxvbvjts2hac8if-074411057216:4000` | ✅ Docker internal |
| `LITELLM_TRIAGE_MODEL` | `triage-model` | ✅ Set in Coolify ops-hub-app |
| `FREESCOUT_DB_URL` | `postgresql://freescout_user.yocoljutbiizdbfraapx:…` | ✅ Set |
| `FREESCOUT_BOT_USER_ID` | `1` | ✅ Set |
| LiteLLM aliases | `triage-model` + `meta/llama-3.3-70b-instruct` | ✅ NVIDIA primary + OpenAI fallback |
| DB columns | `urgency`, `category`, `routing`, `responded` state | ✅ Applied |

---

## Open blocker — FQ-41 (founder action required)

The Supabase public schema was reset again (2026-06-26 02:45 UTC), wiping the `ops_hub_app` GRANT on FreeScout's `conversations` and `threads` tables. The poller currently gets `permission denied` on every sweep.

**Founder must run these two commands** (via SSH to VPS → `docker exec` on the FreeScout container):

```bash
# Command A — permanent default privilege (run as freescout_user via artisan tinker):
echo "DB::statement(\"ALTER DEFAULT PRIVILEGES FOR ROLE freescout_user IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app\");" | docker exec -i <freescout_container_name> php /www/html/artisan tinker --no-interaction

# Command B — immediate grant on existing tables:
echo "DB::statement(\"GRANT SELECT ON conversations, threads TO ops_hub_app\");" | docker exec -i <freescout_container_name> php /www/html/artisan tinker --no-interaction
```

Replace `<freescout_container_name>` with the current FreeScout container name (run `docker ps | grep freescout` on the VPS to find it).

Full instructions in `FOUNDER_QUEUE.md → FQ-41`.

---

## What remains (Sprint 2)

### Immediate (unblocked after FQ-41)

- **T-26 — Synthetic incident drill**: Send a P1-style email to `support@inatechshell.ca`, watch the full pipeline triage → respond, verify FreeScout note, document as post-mortem. Closes M1 criterion #11.
- **T-27 — DNC project onboarding**: Add DNC as a second project/tenant in the system. Tests app-agnostic design. Closes M1 criterion #12. Requires FQ-29 (DNC scope) resolution.

### Housekeeping

- **Main deploy to staging**: All PRs are merged to main. Staging will auto-deploy via `main-deploy.yml` on the next push/merge. The deployed build still has the old hardcoded model code — a deploy is needed to pick up the env-var fix. This is not urgent since the legacy alias is still registered in LiteLLM and the pipeline works.
- **LiteLLM re-registration after any redeploy**: Every LiteLLM redeploy wipes the model registry (STORE_MODEL_IN_DB schema is reset). After any future LiteLLM redeploy, run `configure-litellm-triage-model.yml` from `main`. The container suffix in the internal URL also changes — check with `docker ps --format '{{.Names}}' | grep h12xz8887fxvbvjts2hac8if` on the VPS and update `LITELLM_URL` in Coolify ops-hub-app.

---

## Key operational instructions

### Running configure-litellm-triage-model.yml

**When:** After any LiteLLM redeploy (registry is wiped), or if Inngest shows `400: Invalid model name`.

1. GitHub → Actions → "Configure LiteLLM — triage-model alias (NVIDIA primary + OpenAI fallback)"
2. Run workflow → branch: `main` → click Run
3. Watch for "triage-model alias: WORKING (HTTP 200)" in the smoke test step
4. If step 3 (purge) exits with HTTP 500 — that's expected on empty registry, it now handles it gracefully
5. If health check exits 28 (timeout) — the sslip.io IP `187.124.76.235` may have changed; run `dig +short coolify.inatechshell.ca` to get the new IP, update `LITELLM_SSLIP_IP` in the workflow file, commit, re-run

### After any LiteLLM redeploy

1. `docker ps --format '{{.Names}}' | grep h12xz8887fxvbvjts2hac8if` → get new container suffix
2. Update `LITELLM_URL` in Coolify → ops-hub-app → Environment Variables: `http://h12xz8887fxvbvjts2hac8if-<new_suffix>:4000`
3. Run `configure-litellm-triage-model.yml` to re-register model aliases

### artisan tinker (FreeScout DB access)

Only way to run SQL as `freescout_user` (who owns FreeScout tables). Supabase SQL Editor runs as `postgres` and cannot grant on tables it doesn't own.

```bash
# Find the container name first:
docker ps | grep freescout

# Pipe SQL via stdin (--execute flag does not exist on this image):
echo "DB::statement(\"YOUR SQL HERE\");" | docker exec -i <container_name> php /www/html/artisan tinker --no-interaction
```

### Coolify API — env var pattern

POST to `/api/v1/applications/<UUID>/envs` — do NOT include `is_secret: true` (returns HTTP 422). Plain `{key, value}` only. Delete before re-create for idempotency.

---

## Branch / repo state

- **Current branch on disk**: `main` (up to date with origin)
- **All PRs**: closed or merged — no open PRs
- **No uncommitted changes**

---

## Files to read at session start

- `CLAUDE.md` — tech stack, security rules, standing constraints
- `WORK.md` — sprint status board
- `FOUNDER_QUEUE.md` — FQ-41 is the active blocker
- `.claude/team/CONSTITUTION.md` — operating rules
- `src/inngest/ticket-triage.ts` + `ticket-respond.ts` — core pipeline code
