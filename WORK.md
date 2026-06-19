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
| 2 | Coolify projects provisioned: `ops-hub-staging` and `ops-hub-prod` | **Founder** | ⏳ Pending |
| 3 | Supabase project for Ops Hub (pgvector enabled) | **Founder** | ⏳ Pending |
| 4 | Inngest + LangFuse + LiteLLM running in staging + prod | Prod Manager + Data Eng | 🔒 Blocked on #2 |
| 5 | All 11 agent specs loaded; agents respond when invoked | PM | ✅ Done (`.claude/agents/` committed 2026-06-18) |
| 6 | FreeScout deployed and connected as ticket intake | Production Manager | 🔒 Blocked on #2 |
| 7 | CI/CD pipeline active: lint + tests + eval gate + staging auto-deploy | Tech Lead | 🔒 Blocked on #2, #3 |
| 8 | At least 1 eval case per agent; eval gate enforced on PRs | Evals Lead | 🔒 Blocked on #7 |
| 9 | Sentry + UptimeRobot wired for Ops Hub and TTS | Production Manager | 🔒 Blocked on #2 |
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

### Track B — Infrastructure Provisioning (🔒 blocked on founder: Coolify + Supabase)

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-07: Deploy Inngest (connect to Inngest Cloud) in staging + prod | Production Manager | Founder: Coolify provisioned | Inngest dashboard shows both envs; test event processed | Jul 2 |
| T-08: Deploy LiteLLM (self-hosted) to staging + prod on Coolify | Production Manager | Founder: Coolify provisioned | LiteLLM running; test API call returns model response | Jul 2 |
| T-09: Deploy LangFuse to staging + prod on Coolify | Data Engineer | Founder: Coolify provisioned | LangFuse UI reachable; first trace logged successfully | Jul 2 |
| T-10: Deploy FreeScout to staging on Coolify | Production Manager | Founder: Coolify provisioned | FreeScout accessible at staging URL; test ticket submittable | Jul 2 |
| T-11: Apply initial Supabase schema migrations | Tech Lead | Founder: Supabase provisioned; T-03 complete | All tables created; RLS policies applied; migration files in `supabase/migrations/` | Jul 2 |
| T-12: Set up Supabase Vault — store all LLM API keys and service secrets | Security Lead | Founder: Supabase provisioned | All secrets in Vault; zero keys in env files, git, or Coolify env vars | Jul 2 |
| T-13: Wire Sentry for Ops Hub (staging + prod) | Production Manager | Founder: Coolify provisioned | First test error captured in Sentry | Jul 2 |
| T-14: Wire UptimeRobot monitors for Ops Hub staging + prod | Production Manager | Founder: Coolify provisioned | Monitors active; test alert fires and clears | Jul 2 |

### Track C — CI/CD & Eval Gate (starts after T-05 + infra available)

| Task | Owner | Depends on | Exit criteria | Due |
|---|---|---|---|---|
| T-15: Implement GitHub Actions CI (lint + tests + staging auto-deploy on merge to main) | Tech Lead | T-05; Founder: Coolify provisioned | PR triggers pipeline; lint + test pass; staging deploys on merge | Jul 4 |
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
| T-07 through T-15, T-18, T-19, T-20 | Founder: Coolify provisioning not yet done | Sprint 1 Track B + C slip; M1 delivery pushed toward end of July | PM |
| T-11, T-12, T-18 | Founder: Supabase project not yet created | Schema migrations, Vault setup, and RLS tests cannot run | PM |

Escalated to `FOUNDER_QUEUE.md` — two blocking questions posted (FQ-01, FQ-02).

---

## Per-agent status

### PM
Sprint 1 planned (2026-06-18). Monitoring M1 checklist. Next: Friday July 4 sprint retro to `docs/retros/sprint-1.md`.

### Tech Lead
**Track A complete (2026-06-18), ahead of the Jun 27 due date.** All four artifacts authored and committed on branch `feature/sprint1-track-a-architecture`:
- T-01 → `docs/adr/0001-environment-topology.md` (incl. VPS sizing review; 70% util → founder resize escalation). Status Proposed — needs Prod Mgr deployability sign-off.
- T-02 → `docs/adr/0002-tool-stack.md` (7 tools, per-tool fallback triggers).
- T-03 → `docs/engineering/database-schema.md` + `supabase/migrations/20260618120000_initial_schema.sql` + `20260618120100_enable_rls_policies.sql`. **RLS is fail-closed; enforcement model split between `ops_hub_app` role (agent paths, GUC) and JWT (portal); `service_role` reserved for migrations/platform.** → **Security Lead: please review §6 flags in the schema doc — the service_role bypass model is the headline item; T-18 must test isolation via the agent (`ops_hub_app`) path, not just Auth.**
- T-05 → `docs/engineering/ci-cd-pipeline.md` rewritten implementation-ready. Toolchain decision: Node 20 + TS (pnpm) primary, Python 3.12 secondary. → **T-15 (GitHub Actions) can proceed against this spec without coming back to me.**

**Reconciliations made (flagged for owners, non-blocking M1):** `feature-flags.md` schema + helper use `project` text → must move to `project_id` uuid FK (now that `projects` table exists); `database-migrations.md` should note flat platform-migration layout vs. the future per-project subdirs.

**Next (blocked on founder infra):** T-11 (apply migrations once Supabase provisioned) + T-15 (GitHub Actions impl once Coolify provisioned). Awaiting T-04 draft from Solutions Architect to review for TTS coupling (T-05 in my brief / T-04 in this board).

No FOUNDER_QUEUE items raised — none of these decisions are founder-owned per RACI. The VPS-resize spend decision is correctly deferred behind the 70% monitoring trigger (ADR-0001 §6).

### QA Manager
**Active.** T-06 (test plan) starts immediately. T-19 (integration test) blocked until FreeScout + Supabase staging are live.

### Production Manager
**Standing by on Track B.** T-07, T-08, T-10, T-13, T-14 all blocked on Coolify. Prepare Coolify app configs and deploy checklists while waiting. Monitor `FOUNDER_QUEUE.md` for provisioning confirmation.

### Security Lead
**Active.** Review T-03 schema when Tech Lead publishes (target Jun 27). T-12 + T-18 blocked on Supabase. Confirm secrets hygiene plan for GitHub Actions env vars now.

### Evals Lead
**Active.** T-16 (11 eval cases) starts immediately — no infra dependency. T-17 (CI wiring) blocked on T-15.

### Knowledge Lead
**Standing by on Track D.** T-20 blocked until Supabase provisioned. Draft KB category taxonomy in the meantime.

### Frontend Engineer
**Minimal Sprint 1 scope.** No frontend tasks until FreeScout wired and ticket flow established (Sprint 2 / M2 scope). Monitor for T-10 completion — will be needed to verify FreeScout UI before sign-off.

### Data Engineer
**Waiting on Coolify.** T-09 (LangFuse deploy) blocked. Prepare LangFuse config (org keys, DSN, project structure) while waiting.

### Solutions Architect
**Active.** T-04 (Project Context schema for TTS) starts immediately. DNC onboarding checklist prep begins once T-04 approved by Tech Lead.

---

## Risks under consideration

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Coolify/Supabase provisioning delayed past Jun 27 | High | All infra tasks slip; M1 delivery drifts toward end of July (still within target, but loses buffer). Escalated to FOUNDER_QUEUE. | PM |
| VPS resource contention (Inngest + LiteLLM + LangFuse + FreeScout on one VPS) | Medium | Tech Lead sizing review in ADR-0001; flag if VPS upgrade needed. Founder approval required for any paid infra change. | Tech Lead |
| Repo naming mismatch vs. charter | Low | Charter says `admin-nutshell/ops-hub`; actual is `inatechshell/ops-hub-00`. Clarification posted to FOUNDER_QUEUE (FQ-03). | PM |

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
