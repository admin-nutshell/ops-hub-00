# Deploy Plan — Swap LiteLLM Provider: NVIDIA NIM → Anthropic Claude Haiku 4.5

**Date:** 2026-06-25
**Change:** P1 incident recovery — replace exhausted NVIDIA NIM model with Anthropic Claude Haiku 4.5
**Workflow:** `.github/workflows/swap-litellm-provider-anthropic.yml`
**Branch:** `ops/pm-status-20260625`
**Environment:** `litellm-staging` (staging only; production not yet active)
**Owner:** Production Manager

---

## Incident summary

LiteLLM returning 429 for all triage requests:
```
No deployments available for selected model, cooldown_list=['48ea73ba-7c3c-4a88-a261-921558c3fc19']
```

Root cause: NVIDIA NIM free-tier credits exhausted. The model `meta/llama-3.3-70b-instruct`
registered under model ID `48ea73ba-7c3c-4a88-a261-921558c3fc19` is in permanent cooldown.
All ticket triage calls from `src/inngest/ticket-triage.ts` are failing.

---

## What changes

| Layer | Before | After |
|-------|--------|-------|
| LiteLLM model_name alias | `meta/llama-3.3-70b-instruct` → NVIDIA NIM | `meta/llama-3.3-70b-instruct` → Anthropic Claude Haiku 4.5 |
| LiteLLM litellm_params.model | `openai/meta/llama-3.3-70b-instruct` | `anthropic/claude-haiku-4-5` |
| LiteLLM litellm_params.api_base | `https://integrate.api.nvidia.com/v1` | (removed — Anthropic SDK handles routing) |
| LiteLLM litellm_params.api_key | `os.environ/NVIDIA_API_KEY` | `os.environ/ANTHROPIC_API_KEY` |
| `litellm-staging` Coolify env vars | ANTHROPIC_API_KEY may be absent | ANTHROPIC_API_KEY present (injected if absent) |
| `ops-hub-app` Coolify env vars | LITELLM_DEFAULT_MODEL absent | LITELLM_DEFAULT_MODEL = `meta/llama-3.3-70b-instruct` (staged) |

Application code (`ticket-triage.ts`) sends `model: "meta/llama-3.3-70b-instruct"` —
this string is preserved as the LiteLLM alias. Zero code changes required.

---

## Rollback path

NVIDIA NIM credits are exhausted. Rolling back to NVIDIA NIM is not possible without
acquiring new credits (founder decision, not an automated rollback).

**If Claude Haiku triage quality is insufficient:**
- Re-run `swap-litellm-provider-anthropic.yml`
- Before running: change `HAIKU_MODEL` env in the workflow from `anthropic/claude-haiku-4-5`
  to `anthropic/claude-sonnet-4-6` (stronger model, higher cost — founder cost approval required)

**If ANTHROPIC_API_KEY is invalid or quota exceeded:**
1. Founder rotates Anthropic API key
2. Updates GitHub secret `ANTHROPIC_API_KEY`
3. Deletes the registered model: `POST /model/delete {"id": "<id-from-/model/info>"}`
4. Re-runs this workflow

**NVIDIA NIM config for reference (re-register when credits restored):**
```json
{
  "model_name": "meta/llama-3.3-70b-instruct",
  "litellm_params": {
    "model": "openai/meta/llama-3.3-70b-instruct",
    "api_base": "https://integrate.api.nvidia.com/v1",
    "api_key": "os.environ/NVIDIA_API_KEY"
  }
}
```

---

## Pre-deploy checklist

- [x] QA not required — this is an incident recovery fix, not a feature change
- [x] Security Lead action: change touches Coolify env var (`ANTHROPIC_API_KEY`) — recorded in DECISIONS.md; Security Lead informed via this deploy plan. No new secret is generated; key comes from founder-owned Anthropic account
- [x] Rollback path defined (above)
- [x] No code commits — workflow-only change
- [x] Canary target: litellm-staging only (single service, no blast radius beyond staging triage)
- [x] Monitoring window: 24 hours post-deploy
- [ ] ANTHROPIC_API_KEY in litellm-staging Coolify env OR in GitHub secrets — **TBD at runtime** (workflow self-detects; see FOUNDER_QUEUE if blocked)

---

## Deploy steps

1. Push `swap-litellm-provider-anthropic.yml` to `ops/pm-status-20260625`
2. Trigger: `gh workflow run swap-litellm-provider-anthropic.yml --ref ops/pm-status-20260625`
3. Monitor workflow run in GitHub Actions
4. If step 4 fails ("ANTHROPIC_API_KEY absent + no secret"): resolve FOUNDER_QUEUE item FQ-42, then re-trigger

---

## Post-deploy smoke test

The workflow itself runs a live completion test (step 6):
```
POST /chat/completions
model: "meta/llama-3.3-70b-instruct"  ← the alias the app sends
messages: [{role: "user", content: "Reply with the single word: ok"}]
```
Expected: HTTP 200 with a text response.

Additional manual verification:
```sql
-- After sweepNewTickets next cron run (within 5 minutes):
SELECT id, state, urgency, category FROM tickets WHERE state = 'triaged' LIMIT 5;
```

---

## Monitoring window

24 hours from first successful triage call post-deploy.

Watch:
- Sentry: LiteLLM 4xx/5xx error rate
- LangFuse: `ticket-triage` generation traces (model field should show `claude-haiku-4-5`)
- UptimeRobot: `litellm-staging.inatechshell.ca/health` — should remain green
- Inngest dashboard: `sweep-new-tickets` + `ticket-triage` function success rate

---

## Tech Lead follow-up required

`src/inngest/ticket-triage.ts` has hardcoded model name at two locations:

| File | Line | Current | Recommended fix |
|------|------|---------|-----------------|
| `src/inngest/ticket-triage.ts` | 71 | `model: "meta/llama-3.3-70b-instruct"` | `model: process.env.LITELLM_DEFAULT_MODEL ?? "meta/llama-3.3-70b-instruct"` |
| `src/inngest/ticket-triage.ts` | 173 | `model: "meta/llama-3.3-70b-instruct"` | `model: process.env.LITELLM_DEFAULT_MODEL ?? "meta/llama-3.3-70b-instruct"` |

`LITELLM_DEFAULT_MODEL` is staged in ops-hub-app Coolify env vars after this deploy.
Tech Lead should wire the env var read into the code to prevent future incidents requiring
model-name changes across multiple workflow files.
