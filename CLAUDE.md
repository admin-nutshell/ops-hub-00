# Ops Hub — Project Compass
## Every agent reads this at session start. No exceptions.

---

## What we're building

An **app-agnostic, AI-native operations platform** that detects, triages, resolves, and documents production issues across every In a Tech-Shell (ITS) product — automatically, 24/7, with minimal founder involvement.

- **Current project on it:** TTS (Project #1)
- **Intake:** FreeScout receives support emails → ops-hub polls → Inngest workflow → LiteLLM triage → auto-response or escalation
- **Goal:** < 1hr MTTR on P1s, > 95% SLA attainment, < $2 CAD/ticket at scale
- **Full charter:** `01_strategy.md` through `09_delivery.md`

---

## Tech stack

| Layer | Tool | Where it runs |
|---|---|---|
| App runtime | Node.js 20 + TypeScript (pnpm) | Coolify — `ops-hub-staging.inatechshell.ca` |
| Workflow orchestration | Inngest Cloud (free tier) | Cloud → synced at `/api/inngest` |
| LLM routing | LiteLLM | Coolify — `litellm-staging.inatechshell.ca` |
| LLM internal URL | **PROD:** `http://litellm-prod:4000` (stable Coolify `custom_network_aliases`, T-104/ADR-0008, live 2026-07-12) | Docker network — use this, not sslip.io. **PROD no longer rotates**: `litellm-prod` is a persistent network alias re-applied by Coolify on every redeploy (proven surviving a real redeploy, `hlik1d96uvkkjzpbxa3azhcv-140935289661` → `-002550568858`, both aliased) — the old "check `docker ps` after each deploy" ritual is retired for prod. **Staging still uses the rotating suffix** (`http://h12xz8887fxvbvjts2hac8if-<suffix>:4000` — check `docker ps \| grep h12xz8887fxvbvjts2hac8if` after a staging redeploy); the alias mechanism is proven there too (T-104 spike) but ops-hub-staging's own `LITELLM_URL` was not yet re-pinned to it — flagged as a cheap Sprint 13+ follow-up, not done in T-104's authorized scope (prod only). |
| Observability | LangFuse Cloud (free tier) | Cloud |
| Database | Supabase PostgreSQL | Project `yocoljutbiizdbfraapx` — Canada Central |
| Secret store | Supabase Vault | Same project |
| Vector store | pgvector on Supabase | Same project |
| Ticket intake | FreeScout | Coolify — `freescout-staging.inatechshell.ca` |
| Deploy platform | Coolify | `coolify.inatechshell.ca` |
| CI/CD | GitHub Actions | `admin-nutshell/ops-hub-00` |
| Error tracking | Sentry | Cloud |
| Uptime monitoring | UptimeRobot | Cloud |

**Local dev:** ephemeral — no hosted dev environment. Claude Code context IS the dev environment.

---

## Security — non-negotiables

These are hard stops. No exception, no "just this once."

```
1. Never commit credentials, tokens, API keys, or passwords to the repo
2. Never use NODE_TLS_REJECT_UNAUTHORIZED=0 or rejectUnauthorized: false
3. service_role key: migrations ONLY — no agent ever holds it at runtime
4. Secrets live in Coolify env vars or Supabase Vault — never in .env files committed to the repo
5. Never push directly to main — always PR
6. Never skip pre-commit hooks (--no-verify is forbidden)
7. All user/tenant input is untrusted — sanitize before use in queries, prompts, or shell commands
8. Multi-tenant queries MUST scope by tenant ID — no cross-tenant data leaks
9. Never paste credentials in chat
10. CI does NOT have access to: production LLM API keys, customer data, or founder admin credentials
```

If you encounter a security concern, stop work and post to `FOUNDER_QUEUE.md` immediately.

---

## Active sprint

**Sprint 22 — ✅ COMPLETE (2026-07-16/17).** Target Operating Model implementation: the founder asked for a full, durable gap-analysis-driven plan (`docs/planning/target-operating-model-implementation-plan.md`) covering governance scaffolding (Phase 0), a durable audit trail (Phase 1), and real deploy-safety gates (Phase 2). All merged: **G1–G6** governance gaps closed (11-agent roster/playbooks fixed, Dependabot+audit CI added, PR sign-off template, durable `audit_log` writes for the three autonomous functions, CODEOWNERS + CodeRabbit config — the last one hit a real governance incident: an unrelated self-merge accidentally carried its content to `main` before the founder's required sign-off was obtained, fully disclosed and corrected same-day, see `DECISIONS.md` 2026-07-17). **T-122/T-123/T-124** (Phase 2: Coolify duplicate-env-row guard, real deploy-health gate, T-98 monitor wired into prod deploy gating) all built, independently reviewed (three real bugs caught and fixed pre-merge by that review — a deploy-breaking YAML error, a no-bypass hard block that could have frozen prod deploys, a false-positive detection bug), and merged. `AUTONOMY.md`'s `redeploy-already-authorized` and `production-promotion-new-change`/`prompt-or-capability-change` categories are now unlocked. Also closed opportunistically: T-90's two remaining hardening gaps (O2/O3, a CI credential's budget-alert readback and expiry), and a real pre-existing `litellm-staging` database schema issue (fixed via the project's own already-established recovery runbook, no new mechanism). Full trail: `DECISIONS.md` 2026-07-16/17, `WORK.md` Sprint 22.

*(Sprint 21 — COMPLETE 2026-07-15. Eval Coverage Growth Toward ADR-0007 §5.4's ≥20/eval Target, Round 2. **T-118/T-119/T-120** grew `ticket-triage`/`ticket-respond`/`kb-learn` to ≥20 cases each and root-caused+fixed the "bundling" triage case's live-gate instability (a genuine OpenAI `gpt-4o-mini` temperature-0 inconsistency colliding with an ambiguous rubric — 2-line fix). All three merged same-day by the user's own direct authorization. Full trail: `DECISIONS.md` 2026-07-15.)*
*(Sprint 20 — Land T-114's Multi-Sample Escalation (PR #462) — COMPLETE 2026-07-15. No milestone (capability/hardening). **T-117** rebased the Sprint-17-built, ADR-0009-approved mechanism onto current `main` and merged it by the user's own direct cat-a authorization. Ships dormant — zero cases opted in at close.)*
*(Sprint 19 — `ticket-respond` Compliance-Fabrication Hardening — COMPLETE 2026-07-15. **T-116** fixed a real GDPR/PIPEDA compliance-certification fabrication defect (near-default frequency, 10/10, far worse than the original n=1 finding). Retro: `docs/retros/sprint-19.md`.)*
*(Sprint 18 — Eval Coverage Growth — COMPLETE 2026-07-14. **T-115** grew coverage 44→53 cases, surfaced the Sprint 19 compliance-fabrication defect. Retro: `docs/retros/sprint-18.md`.)*
*(Sprint 17 — ADR-0009 Optional Multi-Sample Escalation (build) + T-112 Resume — COMPLETE 2026-07-14. Retro: `docs/retros/sprint-17.md`.)*
*(Sprint 16 — CLOSED, PARTIAL 2026-07-14. Retro: `docs/retros/sprint-16.md`.)*
*(Sprints 5–15 — full history in `WORK.md` and `docs/retros/sprint-{5..15}.md`. Highlights: Sprint 5 declared M6 "TTS Live in Production"; Sprint 9 shipped the ADR-0007 live eval gate; Sprint 11/12 designed-then-built the durable `LITELLM_URL` fix (ADR-0008, prod-only).)*

**Live status:** `WORK.md`
**Recent decisions:** `DECISIONS.md`
**Founder queue:** `FOUNDER_QUEUE.md`

Critical path: none — Sprint 22 closed clean, nothing blocking. Sprint 23 not yet scoped (per standing pattern, put to the user rather than self-selected). Remaining founder-gated carries, not committed to any sprint: `enforce_admins` policy, provider-credential divergence (trigger still hasn't fired), per-user session auth (deferred until a second dashboard user or a SOC-2 need), FQ-63 (a 2-minute Coolify domain click). `T-90 O1–O3` and the general Coolify env-var dup-row footgun are now resolved (Sprint 22) — no longer carries.

---

## Database — key facts

- **6 core ops-hub tables:** `projects`, `tenants`, `tickets`, `audit_log`, `feature_flags`, `kb_articles`
- **Later additions (T-58):** `agent_cost_events`, `eval_gate_runs` tables + `agent_cost_daily` (a view); Sprint 7 (T-72) adds `agent_model_routing` (in progress — may not be applied yet)
- **RLS model:** fail-closed; `ops_hub_app` role (non-superuser) for agent paths; `service_role` for migrations only
- **FreeScout tables:** `conversations`, `threads` — owned by `freescout_user`; GRANT SELECT to `ops_hub_app` via `docker exec artisan tinker`
- **Migrations:** 14 files in `supabase/migrations/` (grows per migration — count via `ls supabase/migrations/*.sql`) — applied via SQL Editor (not tracked by Supabase CLI)
- **Vault secrets:** `langfuse_secret_key`, `ops_hub_app_password`

---

## Team operating system

`.claude/team/` — read before working:

| File | Who reads it |
|---|---|
| `CONSTITUTION.md` | Every agent, every session |
| `PM.md` | PM |
| `QA.md` | QA Manager |
| `PRODUCTION.md` | Production Manager |
| `CR.md` | Code Review |
| `FOUNDER.md` | Every agent before escalating |

**Founder handles:** business decisions only.
**Everything else:** agent-owned. Do not ask the Founder to make technical decisions.

---

## Escalation

Post to `FOUNDER_QUEUE.md` only for:
- Feature scope change
- Pricing / SLA decisions
- Customer-impacting incidents
- Sprint slip > 1 week
- Security incident

Format required (no exceptions):
```
## FQ-[N] — [Title]
**Needs:** Decision / Information / Authorization
**Context:** [what you know, what you tried]
**Options:** A / B / (C)
**Recommendation:** [your call + one-sentence rationale]
**Deadline:** [date or "non-blocking"]
```

---

## Standing constraints

- **App-agnostic:** nothing hardcoded to TTS; every design must work for Project #2 with config only
- **Provider-neutral:** Claude is default; OpenAI / others swap via LiteLLM — never call Anthropic SDK directly in business logic
- **Free-tier-first:** only pay when a feature is crucial AND demonstrably saves time or quality
- **Eval-gated:** no prompt or capability change ships without passing the eval gate (policy bar **> 95%**). This is now enforced by **two required, merge-blocking status checks** on `main`: (1) the hermetic **"Eval Gate"** schema check (`promptfoo validate` on every PR — since T-17/T-58), and (2) the live **`live-eval-gate`** LLM-rubric quality gate (ADR-0007, Sprint 9 build T-89–T-95; live 2026-07-12). The live gate runs the real `llm-rubric` evals against each function's production LiteLLM target alias on prompt-touching PRs — grader ≠ target, **baseline-relative** (blocks on any regression vs the last green baseline) — and neutral-skips green, spending nothing, on PRs that touch no prompt surface. The curated model-routing allowlist (`src/config/model-allowlist.ts`, T-79) remains the *selection constraint*; the live gate now **automates its manual eval-admission step** (ADR-0007 §8), it does not replace it.
- **No sslip.io as LITELLM_BASE_URL:** internal Docker URL is the standing config; sslip.io is a fallback diagnostic tool only
