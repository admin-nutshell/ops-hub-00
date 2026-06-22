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
| 4 | Inngest + LangFuse + LiteLLM running in staging + prod | Prod Manager + Data Eng | ⚠️ Partial — **T-08 LiteLLM: ✅ DEPLOYED** (run #27887445367). T-09 LangFuse: Cloud provisioned (US); trace test pending T-08 canary. **T-07 Inngest: ops-hub-app ✅ DEPLOYED** (run #27921007847, HTTP 200 on `/health`, 2026-06-21). **FQ-13 RESOLVED (2026-06-22):** signing key + event key set in Coolify. Pending: container redeploy (on PR merge) + founder test-event verification via Inngest dashboard. |
| 5 | All 11 agent specs loaded; agents respond when invoked | PM | ✅ Done (`.claude/agents/` committed 2026-06-18) |
| 6 | FreeScout deployed and connected as ticket intake | Production Manager | ✅ **T-10 DONE (2026-06-21).** FreeScout v2.1.2 running on Coolify staging; health check green; Supabase Postgres connected via session pooler (aws-1-ca-central-1). |
| 7 | CI/CD pipeline active: lint + tests + eval gate + staging auto-deploy | Tech Lead | ✅ **T-15 scaffold merged** (0860ff4, 2026-06-20); **branch protection fully active** — 3 required checks (lint, test, security), ≥1 approval, no direct push; eval gate lands with T-17 |
| 8 | At least 1 eval case per agent; eval gate enforced on PRs | Evals Lead | 🔒 Blocked on #7 |
| 9 | Sentry + UptimeRobot wired for Ops Hub and TTS | Production Manager | ⏳ Partial — **Sentry SDK deployed** (PR #60, 2026-06-21); **UptimeRobot provisioning script authored** (PR #73, 2026-06-22) — monitors not yet created; dispatch pending PR #73 merge. Remaining: (a) merge + dispatch workflow to create 3 staging monitors; (b) alert contacts config for email to mai@leelaecospa.com; (c) prod monitors; (d) TTS monitors. |
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
| T-04: Draft Project Context schema for TTS v1 | Solutions Architect | — | ✅ **Done (2026-06-21, PR #64/63).** `docs/engineering/project-context-schema.md` — draft-07 JSON Schema with project/tenant identity, integrations, feature flags, constraints, metadata. Credential fields are Vault refs. Tech Lead review invited. | Jun 27 |
| T-05: Write CI/CD pipeline spec (lint + test + eval gate + staging auto-deploy + prod manual promotion) | Tech Lead | — | ✅ Done (2026-06-18). `docs/engineering/ci-cd-pipeline.md` rewritten implementation-ready; toolchain = Node/TS primary. | Jun 27 |
| T-06: Author Sprint 1 test plan (infrastructure verification scope) | QA Manager | — | ✅ **Done (2026-06-21, PR #66).** `docs/testing/sprint-1-test-plan.md` — 7 test categories; blocked-tests table (FQ-13, FQ-14, FQ-15); M1 exit criteria split by "green now" vs "unblock pending". | Jun 27 |

### Track B — Infrastructure Provisioning (🟢 unblocked — Coolify + Supabase both provisioned)

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-07: Deploy Inngest (connect to Inngest Cloud) in staging + prod | Production Manager | ✅ Coolify; ✅ T-15 done | Inngest dashboard shows both envs; test event processed | Jul 2 |
| ↳ **ops-hub-app ✅ DEPLOYED (2026-06-21).** Run #27921007847 — all steps green. Health check HTTP 200 on attempt 1. FQDN: `http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io`. FQ-12 resolved (docker login ghcr.io on VPS). **FQ-13 RESOLVED (2026-06-22):** INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY set in Coolify env vars by founder. Pending: container redeploy (on this PR merge) + founder test-event verification via Inngest dashboard. | | | | 2026-06-22 |
| T-08: Deploy LiteLLM (self-hosted) to staging + prod on Coolify | Production Manager | ✅ Coolify provisioned | LiteLLM running; test API call returns model response | Jul 2 |
| ↳ **[PR #6](https://github.com/admin-nutshell/ops-hub-00/pull/6) — ✅ MERGED (8c5170c).** `deploy-staging-services.yml` workflow on main. | | | | 2026-06-20 |
| ↳ **[PR #8](https://github.com/admin-nutshell/ops-hub-00/pull/8) — ✅ MERGED (2fea606).** Pre-flight diagnostics + full HTTP capture. Run #27887003804 confirmed root cause: Coolify API gate disabled (see FQ-07). | | | | 2026-06-20 |
| T-09: Connect to LangFuse Cloud (provisioned 2026-06-20, US region — no Coolify deploy needed) | Data Engineer | ✅ Cloud provisioned | LangFuse UI reachable; first trace logged from LiteLLM after T-08 | Jul 2 |
| T-10: Deploy FreeScout to staging on Coolify | Production Manager | ✅ Coolify provisioned | ✅ **DONE (2026-06-21).** FreeScout v2.1.2 (nfrastack/freescout:latest) deployed to Coolify staging; all health checks green (run #27916949231, 3m50s). URL: Coolify-assigned staging FQDN. Root causes fixed via PRs #42–#46: SKIP_DB_READY (nfrastack image switch), pooler URL port-parse guard, DB_SSL_MODE=require for laravel psql check. FQ-11 resolved by founder (correct pooler hostname confirmed). | Jul 2 |
| ↳ PRs #42–#46: tiredofit→nfrastack image, SKIP_DB_READY, DB_SSL_MODE=require, URL port-parse guard. Run #27916949231 ✅. | | | | 2026-06-21 |
| T-11: Apply initial Supabase schema migrations | Tech Lead | ✅ Supabase provisioned; T-03 complete | ✅ **DONE (2026-06-21).** Both migrations applied via Supabase SQL Editor. All 6 tables live in `public` schema with RLS enabled. `ops_hub_app` role created. LiteLLM tables also present (expected — `STORE_MODEL_IN_DB=True`). FQ-15 resolved. | Jul 2 |
| T-12: Set up Supabase Vault — store all LLM API keys and service secrets | Security Lead | ✅ Supabase provisioned; ✅ T-11 done | ✅ **Done (merged PR #69 — Vault runbook).** `ops_hub_app_login` connectable login role (nobypassrls, inherits ops_hub_app); hardened `internal.get_secret()` accessor (V1–V5 baked in, no PUBLIC/PostgREST exfiltration). Founder executes secret migration per runbook; DB_URL credential excepted per V4. | Jul 2 |
| T-13: Wire Sentry for Ops Hub (staging + prod) | Production Manager | ✅ Coolify provisioned | **⏳ SDK deployed + instrument.ts fix deployed (PRs #60/#63, run #27922168744).** `SENTRY_DSN` in Coolify env. Sentry.init now runs before other modules load (correct OTel auto-instrumentation). Pending: verify first error in Sentry dashboard. | Jul 2 |
| T-14: Wire UptimeRobot monitors for Ops Hub staging + prod | Production Manager | ✅ Coolify provisioned | **🟡 In flight** — FQ-14 resolved (API key in GitHub secrets). `scripts/provision-uptimerobot.sh` + `.github/workflows/provision-uptimerobot.yml` authored (PR #73). **Monitors not yet created** — dispatch requires PR #73 merged to main, then: `gh workflow run provision-uptimerobot.yml --repo admin-nutshell/ops-hub-00`. Verify by checking run log for 3× `"stat":"ok"`. Alert contacts NOT yet wired — monitors will be created without alert_contacts; email routing to mai@leelaecospa.com requires UptimeRobot dashboard follow-up (create contact → note ID → re-run workflow). Prod monitors deferred to post-M1. | Jul 2 |

### Track C — CI/CD & Eval Gate (starts after T-05 + infra available)

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-15: Implement GitHub Actions CI (lint + tests + staging auto-deploy on merge to main) | Tech Lead | T-05 ✅; ✅ Coolify provisioned | PR triggers pipeline; lint + test pass; staging deploys on merge | Jul 4 |
| ↳ **[PR #1](https://github.com/admin-nutshell/ops-hub-00/pull/1) — ✅ MERGED (9d685b0).** CI skeleton (pr-checks.yml). | | | | 2026-06-20 |
| ↳ **[PR #3](https://github.com/admin-nutshell/ops-hub-00/pull/3) — ✅ MERGED (295a481).** Gitleaks CLI fix — all 3 CI checks now functional. | | | | 2026-06-20 |
| ↳ **[PR #2](https://github.com/admin-nutshell/ops-hub-00/pull/2) — ✅ MERGED (0860ff4). T-15 COMPLETE.** Node 20 + TS + pnpm scaffold; Lint ✅ Test ✅ Security ✅. Unblocks T-07, T-13, Coolify app deploy. | | | | 2026-06-20 |
| ↳ **Branch protection: ✅ FULLY ACTIVE.** 3 required checks (Lint & Type Check, Unit Tests, Security Scan), strict, 0 required approvals (↓ from 1; founder is sole contributor, self-approval impossible — CI gates are the quality bar), enforce_admins=true, dismiss stale, no force-push, no deletion. Updated 2026-06-21 by Tech Lead. | | | | 2026-06-20 |
| T-16: Author 1 eval case per agent (11 total minimum) | Evals Lead | — | ✅ **Done (2026-06-21, PR #65).** 11 `.yaml` eval files in `evals/` — one per agent, each with llm-rubric at threshold 0.8 testing the agent's core decision-making. Ready for T-17 CI wiring. | Jul 4 |
| T-17: Wire Promptfoo eval gate into CI (failing eval blocks PR merge) | Evals Lead | T-15; T-16 | Failing eval blocks merge; passing eval trace visible in LangFuse | Jul 4 |
| T-18: Verify cross-tenant RLS isolation (automated test) | Security Lead | ✅ T-11; ✅ T-12 | ✅ **Done (PR #72).** `src/integration/rls-isolation.test.ts` — asserts AS `ops_hub_app_login` (RLS genuinely engages; not the no-op service_role path): tenant_A sees its row (positive control), tenant_B does NOT (isolation), no-GUC sees zero (fail-closed). Pooler-safe (per-probe txn + transaction-local GUC). Skips in CI (no staging creds); run `pnpm test:integration` against staging to verify. Merges-after T-19. | Jul 4 |

### Track D — QA & Knowledge Foundation

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-19: Write first integration test: ticket intake → `new` → `triaged` state machine | QA Manager | ✅ T-10; ✅ T-11 | ✅ **Done (2026-06-21, PR #70)** — `src/integration/ticket-state-machine.test.ts`; skips in CI (no staging creds); uses `service_role` for now; `// TODO T-12` migrate to `ops_hub_app_login`. | Jul 4 |
| T-20: Initialize KB structure in Supabase (index, categories, placeholder articles) | Knowledge Lead | ✅ T-11 | ✅ **Done (2026-06-21, PR #71)** — `docs/knowledge/kb-structure.md` + `supabase/migrations/20260621130000_kb_seed.sql`; 2 placeholder articles; ANN index deferred until rows populated | Jul 4 |

---

## Blocked items

| Item | Blocked by | Impact if unresolved by Jun 27 | Owner |
|---|---|---|---|
| ~~T-07 Inngest keys~~ | ~~**FQ-13 RESOLVED (2026-06-22)**~~: INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY set in Coolify by founder. Merge this PR → container redeploys → founder verifies /api/inngest introspection + test event from Inngest dashboard. | M1 #4 remains partial until test event confirmed | Production Manager |
| ~~T-18 (RLS isolation test)~~ | ~~**T-12** (Vault + `ops_hub_app` login role)~~ — Resolved 2026-06-22: T-12 merged (PR #69); T-18 test written (PR #72). | — | Security Lead |

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
Decision: rather than provide agents a `DATABASE_URL`, the founder applies the two migrations themselves using a copy-paste runbook → `docs/engineering/t11-migration-runbook.md`. Runbook gates migration 2 (`20260618120100_enable_rls_policies.sql`) behind Security Lead sign-off, uses per-file `psql -f` (NOT `supabase db push`, which would apply both migrations at once and bypass the gate), and includes PowerShell-native commands for the founder's Windows environment. **Security Lead sign-off recorded (2026-06-21, APPROVED WITH CONDITIONS, C1 applied — `authenticated` removed from `audit_log_insert`).** **Awaiting: founder execution — see FQ-15 in FOUNDER_QUEUE.md.** `ops_hub_app` login-role wiring follows in T-12.

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
**Active.** T-06 (test plan) done. **T-19 in progress (2026-06-21):** first integration test `src/integration/ticket-state-machine.test.ts` written — project→tenant→ticket(`new`)→assert→update(`triaged`)→assert→teardown (reverse-FK). Vitest + `@supabase/supabase-js`. Self-skips when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` absent so CI stays green without secrets. Connects via `service_role` (RLS bypass) as a stopgap — **must migrate to `ops_hub_app_login` once T-12 (Vault + login role) lands** (`// TODO T-12` in file). Reconciled the stale CI wiring: `pr-checks.yml` integration guard + `package.json test:integration` repointed `tests/integration` → `src/integration` (matches the spec'd test path). PR opened. Local `pnpm lint`/`typecheck`/`test`/`test:integration` all green; `--frozen-lockfile` verified after adding supabase-js.

### Production Manager
**🟢 ACTIVE (2026-06-21)**

**T-08: LiteLLM — ✅ DEPLOYED** (run #27887445367 + re-confirmed healthy). `litellm-staging` running at `http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io`.

**T-10: FreeScout — ✅ DEPLOYED (2026-06-21)** — see task row + FQ-11. `freescout-staging` running at `http://y4b8nibdtizby6ys3el2gad4.187.124.76.235.sslip.io`. Image: `nfrastack/freescout:latest`. Run #27916949231 all steps green.

**ADR-0001 sign-off — now eligible.** T-08 + T-10 both live. Will sign off when ADR-0001 §6 is reviewed against current VPS utilisation.

---

**T-07: Inngest — 🟡 Keys set; post-merge redeploy + test event verification pending (2026-06-22)**

ops-hub-app running at `http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io`. Run #27921007847 — health check HTTP 200 on attempt 1. FQ-12 resolved: docker login ghcr.io on VPS. Deploy pipeline fully operational (PRs #50–#58).

**FQ-13 RESOLVED (2026-06-22):** INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY set in Coolify env vars by founder. SDK wired: `/api/inngest` served via `inngest/node` serve() handler; `helloWorld` function registered (trigger: `test/hello.world`). Source: `src/index.ts` + `src/inngest/functions.ts`.

**Post-merge action (founder):** After this PR merges, main-deploy.yml triggers container redeploy picking up the new keys. Verify: (1) GET `/api/inngest` returns 200 with introspection JSON; (2) send `test/hello.world` event from Inngest Cloud dashboard and confirm function execution. Production Manager will mark T-07 ✅ Done on confirmation.

Note: Live network verification from this agent context was not possible (all outbound network tools denied in this session). Endpoint health inferred from: prior confirmed deploy, founder-confirmed env var set, and source code inspection.

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
**✅ T-18 DONE (2026-06-22, PR #72) — cross-tenant RLS isolation test written.** Both T-12 and T-18 complete.

**T-18 — `src/integration/rls-isolation.test.ts`.** Rejected the task's literal spec: supabase-js + service_role + `rpc('set_config')` tests NOTHING (service_role bypasses RLS → returns all rows; and rpc/select are separate transactions so a transaction-local GUC evaporates). It would FAIL on real Supabase while sitting GREEN-SKIPPED in CI — a false "isolation verified" signal, the worst outcome for a security gate. Replaced with the Tech-Lead-ratified path (Option A): assertions run via the `pg` driver AS `ops_hub_app_login` (T-12's nobypassrls login role) so RLS genuinely engages — the runbook §8 "Real login-path RLS check." Three assertions (positive control + isolation + fail-closed); per-probe transaction with transaction-local GUC (pooler-safe). service_role used for setup/teardown only. Skips in CI without staging creds. See DECISIONS.md 2026-06-22.

**Run against staging before relying on it:** `pnpm test:integration` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPS_HUB_APP_LOGIN_URL` set against ops-hub-staging. CI auto-skips (no creds). Wiring CI staging creds for automated runs is an M2 follow-up. T-18 PR merges-after T-19 (PR #70).

**T-12 — done (PR #69 merged).** `ops_hub_app_login` login role + hardened `internal.get_secret()` accessor (V1–V5 conditions). Founder executes the secret migration per the runbook.

### Evals Lead
**Active.** T-16 (11 eval cases) starts immediately — no infra dependency. T-17 (CI wiring) blocked on T-15.

### Knowledge Lead
**✅ T-20 DONE (2026-06-21) — KB structure committed.**

`docs/knowledge/kb-structure.md` — 6-category taxonomy, naming conventions, embedding model note (`text-embedding-ada-002`, 1536 dims), mandatory `WHERE project_id = $1` search pattern, RAG quality targets.

`supabase/migrations/20260621130000_kb_seed.sql` — seeds `ops-hub` project row (fixed UUID `00000000-0000-0000-0000-000000000001`, dev/staging only) + 2 placeholder KB articles (`Ops Hub — Getting Started`, `FreeScout → Ops Hub ticket intake runbook`). Embeddings null; ANN index deferred to Data Engineer embedding pipeline.

Notifying: QA Manager + Evals Lead — new KB domain content available for eval/test coverage. Data Engineer — 2 unembedded articles in `ops-hub` namespace ready for T-09 follow-up embedding pipeline.

### Frontend Engineer
**Minimal Sprint 1 scope.** No frontend tasks until FreeScout wired and ticket flow established (Sprint 2 / M2 scope). Monitor for T-10 completion — will be needed to verify FreeScout UI before sign-off.

### Data Engineer
**🟢 T-09 UPDATED (2026-06-20) — LangFuse Cloud provisioned (US region). No Coolify deploy needed.**
T-09 revised exit criteria: (1) LangFuse Cloud UI accessible at your provisioned URL ✅; (2) first trace logged from LiteLLM after T-08 completes. Wire DSN env vars (`LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`) into LiteLLM config — already set in Coolify. Monitor monthly event count against 50K free-tier ceiling (ADR-0002 §2 trigger at 70% = 35K events). Data residency: LangFuse Cloud US region approved for Sprint 1 + Sprint 2 (FQ-05, 2026-06-20). Revisit before M3 when real tenant tickets flow.

**🟡 T-14 (2026-06-22) — UptimeRobot provisioning script authored (PR #73, pending merge).**
`scripts/provision-uptimerobot.sh` + `.github/workflows/provision-uptimerobot.yml` pushed and PR open. Monitors NOT yet created — dispatch requires PR #73 merged to main (workflow_dispatch not dispatchable from feature branches until the workflow exists on the default branch). Post-merge step: `gh workflow run provision-uptimerobot.yml --repo admin-nutshell/ops-hub-00`. Verify by confirming 3× `"stat":"ok"` in the run log. Three monitors: ops-hub-app (staging), LiteLLM (staging), FreeScout (staging); check interval: 5 min. Alert contacts intentionally empty — UptimeRobot requires a pre-created contact ID; email routing to mai@leelaecospa.com is a follow-up (create contact in UptimeRobot dashboard, update script or configure via UI). Prod monitors and TTS monitors deferred to post-M1.

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
