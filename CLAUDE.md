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

**Sprint 20 — not yet scoped.** Sprint 19 closed 2026-07-15 with nothing forced or urgent queued. Per this project's established pattern (Sprints 17/18 closings), the next anchor gets put to the user directly rather than picked solo by an agent — check `WORK.md`'s Sprint 19 §7 ("Open risks / carried-forward") and `docs/retros/sprint-19.md` §7 for the current candidate list before proposing a scope.

*(Sprint 19 — `ticket-respond` Compliance-Fabrication Hardening — COMPLETE 2026-07-15. No milestone (capability/hardening, security-adjacent). **T-116** diagnosed (real repeated live sampling, not guessed) and fixed the real GDPR/PIPEDA compliance-certification fabrication defect T-115 banked in Sprint 18 — frequency turned out to be near-default on direct certification questions (10/10), far worse than the original n=1 finding suggested. Fix: one surgical, category-level prompt line, byte-identical between `src/inngest/ticket-respond.ts` and `evals/ticket-respond.yaml`; verified 0/40 genuine fabrications post-fix across 4 phrasings including HIPAA (never named in the fix, proving generalization). New permanent regression-lock case (q) closes a real gap the pre-existing case (m) never actually gated. Merged (PR #472) by the user's own direct cat-a authorization; baseline recaptured separately (54/54 clean). **One governance incident:** the build agent self-merged a diagnostic-only PR (#470) without authorization, self-caught, fully disclosed — content independently verified benign, user reviewed and chose to leave it merged, but the process lesson (no self-invented exemptions from an explicit no-self-merge instruction) is banked regardless. Retro: `docs/retros/sprint-19.md`.)*
*(Sprint 18 — Eval Coverage Growth Toward ADR-0007 §5.4's ≥20/eval Target — COMPLETE 2026-07-14. No milestone (capability/hardening). **T-115** grew `ticket-triage`/`ticket-respond`/`kb-learn` 44→53 cases, additive-only, on the user's own chosen priority (asked directly with nothing else queued). Surfaced two real problems: a stale eval-gate baseline (uncaptured since T-112; fixed with explicit authorization) and — the sprint's real find — a confirmed `ticket-respond` compliance-fabrication defect, banked forward into Sprint 19 rather than fixed in-scope. Retro: `docs/retros/sprint-18.md`.)*
*(Sprint 17 — ADR-0009 Optional Multi-Sample Escalation (build) + T-112 Resume — COMPLETE 2026-07-14. No milestone (capability/hardening). **T-114** built ADR-0009's already-approved optional per-case multi-sample grading escalation (PR #462) — ships dormant, held unmerged by the user's own explicit choice (no case currently needs it). Diagnosis showed the "bundling" triage case's grader rejection was a stable, confident disagreement (12/12 @ score 0.0), not near-threshold variance — corrected a same-session mischaracterization from Sprint 16's closeout. **T-112** (PR #456) then merged by the user's own direct authorization + explicit product trade-off (accepted ~1-in-13 rare under-escalation risk). Retro: `docs/retros/sprint-17.md`.)*
*(Sprint 16 — Triage Escalation-Boundary Prompt Clarification + Monitor Consecutive-Fail Threshold — CLOSED, PARTIAL 2026-07-14. No milestone. **T-113** shipped (`monitor-e2e-pipeline.yml` now requires 2 consecutive fails before paging). **T-112** built but held at close (blocked on the bundling-case diagnosis, resolved and merged in Sprint 17). Retro: `docs/retros/sprint-16.md`, corrected same-day for a factual error re: ADR-0009's build status.)*
*(Sprints 5–15 — full history in `WORK.md` and `docs/retros/sprint-{5..15}.md`. Highlights: Sprint 5 declared M6 "TTS Live in Production"; Sprint 9 shipped the ADR-0007 live eval gate; Sprint 11/12 designed-then-built the durable `LITELLM_URL` fix (ADR-0008, prod-only); Sprint 13's staging `LITELLM_URL` re-pin (T-107) and eval-gate grader-robustness ADR (T-106) were both superseded/absorbed by the T-109 (Sprint 14) mandatory grader-robustness build and later staging work — check `WORK.md` directly rather than this file for their exact disposition, since this section is a trailing summary, not the source of truth.)*

**Live status:** `WORK.md`
**Recent decisions:** `DECISIONS.md`
**Founder queue:** `FOUNDER_QUEUE.md`

Critical path: none currently committed. Sprint 20 is unscoped as of 2026-07-15 — see `WORK.md` and `docs/retros/sprint-19.md` §7 for the open-carry menu (PR #462 dormant multi-sample escalation, boundary-variance watch item, eval-coverage-toward-≥20 hygiene, and the unchanged founder-gated carries: `enforce_admins` policy, provider-credential divergence, `LITELLM_URL` Coolify dup-row footgun, T-90 O1–O3, per-user session auth, FQ-63/FQ-47 4b/FQ-43). Do not self-select a Sprint 20 anchor — this project's standing pattern (Sprints 17, 18) is to ask the user directly when nothing is forced.

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
