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

### FQ-18 — One-time action: Change ops-hub-app domain to HTTPS in Coolify dashboard (T-07 blocker)

```
BLOCKING: [Production Manager] Inngest sync is broken — HTTPS routes to TTS app.

Root cause confirmed (2026-06-22):
  ops-hub-app Coolify FQDN = http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io
  HTTPS:443 for that subdomain routes to TTS app (no HTTPS Traefik router exists for ops-hub-app)
  Inngest Cloud requires HTTPS → sync fails with TTS login page
  HTTP works: /health → 200, /api/inngest → 401 (signing key active)

The Coolify REST API returns 422 for PATCH with fqdn (not allowed for docker image apps).
This requires a 2-minute UI change:

Steps:
  1. Go to https://coolify.inatechshell.ca
  2. Open ops-hub-app → Settings (or Domains/Network tab)
  3. Find the domain field — current value: http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io
  4. Change http:// to https:// → https://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io
  5. Save → then click Restart (or Redeploy)
  6. Wait ~60s then verify: curl https://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io/health
     Expected: {"status":"ok"}
  7. Then sync ops-hub-app in Inngest Cloud dashboard → T-07 complete

Reply: RESOLVED: [date] — HTTPS domain set in Coolify; app restarted; /health returns 200 via HTTPS.

Impact if delayed: T-07 Inngest sync blocked; M1 criterion #4 incomplete; T-09 LangFuse
  trace test and T-13 Sentry verification also blocked on a fully functional staging env.
Linked: T-07, FQ-13 (resolved), DECISIONS.md 2026-06-22, PR #78 (workflow merged)
```

---

### FQ-17 — One-time action: UptimeRobot API key type check + manual monitor creation fallback

```
[Data Engineer] UptimeRobot provisioning workflow is still failing with access_denied
  even after removing the interval parameter (PR #76). Root cause: the API key type
  is likely incorrect, or the account has a restriction that blocks programmatic
  monitor creation.

Diagnosis step (2 min):
  1. Go to https://uptimerobot.com → My Settings → API Settings
  2. Confirm the key in GitHub secret UPTIMEROBOT_API_KEY is the "Main API Key"
     (NOT a "Monitor-Specific API Key" — those can only read/update that one monitor)
  3. Run the following test in any terminal to confirm read access works:
       curl -X POST "https://api.uptimerobot.com/v2/getAccountDetails" \
         -d "api_key=<your-key>&format=json"
     If "stat":"ok" → key is valid; if "stat":"fail" → wrong key type

Option A (recommended — re-enable agent automation):
  Update the GitHub secret with the correct Main API Key:
    gh secret set UPTIMEROBOT_API_KEY --body "<main-api-key>"
  Then re-run the workflow:
    gh workflow run provision-uptimerobot.yml --repo admin-nutshell/ops-hub-00

Option B (self-service, 5 min):
  Manually create 3 HTTP monitors in UptimeRobot dashboard:
    1. ops-hub-app: http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io/health
    2. LiteLLM:     http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io/health
    3. FreeScout:   http://y4b8nibdtizby6ys3el2gad4.187.124.76.235.sslip.io
  5-minute interval; alert email: mai@leelaecospa.com

Reply: RESOLVED: [date] — Option A/B; all 3 monitors active.

Impact if delayed: No uptime alerts for staging (non-blocking for dev; blocking for M1 #9).
Linked: T-14, PR #73, PR #76, scripts/provision-uptimerobot.sh
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
