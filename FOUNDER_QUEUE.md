# FOUNDER_QUEUE.md — Escalations to Founder

> Items needing founder input. Polled by founder 1–2x per day. All other decisions are agent-owned per RACI in `05_people_and_process.md`.

---

## Emergency stop

```
EMERGENCY_STOP: false
```

Setting `EMERGENCY_STOP: true` halts all agent activity immediately. Used only in genuine emergencies (security incident, runaway cost, suspected compromise). Restore to `false` after the situation is contained.

---

## Format

```
[Severity tag] [Agent name] Ask summary
        Context: <1–3 lines>
        Impact if delayed: <what happens if founder doesn't respond>
        Linked: <ticket / ADR / file references>
```

Severity tags:

| Tag | When to use | Founder response time |
|---|---|---|
| `URGENT:` | P1 incident, security signal, financial decision | < 1 hour |
| `BLOCKING:` | Agent cannot continue without answer | < 4 hours |
| *(none)* | Standard ask | < 24 hours |

Founder responds ONLY to business logic and UI/UX decisions.
All technical decisions (security, architecture, tooling, configuration) are made by the
relevant agent and presented as recommendations — not questions. Agents must bring a
recommendation WITH rationale, not a choice between options.

Founder response types:
- `APPROVED:` — business/UX decision accepted
- `REJECTED:` [reason] — business/UX decision declined
- `MORE INFO:` [specific business question] — only when business context is genuinely missing

After founder responds, the originating agent removes the item from this queue and proceeds. Resolved items archive to `docs/founder-queue-archive/YYYY-MM.md` weekly.

---

## Open queue

---

### FQ-36 — URGENT: [Tech Lead] Fix LITELLM_URL in Coolify — wrong URL causes TLS failure, ticket triage broken

```
URGENT: [Tech Lead] T-22 ticket triage is running but EVERY run fails with:
  TypeError: fetch failed — self-signed certificate

Root cause: LITELLM_URL is set to https://litellm-staging.inatechshell.ca but
  litellm-staging serves Traefik's default self-signed cert (not Let's Encrypt).
  Node.js in the ops-hub container rejects it. Ticket triage is completely broken.

DO NOT set NODE_TLS_REJECT_UNAUTHORIZED=0 — that is a security hole.

--- Fix (1 minute, manual) ---

  In Coolify → ops-hub-app → Environment Variables:
  CHANGE  LITELLM_URL  from: https://litellm-staging.inatechshell.ca
                         to: http://litellm-staging:4000

  Both services share the same Coolify Docker network. The internal URL bypasses TLS
  entirely and is the correct architecture for service-to-service calls.

  After changing: click Save + Restart (or Redeploy) to apply the new value.

--- Fix (automated, after PR merge) ---

  Alternatively, merge PR #143 (fix/litellm-tls → main) then:
    gh workflow run fix-litellm-tls.yml
  The workflow updates the env var, restarts ops-hub-app, and re-syncs Inngest automatically.

--- Verify ---

  Within 5 min of the restart, sweepNewTickets cron will fire and triage conv 6 + 7.
  In Supabase: SELECT id, state, urgency, category, routing FROM tickets WHERE
    freescout_conversation_id IN (6,7);
  Expected: state='triaged', urgency/category/routing populated.

Impact if delayed: T-22 cannot be validated. Conv 6+7 remain at state='new'. T-23 blocked.
Linked: T-22 (PR #141), FQ-35 (migration + LITELLM_MASTER_KEY done), PR #143
```

---

### ~~FQ-35 — BLOCKING: [Tech Lead] Run T-22 migration + add LITELLM env vars to Coolify ops-hub-app~~ — PARTIALLY RESOLVED

```
PARTIAL: Actions 1 (migration) and 2 (LITELLM_MASTER_KEY) appear complete — ticket-triage
  runs are firing and reaching LiteLLM. However LITELLM_URL was set to the wrong value
  (https:// URL with a self-signed cert). See FQ-36 for the corrective action.
Linked: FQ-36 (active)
```

---

### ~~FQ-32 — [Tech Lead] Add OPS_HUB_APP_LOGIN_URL env var to Coolify ops-hub-app~~ — SUPERSEDED by FQ-33

```
RESOLVED (env var added) but with incorrect username format — missing project ref suffix.
Supabase session pooler requires ops_hub_app_login.yocoljutbiizdbfraapx as the username,
not ops_hub_app_login. pollFreeScout is failing with ENOIDENTIFIER.
See FQ-33 for the corrected value.
```

---

### ~~FQ-33 — BLOCKING: [Tech Lead] Fix OPS_HUB_APP_LOGIN_URL — username missing project ref suffix~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — OPS_HUB_APP_LOGIN_URL updated with correct
  .yocoljutbiizdbfraapx suffix. pollFreeScout now connects successfully.
  T-21 verified end-to-end: two tickets ingested (freescout_conversation_id: 6 + 7).
  Linked: T-21 (PR #140), FQ-32 (superseded)
```

---

### ~~FQ-34 — BLOCKING: [Tech Lead] Run GRANT as freescout_user via docker exec~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — GRANT SELECT ON conversations, threads TO ops_hub_app
  executed via docker exec artisan tinker. pollFreeScout can now SELECT from both tables.
  T-21 verified end-to-end.
  Linked: T-21 (PR #140), FQ-31, DECISIONS.md 2026-06-23
```

---

### ~~FQ-31 — [Tech Lead] Apply T-21 migration in Supabase SQL Editor~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — T-21 migration applied (freescout_conversation_id column
  added to tickets; staging-support tenant seeded). T-21 verified end-to-end.
  Linked: T-21 (PR #140)
```

---


### FQ-30 — [Tech Lead] Remove FREESCOUT_API_KEY from Coolify ops-hub-app env vars (cleanup)

```
[Tech Lead] Sprint 2 is now using Supabase direct polling (DECISIONS.md 2026-06-23) —
  the FreeScout REST API is no longer part of the architecture. FREESCOUT_API_KEY was
  added to Coolify ops-hub-app env vars for the now-abandoned PT-2 approach and should
  be removed.

Action: Coolify dashboard -> ops-hub-app -> Environment -> delete FREESCOUT_API_KEY.

Non-blocking. No urgency — can be done at next convenience before Sprint 2 closes.
Linked: DECISIONS.md 2026-06-23 (T-21 Supabase direct polling pivot)
```

---

### ~~FQ-28 — [Production Manager] FreeScout admin access for Sprint 2 pre-sprint ops~~ — SUPERSEDED by FQ-30

```
[Production Manager] Sprint 2 pre-sprint ops (PT-1 + PT-2) need FreeScout admin access.

Context: Two configuration steps are needed before the AI pipeline can be wired up:
  PT-1: Add a webhook in FreeScout admin (Settings → Webhooks) pointing to
        https://ops-hub-staging.inatechshell.ca/api/webhooks/freescout
        (events: Conversation Created, Conversation Updated)
  PT-2: Generate a FreeScout API key (Profile → API Access) and provide it so
        Production Manager can store it in Coolify as FREESCOUT_API_KEY.

Recommendation: Production Manager will attempt both via browser automation using the
  FreeScout admin account (haytham@inatechshell.ca). If a saved browser session exists
  this can proceed without founder involvement.

Impact if delayed: T-21 (webhook receiver) cannot be tested E2E; T-23 (auto-response)
  cannot POST replies to FreeScout. Both are on the Sprint 2 critical path.

Linked: T-21, T-23, PT-1, PT-2, Sprint 2 plan
```

---

### FQ-29 — [Solutions Architect] Confirm DNC project scope for T-27 (M1 criterion #12)

```
[Solutions Architect] T-27 scope requires clarification on what "DNC" refers to.

Context: M1 criterion #12 is "DNC tickets flowing through Ops Hub." Before T-27 can be
  scoped, the Solutions Architect needs to know:
  (a) Is DNC a specific client project to onboard?
  (b) Or is DNC a ticket type/compliance category (e.g. Do-Not-Contact)?
  (c) What does a DNC ticket look like — example subject/body?

Recommendation: Please confirm in one sentence. Once confirmed, Solutions Architect
  will own the full T-27 implementation with no further input needed.

Impact if delayed: T-27 cannot be scoped; M1 criterion #12 cannot close. Non-blocking
  for T-21–T-26 (AI pipeline can be built and drilled before T-27 starts).

Linked: T-27, M1 criterion #12
```

---

### ~~FQ-27 — BLOCKING: litellm-staging 502 — Traefik port mismatch~~ — RESOLVED

```
RESOLVED: [Production Manager] 2026-06-23 — Fully automated fix. No founder action taken.
  Root cause: Coolify deployed litellm-staging with Traefik loadbalancer.server.port=80;
    LiteLLM listens on port 4000. Every request hit port 80 (nothing) → 502.
  Fix path (PRs #119–#125):
    1. Decoded base64 custom_labels from Coolify API
    2. Replaced port=80 → port=4000 in Traefik + Caddy label refs (sed)
    3. Re-encoded as base64 — PATCH /applications/{uuid} HTTP 200
    4. POST /stop → POST /start: container recreated with correct Traefik labels
    5. Health poll: HTTP 200 ✅ (litellm-staging.inatechshell.ca reachable)
    6. configure-litellm-nvidia.yml auto-dispatched and succeeded:
       POST /model/new HTTP 200 — meta/llama-3.3-70b-instruct registered in LiteLLM DB
       GET /model/info — 1 entry confirmed ✅
  T-08 ✅ DONE. M1 criterion #4 complete.
  Linked: T-08, PRs #119–#125, runs #28043591139 + #28043673055
```

---

### ~~FQ-26 — BLOCKING: Verify litellm-staging container health + env vars~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — litellm-staging confirmed Running (up 20 minutes).
  All env vars present: DATABASE_URL ✅, LITELLM_MASTER_KEY ✅, STORE_MODEL_IN_DB=True ✅,
  NVIDIA_API_KEY ✅. Workflow re-triggered. A new issue was subsequently found (see FQ-27).
  Linked: T-08, FQ-27
```

---

### ~~FQ-25 — BLOCKING: LITELLM_MASTER_KEY + NVIDIA_API_KEY GitHub secrets not resolving~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — Both secrets confirmed set in GitHub Actions:
  LITELLM_MASTER_KEY ✅ and NVIDIA_API_KEY ✅. Workflow re-triggered successfully.
  Linked: T-08, FQ-26
```

---

### ~~FQ-24 — BLOCKING: Set FreeScout custom domain in Coolify dashboard~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — FQDN set in Coolify UI for freescout-staging.
  Caddy now routes https://freescout-staging.inatechshell.ca to the FreeScout container.
  FreeScout confirmed live. Admin email updated to support@inatechshell.ca.
  T-10 ✅ DONE. M1 criterion #6 complete. Sprint 2 E2E test path unblocked.
  Linked: T-10, PRs #98–#109, run #28002846589
```

---

### ~~FQ-22 — BLOCKING: Add FREESCOUT_DB_PASS secret~~ — RESOLVED (superseded by FQ-23)

```
RESOLVED: [Founder] 2026-06-23 — FREESCOUT_DB_PASS secret added. However, v3 redeploy
  (run #28000210274) revealed a new blocker: the Supabase master password contains an
  '@' character. The psql client inside nfrastack/freescout splits the connection URL
  on the FIRST '@', making the host resolve to '24zakhsh@pooler-hostname' — DNS fails.
  New action needed: see FQ-23 BLOCKING below.
  Linked: T-10, FQ-23
```

---

### ~~FQ-23 — BLOCKING: Create dedicated FreeScout DB user in Supabase~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — freescout_user created in Supabase SQL Editor;
  FREESCOUT_DB_PASS updated to FreeScoutStaging2026.
  Production Manager updated workflow DB_USER → freescout_user.yocoljutbiizdbfraapx
  (PR #104) and ran v3 redeploy (run #28001287578).

  Container logs confirmed success:
    - Empty database detected → migrations ran
    - Admin user created: mai@leelaecospa.com
    - nginx + php-fpm started
    - HTTP 200 at https://freescout-staging.inatechshell.ca

  T-10 DONE. M1 criterion #6 complete. Sprint 2 E2E test unblocked.
  Linked: T-10, PR #104, run #28001287578
```

---

### ~~FQ-18 — One-time action: Change ops-hub-app domain to HTTPS in Coolify dashboard (T-07 blocker)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — DNS A record added (ops-hub-staging.inatechshell.ca →
  187.124.76.235), domain set to https://ops-hub-staging.inatechshell.ca in Coolify,
  app restarted. Inngest Cloud app synced successfully at
  https://ops-hub-staging.inatechshell.ca/api/inngest. ops-hub registered in Inngest
  Production environment. T-07 complete. T-09 and T-13 unblocked.
  Linked: T-07, FQ-13 (resolved), PR #78/79/80
```

---

### ~~FQ-17 — One-time action: Create 3 UptimeRobot monitors manually (API blocked by free plan)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — 3 monitors created manually in UptimeRobot dashboard
  (free plan blocks newMonitor API — confirmed via getAccountDetails, active_subscription:null).
  Active monitors:
    1. ops-hub-staging health → https://ops-hub-staging.inatechshell.ca/health
    2. litellm-staging health → https://litellm-staging.inatechshell.ca/health
    3. TTS app health         → TTS app URL
  Note: /api/inngest monitor deleted — Inngest returns 405 on GET by design (signed POST
  required); uptime monitors using GET would generate constant false alerts.
  T-14 ✅ Done. M1 criterion #9 ✅ Done. Sprint 1: 20/20 (100%).
```

---

### ~~FQ-16 — One-time action: Execute T-12 Vault setup (5-step SQL in Supabase SQL Editor)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — T-12 Vault setup complete. All security checks passed:
  - ops_hub_app_login role created (login=true, bypassrls=false)
  - langfuse_secret_key stored in Vault
  - ops_hub_app_password stored in Vault
  - internal.get_secret() accessor created
  - anon/authenticated have no accessor access
  - ops_hub_app cannot read vault directly
  T-12 done. T-18 integration test unblocked (can now run against real ops_hub_app_login path).
  Linked: T-12 (PR #69), T-18 (PR #72), docs/engineering/t12-vault-runbook.md
```

---

### ~~FQ-15 — One-time action: Run T-11 Supabase migrations (runbook ready, gate cleared)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-21 — T-11 migrations applied via Supabase SQL Editor.
  All 6 tables verified in public schema. LiteLLM tables also present (expected —
  STORE_MODEL_IN_DB=True). T-12 (Vault setup) now unblocked. T-19 and T-20 unblocked.
  T-18 unblocks after T-12.
  Linked: T-11, T-12, T-18, T-19, T-20
```

---

### ~~FQ-14 — One-time action: UptimeRobot monitor setup (3 staging URLs)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — Option A complete. UPTIMEROBOT_API_KEY set in GitHub
  Actions secrets. Agents unblocked to create monitors. T-14 in flight.
  Linked: T-14, WORK.md
```

---

### ~~FQ-13 — One-time action: Inngest Cloud app provisioning (signing key + event key)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY set in
  Coolify env vars for ops-hub-app. Container redeploys on next PR merge to main.
  Pending founder action: after redeploy, verify /api/inngest returns 200 with
  introspection JSON; send test/hello.world event from Inngest Cloud dashboard to
  confirm helloWorld function executes.
  Linked: T-07, PR #49 (merged), WORK.md
```

---

### ~~FQ-12 — One-time action: GHCR auth on Coolify VPS~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-21 — Option B chosen: docker login ghcr.io configured on
  Coolify VPS with read:packages PAT. Login confirmed successful. VPS can now pull
  private GHCR images. T-07 Inngest staging deploy unblocked.
  Linked: PRs #53–#55, T-07
```

---

### ~~FQ-11 — T-10 FreeScout: Supabase Supavisor pooler rejects project~~ — RESOLVED

```
RESOLVED: [Production Manager] 2026-06-21 — Founder provided correct pooler hostname
  (aws-1-ca-central-1.pooler.supabase.com, not aws-0) and updated SUPABASE_STAGING_DB_URL
  GitHub secret to the pooler URL.

  Additional root causes found and fixed agent-side (no founder action needed):
    - Pooler URL had no explicit :5432 port → URL parser put hostname in DB_PORT → fixed by
      numeric guard + default-5432 fallback (PR #46, run #27916949231).
    - laravel_db_is_populated() uses DB_SSL_MODE not FREESCOUT_DB_PGSQL_SSL_MODE → added
      DB_SSL_MODE=require to container env (PR #46).
    - tiredofit/freescout image had no SKIP_DB_READY → switched to nfrastack/freescout
      (PR #45); SKIP_DB_READY=TRUE now bypasses the pg_isready loop.

  T-10 FreeScout DEPLOYED. Health check green. Run #27916949231 ✓ all steps, 3m50s.
  Linked: PRs #42–#46, FQ-10 (resolved), DECISIONS.md
```

---

### ~~FQ-10 — T-10 FreeScout: VPS directory permissions block PostgreSQL; architecture choice needed~~ — RESOLVED

```
RESOLVED: [Production Manager] 2026-06-21 — Founder chose Option B (Supabase).
  VPS outbound TCP:5432 is now OPEN (iptables rule added by founder).
  Workflow reverted to tiredofit/freescout + Supabase PostgreSQL (PRs #36–#37).
  Coolify-managed PostgreSQL permanently abandoned on this VPS (bind-mount root:root
  permission bug is systemic; all 10 autonomous fix paths were exhausted in PRs #25–#34).
  New active blocker: Supabase session pooler rejects project (see FQ-11).
  Linked: PRs #25–#37, FQ-09 (superseded), FQ-11 (active)
```

---

### ~~FQ-09 — VPS firewall blocks outbound TCP:5432~~ — SUPERSEDED BY FQ-10

```
SUPERSEDED: [Production Manager] 2026-06-21 — the PR #25 agent workaround (internal PG)
  ultimately failed due to VPS directory permission issues (see FQ-10). FQ-09's recommended
  action (open outbound TCP 5432) is now the RECOMMENDED path in FQ-10 Option B.
  This item is retained for reference. No separate founder action needed — FQ-10 covers it.
  Linked: FQ-10 (active), PRs #25–#34
```

---

### ~~FQ-08 — FreeScout MariaDB sidecar is crashing on Coolify VPS~~ — RESOLVED (agent-owned)

```
RESOLVED: [Production Manager] 2026-06-20 — no founder action required.

  Root cause identified: thatwebagency/freescout does NOT exist on Docker Hub (returns HTTP 404).
  The MariaDB sidecar crash was a secondary symptom; the primary failure was that Docker could
  never pull the FreeScout image on any deploy attempt.

  Fix applied via PR #17 (fix/freescout-postgresql-tiredofit):
    - Switched to tiredofit/freescout (actively maintained; latest release June 13, 2026;
      PostgreSQL support via DB_TYPE=pgsql)
    - Eliminated MariaDB sidecar; FreeScout now connects to existing Supabase PostgreSQL
    - FREESCOUT_STAGING_ADMIN_PASS secret created; SUPABASE_STAGING_DB_URL already present
    - Workflow: removes freescout-mariadb if present, deletes+recreates FreeScout app if
      still pointing to wrong image, sets tiredofit env vars with pgsql/Supabase config

  No cost impact: uses existing Supabase staging DB ($0 additional).
  Staging trade-off accepted: FreeScout tables co-tenant in Ops Hub Supabase public schema
  for Sprint 1 staging only; production will use a dedicated database.

  Linked: PR #18, DECISIONS.md 2026-06-20 [Production Manager] entry.
```

---

### ~~FQ-07 — Coolify API access feature gate is disabled~~ — RESOLVED (agent-confirmed)

```
RESOLVED: [Production Manager] 2026-06-21 — Coolify API access was enabled by founder
  (evidenced by all subsequent workflow runs returning HTTP 200 from /api/v1/servers).
  PRs #19–#22 all ran successfully against the Coolify API. No further action needed.
  FQ-07 archived to docs/founder-queue-archive/.
```

---

### ~~FQ-06 — Approve merge of PR #1: CI pipeline skeleton~~ — RESOLVED

```
APPROVED: [Founder] — Merge PR #1. Agents handle all technical configuration
  including branch protection settings. Tech Lead owns branch protection setup —
  find a way to execute without repo admin or escalate to a solution.
```

---

### ~~FQ-01 — Coolify provisioning~~ — RESOLVED

```
APPROVED: [Founder] — Coolify projects ops-hub-staging and ops-hub-prod provisioned
  at https://coolify.inatechshell.ca. Production Manager has full admin access via
  the existing Coolify instance. Proceed with T-07 through T-15.
```

---

### ~~FQ-02 — Supabase project for Ops Hub~~ — RESOLVED

```
APPROVED: [Founder] — Supabase project for Ops Hub created (2026-06-18).
  Dedicated project (separate from TTS). pgvector enabled. Region: Canada Central
  (PIPEDA compliant). Connection details in docs/infrastructure/supabase-ops-hub.md
  (placeholder values — real values stored in Coolify env vars, never committed).
  T-11 (migrations) and T-12 (Vault setup) are now unblocked.
```

---

### ~~FQ-03 — Repo naming vs. charter~~ — RESOLVED

```
APPROVED: [Founder] — Update docs to reflect actual repo name (admin-nutshell/ops-hub-00).
  Do not rename the repo. 09_delivery.md updated; DECISIONS.md logged.
```

---

### ~~FQ-05 — LangFuse Cloud data residency (PIPEDA awareness)~~ — RESOLVED

```
APPROVED: [Founder] — LangFuse US region approved for Sprint 1 and Sprint 2.
  Revisit before M3 when real tenant tickets start flowing.
```

---

### ~~FQ-04 — DNC go-live target date~~ — WITHDRAWN

```
WITHDRAWN: [Founder] — DNC is parked. Focus is building the Ops Hub system.
  M3 timeline is deferred until further notice. Solutions Architect proceeds
  with generic onboarding checklist only (no DNC-specific timeline).
```

---

## Recently resolved (this week)

- **FQ-01** (2026-06-18) — Coolify provisioned (`ops-hub-staging` + `ops-hub-prod` at `coolify.inatechshell.ca`). APPROVED by Founder. Unblocks T-07–T-15.
- **FQ-02** (2026-06-18) — Supabase project provisioned. APPROVED by Founder. Unblocks T-11, T-12, T-18, T-20.
- **FQ-05** (2026-06-20) — LangFuse Cloud US region approved for Sprint 1 + Sprint 2. Revisit before M3 (real tenant data).

---

*Founder: this is the only file you're required to read regularly. Everything else updates around you.*
