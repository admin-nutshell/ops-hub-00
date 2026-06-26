# Deploy Plan: LiteLLM model re-registration — meta/llama-3.3-70b-instruct

**Date:** 2026-06-25
**Environment:** `ops-hub-staging` on Coolify
**Change type:** LiteLLM DB-only (no container restart, no env var changes)
**Status:** PLANNED — awaiting workflow run
**Production Manager:** Claude (Sonnet 4.6)
**Founder approval:** YES — approved in session (2026-06-25)

---

## Problem

`triageTicket` Inngest function is failing with:

```
LiteLLM 400: Invalid model name passed in model=meta/llama-3.3-70b-instruct
```

This is a LiteLLM **router-level** error, not an NVIDIA API error. It means
`meta/llama-3.3-70b-instruct` is not in LiteLLM's registered deployment list.
Root cause: litellm-staging has been redeployed several times during T-22 network
fixes (PRs #143–#145). Each full redeploy resets the LiteLLM database, wiping all
`STORE_MODEL_IN_DB` model registrations. The initial registration (run #28043673055)
was lost during one of these redeploys.

---

## Pre-deploy checklist

- [x] QA Manager: not required — no code change; pure infrastructure config restore
- [x] Security Lead: not required — no secrets/vault changes; no new env vars; same
  NVIDIA_API_KEY already in Coolify staging env vars
- [x] Rollback path defined (see below)
- [x] Canary target: litellm-staging model registration (24h monitoring window)
- [x] Sentry + UptimeRobot: baselines captured (UptimeRobot monitors T-09 active)
- [x] Founder notified: approved in session

---

## Change description

**What is changing:** Re-register `meta/llama-3.3-70b-instruct` in the LiteLLM
database via the `/model/new` API endpoint. No container restart. No code change.
No env var changes.

**Registration params (same as original run #28043673055):**

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

- `model_name` is the caller-facing name (what `triageTicket` sends)
- `openai/` prefix tells LiteLLM to use the OpenAI-compatible endpoint
- The actual model string sent to NVIDIA NIM is `meta/llama-3.3-70b-instruct`
  which IS the correct current NVIDIA NIM catalog name
- `os.environ/NVIDIA_API_KEY` is resolved from the container env at request time
  (NVIDIA_API_KEY is already set in Coolify staging env vars)

---

## Deploy steps

Workflow: `.github/workflows/fix-litellm-model-registration.yml`

1. Health-check litellm-staging — fail fast if not Running
2. GET `/model/info` — log all currently registered models
3. GET `/v1/models` — log publicly exposed model list
4. DELETE any existing `meta/llama-3.3-70b-instruct` registrations (by model DB id)
5. POST `/model/new` — register with the params above
6. Verify registration appears in `/model/info`
7. POST `/chat/completions` — test call with `max_tokens: 5`
8. Report LITELLM_DEFAULT_MODEL in ops-hub-app env vars (if set)

---

## Rollback path

**Blast radius:** LiteLLM model registry only. No container, no app code, no env vars.

| Condition | Rollback action | Time |
|---|---|---|
| Registration fails | Nothing to revert — no change was made | 0 min |
| Test completion fails (NVIDIA API error) | POST `/model/delete` with the new model DB id (logged in workflow output) | < 5 min |
| Test completion fails (wrong key) | Update NVIDIA_API_KEY in Coolify staging → container restart | < 15 min; escalate to FOUNDER_QUEUE |
| Original state was "no model" | Zero rollback needed; old state was already broken | N/A |

---

## Post-deploy verification

- [ ] Workflow run shows HTTP 200 on `/chat/completions` test
- [ ] `triageTicket` Inngest function processes the next synthetic ticket without
  "Invalid model name" error
- [ ] LangFuse receives a trace from the triage call
- [ ] No Sentry error spike in the 30-minute window after deploy

---

## Monitoring window

24 hours from workflow run completion. Check:
- LangFuse trace health every 2 hours
- Sentry error count (LiteLLM 400s should drop to zero)
- UptimeRobot litellm-staging monitor

---

*Deploy plan authored 2026-06-25. Rollback path defined. Ready to execute.*
