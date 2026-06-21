# WORK.md — Live Status Board

> The agents' shared working surface. Everyone reads this at session start; everyone updates it during work.

---

## Current sprint

**Sprint:** Sprint 1 — Workspace + Foundation
**Sprint goal:** Stand up all foundational infrastructure (Coolify environments, Supabase, Inngest, LangFuse, LiteLLM, FreeScout, CI/CD with eval gate) so the agent team is fully operational and the first end-to-end ticket can flow through the Ops Hub. Closes milestone **M1**.
**Sprint window:** June 23 – July 4, 2026 (2 weeks)
**Target milestone:** M1 — "Workspace + Foundation" (chartered end-of-July 2026; targeting early delivery by July 4 to build buffer before M2)

---

## M1 checklist (Phase 1 success gate)

From `09_delivery.md` — all must be true before M1 is declared complete.

| # | Criterion | Owner | Status |
|---|---|---|---|
| 1 | GitHub repo with full plan + workspace files | Founder | ✅ Done (2026-06-18) |
| 2 | Coolify projects provisioned: `ops-hub-staging` and `ops-hub-prod` | **Founder** | ✅ Done (2026-06-20) — 34 env vars configured in staging; 6 GitHub secrets set |
| 3 | Supabase project for Ops Hub (pgvector enabled) | **Founder** | ✅ Done (2026-06-18) |
| 4 | Inngest + LangFuse + LiteLLM running in staging + prod | Prod Manager + Data Eng | ⚠️ Partial — **T-08 LiteLLM: ✅ DEPLOYED** (run #27887445367). T-09 LangFuse: Cloud provisioned (US); trace test pending T-08 canary. **T-07 Inngest: ops-hub-app ✅ DEPLOYED** (run #27921007847, HTTP 200 on `/health`, 2026-06-21). Inngest Cloud registration + test event pending. |
| 5 | All 11 agent specs loaded; agents respond when invoked | PM | ✅ Done (`.claude/agents/` committed 2026-06-18) |
| 6 | FreeScout deployed and connected as ticket intake | Production Manager | ✅ **T-10 DONE (2026-06-21).** FreeScout v2.1.2 running on Coolify staging; health check green; Supabase Postgres connected via session pooler (aws-1-ca-central-1). |
| 7 | CI/CD pipeline active: lint + tests + eval gate + staging auto-deploy | Tech Lead | ✅ **T-15 scaffold merged** (0860ff4, 2026-06-20); **branch protection fully active** — 3 required checks (lint, test, security), ≥1 approval, no direct push; eval gate lands with T-17 |
| 8 | At least 1 eval case per agent; eval gate enforced on PRs | Evals Lead | 🔒 Blocked on #7 |
| 9 | Sentry + UptimeRobot wired for Ops Hub and TTS | Production Manager | ⏳ In progress — Sentry DSN in Coolify env vars; UptimeRobot setup starts now; completion after T-15 |
| 10 | At least 1 ticket flowed end-to-end: FreeScout → triage → fix → deploy → resolved | Full team | 🔒 Blocked on #4, #6, #7 |
| 11 | First synthetic incident drill + post-mortem authored | Prod Manager + Tech Lead | 🔒 Blocked on #10 |
| 12 | DNC tickets flowing through Ops Hub | Solutions Architect | 🔒 Blocked on #10 |
| 13 | First monthly founder briefing produced | PM | 🔗 Scheduled: July 31 |

---

## Active tickets

*(none yet — sprint in setup phase)*

| Ticket ID | Title | Severity | Owner | State | Updated |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## Sprint 1 tasks

### Track A — Architecture & Schema (starts immediately — no infra dependency)

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-01: Author ADR-0001 — environment topology (dev/staging/prod on Coolify, shared VPS) | Tech Lead | — | ✅ Done (2026-06-18). `docs/adr/0001-environment-topology.md` committed (incl. VPS sizing review). Status: Proposed — pending Prod Mgr deployability sign-off. | Jun 27 |
| T-02: Author ADR-0002 — tool stack rationale (Inngest + LangFuse + LiteLLM + Supabase) | Tech Lead | — | ✅ Done (2026-06-18). `docs/adr/0002-tool-stack.md` committed (7 tools, fallback triggers). | Jun 27 |
| T-03: Design Ops Hub Supabase schema (tickets, tenants, agents, events, audit_log, feature_flags) | Tech Lead | — | ✅ Done (2026-06-18). `docs/engineering/database-schema.md` + 2 migrations in `supabase/migrations/`. ⏳ Needs Security Lead RLS sign-off — see flags in schema doc §6. | Jun 27 |
| T-04: Draft Project Context schema for TTS v1 | Solutions Architect | — | JSON schema spec committed to `docs/engineering/project-context-schema.md`; reviewed by Tech Lead | Jun 27 |
| T-05: Write CI/CD pipeline spec (lint + test + eval gate + staging auto-deploy + prod manual promotion) | Tech Lead | — | ✅ Done (2026-06-18). `docs/engineering/ci-cd-pipeline.md` rewritten implementation-ready; toolchain = Node/TS primary. | Jun 27 |
| T-06: Author Sprint 1 test plan (infrastructure verification scope) | QA Manager | — | Test plan committed to `docs/testing/sprint-1-test-plan.md` | Jun 27 |

### Track B — Infrastructure Provisioning (🟢 unblocked — Coolify + Supabase both provisioned)

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-07: Deploy Inngest (connect to Inngest Cloud) in staging + prod | Production Manager | ✅ Coolify; ✅ T-15 done | Inngest dashboard shows both envs; test event processed | Jul 2 |
| ↳ **ops-hub-app ✅ DEPLOYED (2026-06-21).** Run #27921007847 — all steps green. Health check HTTP 200 on attempt 1. FQDN: `http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io`. FQ-12 resolved (docker login ghcr.io on VPS). Remaining: Inngest Cloud registration + verify test event. | | | | 2026-06-21 |
| T-08: Deploy LiteLLM (self-hosted) to staging + prod on Coolify | Production Manager | ✅ Coolify provisioned | LiteLLM running; test API call returns model response | Jul 2 |
| ↳ **[PR #6](https://github.com/admin-nutshell/ops-hub-00/pull/6) — ✅ MERGED (8c5170c).** `deploy-staging-services.yml` workflow on main. | | | | 2026-06-20 |
| ↳ **[PR #8](https://github.com/admin-nutshell/ops-hub-00/pull/8) — ✅ MERGED (2fea606).** Pre-flight diagnostics + full HTTP capture. Run #27887003804 confirmed root cause: Coolify API gate disabled (see FQ-07). | | | | 2026-06-20 |
| T-09: Connect to LangFuse Cloud (provisioned 2026-06-20, US region — no Coolify deploy needed) | Data Engineer | ✅ Cloud provisioned | LangFuse UI reachable; first trace logged from LiteLLM after T-08 | Jul 2 |
| T-10: Deploy FreeScout to staging on Coolify | Production Manager | ✅ Coolify provisioned | ✅ **DONE (2026-06-21).** FreeScout v2.1.2 (nfrastack/freescout:latest) deployed to Coolify staging; all health checks green (run #27916949231, 3m50s). URL: Coolify-assigned staging FQDN. Root causes fixed via PRs #42–#46: SKIP_DB_READY (nfrastack image switch), pooler URL port-parse guard, DB_SSL_MODE=require for laravel psql check. FQ-11 resolved by founder (correct pooler hostname confirmed). | Jul 2 |
| ↳ PRs #42–#46: tiredofit→nfrastack image, SKIP_DB_READY, DB_SSL_MODE=require, URL port-parse guard. Run #27916949231 ✅. | | | | 2026-06-21 |
| T-11: Apply initial Supabase schema migrations | Tech Lead | ✅ Supabase provisioned; T-03 complete | **RUNBOOK READY** — at `docs/engineering/t11-migration-runbook.md`; Security Lead review required (gates migration 2); awaiting founder execution. | Jul 2 |
| T-12: Set up Supabase Vault — store all LLM API keys and service secrets | Security Lead | ✅ Supabase provisioned | All secrets in Vault; zero keys in env files, git, or Coolify env vars | Jul 2 |
| T-13: Wire Sentry for Ops Hub (staging + prod) | Production Manager | ✅ Coolify provisioned | First test error captured in Sentry | Jul 2 |
| T-14: Wire UptimeRobot monitors for Ops Hub staging + prod | Production Manager | ✅ Coolify provisioned | Monitors active; test alert fires and clears | Jul 2 |

### Track C — CI/CD & Eval Gate (starts after T-05 + infra available)

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-15: Implement GitHub Actions CI (lint + tests + staging auto-deploy on merge to main) | Tech Lead | T-05 ✅; ✅ Coolify provisioned | PR triggers pipeline; lint + test pass; staging deploys on merge | Jul 4 |
| ↳ **[PR #1](https://github.com/admin-nutshell/ops-hub-00/pull/1) — ✅ MERGED (9d685b0).** CI skeleton (pr-checks.yml). | | | | 2026-06-20 |
| ↳ **[PR #3](https://github.com/admin-nutshell/ops-hub-00/pull/3) — ✅ MERGED (295a481).** Gitleaks CLI fix — all 3 CI checks now functional. | | | | 2026-06-20 |
| ↳ **[PR #2](https://github.com/admin-nutshell/ops-hub-00/pull/2) — ✅ MERGED (0860ff4). T-15 COMPLETE.** Node 20 + TS + pnpm scaffold; Lint ✅ Test ✅ Security ✅. Unblocks T-07, T-13, Coolify app deploy. | | | | 2026-06-20 |
| ↳ **Branch protection: ✅ FULLY ACTIVE.** 3 required checks (Lint & Type Check, Unit Tests, Security Scan), strict, 0 required approvals (↓ from 1; founder is sole contributor, self-approval impossible — CI gates are the quality bar), enforce_admins=true, dismiss stale, no force-push, no deletion. Updated 2026-06-21 by Tech Lead. | | | | 2026-06-20 |
| T-16: Author 1 eval case per agent (11 total minimum) | Evals Lead | — | 11 `.yaml` eval files committed to `evals/`; each tests the agent's core capability | Jul 4 |
| T-17: Wire Promptfoo eval gate into CI (failing eval blocks PR merge) | Evals Lead | T-15; T-16 | Failing eval blocks merge; passing eval trace visible in LangFuse | Jul 4 |
| T-18: Verify cross-tenant RLS isolation (automated test) | Security Lead | T-11; T-12 | Test confirms tenant A cannot read tenant B rows; committed to CI | Jul 4 |

### Track D — QA & Knowledge Foundation

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-19: Write first integration test: ticket intake → `new` → `triaged` state machine | QA Manager | T-10; T-11 | Test passes in CI against staging | Jul 4 |
| T-20: Initialize KB structure in Supabase (index, categories, placeholder articles) | Knowledge Lead | T-11 | KB table populated; first 2 placeholder articles committed | Jul 4 |

---

## Blocked items

| Item | Blocked by | Impact if unresolved by Jun 27 | Owner |
|---|---|---|---|
| T-11 (migrations) | Security Lead sign-off on migration 2 (RLS policies) + founder execution of runbook | Supabase schema not live; T-12, T-18, T-20 all blocked | Tech Lead |

---

## Per-agent status

### PM
Sprint 1 planned (2026-06-18). Monitoring M1 checklist. Next: Friday July 4 sprint retro to `docs/retros/sprint-1.md`.

**2026-06-20 — PR #1 review coordination complete; operating model updated.**
Parallel review by Tech Lead + QA Manager + Security Lead — all signed off. Three follow-up commits applied (zizmor hardening, integration test step, gitleaks digest pin + command migration). FQ-06 approved by Founder. Operating model updated: Founder responds only to business logic and UI/UX; all technical decisions (security config, branch protection, tooling) are agent-owned. Tech Lead now owns PR #1 merge + branch protection setup. Tracking items for T-15/T-19: branch-protection required checks added incrementally; coverage PR comment deferred.

**2026-06-20 — FQ-03 resolved.** Repo naming confirmed: `admin-nutshell/ops-hub-00` is canonical. `09_delivery.md` updated; repo not renamed.

**2026-06-20 — Sprint 1 active work coordinated.** FOUNDER_QUEUE clear. Dispatched parallel tracks:
- Tech Lead: merge PR #1 → branch protection → T-11 (migrations) → T-15 (app scaffold)
- Production Manager: T-08 (LiteLLM) + T-10 (FreeScout) in parallel

### Tech Lead
**🟢 T-11 RUNBOOK READY (2026-06-20) — founder-run path chosen; agents never hold service_role key.**
Decision: rather than provide agents a `DATABASE_URL`, the founder applies the two migrations themselves using a copy-paste runbook → `docs/engineering/t11-migration-runbook.md`. Runbook gates migration 2 (`20260618120100_enable_rls_policies.sql`) behind Security Lead sign-off, uses per-file `psql -f` (NOT `supabase db push`, which would apply both migrations at once and bypass the gate), and includes PowerShell-native commands for the founder's Windows environment. **Awaiting: (1) Security Lead RLS sign-off, (2) founder execution.** `ops_hub_app` login-role wiring follows in T-12.

**Branch protection (2026-06-20): ✅ FULLY ACTIVE.** GitHub Team upgrade executed. Branch protection configured on `main`: require Lint & Type Check + Unit Tests + Security Scan (all 3 required); strict (branches up to date); ≥1 approval; dismiss stale reviews; no direct push; no force-push; no deletion.

**Track A complete (2026-06-18), ahead of the Jun 27 due date.** All four artifacts authored and committed on branch `feature/sprint1-track-a-architecture`:
- T-01 → `docs/adr/0001-environment-topology.md` (incl. VPS sizing review; 70% util → founder resize escalation). Status Proposed — needs Prod Mgr deployability sign-off.
- T-02 → `docs/adr/0002-tool-stack.md` (7 tools, per-tool fallback triggers).
- T-03 → `docs/engineering/database-schema.md` + `supabase/migrations/20260618120000_initial_schema.sql` + `20260618120100_enable_rls_policies.sql`. **RLS is fail-closed; enforcement model split between `ops_hub_app` role (agent paths, GUC) and JWT (portal); `service_role` reserved for migrations/platform.** → **Security Lead: please review §6 flags in the schema doc — the service_role bypass model is the headline item; T-18 must test isolation via the agent (`ops_hub_app`) path, not just Auth.**
- T-05 → `docs/engineering/ci-cd-pipeline.md` rewritten implementation-ready. Toolchain decision: Node 20 + TS (pnpm) primary, Python 3.12 secondary. → **T-15 (GitHub Actions) can proceed against this spec without coming back to me.**

**Reconciliations made (flagged for owners, non-blocking M1):** `feature-flags.md` schema + helper use `project` text → must move to `project_id` uuid FK (now that `projects` table exists); `database-migrations.md` should note flat platform-migration layout vs. the future per-project subdirs.

**🟢 T-15 COMPLETE (2026-06-20) — PR #2 merged (0860ff4).**
Full Node 20 + TS + pnpm scaffold on `main`: `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `src/index.ts` (GET /health), `src/health.test.ts`, `Dockerfile` (multi-stage, non-root), `.githooks/pre-push`. All 3 CI checks green. Branch protection fully configured.

**T-07 (Inngest), T-13 (Sentry SDK init), and Coolify app staging deploy are now unblocked.**

**Handing off to Production Manager: begin T-08 (LiteLLM deployment to Coolify staging).** Specs ready in Production Manager section below.

No FOUNDER_QUEUE items raised for arch decisions — none are founder-owned per RACI. See FQ-05 (new) for LangFuse data residency note. The VPS-resize spend decision is correctly deferred behind the 70% monitoring trigger (ADR-0001 §6).

### QA Manager
**Active.** T-06 (test plan) starts immediately. T-19 (integration test) blocked until FreeScout + Supabase staging are live.

### Production Manager
**🟢 ACTIVE (2026-06-21)**

**T-08: LiteLLM — ✅ DEPLOYED** (run #27887445367 + re-confirmed healthy). `litellm-staging` running at `http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io`.

**T-10: FreeScout — ✅ DEPLOYED (2026-06-21)** — see task row + FQ-11. `freescout-staging` running at `http://y4b8nibdtizby6ys3el2gad4.187.124.76.235.sslip.io`. Image: `nfrastack/freescout:latest`. Run #27916949231 all steps green.

**ADR-0001 sign-off — now eligible.** T-08 + T-10 both live. Will sign off when ADR-0001 §6 is reviewed against current VPS utilisation.

---

**T-07: Inngest — ✅ ops-hub-app DEPLOYED (2026-06-21)**

ops-hub-app running at `http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io`. Run #27921007847 — health check HTTP 200 on attempt 1 (immediately after deployment). FQ-12 resolved: docker login ghcr.io on VPS (Option B). Deploy pipeline fully operational end-to-end (PRs #50–#58).

**Next:** Register staging FQDN with Inngest Cloud; verify test event processed via `/api/inngest`.

**T-09: LangFuse Cloud** — Already provisioned (US region). Blocked on T-08 canary → send test trace from LiteLLM after T-07 live.

**T-13: Sentry** — `SENTRY_DSN` already in Coolify env vars. Needs Sentry SDK init in app code — begins with T-07 app code changes.

**T-14: UptimeRobot** — Set up monitors for LiteLLM + FreeScout staging URLs. Start now (URLs known). Add ops-hub app URL monitor after T-07 deploy.

Remaining deploy order:
1. **T-07: Inngest** — ops-hub app creation + Inngest SDK init (next)
2. **T-11: Supabase migrations** — awaiting Security Lead sign-off + founder execution of runbook
3. **T-12: Vault setup** — after T-11; Security Lead coordinates
4. **T-14: UptimeRobot** — can start immediately for LiteLLM + FreeScout URLs
5. **T-13: Sentry** — SDK init in app code (with T-07)

### Security Lead
**Active.** Review T-03 schema when Tech Lead publishes (target Jun 27). T-12 + T-18 blocked on Supabase. Confirm secrets hygiene plan for GitHub Actions env vars now.

### Evals Lead
**Active.** T-16 (11 eval cases) starts immediately — no infra dependency. T-17 (CI wiring) blocked on T-15.

### Knowledge Lead
**Standing by on Track D.** T-20 blocked until Supabase provisioned. Draft KB category taxonomy in the meantime.

### Frontend Engineer
**Minimal Sprint 1 scope.** No frontend tasks until FreeScout wired and ticket flow established (Sprint 2 / M2 scope). Monitor for T-10 completion — will be needed to verify FreeScout UI before sign-off.

### Data Engineer
**🟢 T-09 UPDATED (2026-06-20) — LangFuse Cloud provisioned (US region). No Coolify deploy needed.**
T-09 revised exit criteria: (1) LangFuse Cloud UI accessible at your provisioned URL ✅; (2) first trace logged from LiteLLM after T-08 completes. Wire DSN env vars (`LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`) into LiteLLM config — already set in Coolify. Monitor monthly event count against 50K free-tier ceiling (ADR-0002 §2 trigger at 70% = 35K events). Data residency: LangFuse Cloud US region approved for Sprint 1 + Sprint 2 (FQ-05, 2026-06-20). Revisit before M3 when real tenant tickets flow.

### Solutions Architect
**Active.** T-04 (Project Context schema for TTS) starts immediately. DNC onboarding checklist prep begins once T-04 approved by Tech Lead.

---

## Risks under consideration

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| ~~Coolify/Supabase provisioning delayed~~ | ~~High~~ | Resolved 2026-06-18 — both provisioned ahead of Jun 27 deadline. | PM |
| VPS resource contention (Inngest + LiteLLM + LangFuse + FreeScout on one VPS) | Medium | Tech Lead sizing review in ADR-0001; flag if VPS upgrade needed. Founder approval required for any paid infra change. | Tech Lead |
| ~~Repo naming mismatch vs. charter~~ | ~~Low~~ | Resolved 2026-06-20 — FQ-03 approved: `admin-nutshell/ops-hub-00` is canonical; `09_delivery.md` updated. | PM |

---

## Recently resolved

*(empty — first sprint)*

---

## Workspace conventions

- **Updating this file:** any agent may update its own section + the section relevant to its current work. Be append-aware — don't overwrite another agent's update.
- **Stale items:** anything not touched in > 48h triggers PM review.
- **Sprint rhythm:** PM rewrites "Current sprint" section every Monday.

---

*This file is the canonical "what's happening right now" view. If something is happening but not here, it isn't happening.*
