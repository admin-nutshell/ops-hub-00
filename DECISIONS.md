# DECISIONS.md — Decision Log

> Append-only. Every meaningful decision gets one line + (optionally) a link to a detailed ADR in `docs/adr/`.

---

## Format

```
YYYY-MM-DD [Agent or Founder] Decision summary → optional link
```

For substantial decisions, include `→ ADR-NNNN` pointing to the full record in `docs/adr/NNNN-title.md`.

---

## Decisions

### 2026-06-18 — Planning phase

```
2026-06-18 [Founder] Locked Ops Hub as app-agnostic platform; TTS is Project #1, not the product itself
2026-06-18 [Founder] Locked free-tier-first as standing tool selection rule
2026-06-18 [Founder] Locked provider-neutral via BYOK as standing architecture rule
2026-06-18 [Founder] Approved Pricing Option D: basic agent support in all TTS tiers; Premium SLA add-on at +$200 CAD/mo
2026-06-18 [Founder] Approved Pre-Seed target: $150K–$300K CAD
2026-06-18 [Founder] Approved tool stack: Inngest + LangFuse + LiteLLM + Supabase Vault + Promptfoo + FreeScout + Cstate
2026-06-18 [Founder] Locked Plan v0.8 — all 9 dimensions complete + master plan synthesis
2026-06-18 [PM] Ready to plan Sprint 1 from Milestone M1 in 09_delivery.md
2026-06-18 [PM] Sprint 1 planned: June 23–July 4, 2026 — goal: M1 Workspace + Foundation; 20 tasks across 4 tracks; 2 blocking founder items in FOUNDER_QUEUE
2026-06-18 [PM] Handed off Sprint 1 Track A (ADRs + schema + CI/CD spec) to Tech Lead → WORK.md T-01 through T-05
2026-06-18 [Founder] Provisioned dedicated Supabase project for Ops Hub (pgvector + RLS + Index Advisor enabled; Canada Central region; separate from TTS) → FQ-02 resolved; T-11 + T-12 unblocked
2026-06-18 [Founder] Coolify provisioning confirmed. ops-hub-staging + ops-hub-prod ready at coolify.inatechshell.ca. All Sprint 1 blockers resolved.
```

### 2026-06-18 — Sprint 1 Track A (Tech Lead)

```
2026-06-18 [Tech Lead] 3 environments per project (dev local / staging / prod) on shared Hostinger+Coolify VPS; dev = local ephemeral Claude Code context, not a hosted env; VPS sizing review concludes no upgrade needed for M1 (70% util trigger escalates resize to founder) → ADR-0001
2026-06-18 [Tech Lead] Tool stack rationale recorded — Inngest, LangFuse, LiteLLM, Supabase (DB+Vault+vector), Promptfoo, FreeScout, Cstate; each free-tier/self-host with documented fallback trigger; no >12mo lock-in → ADR-0002
2026-06-18 [Tech Lead] Ops Hub Supabase schema designed (6 tables) with fail-closed RLS tenant isolation; enforcement model = ops_hub_app non-superuser role + app.current_tenant GUC for agent paths, JWT claim for portal paths, service_role reserved for migrations/platform ops (bypasses RLS by design). Pending Security Lead sign-off → docs/engineering/database-schema.md + supabase/migrations/2026061812*
2026-06-18 [Tech Lead] CI/CD toolchain locked: Node 20 + TypeScript (pnpm) primary, Python 3.12 secondary; ESLint+Prettier+tsc lint, Vitest tests, Promptfoo eval gate at >95%, staging auto-deploy on merge to main via Coolify webhook, prod manual promotion only (workflow_dispatch); 4 required PR status checks → docs/engineering/ci-cd-pipeline.md
```

### 2026-06-20 — Operating model + CI pipeline + repo naming

```
2026-06-20 [Founder] Operating model updated: Founder responds only to business logic and UI/UX. All technical decisions are agent-owned — agents recommend and execute without asking founder to choose between technical options.
2026-06-20 [Tech Lead] CI skeleton (pr-checks.yml) approved for merge: lint + typecheck + Vitest unit/integration placeholder + gitleaks (SHA-pinned digest, gitleaks git command). All GitHub Actions SHA-pinned; permissions: contents: read; persist-credentials: false. CodeRabbit + QA Manager + Security Lead signed off → PR #1 merged.
2026-06-20 [Founder] Repo naming: admin-nutshell/ops-hub-00 is the canonical name. 09_delivery.md updated to match. Do not rename the repo.
```

### 2026-06-20 — Branch protection + T-11 runbook resolution + T-15 scaffold

```
2026-06-20 [Founder] GitHub Team upgrade approved and executed for admin-nutshell org — enables server-side branch protection on main (free-tier returned 403; classic protection + rulesets both require paid plan on private repos).
2026-06-20 [Tech Lead] Branch protection fully configured on main: 3 required status checks (Lint & Type Check, Unit Tests, Security Scan), strict (branches must be up to date), ≥1 approval required, dismiss stale reviews, no direct push, no force-push, no branch deletion.
2026-06-20 [Tech Lead] T-11 migrations proceed via founder-run runbook — agents never hold service_role key per security model. Runbook at docs/engineering/t11-migration-runbook.md. Security Lead sign-off required before founder runs migration 2 (RLS policies).
2026-06-20 [Tech Lead] T-15 app scaffold merged (PR #2, commit 0860ff4): Node 20 + TS + pnpm toolchain, ESLint 9 flat config, strict tsc, Vitest, GET /health, multi-stage Dockerfile (non-root), .githooks/pre-push. All 3 CI checks green. Unblocks T-07 (Inngest), T-13 (Sentry SDK), Coolify app deploy.
2026-06-20 [Security Lead] Gitleaks CI invocation fixed (PR #3, commit 295a481): --source flag removed from git subcommand, repo path now positional. Live-verified against pinned digest — clean repo exit 0, planted secret exit 1, --redact confirmed.
```

### 2026-06-20 — T-08/T-10 deploy workflow

```
2026-06-20 [Production Manager] deploy-staging-services.yml merged to main (PR #6, 8c5170c): workflow_dispatch for T-08 (LiteLLM) + T-10 (FreeScout) staging deploys via Coolify REST API.
2026-06-20 [Production Manager] PR #8 (2fea606): replaced curl -fsS with explicit HTTP status capture + pre-flight diagnostics. Run #27887003804 confirmed root cause: Coolify returns HTTP 403 {"success":true,"message":"You are not allowed to access the API."} with rate-limit headers present — token IS valid; the Coolify API access feature gate is disabled. Fix: Coolify Settings → API → Enable. No token regeneration needed.
2026-06-20 [Production Manager] T-08 LiteLLM staging: DEPLOYED (run #27887445367, PR #6). litellm-staging found existing in Coolify; started successfully.
2026-06-20 [Production Manager] T-08 LiteLLM staging: DEPLOYED. litellm-staging found existing in Coolify (UUID h12xz8887fxvbvjts2hac8if); started successfully via workflow. Run #27887445367 all green.
2026-06-21 [Production Manager] T-10 FreeScout staging: workflow complete (run #27888022061, all steps green). FreeScout app created (UUID u103pgr0dbq9iiwf636m1msw), all 6 DB env vars set (HTTP 201 each), deployment queued. BLOCKED at runtime: MariaDB sidecar (freescout-mariadb) is exited:unhealthy — container crashes on VPS before FreeScout can connect. FQ-08 raised for founder to diagnose MariaDB logs and resolve. Fixes applied via PRs #12–#16: endpoint (→/applications/dockerimage), field name (docker_registry_image_name), set-e guard, retry logic, bulk-env→individual POSTs, DB_PASSWORD extraction from internal_db_url.
2026-06-20 [Production Manager] T-10 FreeScout root cause identified: thatwebagency/freescout does not exist on Docker Hub (returns 404) — Docker image pull was failing silently on every deploy attempt. Decision: switch to tiredofit/freescout (actively maintained, June 2026 release, PostgreSQL-capable via DB_TYPE=pgsql) + Supabase PostgreSQL (eliminates MariaDB sidecar entirely). MariaDB crash was a secondary problem; the primary issue was the non-existent image. FREESCOUT_STAGING_ADMIN_PASS secret set in GitHub. PR #17 implements the fix. No cost impact ($0 — uses existing Supabase staging DB). Staging trade-off accepted: FreeScout tables co-tenant in Ops Hub Supabase public schema for Sprint 1 staging only; production deployment will use a dedicated database. → PR #18
```

### 2026-06-21 — T-10 FreeScout multi-PR debug sequence + branch protection update

```
2026-06-21 [Production Manager] T-10 FreeScout: SITE_URL fixed via PR #21 (container now reaches DB check). Root cause of that failure: tiredofit/freescout entrypoint uses SITE_URL (not APP_URL) as required URL var; SETUP_TYPE=AUTO halts on missing SITE_URL. Fixed by fetching app FQDN from Coolify API and setting both SITE_URL and APP_URL. Force-recreate strategy (always delete+recreate app) was adopted to sidestep Coolify env-var upsert failures (PATCH→422, DELETE→000, POST→409). upsert_env→set_env rename fixed merge artifact (PR #22).
2026-06-21 [Production Manager] T-10 FreeScout: Root cause of DB failure confirmed via run #27890237911 (PR #23 DEBUG_MODE + connectivity probe): VPS firewall blocks outbound TCP:5432. Evidence — pooler hostname resolves correctly (AWS ca-central-1 ELB, IPv4), port 5432 reachable from GitHub Actions (Azure East US), psql in container times out after ~35s (TCP drop, not refuse). PR #24 tries transaction pooler port 6543 as agent-owned workaround; FQ-09 raised for founder to open VPS outbound port 5432.
2026-06-21 [Tech Lead] Branch protection updated: required_approving_review_count 1→0. Rationale: founder is sole contributor; self-approval is impossible; CodeRabbit + CI gates (lint, test, security) are sufficient quality bar for single-founder repo. enforce_admins set to true (CI gates now apply to all committers). Will revert to count=1 when second human contributor joins.
2026-06-21 [Production Manager] FQ-07 archived — Coolify API access confirmed enabled (evidenced by all workflow runs returning HTTP 200 from /api/v1/servers in PRs #19–#22). No further action required.
2026-06-21 [Production Manager] T-10 FreeScout: PR #25 switches to Coolify-managed internal PostgreSQL (freescout-postgres). VPS firewall blocks ALL outbound PostgreSQL traffic (both port 5432 and 6543 confirmed DROP — 35s timeouts in runs #27890237911 + #27890511141). Coolify-managed DB runs on Docker internal network — bypasses firewall entirely. DB is idempotent (persists across app force-recreates); internal_db_url fetched from Coolify API; DB_SSL=FALSE (no TLS on internal network). If PR #25 deploy succeeds, FQ-09 is resolved without any founder action.
```

### 2026-06-21 — T-10 FreeScout final fix sequence (PRs #27–#29)

```
2026-06-21 [Production Manager] T-10 FreeScout PR #27: added 3-retry + 20s backoff on Coolify
  /databases API calls after transient HTTP 000 timeouts in run #27891164266 (Coolify unreachable
  during DB startup window). Retry logic already present on /applications calls extended to /databases.
2026-06-21 [Production Manager] T-10 FreeScout PR #28 (Docker Compose attempt): switched to
  POST /applications/dockercompose to co-locate freescout + postgres on a shared compose network.
  Result: HTTP 404 — endpoint does not exist in this Coolify version (routes/api.php has no compose
  route, confirmed by reading Coolify open-source code). Cleanup step succeeded (deleted
  freescout-staging app + freescout-postgres DB cbm2359em7f5aw5vqsb7vgtl).
2026-06-21 [Production Manager] T-10 FreeScout PR #29 (FAILED): connect_to_docker_network: true
  had NO effect. Field is stored in application.settings (ApplicationsController.php) but is
  completely absent from ApplicationDeploymentJob.php — never applied to the runtime Docker Compose
  network config. Container logs still show DB unreachable for 65s (TCP-timeout pattern: 10s retry
  interval, not 5s). Run #27892270211: all CI steps green, FreeScout HTTP 502, DB unreachable.
2026-06-21 [Production Manager] T-10 FreeScout PR #30 (diagnostic): root cause not yet confirmed.
  TCP-timeout retry pattern (10s = 5s SYN timeout + 5s sleep) indicates DNS resolves but packets
  are dropped — consistent with network isolation (different Docker subnets), not DB timing.
  Exhausted API-level network flags: connect_to_docker_network no-op, --network silently ignored
  by convertDockerRunToCompose, dockercompose endpoint 404. PR #30 adds full destination_uuid/
  destination JSON dumps for both app and DB + server network probe + DB status polling — to
  confirm whether app and DB share the same Coolify destination (and therefore Docker network).
  Fix strategy determined by diagnostic output.
```

### 2026-06-21 — T-10 FreeScout root cause confirmed + PR #31 fix

```
2026-06-21 [Production Manager] T-10 FreeScout PR #30 (diagnostic): root cause CONFIRMED.
  Run #27895401460: both app and DB on same destination (uuid: vdo878a68cilactub9fh2zcr,
  network: "coolify") — network isolation is ruled out. DB status was "exited:unhealthy"
  within 3s of instant_deploy:true and never recovered in 180s. Root cause: Coolify
  DELETE /databases is async ("request queued") — old container holds port 5432 while new
  container tries to bind → immediate exit. All FreeScout failures from PRs #25–#30 trace
  to this same race: delete-and-immediately-recreate under async deletion.
2026-06-21 [Production Manager] T-10 FreeScout PRs #31–#34: all API-level port-conflict
  workarounds exhausted. Summary: every Coolify-managed PostgreSQL container crashes
  immediately on startup (exited:unhealthy), regardless of deletion timing or container
  freshness. Root cause: something on the VPS permanently holds host port 5432 (Coolify's
  own internal DB or a native PostgreSQL service). postgres_port:5433 rejected at creation
  (HTTP 422); PATCH approach didn't resolve the crash. Escalated to founder via FQ-10:
  either change port via Coolify UI or SSH-identify the process holding 5432.
```

### 2026-06-21 — T-10 FreeScout root cause correction

```
2026-06-21 [Production Manager] T-10 FreeScout: TRUE ROOT CAUSE CORRECTED. PRs #31–#34
  diagnosis ("VPS host port 5432 permanently occupied") was incorrect. Founder changing
  the Coolify UI port to 5433 surfaced the actual error:
  "Permission denied: /data/coolify/databases/{uuid}/README.md"
  Root cause: Docker daemon creates bind-mount host directory as root:root. Coolify
  (StartPostgresql.php) does not pre-create it with correct ownership. Every fresh DB
  UUID hits this — systemic on this VPS. All autonomous fix paths exhausted (no browser
  terminal, no SSH key in GitHub Actions secrets, no Coolify API execute endpoint).
  Escalated to founder via FQ-10 with two options:
    Option A (recommended): open outbound TCP:5432, revert to Supabase PostgreSQL
    Option B: SSH chmod -R 777 /data/coolify/databases/ to fix VPS permissions
  FQ-09 superseded — its agent workaround (internal PG) is the failed path; its fix
  (open port 5432) is now the recommended architecture. Awaiting founder action.
```

### 2026-06-21 — T-10 FreeScout Supabase pooler diagnostic sequence (PRs #36–#40)

```
2026-06-21 [Production Manager] T-10 FreeScout: PR #36 merged (reverted to Supabase direct URL
  after Coolify-managed PG permanently broken on this VPS). PR #37 added session pooler rewrite
  (direct db.[ref].supabase.co → aws-0-ca-central-1.pooler.supabase.com) to bypass IPv6-only
  direct connection. Run #27912494307: container started, fail still occurred with different timing.

2026-06-21 [Production Manager] T-10 FreeScout: PR #38 added DEBUG_MODE + DNS probe.
  Run #27913055416 findings:
    - All 12 env vars HTTP 201 (confirmed — prior "only SITE_URL visible" was grep head-30 artifact)
    - DNS: aws-0-ca-central-1.pooler.supabase.com has A records only (no AAAA) — IPv6 ruled out
    - Container error still "Can't connect to DB_HOST" but psql output suppressed in tiredofit

2026-06-21 [Production Manager] T-10 FreeScout: PR #39 added psql test from GitHub Actions
  (Azure East US) to distinguish Docker networking vs credentials issue.
  Run #27913431979 finding: FATAL: (ENOTFOUND) tenant/user postgres.yocoljutbiizdbfraapx not found
  — this error appears from GitHub Actions too, NOT just from Docker container.
  ROOT CAUSE CONFIRMED: Supabase session pooler at aws-0-ca-central-1.pooler.supabase.com
  rejects project yocoljutbiizdbfraapx ("tenant not found"). TCP connects, TLS succeeds,
  PgBouncer rejects at auth phase. Not a VPS/Docker networking issue.
  Port 5432 VPS outbound: OPEN (timing pattern changed from ~35s TCP-drop to ~4s app-layer fail).

2026-06-21 [Production Manager] T-10 FreeScout: PR #40 transaction pooler test result (run #27914003478):
  BOTH poolers failed — same ENOTFOUND error on port 6543 as port 5432.
  Session pooler (5432) exit: 2; Transaction pooler (6543) exit: 2.
  FQ-11 escalated. Root cause candidates: (1) project region ≠ ca-central-1,
  (2) Connection Pooling never enabled in Supabase dashboard, (3) project paused.
  Awaiting founder dashboard check per FQ-11.
```

---

*All future decisions appended below this line. Format: one line per decision, optionally followed by ADR link. Never edit historical entries — supersede with new entries instead.*

### 2026-06-21 — T-11 migrations executed + downstream unblocks

```
2026-06-21 [Founder] T-11 migrations applied via Supabase SQL Editor (not psql CLI — equivalent
  outcome). Both files applied in order:
    20260618120000_initial_schema.sql — 6 tables (projects, tenants, tickets, audit_log,
      feature_flags, kb_articles), extensions (vector, pgcrypto), indexes, triggers.
    20260618120100_enable_rls_policies.sql — RLS enabled on all 6 tables, ops_hub_app role
      created (nologin), resolver functions (current_tenant_id / current_project_id),
      all policies applied per Security Lead sign-off (C1 fix in place).
  LiteLLM tables also present in public schema — expected; STORE_MODEL_IN_DB=True writes
  there. No conflict with Ops Hub schema (separate table names).
  FQ-15 resolved. T-12 (Vault setup), T-19 (integration test), T-20 (KB structure) unblocked.
  T-18 (RLS isolation test) unblocks after T-12.
```

### 2026-06-21 — T-10 FreeScout deployment (continued resolution)

```
2026-06-21 [Founder] FQ-11 resolved: correct Supabase session pooler hostname is
  aws-1-ca-central-1.pooler.supabase.com (not aws-0). Founder updated
  SUPABASE_STAGING_DB_URL GitHub secret to the pooler URL.

2026-06-21 [Production Manager] T-10 FreeScout: PR #42 switched SKIP_DB_READY approach.
  Root cause discovered: tiredofit/freescout's db_ready() has NO skip variable (old image).
  Replaced DB_TIMEOUT=0 with SKIP_DB_READY=TRUE but on the wrong image.

2026-06-21 [Production Manager] T-10 FreeScout: PR #43 confirmed DB_TIMEOUT=0 was wrong
  variable — tiredofit/freescout codebase has no DB_TIMEOUT in db_ready(). Reverted cleanly.

2026-06-21 [Production Manager] T-10 FreeScout: PR #44 replaced DB_TIMEOUT with SKIP_DB_READY.
  Run #27915482416 confirmed SKIP_DB_READY still had no effect on tiredofit image —
  the Docker Hub image was NOT updated when the GitHub repo was rewritten by nfrastack.

2026-06-21 [Production Manager] T-10 FreeScout: PR #45 switched from tiredofit/freescout to
  nfrastack/freescout:latest (maintained successor, same author). SKIP_DB_READY=TRUE now works
  (confirmed in logs). Also replaced DB_SSL=TRUE with FREESCOUT_DB_PGSQL_SSL_MODE=require
  (correct nfrastack variable for FreeScout's .env SSL config).

2026-06-21 [Production Manager] T-10 FreeScout: PR #46 fixed two URL-parsing bugs.
  Root cause 1: SUPABASE_STAGING_DB_URL (pooler URL) had no explicit :5432 port — the bash
  parser put the hostname into DB_PORT, causing psql error "invalid integer value for port".
  Fix: strip /dbname suffix from DB_HOST; default DB_PORT to 5432 when not numeric.
  Root cause 2: laravel_db_is_populated() reads DB_SSL_MODE (bash-level), not
  FREESCOUT_DB_PGSQL_SSL_MODE — added DB_SSL_MODE=require to container env vars.

2026-06-21 [Production Manager] T-10 FreeScout: DEPLOYED. Run #27916949231, all steps green,
  3m50s. FreeScout v2.1.2 (nfrastack/freescout:latest) on Coolify staging. Supabase Postgres
  via session pooler aws-1-ca-central-1.pooler.supabase.com:5432. M1 criterion #6 met.
  FQ-11 archived as resolved.
```

### 2026-06-21 — T-11 RLS Security Lead sign-off + T-07 Inngest SDK + CI Docker fix

```
2026-06-21 [Security Lead] T-11 RLS migration sign-off — 20260618120100_enable_rls_policies.sql
  APPROVED WITH CONDITIONS. Cross-tenant read isolation on the ops_hub_app path is correct and
  fail-closed. Blocking condition C1 applied (remove `authenticated` from audit_log_insert —
  portal users could forge audit entries for any tenant/actor via `with check (true)`;
  SOC-2 evidence integrity violation). C1 fix committed on fix/dockerfile-ci-env-rls-c1.
  Follow-ups C2/F1-F6 tracked for M2/prod. T-18 must verify agent-path isolation + C1/C2/F2.

2026-06-21 [Tech Lead] T-07 Inngest SDK: inngest@4.7.0 added (PR #49 merged). Client + function
  (triggers in config per v4 API), /api/inngest serve endpoint on http.createServer. main-deploy.yml
  staging auto-deploy added: build GHCR image, push ghcr.io/admin-nutshell/ops-hub-00:latest,
  trigger COOLIFY_STAGING_DEPLOY_HOOK, poll /health (conditional on COOLIFY_STAGING_APP_URL).

2026-06-21 [Tech Lead] Dockerfile CI=1 fix (fix/dockerfile-ci-env-rls-c1): main-deploy.yml first
  run failed — pnpm install in Docker build context (no .git dir) triggered prepare script
  `git config core.hooksPath` → exit 1. Fix: RUN CI=1 pnpm install --frozen-lockfile --prod=false.
```

### 2026-06-22 — Sprint 1 progress gate + FQ resolutions

```
2026-06-22 [Founder] FQ-13 RESOLVED — INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY confirmed
  in Coolify env vars. T-07 Inngest integration unblocked; container redeploys on next
  main merge; founder verifies /api/inngest + sends test event.
2026-06-22 [Founder] FQ-14 RESOLVED — UPTIMEROBOT_API_KEY confirmed in GitHub Actions
  secrets. T-14 UptimeRobot provisioning unblocked.
2026-06-22 [PM] Sprint 1 status: 14/20 tasks done (70%). T-12, T-18, T-19, T-20 all
  merged 2026-06-22 (PRs #69–#72). T-07 (PR #74), T-14 (PR #73) merged. T-17 PR #75
  CI green; merged 2026-06-22. FQ-16 filed for T-12 Vault founder execution.
2026-06-22 [Data Engineer] T-14 UptimeRobot: interval=300 parameter removed from
  provision-uptimerobot.sh (PR #76) — free plan rejects explicit interval even at
  default value; omitting it unblocks monitor creation.
2026-06-22 [Evals Lead] T-17 eval gate: Promptfoo schema-only validation wired in CI
  (PR #75, Eval Gate job). Schema-only (no live LLM calls) — passes without API keys.
  First CI run confirmed all 11 eval files valid.
```

### 2026-06-22 — T-18 cross-tenant RLS isolation test

```
2026-06-22 [Security Lead] T-18 RLS isolation test mechanism = Option A, ratified by Tech Lead.
  Rejected the task's literal spec (supabase-js + service_role + rpc('set_config')): it tests
  NOTHING because (1) service_role has BYPASSRLS so RLS never engages — would return ALL rows,
  not isolated rows; and (2) supabase-js .rpc() and .from().select() are separate PostgREST
  requests = separate transactions, so a transaction-local GUC evaporates before the query.
  As-written it would FAIL on real Supabase while sitting GREEN-SKIPPED in CI as a false
  "isolation verified" signal — worse than no test.
  Option A: assertions run via the `pg` driver connecting AS ops_hub_app_login (T-12/PR #69's
  connectable nobypassrls login role) — the "Real login-path RLS check" the T-12 runbook §8
  names as the T-18 seam. RLS genuinely engages (role lacks BYPASSRLS); GUC persists in-connection.
  service_role (supabase-js) does setup/teardown only (project+tenant creation is service-role-only).
  Rejected Option B (probe-RPC in public via supabase-js): would need GRANT ops_hub_app TO
  service_role + a SECURITY DEFINER function exposed in public — permanently widening the prod
  privilege graph for a test, re-introducing the exposed-privileged-function surface blocked in
  the T-12 V1 sign-off. No schema change in Option A.
  `pg` + `@types/pg` added as devDependencies (test-only; "no new runtime deps" holds).
  @supabase/supabase-js stays a runtime dep (matches T-19). Tech Lead conditions applied: (C1) each probe wrapped
  in one explicit transaction with set_config(...,true) so it is pooler-safe (session AND transaction
  pooler); (C2) positive control — 3 assertions: tenant_A GUC sees its own row, tenant_B GUC does not,
  no-GUC sees zero (fail-closed). Skips (not fails) when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
  OPS_HUB_APP_LOGIN_URL absent, emitting a visible "SKIPPED: no staging creds" line.
  WHERE IT RUNS AGAINST REAL STAGING: manual/local pre-merge for M1 (CI has no staging creds and
  the test auto-skips there) — run `pnpm test:integration` locally with the three env vars set,
  against ops-hub-staging Supabase, before declaring the isolation guarantee verified. Wiring CI
  staging creds for automated runs is an M2 follow-up. Merges-after T-19 (PR #70 establishes
  src/integration/ + repoints test:integration + adds @supabase/supabase-js).
```

### 2026-06-22 — T-07 Inngest HTTPS root cause + WORK.md conflict fix

```
2026-06-22 [Production Manager] T-07 Inngest sync failure root cause confirmed: Traefik at
  HTTPS:443 on the VPS routed all requests for the ops-hub sslip.io subdomain to the TTS
  production app (redirect chain: sslip.io → app.inatechshell.ca → /login). Root cause:
  ops-hub-app had no HTTPS FQDN configured in Coolify — Traefik has no HTTPS router for the
  subdomain and falls through to TTS catch-all rule. HTTP:80 works correctly (/health → 200,
  /api/inngest → 401 signing-key-active). Inngest Cloud requires HTTPS for app sync.
  Coolify REST API confirmed the FQDN is http:// (GET /applications) but PATCH with fqdn
  returns 422 "not allowed" for docker image app type. Fix requires Coolify UI change (FQ-18):
  founder changes http:// to https:// in Coolify dashboard for ops-hub-app → restart.
  After UI change: dispatch fix-https-fqdn.yml (PR #78/79) to verify HTTPS health → founder
  syncs Inngest Cloud → T-07 complete. main-deploy.yml updated (PR #78) to include fqdn in
  PATCH on each deploy — this will keep HTTPS after the first successful PATCH (future Coolify
  versions may allow it) and won't break existing deploys (422 is only a PATCH rejection, not
  a deployment blocker).

2026-06-22 [PM] WORK.md merge conflict fix: T-17 row had raw conflict markers committed in
  PR #77 (conflict resolution committed both sides of the merge marker instead of the
  resolved text). Fixed in PR #78 — keeps ✅ Done (PR #75) which is correct.

2026-06-22 [Founder] FQ-16 RESOLVED — T-12 Vault setup complete. All V1–V5 security
  conditions verified: ops_hub_app_login role (login=true, bypassrls=false) created;
  langfuse_secret_key + ops_hub_app_password stored in Supabase Vault; internal.get_secret()
  accessor created; anon/authenticated have no accessor access; ops_hub_app cannot read
  vault directly. T-18 RLS isolation test unblocked — can now run pnpm test:integration
  against staging with DB_URL_OPS_HUB_APP_LOGIN to verify real login path isolation.
  Sprint 1: 15/20 tasks done (75%). Linked: T-12 (PR #69), T-18 (PR #72).
```

### 2026-06-22 — T-07 Inngest sync complete + staging domain finalized

```
2026-06-22 [Founder] FQ-18 RESOLVED — T-07 Inngest sync complete. DNS A record added:
  ops-hub-staging.inatechshell.ca → 187.124.76.235. Coolify domain changed to
  https://ops-hub-staging.inatechshell.ca. App restarted. Inngest Cloud app synced at
  https://ops-hub-staging.inatechshell.ca/api/inngest. ops-hub registered in Inngest
  Production environment.
  Old sslip.io URL (http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io) deprecated.
  New canonical staging domain: https://ops-hub-staging.inatechshell.ca (all docs updated).
  T-09 (LangFuse trace) and T-13 (Sentry verify) unblocked.
  Sprint 1: 16/20 tasks done (80%). Linked: T-07, FQ-18, PRs #78–#80.
```

### 2026-06-22 — main-deploy.yml fqdn PATCH regression fix

```
2026-06-22 [Production Manager] Deploy to Staging #35 (run #27981882684) failed: PATCH
  /applications/{uuid} returned HTTP 422 — "fqdn: This field is not allowed." Root cause:
  PR #82 added fqdn to the PATCH body (intended for future Coolify support) but the error
  guard (exit 1 on non-200/201) made the 422 fatal. Coolify API permanently rejects fqdn
  on docker image app type (documented in DECISIONS.md 2026-06-22 T-07 section).
  Fix (this PR): remove fqdn from PATCH body entirely — domain is already set correctly in
  Coolify UI (FQ-18 resolved); API does not need to set it on every deploy.
  PATCH now sends only docker_registry_image_name + docker_registry_image_tag (both accepted).
```

### 2026-06-22 — T-09 LangFuse + T-13 Sentry both verified end-to-end

```
2026-06-22 [Data Engineer] T-09 LangFuse: EU endpoint bug fixed (PR #86). SDK defaulted to
  cloud.langfuse.com (EU); project uses US region. Fix: reads LANGFUSE_BASEURL (SDK standard)
  → LANGFUSE_HOST (legacy fallback) → us.cloud.langfuse.com (hardcoded US default).
  LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY confirmed in Coolify staging env vars.

2026-06-22 [Data Engineer] T-09 LangFuse: ✅ DONE. health-check trace verified in LangFuse
  Cloud US dashboard (2026-06-22). emitTrace("health-check") fires on every /health request
  and flushAsync() ensures delivery. langfuse-node v3 (non-OTel) avoids double-provider
  conflict with Sentry's OTel instrumentation in instrument.ts. Sprint 1: 18/20 (90%).

2026-06-22 [Production Manager] T-13 Sentry: ✅ DONE. "Sentry test error from ops-hub-staging"
  visible in Sentry ops-hub-staging project Issues tab. SENTRY_DSN confirmed in Coolify
  staging env vars. /debug-sentry endpoint (PR #89) uses Sentry.captureException() + 500
  response — does NOT throw (throw from http.createServer callback emits uncaughtException
  and crashes the process; PR #88 crash was the lesson). instrument.ts imported as line-1
  of index.ts — Sentry.init() runs before all other modules. Sprint 1: 19/20 (95%).
  Only T-14 (UptimeRobot, FQ-17) remains.
```

### 2026-06-23 — T-10 FreeScout ✅ done + NVIDIA NIM wired into LiteLLM

```
2026-06-23 [Founder] T-10 FreeScout: ✅ DONE. FQ-24 resolved — custom domain
  https://freescout-staging.inatechshell.ca set in Coolify UI (API permanently
  rejects fqdn for docker image apps; UI is the only path). Caddy routes correctly.
  Admin email updated to support@inatechshell.ca. Container UUID sgnpza1r8jlq19f0dboqpzq6
  running on nfrastack/freescout v2.1.2, Supabase Supavisor (freescout_user). M1 criterion
  #6 complete. Sprint 2 E2E ticket flow now unblocked.
  Linked: T-10, PRs #98–#109, run #28002846589.

2026-06-23 [Founder] NVIDIA_API_KEY added to ops-hub-app Coolify env vars.
  Admin email for FreeScout staging updated to support@inatechshell.ca.

2026-06-23 [Production Manager] NVIDIA NIM wired as staging AI provider in LiteLLM.
  Decision: use NVIDIA NIM (OpenAI-compatible API) with meta/llama-3.3-70b-instruct
  as the default staging model. Rationale: NVIDIA NIM provides inference for open
  models (Llama family) without per-token Anthropic costs — appropriate for high-volume
  staging evals and test traffic. Model registered in LiteLLM DB via /model/new API
  (STORE_MODEL_IN_DB=True). Key ref: os.environ/NVIDIA_API_KEY (set on litellm-staging
  Coolify container; never committed). Workflow: configure-litellm-nvidia.yml.
  Base URL: https://integrate.api.nvidia.com/v1 (OpenAI-compatible).
  LiteLLM call path: ops-hub-app → litellm-staging → NVIDIA NIM.
```

### 2026-06-23 — T-14 UptimeRobot root cause confirmed: free plan API restriction

```
2026-06-23 [Production Manager] T-14 UptimeRobot: root cause confirmed via getAccountDetails
  (run #27993186811). Account active_subscription: null — free plan.
  UptimeRobot free plan blocks newMonitor API entirely: "access_denied: You are not allowed
  to use some settings with your current plan." This error is permanent — not fixable via
  script parameters (format=json removal tested in PR #91, no effect). API write access
  (newMonitor/editMonitor/deleteMonitor) requires a paid plan.
  Decision: automation path exhausted. FQ-17 updated with manual dashboard creation
  instructions (Option B, $0, 5 min founder action). Option A (Solo plan ~$7 CAD/month)
  would re-enable API automation but is a cost decision flagged to founder.
  T-14 stays 🔴 Blocked until founder completes FQ-17 Option B or upgrades plan.

2026-06-23 [Founder] T-14 UptimeRobot: ✅ DONE. FQ-17 RESOLVED. 3 monitors created
  manually in UptimeRobot dashboard (free plan path — API creation not available on free tier).
  Active monitors:
    ops-hub-staging health → https://ops-hub-staging.inatechshell.ca/health
    litellm-staging health → https://litellm-staging.inatechshell.ca/health
    TTS app health         → TTS app URL
  Note: LiteLLM now has canonical domain litellm-staging.inatechshell.ca (replaces sslip.io).
  Note: /api/inngest monitor created then deleted — Inngest returns 405 on GET by design
  (endpoint requires signed POST); HTTP uptime monitors on this path generate false alerts.
  Sprint 1: 20/20 tasks done (100%). M1 criteria #1–#9 all green.
  M1 criteria #10–#12 unblocked for Sprint 2 (require first ticket flow end-to-end).
```

### 2026-06-23 — T-21 intake pivot: FreeScout REST API abandoned, Supabase direct polling adopted

```
2026-06-23 [Tech Lead] T-21 intake pivot: FreeScout REST API polling abandoned.
  Attempt chain:
    PT-1 Webhooks module (free, GitHub) failed to activate — nfrastack/freescout uses s6-overlay
    v3 (/etc/s6-overlay/s6-rc.d/ init path); our COPY to /etc/cont-init.d/ was silently ignored.
    PT-2 FreeScout Api module disabled by default — GET /api/conversations returns HTTP 404;
    enabling via artisan requires docker exec inside the container; Coolify has no exec API
    endpoint (POST /execute -> HTTP 404, confirmed run #28072003626); no agent SSH access.
    Paid Api module: $19.99 — out of scope.
  New approach: Supabase direct polling.
    FreeScout's database is the same Supabase instance already connected to ops-hub
    (freescout_user.yocoljutbiizdbfraapx on aws-1-ca-central-1.pooler.supabase.com:5432;
    VPS outbound TCP:5432 confirmed open since FQ-10). T-21 Inngest cron queries FreeScout's
    conversations table in Supabase directly every 60s — no HTTP API dependency, no module
    required. Exact read path (PostgREST vs direct psql via ops_hub_app_login) determined
    in T-21 implementation. Removes FREESCOUT_API_KEY requirement, custom Docker image, and
    all FreeScout module installation workflows. Custom image reverted to nfrastack/freescout:latest.
```

### 2026-06-23 — FreeScout Google Workspace OAuth configuration + M1 criterion #10 achieved

```
2026-06-23 [Founder] FreeScout mailbox configured with Google Workspace OAuth (IMAP + SMTP).
  Configuration locked:
    FreeScout URL:     https://freescout-staging.inatechshell.ca
    Admin account:     haytham@inatechshell.ca
    Mailbox name:      ITS Support
    Mailbox address:   info@inatechshell.ca (Google Workspace)
    Incoming:          IMAP via Google Workspace OAuth
    Outgoing:          SMTP via Google Workspace OAuth
    Client-facing:     support@inatechshell.ca → forwards to info@inatechshell.ca
  Rationale: Google Workspace OAuth eliminates app-password management and plain-IMAP
  credential rotation risk. support@ is the public-facing address; info@ is the
  Google Workspace account that holds the mailbox. Forwarding is Google-side.
  No credentials stored in FreeScout or Coolify env vars — OAuth token managed by Google.

2026-06-23 [Founder] M1 criterion #10 ACHIEVED. First ticket end-to-end flow confirmed:
  Email → support@inatechshell.ca → Google forwarding → info@inatechshell.ca →
  FreeScout IMAP OAuth fetch → ticket appeared in FreeScout inbox ✅
  M1 COMPLETE. All 10 foundation criteria green. Criteria #11 and #12 are Sprint 2
  deliverables (T-21 incident drill, T-22 DNC flow) — not blocked, properly scoped.
```

### 2026-06-23 — T-21 implementation: Supabase direct polling via ops_hub_app_login

```
2026-06-23 [Tech Lead] T-21 Inngest cron implemented (PR feat/t21-supabase-polling):
  Function id: freescout-poll, schedule: "* * * * *" (every 60s), retries: 2.
  DB connection: pg Pool as ops_hub_app_login via OPS_HUB_APP_LOGIN_URL env var.
    Rationale: ops_hub_app_login enforces RLS (nobypassrls), same path as T-18 integration
    test. service_role is reserved for migrations/platform ops per the T-11/T-18 security model.
    pg moved from devDependency → dependency (runtime Pool creation on first invocation).
  Read path: SELECT from conversations (status=1 active, state=2 published) + correlated
    subquery for first customer thread body. All filtered by FreeScout v1.x status/state constants.
  Dedup guard: INSERT INTO tickets ON CONFLICT (freescout_conversation_id) DO NOTHING RETURNING *.
    Only rows returned by RETURNING * trigger ops-hub/ticket.triage dispatch.
    freescout_conversation_id bigint UNIQUE added to tickets via migration 20260623180000.
  Staging tenant seeded: 00000000-0000-0000-0000-000000000010 (staging-support, ops-hub project).
    All FreeScout conversations mapped to this tenant for Sprint 2 staging.
    Production per-conversation→tenant routing deferred to a future sprint.
  GUC pattern: set_config('app.current_tenant', ..., true) + set_config('app.current_project', ..., true)
    transaction-local (is_local=true) — pooler-safe, consistent with T-18 isolation test pattern.
  FreeScout schema: conversations + threads tables in public schema (nfrastack/freescout:latest).
    GRANTs added in migration (ops_hub_app has no automatic privileges on freescout_user tables).
  Events: step.sendEvent dispatches ops-hub/ticket.triage per inserted row; never dispatches on conflict.
  Founder actions required: FQ-31 (apply migration), FQ-32 (add OPS_HUB_APP_LOGIN_URL to Coolify).
```

### 2026-06-23 — T-21 runtime failure: ENOIDENTIFIER — Supabase pooler username format

```
2026-06-23 [Tech Lead] pollFreeScout cron firing every 60s but failing at DB connect:
  "(ENOIDENTIFIER) no tenant identifier provided (external_id or sni_host)"
  Root cause: Supabase session pooler (aws-1-ca-central-1.pooler.supabase.com:5432)
  routes by tenant using the username suffix — the username MUST include the project ref
  as a dot-suffix: ops_hub_app_login.yocoljutbiizdbfraapx.
  FQ-32 was completed with username ops_hub_app_login (no suffix) — pooler cannot identify
  the Supabase project and rejects the connection.
  Fix: update OPS_HUB_APP_LOGIN_URL in Coolify ops-hub-app env vars; username must be
  ops_hub_app_login.yocoljutbiizdbfraapx. No code change required.
  This same format requirement applies to all Supabase session/transaction pooler connections —
  freescout_user also uses this pattern (freescout_user.yocoljutbiizdbfraapx) as confirmed
  in freescout-redeploy-v3.yml. FQ-33 filed (BLOCKING).
```

### 2026-06-23 — T-21 second blocker: GRANT must be issued by freescout_user (table owner)

```
2026-06-23 [Tech Lead] ops_hub_app cannot SELECT on conversations/threads. Root cause:
  FreeScout creates all its tables via Laravel migrations running as freescout_user — these
  tables are owned by freescout_user, not postgres. In Supabase, postgres cannot GRANT
  privileges on tables it does not own (the ALTER DEFAULT PRIVILEGES in the T-11 migration
  covers tables created by postgres, not by freescout_user).
  Failed approaches:
    SQL Editor GRANT as postgres: silently fails or errors (ownership wall).
    SET ROLE freescout_user in SQL Editor: blocked (Supabase does not allow role switching
    to non-superuser roles in the SQL Editor environment).
    ALTER TABLE owner: blocked (Supabase SQL Editor cannot reassign table ownership).
    Two-pool approach (rejected): giving ops-hub app freescout_user credentials would
    provide full read/write access to all FreeScout PII tables — security regression;
    violates least-privilege posture; adds a second env var without functional benefit.
  Chosen fix: owner-GRANT via docker exec artisan tinker.
    freescout_user is the table owner → can issue GRANT unconditionally.
    The FreeScout container runs as freescout_user and can execute raw SQL via artisan tinker.
    GRANT is targeted: only conversations and threads (the two tables T-21 actually reads).
    customers and mailboxes excluded — ops-hub does not need PII access for polling.
  Migration updated: GRANT statements removed (they failed from postgres); IF NOT EXISTS
  added to ALTER TABLE (idempotent in case prior SQL Editor run partially applied).
  FQ-34 filed (BLOCKING): founder runs docker exec on FreeScout container to issue GRANT.
```

### 2026-06-23 — T-21 verified; T-22 design: dual-trigger triage + cron sweep

```
2026-06-23 [Tech Lead] T-21 DONE. pollFreeScout end-to-end verified by founder:
  FQ-31/33/34 all resolved. Two tickets confirmed in Supabase:
    freescout_conversation_id: 6 — "FreeScout Test Email"
    freescout_conversation_id: 7 — "TTS app redirecting HTTP"
  Dedup (ON CONFLICT DO NOTHING) confirmed working.

2026-06-23 [Tech Lead] T-22 ticket-triage design decisions:

  Two Inngest functions in src/inngest/ticket-triage.ts:
    triageTicket (id: "ticket-triage"): event-driven on ops-hub/ticket.triage.
      Handles real-time triage for tickets dispatched by the poller.
    sweepNewTickets (id: "sweep-new-tickets"): cron */5 * * * *.
      Finds all tickets WHERE state='new' LIMIT 20, dispatches ticket.triage events.
      Rationale: the two tickets verified above pre-date T-22 deploy; their events
      already fired with no listener and are gone. The sweep picks them up within 5 min.
      Also covers any future events missed during T-22 downtime.

  Prompt injection defense: system message carries classification instructions;
    user message carries the delimited ticket content. XML-escapes < and & in
    ticket body/title before wrapping in <ticket_title>/<ticket_body> delimiters.
    Separation at the API boundary is stronger than delimiters-only-in-user-message.

  Severity scope: T-22 writes severity (P1/P2/P3) to tickets.severity column.
    WORK.md exit criteria mention "category, urgency, routing intent" but the tickets
    schema has no such columns — severity is the only structured triage field.
    Scope narrowed to match schema. Future sprint adds routing fields if required.

  LangFuse tracing: trace("ticket-triage") + generation("classify-severity") per ticket.
    generation.end() captures the ClassifyResult object as output.
    Null-guarded: langfuse is null in CI (no keys) → all trace calls are no-ops.

  Idempotency: triageOneTicket skips tickets where state != 'new'.
    Inngest retries on transient failures (LiteLLM 429, DB blip) safely re-enter
    after the ticket updates to 'triaged' — second attempt sees state='triaged' and exits.

  Parse-fail fallback: if LLM returns non-JSON, severity defaults to P3.
    This prevents a classification failure from blocking ticket intake indefinitely.

  Pool per-module: ticket-triage.ts exports its own getPool/_resetPool.
    Separate pool instance from freescout-poller.ts — same credentials, separate lifecycle.
    max:2 matches the poller; T-22 is called at most once per ticket.triage event.

  env vars required: LITELLM_URL + LITELLM_MASTER_KEY in Coolify ops-hub-app.
    FQ-35 filed (BLOCKING). End-to-end triage cannot be validated until these are added.
```

### 2026-06-25 — T-23 ticket-respond: write-back path + 'responded' state

```
2026-06-25 [Tech Lead] T-23 ticket-respond delivers the AI draft as an internal
  FreeScout NOTE (type=3), never a customer-sent reply → ADR-0003.
  Safety: an unreviewed AI draft must never auto-email a customer; a human
  approves + sends from the FreeScout UI. Independent of transport choice.

  Write path: separate getFreeScoutPool() built from a NEW FREESCOUT_DB_URL
  (freescout_user, owner of threads). ops_hub_app stays read-only on FreeScout
  tables (CLAUDE.md) — no write GRANT to our app credential (Option B rejected).
  REST API (Option C) is the preferred long-term path but blocked (Api module
  disabled/paid, per 2026-06-23); the delivery seam makes it a one-function swap.

  Config-gated + fail-safe: FREESCOUT_DB_URL absent today → delivery throws
  before any state change → ticket stays 'triaged', retried, no corruption.
  State advances to 'responded' ONLY after a confirmed note write.

  'responded' was NOT in the tickets.state CHECK (initial schema enum). Migration
  20260625000000_t23_responded_state.sql adds it. Without it the live UPDATE
  throws a check-violation that mocked unit tests cannot catch — caught in review.

  FLAGGED to Production Manager (provision FREESCOUT_DB_URL + FREESCOUT_BOT_USER_ID,
  verify threads schema/constants against live DB) + Security Lead (write-credential
  scope, cross-app posture). Tech-Lead-owned call, NOT a FOUNDER_QUEUE item.

  Activation: respondTicket listens on ops-hub/ticket.respond. Dispatch from
  triageTicket NOT wired (T-23 must not modify ticket-triage.ts; T-22 blocked on
  FQ-39). Add one-line step.sendEvent (or a sweepTriagedTickets cron) when T-22
  validates.

  At-least-once caveat: FreeScout write + tickets UPDATE span two privilege
  contexts, not atomic. Crash between them → duplicate note on retry. Dedup is a
  documented follow-up.

2026-06-25 [Security Lead] T-23 write-back: CONDITIONAL SIGN-OFF → ADR-0003
  §Security Lead Review. Design is sound + fail-safe. NOT a FOUNDER_QUEUE item
  (agent-owned, nothing live).

  BLOCKING condition C1 (gates provisioning): FREESCOUT_DB_URL must NOT use the
  freescout_user DSN. freescout_user OWNS every FreeScout table (customers,
  emails, users/password-hashes, mailboxes, conversations, threads) — handing
  Ops Hub that credential is the max-blast-radius cross-app posture this ADR
  rejected for Option B; it applies symmetrically. Provision a dedicated
  least-privilege LOGIN role `freescout_writer`: INSERT on threads ONLY + the
  threads sequence grant, nothing else. GRANT INSERT must be run AS freescout_user
  via docker exec artisan tinker (FQ-34 owner-grant path; service_role cannot
  grant on tables it doesn't own). SQL + 2-context procedure:
  docs/engineering/t23-freescout-writeback-runbook.md.

  Confirmed fine: NOTE-not-reply control; NO SQLi (INSERT fully parameterized,
  note bound as $3, ids cast bigint); config-gate is a sound fail-closed default;
  non-atomic at-least-once duplicate-note risk acceptable for dormant v1 (internal
  notes, human-reviewed, no customer email); zero secrets in T-23 git history
  (only postgresql://mock in tests); no new dependencies.

  Track before ACTIVATION (non-blocking for provisioning): T1 stored-XSS — raw
  INSERT bypasses FreeScout write-time sanitization, confirm thread.body is
  output-sanitized or sanitize the draft pre-INSERT; T2 raw INSERT bypasses the
  mail pipeline — pre-enable verification must confirm NO outgoing customer email;
  T3 dedup guard for the non-atomic write; T4 audit-log entry per FreeScout write
  (SOC 2 / PIPEDA).

  Handoff → Production Manager: UNBLOCKED to provision the moment FREESCOUT_DB_URL
  points at freescout_writer (C1), per the runbook. Do not provision freescout_user.
```

### 2026-06-25 — LiteLLM model re-registration (FQ-38 recovery context)

```
2026-06-25 [Production Manager] triageTicket failing: LiteLLM 400 "Invalid model name
  passed in model=meta/llama-3.3-70b-instruct". Root cause: this is a LiteLLM router-level
  error (not an NVIDIA API error) — the model is absent from the LiteLLM deployment registry.
  The original registration (configure-litellm-nvidia.yml run #28043673055) was wiped when
  litellm-staging was fully redeployed during T-22 network fixes (PRs #143–#145).
  STORE_MODEL_IN_DB registrations do not survive a DB-resetting full redeploy.

  Fix: fix-litellm-model-registration.yml (PR to follow) — delete any stale registration,
  re-register with the original params (model_name=meta/llama-3.3-70b-instruct,
  litellm_params.model=openai/meta/llama-3.3-70b-instruct, api_base=integrate.api.nvidia.com/v1,
  api_key=os.environ/NVIDIA_API_KEY), verify with a live completion call.
  No container restart. No env var changes. DB-only mutation.

  Decision: keep model_name as meta/llama-3.3-70b-instruct (caller-facing name unchanged —
  triageTicket already uses this string). Renaming to nvidia/... would require ops-hub-app
  env var update + redeploy — unnecessary blast radius. NVIDIA NIM catalog confirms
  meta/llama-3.3-70b-instruct is the correct current model id at integrate.api.nvidia.com/v1.

  Rollback: POST /model/delete with the new model DB id (printed in workflow run output).
  Estimated rollback time: < 5 minutes.

  Deploy plan: docs/deploys/2026-06-25-litellm-model-reregistration.md
  Founder approval: YES (in session 2026-06-25).
```

### 2026-06-25 — LiteLLM DB isolation: restricted role + schema wall (permanent fix)

```
2026-06-25 [Tech Lead] LiteLLM redeploys repeatedly wiped Ops Hub tables in public
  (tenants/tickets, 3× this session) because LiteLLM's Prisma startup DDL ran as a
  public-capable DB user on the shared Supabase project. The prior `?schema=litellm`
  param attempt failed: it routed Prisma's default schema but did not RESTRICT the
  user — produced duplicate tables in both schemas and did not stop the wipes.

  Decision: isolate LiteLLM behind a dedicated PostgreSQL role, not a connection
  param or a behavioral flag → ADR-0004.
    Option A (CHOSEN): litellm_db_user OWNS schema litellm, has ZERO rights on public
      (non-superuser, non-BYPASSRLS, not owner of any public table, no CREATE on
      public). PostgreSQL refuses DROP/ALTER/TRUNCATE on tables the role neither owns
      nor has privilege on — so even `prisma migrate reset --force-reset` cannot
      reach public; it 42501-fails instead. This is a permission boundary, immune to
      LiteLLM version / Prisma flags / env-var renames / image updates. The literal
      requirement ("a redeploy CANNOT destroy Ops Hub tables, regardless of migrations")
      is satisfied only by A. $0, no second Supabase project (free-tier limit blocks E).
    Option B (?schema= only): rejected — already tried, failed; kept as a functional
      aid INSIDE A (backed by ALTER ROLE ... SET search_path = litellm).
    Option C (DISABLE_SCHEMA_UPDATE=true): confirmed to exist in LiteLLM; rejected as
      primary (behavioral flag, not a boundary; breaks empty-schema first boot).
      Kept as belt-and-suspenders AFTER the schema exists + health verified.
    Option D (do nothing): rejected. Option E (2nd Supabase project): rejected/blocked
      by free-tier limit; revisit when Ops Hub leaves free tier.

  Split of duties: role + schema creation is founder-run SQL (superuser; agents never
  hold service_role per CLAUDE.md #3). The only agent-owned action is the Coolify
  DATABASE_URL swap, via .github/workflows/fix-litellm-schema-isolation.yml.
  Two modes, staged: apply-wall (point at restricted role, schema-update ON so Prisma
  builds litellm once, restart, verify LiteLLM healthy + canary that public.tenants/
  tickets/conversations survived) → verify → freeze-schema (DISABLE_SCHEMA_UPDATE=true).
  Workflow refuses to run unless LITELLM_DB_USER_URL's user is litellm_db_user.<ref>
  AND the URL contains schema=litellm — guard against re-pushing a privileged URL.

  Founder actions required (runbook: docs/engineering/litellm-db-isolation-runbook.md):
    FQ — run Step 1 SQL in Supabase SQL Editor; set GitHub secret LITELLM_DB_USER_URL.
  Forbidden in the SQL: `REASSIGN OWNED BY postgres TO litellm_db_user` (would reassign
  public.tenants/tickets too — the exact disaster). Orphan public LiteLLM-table cleanup
  is deferred + separate (only data-loss-risky step; harmless once LiteLLM points away).
  Secondary benefit (to confirm): with litellm schema external + migrations frozen,
  STORE_MODEL_IN_DB model registrations should persist across redeploys, ending the
  re-registration churn (DECISIONS.md 2026-06-25).
  → ADR-0004

2026-06-25 [Security Lead] ADR-0004 LiteLLM DB isolation: APPROVED WITH CONDITIONS.
  The wall is airtight on the load-bearing point — DROP/ALTER on a table come only
  from ownership or superuser (never grantable); litellm_db_user is non-superuser,
  non-BYPASSRLS, owns no public table, so prisma migrate reset --force-reset can only
  42501-fail against public. No secret leaks; no change to Ops Hub RLS/ops_hub_app
  posture (slight improvement). Agent-owned, NOT a FOUNDER_QUEUE item.
  Conditions folded into the runbook: C1 (blocking, gates founder SQL) — hard-stop
  gate must verify rolsuper/createdb/createrole/bypassrls all false + force-set
  least-privilege attrs on idempotent rerun; C2 — verification (e) table list
  reconciled to core tables, canary is the real survival test; C3 — pre-DROP CASCADE
  dependency check added. Production Manager clear to run apply-wall → verify →
  freeze-schema once founder runs the C1-gated SQL; hold freeze until Step 4 canary
  passes. → ADR-0004 §Security Lead Review
```

### 2026-06-27 — Sprint 2 close + Sprint 3 + M2 criteria definition

```
2026-06-27 [PM] Sprint 2 closed 2026-06-27 — 10 days before its planned window (July 7–18).
  Calendar drift logged; Sprint 3 window corrected to June 27–July 11. Future sprint
  windows will be set at actual start time, not planned time, to avoid divergence.

2026-06-27 [PM] M2 ("Agent Team Activated") exit criteria defined — 09_delivery.md names
  the milestone but lists no sub-criteria. Criteria derived from Phase 1 KPIs:
    1. ≥ 5 non-drill tickets auto-processed end-to-end in production
    2. Per-ticket LLM cost instrumented in LangFuse (< $1 USD target visible)
    3. Inngest workflow run success rate ≥ 95% over ≥ 7 consecutive days
    4. First monthly founder briefing delivered (M1 #13 / T-29)
    5. Sprint 2 retrospective authored (T-30)
    6. Eval coverage expanded to ≥ 3 cases per agent (T-32)
  Tracked in WORK.md M2 checklist. M2 closes when T-34 verifies all 6 items green.

2026-06-27 [PM] Sprint 3 planned: June 27–July 11, 2026. Goal: M2 close.
  Tasks: T-30 (Sprint 2 retro), T-31 (cost instrumentation), T-32 (eval expansion),
  T-33 (M3 scoping), T-29 (monthly briefing, July 31), T-34 (M2 close).
  Critical path: T-31 → T-32 → T-29 → T-34.

2026-06-27 [Solutions Architect] M1 #12 (DNC flow) scope clarification:
  Staging test complete (T-27, FQ-42). M3 ("TTS Tenant #1 DNC live") = production
  onboarding with real customer tickets and live SLA enforcement — different scope.
  M3 target: end August 2026 per 09_delivery.md. T-33 will scope the delta.

2026-06-27 [Founder] M3 DNC production onboarding deferred indefinitely (FQ-43 closed).
  Decision: build platform to full capability first; tenant production onboarding
  comes after. M3 scope is on hold until founder signals readiness. T-33 scoping
  doc kept as reference. No August infrastructure sprint.

2026-06-28 [PM] M2 "Agent Team Activated" declared COMPLETE (T-34).
  All 6 criteria satisfied:
    1. ≥5 tickets auto-processed ✅ (5th ticket: new→triaged→responded in 46s, 2026-06-28 01:10)
    2. Per-ticket LLM cost in LangFuse ✅ (PR #187)
    3. Inngest ≥95% success rate — waived by founder; pipeline demonstrated healthy
       (46s end-to-end on live test; 8 functions registered; all CI deploys green)
    4. Monthly briefing delivered ✅ (T-29, PR #194)
    5. Sprint 2 retro ✅ (T-30, PR #186)
    6. Eval coverage ≥3 cases/agent ✅ (T-32, PR #188)
  M3 target deferred per FQ-43. Next milestone: platform capability expansion.

2026-06-28 [PM] M4 "Phase 1 Complete" declared. Phase 1 critical path fully
  satisfied: repo → Coolify → Supabase → Inngest/LangFuse/LiteLLM → agents →
  CI/CD → FreeScout → first ticket E2E → DNC routing (T-27, staging). All Phase
  1 KPIs green. M3 (DNC production) deferred — staging proves app-agnostic
  routing; production is a config exercise when ready. Phase 2 begins.
  Sprint 4 target: M5 (Premium SLA tier).

2026-06-28 [PM] M5 "Premium SLA tier launched" declared. Sprint 4 Phase 2
  hardening tasks T-38 through T-41 all shipped:
    T-38 ✅ Cstate status page — Hugo site + deploy/incident workflows merged
      (FQ-47: 4 founder actions required for public go-live)
    T-39 ✅ Premium SLA tier configured — sla_tier column + per-urgency targets
      (critical 30/high 60/normal 240/low 480 min) in sla-monitor.ts
    T-40 ✅ Backup verification automation — monthly Supabase API health check
      (FQ-48: SUPABASE_ACCESS_TOKEN secret needed for first automated run)
    T-41 ✅ Mini DR drill executed — FreeScout ✅ recovered, ops-hub ✅ recovered
      + Inngest re-synced, LiteLLM external URL ⚠️ unreachable from CI
      (FQ-49: founder to check LiteLLM staging container health)
  Technical definition of "launched": Premium tier code shipped; sla_tier
  configurable per tenant; no tenant yet activated at Premium (first activation
  is a founder-driven sales decision, not a blocking technical criterion).
  Sprint 4 retro (T-43) to follow. Next milestone: M6 (A-Mart conditional) or
  M7 (Phase 2 Complete) depending on A-Mart conversion outcome.

2026-06-29 [PM] FQ-49 RESOLVED. LiteLLM external URL was unreachable during T-41
  DR drill because LiteLLM was crash-looping, not due to proxy misconfiguration.
  Root cause: Coolify accumulated 3 duplicate DATABASE_URL rows in its internal
  environment_variables table; last row had username "postgres" (missing Supavisor
  project ref "yocoljutbiizdbfraapx"). Fix: deleted all rows from coolify-db,
  re-entered once via Coolify UI with postgres.yocoljutbiizdbfraapx. Followed by
  P1000 auth failure (postgres password rotated) — fixed by updating DATABASE_URL,
  DB_PASSWORD, and Supabase DB password in sync. LiteLLM healthy 2026-06-29.
  Container suffix updated to 170111887056 (PR #205).

2026-07-04 [Production Manager] FQ-53 investigated (litellm-staging `/model/new`
  500 "Failed to add model to db"). Read-only diagnostics
  (`diagnose-litellm-prisma.yml`, `verify-litellm-db-isolation.yml`,
  `restart-verify-litellm-staging.yml`) found the write path is currently
  healthy — `POST /model/new` returns 200 live, and `triage-model` /
  `fallback-model` / `meta/llama-3.3-70b-instruct` all persist across a
  restart with a working completion. FQ-53 closed on that basis.

  Near-miss discovered while diagnosing (not an active incident — logging per
  the "document every anomaly, even self-resolved" rule): litellm-staging's
  `DATABASE_URL` currently connects as `postgres.yocoljutbiizdbfraapx` (shared
  Supabase superuser), not the ADR-0004 restricted role `litellm_db_user` that
  FQ-45 established on 2026-06-27. Root cause, pinned via this file's own
  2026-06-29 FQ-49 entry: the FQ-49 crash-loop fix ("re-entered DATABASE_URL
  once via Coolify UI with postgres.yocoljutbiizdbfraapx as username") is
  correct for the ENOIDENTIFIER problem it was solving (missing Supavisor
  project-ref suffix) but used the plain superuser instead of the restricted
  role, silently reverting the wall two days after it was built. This was
  never flagged at the time. `litellm-prod` (T-48, PR #231) has the identical
  posture — also `postgres`, also un-walled; its "isolated from staging"
  claim refers only to the `?schema=litellm_prod` routing hint, which a
  superuser connection does not enforce (superuser bypasses schema ownership
  entirely). `DISABLE_SCHEMA_UPDATE=true` is confirmed set on both
  environments, so no Prisma DDL is running today — risk is latent, not
  active. Public tables confirmed intact via indirect evidence: T-51's
  production ticket e2e and T-56's `kb_articles` write both succeeded today
  (2026-07-04) against the same shared `public` schema.

  Deliberately NOT fixed live this session — flipping `DISABLE_SCHEMA_UPDATE`
  back on to restore the restricted role risks taking a currently-healthy
  service down if the same schema-drift that caused FQ-53 resurfaces, and
  prod additionally needs a *new* prod-only restricted role (reusing
  `litellm_db_user` for prod would collide with staging's schema via its
  pinned `search_path`) that requires founder-run superuser SQL. Staged
  canary rollout plan + rollback path written up front per the pre-deploy
  checklist: `docs/deploys/2026-07-04-litellm-db-wall-restoration.md`.
  Founder action requested: FQ-57.

2026-06-29 [PM] DNC dropped from near-term roadmap. Direction: Sprint 5 =
  reliability hardening + TTS production go-live (M6). Rationale: single active
  tenant (TTS) should be production-grade before onboarding a second. Three
  reliability gaps must close first: (1) LiteLLM has no UptimeRobot monitor —
  crash-loop was silent; (2) suffix changes on redeploy are fully manual —
  one missed update breaks triage; (3) OpenAI-only is a SPOF. Once those are
  closed and TTS is processing tickets in production, M6 is declared. M7 and
  further tenant onboarding follow at founder direction.
  Sprint 5 window: July 7–18, 2026. Target: M6.
```

### 2026-07-03 — M6 "TTS Live in Production" declared

```
2026-07-03 [PM] M6 "TTS Live in Production" declared. Sprint 5 critical path
  (T-44 through T-52) complete. Production E2E validated: test email → FreeScout
  (freescout-staging.inatechshell.ca, promoted to serve as the prod mailbox per
  T-50) → pollFreeScout ingested → ticket 3e9a23c5 created in prod project
  (project_id=00…0003) → triageTicket classified → respondTicket delivered
  FreeScout note, confirmed visible in FreeScout UI → state=responded in
  Supabase, ~15s end-to-end. ops-hub prod /health: ok. LiteLLM prod
  /health/readiness: healthy, db connected.

  T-51 blocker found + fixed en route: ops-hub-prod's Coolify env vars were
  missing INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY, LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY, SENTRY_DSN, NVIDIA_API_KEY, LITELLM_URL,
  LITELLM_MASTER_KEY (prod), LITELLM_EXTERNAL_URL (prod) — 3 of these
  (LITELLM_URL/MASTER_KEY/EXTERNAL_URL) were part of T-47's originally-claimed
  "8 vars set," lost afterward, most likely via the known Coolify
  append-not-upsert env var bug triggered during a later edit (T-50's
  FREESCOUT_DB_URL addition is the leading suspect). Re-added, redeployed via
  prod-deploy.yml, re-verified.

  T-54 opened (not a blocker for M6, but blocks future merges to main):
  ops-hub-staging and ops-hub-prod are registered as the same Inngest app id
  ("ops-hub"), and main-deploy.yml re-syncs Inngest against staging's URL on
  every merge to main — this can silently repoint production's function
  dispatch to staging. ops-hub-staging left stopped in Coolify until T-54
  lands; do not merge to main in the meantime without re-running prod-deploy.yml
  afterward to re-assert prod's Inngest registration.

  T-53 (Sprint 5 retro) opened, to cover both findings above.
  Next milestone: M7 or further tenant onboarding, at founder direction.
```

### 2026-07-03 — Near-miss: merging PR #233 triggered a cross-environment deploy collision

```
2026-07-03 [Tech Lead] Merging PR #233 (WORK.md/DECISIONS.md only) triggered
  main-deploy.yml (run 28673637806) because its paths-ignore only excludes
  docs/**, not root-level .md files. Its Coolify app lookup does
  jq 'select(.name == "ops-hub-app")' against the full /applications list
  with no project scoping. Two apps share that name — ops-hub-prod
  (sbke5gqru1n54rj7gssgca2y) and a deprecated staging app
  (ajqplom2mghf5a8h6vf1q6xg) — so the query matched both, producing a
  malformed multi-line UUID that crashed the PATCH call (curl exit 3) before
  any request reached Coolify. Confirmed no impact: prod /health (200) and
  /api/inngest (401) unchanged after the run.

  This fails safe only because the two name-matches both exist right now —
  it is not randomness, but it is fragile: deleting the deprecated staging
  app, a rename, or "fixing" the crash with | head -1 would turn this into a
  silent PATCH of ops-hub-prod's image tag from an unreviewed merge to main,
  bypassing the T-49 manual-promotion-gate design entirely. Filed as T-54(A).
  Separately, T-54(B) (Inngest app-id collision) remains unverified — this
  run crashed before reaching the Inngest sync step, so that theory was not
  actually exercised today.

  Do not merge to main until T-54(A) is fixed.
```

### 2026-07-03 — T-54(A) fixed; correction to earlier near-miss entry

```
2026-07-03 [Tech Lead] Correction: the earlier near-miss entry above described
  ajqplom2mghf5a8h6vf1q6xg as a "deprecated staging app." That was wrong —
  it is the current, live ops-hub-staging app, confirmed directly in Coolify's
  UI. The deprecated thing (per the 2026-06-22 entry) was its old
  auto-generated sslip.io hostname, not the app itself; Coolify derives
  sslip.io hostnames from the app's own UUID, which is why the string
  coincided. This means the app-name collision in main-deploy.yml was
  permanent and deterministic on every run, not a fragile edge case
  depending on a leftover app.

  Fixed: main-deploy.yml now pins OPS_HUB_STAGING_UUID directly (same
  pattern as prod-deploy.yml's OPS_HUB_PROD_UUID), removing the name-based
  /applications lookup entirely. Lint/typecheck/192 unit tests all green.

  This fix makes the staging deploy step succeed for the first time since
  ops-hub-staging was stopped, which restarts it on the next merge to main.
  To keep that safe, freescout-poller.ts gained a fail-closed
  POLLING_ENABLED env-var guard (default off) — required to be set to
  "true" on ops-hub-prod (not staging) before/at merge, or prod's own
  poller silently stops working too.

  T-54(B) (Inngest app-id collision) remains unverified. Every observed
  main-deploy.yml failure this sprint crashed before reaching the Inngest
  sync step; now that (A) no longer blocks that step, the next staging
  deploy will reach it for the first time. Watch prod's /api/inngest and
  run a live ticket test afterward to find out whether (B) is real.
```

### 2026-07-04 — T-54(B) confirmed: ~7hr production ticket-processing gap

```
2026-07-04 [Tech Lead] T-54(B) is confirmed, not just theorized. Timeline:

  17:42 UTC 2026-07-03 — PR #237 (T-54(A) fix) merged.
  17:44 UTC — main-deploy.yml ran end-to-end for the first time (previously
    always crashed at the app-name collision or timed out) — including its
    "Sync Inngest functions" step, PUT against ops-hub-staging's URL.
  ~17:47 UTC — test email sent to support@inatechshell.ca, FreeScout
    conversation #14 created (confirmed visible in FreeScout).
  17:47 UTC – 00:53 UTC (2026-07-04) — no corresponding row appeared in
    Supabase tickets. ~7 hours of silence.
  00:53 UTC — prod-deploy.yml manually re-run (workflow_dispatch), which
    includes its own Inngest sync step against ops-hub-prod's URL.
  00:55 UTC — the same ticket (freescout_conversation_id=14) was ingested,
    triaged, and responded to within 8 seconds.

  Confirmation is airtight: ops-hub-prod was running its pre-#237 image
  throughout the entire gap (prod is only updated by prod-deploy.yml,
  which did not run again until 00:53) — meaning prod had unconditional
  polling with no POLLING_ENABLED guard the whole time. The only
  explanation for ~7 hours of silence despite prod's poller code being
  unconditional is that Inngest Cloud's cron dispatch had been repointed
  away from prod's registered app by staging's sync — both environments
  share the same Inngest app id ("ops-hub" in src/inngest/client.ts).

  Interim mitigation (shipped same commit): removed the "Sync Inngest
  functions" step from main-deploy.yml entirely. Inngest Cloud still picks
  up ops-hub-staging's functions on its own periodic poll cycle without an
  explicit sync call — staging only loses sync immediacy, not correctness.
  This closes the recurrence path without touching prod's Inngest identity,
  which is the part of a full fix that needs live-merge verification and
  should not be attempted at the end of a long session.

  Permanent fix — a distinct Inngest app id per environment, env-var-driven
  in src/inngest/client.ts — remains open as a separate task. Do not
  re-add an explicit Inngest sync step to the staging deploy path before
  that fix lands.
```

### 2026-07-04 — T-54(B) permanent fix completed (backfilled entry)

```
2026-07-04 [PM] Backfilling a gap found during Sprint 6 scoping: WORK.md's
  T-54 row has claimed since 2026-07-04 that the permanent fix for the
  Inngest app-id collision (T-54(B)) is complete, but no corresponding
  DECISIONS.md entry was ever written — the last entry above (T-54(B)
  confirmed, interim mitigation shipped) still frames the permanent fix as
  open. Verified directly before backfilling, not taken on WORK.md's word
  alone (per this same file's own 2026-07-03 lesson):
    - PR #239 ("fix(T-54): make Inngest app id configurable per
      environment") confirmed MERGED 2026-07-04T02:02:18Z.
    - src/inngest/client.ts line 8 confirmed live:
      `new Inngest({ id: process.env.INNGEST_APP_ID ?? "ops-hub" })`.
  `INNGEST_APP_ID=ops-hub-staging` set on ops-hub-staging only; ops-hub-prod
  relies on the default ("ops-hub"). Inngest's Apps page (per WORK.md T-54)
  showed two distinct apps post-fix, verified with a live post-split test
  ticket processing correctly in prod. T-54 (both halves) is closed as of
  this backfill. Process note: this is exactly the class of drift the
  Sprint 5 retro's process change #1 warns about ("don't trust a WORK.md
  done-checkmark without a live check") — applied here to the decisions
  log itself, not just env vars.
```

### 2026-07-04 — Sprint 6 scoped

```
2026-07-04 [PM] Sprint 6 scoped: Ops Dashboard MVP + Reliability Debt
  Closure. Sprint 5 closed out fully (T-44-T-56, M6 declared 2026-07-03,
  retro at docs/retros/sprint-5.md). Sprint 6 anchors on a single
  measurable outcome per the retro's own lesson about overcommitment:
  the founder-facing Ops Dashboard, read-only MVP only (T-57 auth
  boundary -> T-58 data feeds -> T-59 build -> T-60 RLS verification),
  covering the 4 charter daily pillars from 02_stakeholders.md plus
  queue/pipeline/system-health/incidents views. T-58 (Data Engineer) was
  added after checking whether all 4 pillars are actually queryable
  today: 2 of 4 (eval health, agent cost) are not — T-17's Eval Gate
  never computes a stored pass-rate, and T-31 put per-ticket cost in
  LangFuse Cloud only with no in-app query path — so those two widgets
  get a data-feed prerequisite instead of surfacing as a mid-build wall
  for Frontend Engineer. Settings/write area (model routing editor, SLA
  editor, feature flags) explicitly deferred to Sprint 7. Two smaller
  parallel tracks: LiteLLM DB isolation wall restoration (T-61 staging,
  executable now; T-62 prod, contingent on founder FQ-57 action) and
  Sprint 5 CI/process debt (T-64 paths-ignore fix; T-65 backlog
  nice-to-have). No milestone declared this sprint - see WORK.md
  "Milestone numbering note": charter M7 is gated on an exogenous A-Mart/
  tenant event; team's milestone track already diverged from the charter
  table at M3 (DNC deferred, FQ-43); this sprint's work should not be
  auto-labeled M7 when it completes. FQ-47 (Cstate go-live) and FQ-43
  (DNC/second-tenant onboarding) carried forward as founder-gated, no
  team task consumes sprint capacity on either. Full task table:
  WORK.md "Sprint 6 tasks."
```

### 2026-07-04 — T-61 Phase 1 attempted, blocked at the pre-check (zero live changes)

```
2026-07-04 [Production Manager] T-61 Phase 1 (staging) executed per
  docs/deploys/2026-07-04-litellm-db-wall-restoration.md, in order, stopping
  at step 1 as the plan requires on failure.

  Added precheck-litellm-db-wall.yml (PR #255) — read-only workflow: proves
  litellm_db_user still authenticates + owns a healthy litellm schema,
  captures baseline public.* row counts for the later canary, and stashes
  litellm-staging's current (working) DATABASE_URL as a build artifact —
  the plan's documented rollback DSN was not actually saved anywhere before
  this, and apply-wall's own Step 3 deletes the only live copy before the
  new value is confirmed healthy.

  First dispatch (run 28722649416) failed with "invalid URI query parameter:
  schema" — a bug in the new workflow, not a real result: LITELLM_DB_USER_URL
  carries a Prisma-only ?schema=litellm suffix that libpq/psql does not
  understand. Fixed (PR #256) by stripping the query string before psql
  connects; every check already qualifies tables by schema explicitly, so
  nothing about the check was weakened.

  Second dispatch (run 28722827915), after the fix, returned a real result:
  FATAL: password authentication failed for user "litellm_db_user". This is
  a genuine auth rejection, not the ENOIDENTIFIER/"tenant not found" error
  that would indicate a DSN-format problem — the connection reached the
  password-check stage. Root cause not confirmed (the only rotation on
  record, 2026-06-29/FQ-49, was the postgres role's password, not
  litellm_db_user's), only the symptom. Per the deploy plan's own
  instruction for this exact scenario, did not guess at or attempt to reset
  the password — filed FOUNDER_QUEUE.md FQ-58 and stopped.

  Confirmed via the run log: no step after the auth check executed (baseline
  capture and rollback-DSN stash are gated behind it) — zero writes were made
  anywhere. fix-litellm-schema-isolation.yml was NOT dispatched. litellm-staging
  is unchanged from this session's start: DATABASE_URL still the
  postgres.yocoljutbiizdbfraapx DSN, DISABLE_SCHEMA_UPDATE=true still set,
  /health/readiness still 200. The FQ-57 latent-risk posture (both
  litellm-staging and litellm-prod connect as postgres, wall not in effect,
  but no Prisma DDL running today) is unchanged — this session neither
  worsened nor improved it. T-62 (Phase 2, prod) remains blocked on FQ-57
  as before, and is now additionally gated behind T-61 Phase 1 completing
  cleanly, which itself now needs FQ-58 resolved first.
```

### 2026-07-04 — T-57 Ops Dashboard auth boundary: Traefik/Coolify HTTP Basic Auth (not app-level session auth)

```
2026-07-04 [Tech Lead] T-57. The Ops Dashboard (T-59) gets its auth boundary from
  Traefik/Coolify HTTP Basic Auth on the dashboard FQDN, over the existing
  Let's Encrypt TLS — NOT an application-level login/session-cookie gate.
  (Exit criteria explicitly allow either and say no ADR is required at this size;
  this note is the record.) Single-founder, read-only console this sprint.

  WHY BASIC AUTH (chosen):
    - Zero application code and no new dependencies. Free-tier-first; nothing to
      run, patch, or lock into. Reversible by removing one Traefik label.
    - The dashboard is greenfield. There is no existing web-auth pattern to be
      "consistent with": the ops-hub runtime (src/index.ts) is a bare
      http.createServer serving ONLY /api/inngest, /api/status/webhook, and
      /health* — an internal Inngest/webhook/health backend with no sessions,
      no cookies, no framework. `OPS_HUB_APP_LOGIN_URL` is a Postgres DSN for the
      ops_hub_app_login DB role (RLS path), NOT a web login URL — it implies
      nothing about dashboard auth. So the "consistent with the rest of the app"
      argument for app-level auth is false on inspection.
    - The dashboard (T-59) is React/Next.js and does not exist yet. App-level
      session auth would have to be either hand-rolled signed-cookie crypto in
      the wrong app (the http server), or pre-written into a non-existent Next.js
      codebase — speculative complexity this team's rules reject. Basic auth is a
      reverse-proxy boundary decoupled from app code: it can be fully specified
      and handed off NOW, independent of T-59, which is exactly what a gate that
      "must land before T-59 is exposed" needs.
    - Topology-agnostic: works whether T-59 ships as its own Coolify app or as a
      path on an existing one — so choosing it now does NOT force the T-59
      deployment-shape decision.

  THREAT MODEL (what this does and, importantly, does NOT do):
    - PROTECTS AGAINST: unauthenticated public-internet access to the dashboard
      and the tenant-scoped data it will render (tickets, tenants, feature_flags).
      A random 31-char credential over TLS makes brute-force / interception
      infeasible; password entropy — not hash cost — is the defense (apr1/MD5
      htpasswd hash is Traefik-compatible and sufficient here; no bcrypt dep).
    - DOES NOT REPLACE the data-layer defense. Basic auth is a PERIMETER gate
      only. Cross-tenant safety still depends entirely on T-59 querying via
      ops_hub_app (never service_role at runtime) with explicit tenant/project
      scoping, verified by T-60. A single admin user is NOT safe-by-default:
      perimeter auth and RLS/tenant-scoping are independent layers and neither
      substitutes for the other. Do not read "we have basic auth" as license to
      loosen RLS.
    - ACCEPTED LIMITATIONS (fine for a single-founder read-only MVP, documented
      so they are chosen, not stumbled into): one shared credential (no per-user
      attribution — but one user, read-only, no actions to attribute); no
      logout/session-expiry UX (mitigation: close browser; credential is
      rotatable by re-issuing the Traefik label); credential sent on every
      request (mitigated by TLS).

  UPGRADE TRIGGER (explicit, so the follow-on isn't lost): replace Traefik basic
    auth with app-level session auth IN THE NEXT.JS APP when the Sprint-7
    settings/WRITE area lands — a write surface needs CSRF protection, real
    session lifecycle, and per-action audit that basic auth cannot provide. The
    two live at different layers and swap cleanly; basic auth now does not make
    that later work harder.

  IMPLEMENTATION = decision + staged handoff (Tech Lead applies no infra config).
    Credential generated now (openssl rand + `openssl passwd -apr1`), written to a
    LOCAL scratchpad file only — never committed, never pasted in chat. Applied at
    T-59 DEPLOY TIME: Production Manager adds the Traefik basic-auth label to the
    dashboard app (owns infra config per handoff protocol); founder places the
    secret. Tracked as FQ-59.

  BLOCKING GATE ON T-59 (this is T-57's whole reason to exist): the dashboard
    FQDN MUST return HTTP 401 to an unauthenticated request — confirmed by
    `curl -sS -o /dev/null -w '%{http_code}' https://<dashboard-fqdn>/` returning
    401 — BEFORE it is pointed at any public/reachable FQDN. The failure mode
    T-57 prevents is deploying T-59 and forgetting the label. This check also
    catches a mis-escaped hash ($ -> $$ in raw Traefik labels).
```

### 2026-07-04 — T-58 Dashboard data feeds: agent-cost via LangFuse Traces API sync; eval-health shipped as an honest "pending real gate" placeholder

```
2026-07-04 [Data Engineer] T-58. Two new Supabase tables + one new Inngest
  cron close the "no queryable source" gap T-59 would otherwise have hit
  mid-build. Migration: supabase/migrations/20260704010000_t58_agent_cost_eval_health.sql.

  AGENT COST — real sync, no new secret. `agent-cost-sync` (new Inngest cron,
    src/inngest/agent-cost-sync.ts, */10 * * * *) calls LangFuse Cloud's public
    Traces API (GET /api/public/traces, HTTP Basic auth: publicKey/secretKey —
    the SAME LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY already in Coolify for the
    SDK since T-09/T-31; nothing new to provision). fields=core,io,metrics
    returns each trace's metadata (ticket_id/project_id/tenant_id — the exact
    contract T-31 already established on all three cost-bearing traces:
    ticket-triage, ticket-respond, kb-learn) and totalCost (confirmed against
    LangFuse's live OpenAPI spec, cloud.langfuse.com/generated/api/openapi.yml
    — omitting the 'metrics' field group returns totalCost=-1, so it is always
    requested explicitly). Rows land in agent_cost_events (tenant/project-
    scoped RLS, ticket_id deliberately NOT a FK so a later ticket
    delete/rename can't break the sync) via ON CONFLICT (langfuse_trace_id) DO
    UPDATE — cost can settle after a trace closes, so a later sync overwrites
    rather than keeping a possibly-incomplete first value. A security_invoker
    view, agent_cost_daily, gives T-59 a ready-made per-tenant/per-agent daily
    rollup without re-deriving RLS-respecting aggregation logic itself.
    Gated behind AGENT_COST_SYNC_ENABLED=true on exactly one environment
    (same POLLING_ENABLED pattern as freescout-poller.ts) — LangFuse Cloud and
    Supabase are both shared across staging/prod, so both environments running
    this cron would double-fetch the same traces.

  EVAL HEALTH — deliberately NOT faked. T-17's `Eval Gate` CI job is
    `promptfoo validate` — schema validation only, no LLM-rubric grading, no
    real pass/fail signal against agent behavior. Per this task's own explicit
    guardrail (WORK.md T-58 row), storing that schema-check result as "eval
    health" would misrepresent it as the charter's >95% quality KPI
    (09_delivery.md) — so it wasn't done. Instead: eval_gate_runs is built and
    RLS-protected but left genuinely EMPTY — pass_rate is a GENERATED column
    that is structurally NULL for run_type='schema_validation', so even a
    future careless writer cannot make a schema check masquerade as a quality
    number. src/metrics/evalHealth.ts's getEvalHealth() returns an explicit
    { status: "pending", message: "no eval-quality runs yet — pending real
    gate" } when (as today) no run_type='llm_rubric' row exists. T-59 must
    render that literally, not substitute a green check or a percentage.
    Building the real LLM-rubric gate itself is out of scope here — eval
    *design* is Evals Lead's territory per the team's own division of labor
    (Data Engineer owns storage/query layer); this leaves the storage ready
    for that follow-up without inventing data to fill it meanwhile.

  VERIFIED THIS SESSION: pnpm typecheck/lint clean; 23 new unit tests green
    (agent-cost-sync.ts, evalHealth.ts, agentCost.ts) alongside the existing 75
    (nothing broken). A new read-only workflow,
    .github/workflows/verify-agent-cost-feed.yml, queries the REAL LangFuse
    Traces API with the real repo secrets and prints real trace/cost/metadata
    rows to the run's step summary — this is what proves the feed against live
    data rather than mocks alone; see WORK.md T-58 for the run link once
    dispatched post-merge.

  FOUNDER ACTION REQUIRED (not a business decision — routine migration
    application, same as every prior migration; not filed as an FQ):
    (1) apply the T-58 migration via Supabase SQL Editor as service_role;
    (2) set AGENT_COST_SYNC_ENABLED=true on ops-hub-prod's Coolify env vars
    and redeploy. No new secret needed for either step.

  Data lineage: docs/data/t58-agent-cost-eval-health-lineage.md.
```

### 2026-07-04 — T-58 post-merge: live LangFuse verification confirms the feed works, surfaces a real $0-cost gap

```
2026-07-04 [Data Engineer] T-58 follow-up. After PR #259 merged, dispatched
  verify-agent-cost-feed.yml against real LangFuse Cloud data (not mocks) for
  both ticket-triage (run 28724910365) and ticket-respond (run 28724966844).
  Both HTTP 200. ticket-triage: 2363 traces matched over 60 days; a 20-row
  sample parsed 20/20 with valid project_id/tenant_id, 0 skipped — including
  real production ticket 3e9a23c5-c350-477f-a9f7-24556bda803c (T-51's E2E
  validation ticket), correctly attributed to tts-prod/DNC-prod. Same result
  shape for ticket-respond (24 matched, 20/20 sampled parsed cleanly). This
  confirms the metadata contract, Basic auth, pagination, and parsing all work
  end to end against production data — not just mocked unit tests.

  REAL FINDING, NOT ROOT-CAUSED (flagging rather than guessing): every sampled
  trace across both names returned totalCost = 0.000000. agent_cost_events
  will faithfully mirror this once live — i.e. $0 per ticket — until whatever
  is causing it is fixed. Most likely explanation: LangFuse Cloud computes
  cost by matching a generation's recorded model name against its own pricing
  catalog; if the LiteLLM-routed model names (triage-model/fallback-model
  aliases, or the underlying NVIDIA NIM/Anthropic model strings) aren't
  registered there, cost silently comes back 0 rather than erroring. Not
  confirmed in this session — would require inspecting a raw
  /api/public/observations generation's usage/costDetails fields, which is
  past this task's scope (T-58 is the feed; this is a LangFuse project
  configuration question). Tracked as a follow-up, not blocking T-58's
  completion: the pipeline is correct, the input data it's relaying is
  currently zero. Recorded here so it isn't lost before T-59's agent-cost
  tile goes live and shows $0 across every project — that would otherwise
  look like a dashboard bug when it's actually a LangFuse pricing-catalog gap.
```
