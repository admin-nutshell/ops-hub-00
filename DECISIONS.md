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

---

*All future decisions appended below this line. Format: one line per decision, optionally followed by ADR link. Never edit historical entries — supersede with new entries instead.*
