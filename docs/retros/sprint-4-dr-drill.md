# Sprint 4 DR Drill — Component-Level Restart Verification

**Date:** 2026-06-28
**Scope:** Staging environment — ops-hub, LiteLLM, FreeScout
**Workflow:** `.github/workflows/dr-drill.yml` (workflow_dispatch)
**Participants:** Production Manager + Tech Lead

---

## Objective

Verify that each platform component can be restarted independently and recovers cleanly, and confirm the LiteLLM internal URL suffix update procedure is understood and documented.

---

## Components drilled

| Component | Action | Recovery time | Result |
|---|---|---|---|
| FreeScout | Container restart via Coolify API | < 3 min | ✅ |
| LiteLLM | Container restart via Coolify API | < 3 min | ✅ |
| ops-hub | Container restart via Coolify API + Inngest re-sync | < 3 min | ✅ |

---

## LiteLLM URL suffix — findings and procedure

**Observation:** A simple container restart (no image pull) does **not** change the internal Docker container name/suffix. The `LITELLM_URL` env var in ops-hub-app remained valid after the drill restart.

**When the suffix DOES change:** Only on a full Coolify redeploy (image pull + new container). This occurs when:
- A new LiteLLM version is deployed
- The Coolify service is fully deleted and recreated
- The LiteLLM model configuration workflow (`configure-litellm-openai-only.yml`) triggers a redeploy

**Procedure for suffix update after full redeploy:**

1. SSH to the VPS **or** use any accessible shell on the Coolify host:
   ```bash
   docker ps --format '{{.Names}}' | grep h12xz8887fxvbvjts2hac8if
   ```
   Note the new suffix (the part after the last `-`).

2. Update `LITELLM_URL` in Coolify ops-hub-app environment variables:
   ```
   http://h12xz8887fxvbvjts2hac8if-<NEW_SUFFIX>:4000
   ```

3. Restart ops-hub (so it picks up the new env var):
   ```bash
   gh workflow run dr-drill.yml --field components=ops-hub
   ```
   Or trigger via Coolify UI.

4. Verify ops-hub /health returns 200 and a triage call succeeds.

**Known limitation:** There is no automated way to discover the new suffix without VPS shell access. The Coolify API does not expose the internal Docker container name in application details. This is an acceptable manual step for the current staging scale.

---

## Incidents / findings

None — all three components recovered within the expected window. FreeScout DB GRANTs (`SELECT` on `conversations`/`threads`) were preserved across the restart (GRANTs are database-level, not container-level).

---

## Process changes

1. **Inngest re-sync after ops-hub restart is required.** Without the `PUT /api/inngest` call, the Inngest dashboard shows the app as disconnected until the next natural sync cycle (~5 min). The `dr-drill.yml` workflow handles this automatically.

2. **FreeScout restart does not require GRANT re-application** provided the Supabase DB was not also reset. If FreeScout's DB is wiped (rare), re-run the GRANT via FreeScout container artisan tinker (see `restart-freescout-regrant.yml`).

3. **LiteLLM model registration survives restarts.** `STORE_MODEL_IN_DB=True` means model config is in Supabase, not in the container. A simple restart does not wipe model registrations.

---

## Runbook additions

- To restart a single component: `gh workflow run dr-drill.yml --field components=<ops-hub|litellm|freescout>`
- To drill all components: `gh workflow run dr-drill.yml --field components=all`
- Full results are in the GitHub Actions step summary for each run (90-day retention)
