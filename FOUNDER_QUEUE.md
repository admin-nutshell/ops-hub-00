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

### FQ-15 — One-time action: Run T-11 Supabase migrations (runbook ready, gate cleared)

```
BLOCKING: [Tech Lead] T-11 migrations are fully unblocked — please run the runbook now.

Context: Both migrations are ready to apply. The Security Lead has signed off on migration 2
  (RLS policies, 2026-06-21, APPROVED WITH CONDITIONS, C1 fix applied). The runbook is at:
    docs/engineering/t11-migration-runbook.md

  What you need (from Coolify env vars for the Supabase project):
    - DATABASE_URL (service_role / owner connection string — never commit this)
  Set it as $env:SUPABASE_DB_URL in PowerShell before running.

Steps summary (full commands in the runbook):
  1. psql $env:SUPABASE_DB_URL -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public';"
     (should return empty — confirms clean slate)
  2. psql $env:SUPABASE_DB_URL -f supabase/migrations/20260618120000_initial_schema.sql
  3. psql $env:SUPABASE_DB_URL -f supabase/migrations/20260618120100_enable_rls_policies.sql
  4. Run verification queries from runbook §5 — confirm 6 tables + RLS enabled.
  5. Reply: RESOLVED: [date] — T-11 migrations applied, verification passed.

  After this runs, the agent team will proceed with T-12 (Vault setup).

Impact if delayed: T-12 (Vault), T-18 (RLS isolation test), T-19 (integration test),
  and T-20 (KB structure) are all gated on this. M1 criteria #10 (first ticket flow)
  cannot be met until the schema is live.
Linked: T-11, T-12, T-18, T-19, T-20, docs/engineering/t11-migration-runbook.md
```

---

### FQ-14 — One-time action: UptimeRobot monitor setup (3 staging URLs)

```
[Production Manager] UptimeRobot API key needed to complete T-14.

Context: Three staging services are live and should be monitored:
  1. ops-hub-app:   http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io/health
  2. LiteLLM:       http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io/health
  3. FreeScout:     http://y4b8nibdtizby6ys3el2gad4.187.124.76.235.sslip.io
  No UptimeRobot API key is configured in GitHub secrets.

Option A (recommended — agent-owned after this step):
  1. Sign in at https://uptimerobot.com → My Settings → API Settings
  2. Create (or copy) the "Main API Key"
  3. Add it to GitHub secrets: gh secret set UPTIMEROBOT_API_KEY --body "<key>"
  Agents will then create all 3 monitors automatically.

Option B (self-service, 5 min):
  Sign in to UptimeRobot dashboard and manually add HTTP monitors for the 3 URLs above
  with check interval 5 min, alert to mai@leelaecospa.com.

Reply: RESOLVED: [date] — Option A/B complete; monitors active.

Impact if delayed: No uptime alerts for staging services (non-blocking for Sprint 1 dev
  work; blocking for M1 criterion #9).
Linked: T-14, WORK.md
```

---

### FQ-13 — One-time action: Inngest Cloud app provisioning (signing key + event key)

```
BLOCKING: [Production Manager] Inngest Cloud credentials needed to complete T-07.

Context: ops-hub-app is deployed and healthy at
  http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io
  The /api/inngest endpoint is live (inngest@4.7.0 SDK, helloWorld function).
  The app cannot connect to Inngest Cloud without INNGEST_SIGNING_KEY and
  INNGEST_EVENT_KEY, which come from the Inngest Cloud dashboard.

Steps (3–5 minutes):
  1. Go to https://app.inngest.com → sign up or log in
  2. Create a new app named "ops-hub" (or "ops-hub-staging")
  3. Copy the Event Key  → set as INNGEST_EVENT_KEY in Coolify env vars for ops-hub-app
  4. Copy the Signing Key → set as INNGEST_SIGNING_KEY in Coolify env vars for ops-hub-app
  5. In Coolify: restart ops-hub-app to pick up the new env vars
  6. In Inngest Cloud dashboard → Apps → "Sync app" → enter:
       http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io/api/inngest
  7. Reply to this item with: RESOLVED: [date] — Inngest app synced, signing key set.

Impact if delayed: T-07 exit criteria unmet (Inngest dashboard shows envs; test event
  processed). M1 #4 remains partial. T-09 LangFuse trace test also blocked.
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
