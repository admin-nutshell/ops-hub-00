# FOUNDER_QUEUE.md

> Items here require founder action. Each item has: what is blocked, the minimum action required, and who to notify when done.

---

## FQ-40 — litellm-staging REDEPLOY required (NVIDIA_API_KEY not in running container)

**Filed:** 2026-06-26
**Filed by:** Production Manager
**Blocks:** T-22 (ticket-triage live validation), LiteLLM triage-model smoke test

### Symptom

`configure-litellm-triage-model.yml` run #28209902312 failed at smoke test:
```
POST /chat/completions (model=triage-model) -> HTTP 401
"Authentication failed" from NVIDIA NIM
```

### Root cause

The container was **restarted** (not redeployed) after the fresh `NVIDIA_API_KEY` was set in
Coolify. Coolify only injects environment variables on **redeploy** — a restart keeps the old
process env.

Diagnostic evidence from this workflow run:
- OpenAI probe (native gpt-4o-mini, no api_key field) → HTTP 200: `OPENAI_API_KEY` IS in the
  container. The old key predates the restart and is still valid at OpenAI.
- NVIDIA smoke test (openai/meta/llama-3.3-70b-instruct + os.environ/NVIDIA_API_KEY) → HTTP 401
  "Authentication failed": the old NVIDIA key in the container is expired/revoked, and the
  fresh key was never injected because the container was only restarted, not redeployed.

### Required action (founder)

1. Go to https://coolify.inatechshell.ca
2. Navigate to ops-hub-staging project → litellm-staging
3. Confirm NVIDIA_API_KEY (and OPENAI_API_KEY if also rotated) are set correctly in the
   Environment Variables tab
4. Click Deploy (full redeploy — NOT Restart) to rebuild the container and inject current vars
5. Wait for litellm-staging to show Running status (~2–5 minutes)
6. Notify Production Manager: "litellm-staging redeployed"

Production Manager will re-run configure-litellm-triage-model.yml immediately after notification.

### What NOT to do

Do NOT click Restart — restart keeps the old container process and does not inject updated env vars.

### Why not automated

Coolify API restart/redeploy causes a full image rebuild (10+ min outage). Per runbook policy,
Production Manager does not initiate Coolify redeployments via API — only via UI. This protects
against accidental outages during business hours.

### After resolution

Production Manager action on receipt of "redeployed" notification:
1. Run: gh workflow run configure-litellm-triage-model.yml --ref main
2. Verify all smoke test steps pass (HTTP 200, NVIDIA NIM serving)
3. Close FQ-40, update WORK.md T-22 status

---
