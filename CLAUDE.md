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
| LLM internal URL | `http://h12xz8887fxvbvjts2hac8if-032924269444:4000` | Docker network — use this, not sslip.io. **Suffix changes on every LiteLLM redeploy** — check `docker ps \| grep h12xz8887fxvbvjts2hac8if` after each deploy. |
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

**Sprint 10 — End-to-End Pipeline Monitoring + Eval Coverage Depth**
Window: August 6–20, 2026 (nominal)
Goal: Cash in Sprint 9's two loudest forward-threads. **Anchor (T-98):** build the synthetic-ticket **downstream** E2E monitor flagged-but-deferred since Sprint 6 — inject a synthetic ticket (dedicated test tenant, self-cleaning, never the real support mailbox) and assert the full downstream chain (Inngest → triage → respond → Supabase `state='responded'` → LangFuse trace); T-97 covered the internal-auth *hop*, this covers the downstream stages. **Parallel (T-99/T-100):** deepen eval coverage now the live gate exists — grow each product eval past ADR-0007 §5.4's small-N caveat, and vet additional `triage`/`respond` aliases through the gate the way T-96 did for `kb_learn`. Any credential/eval-key re-scope Track B needs is gated by a fresh Security Lead review first (Sprint 9 §5.1 norm). No milestone targeted — see WORK.md's "Milestone numbering note."

*(Sprint 9 — Real LLM-Rubric Eval Gate (build) + Monitoring Hardening — COMPLETE 2026-07-12. No milestone (capability-building). The ADR-0007 real eval gate is BUILT and LIVE: `live-eval-gate` is a required, calibration-guarded, baseline-relative merge-blocking check (T-89–T-95) — CLAUDE.md's "Eval-gated" constraint is now literally true. T-96 widened `kb_learn`'s allowlist; T-97 closed the FQ-69 internal-auth blind spot. FQ-70 prod-fallback incident found + fixed mid-sprint. Retro: `docs/retros/sprint-9.md`.)*
*(Sprint 8 — Drift Reconciliation + Eval Coverage — COMPLETE 2026-07-09. No milestone (capability/hardening). T-83 closed the `pg_policy` drift class proactively; FQ-69 (70% of prod tickets stuck 3.6 days on a rejected master key) found mid-sprint and fully resolved. Retro: `docs/retros/sprint-8.md`.)*
*(Sprint 7 — Ops Dashboard Settings / Write Surface — COMPLETE 2026-07-09. No milestone (capability-building). Retro: `docs/retros/sprint-7.md`.)*
*(Sprint 6 — Ops Dashboard MVP + Reliability Debt Closure — COMPLETE 2026-07-08. No milestone (capability-building). Retro: `docs/retros/sprint-6.md`.)*
*(Sprint 5 — Reliability Hardening + TTS Production Go-Live — COMPLETE 2026-07-03/04. M6 "TTS Live in Production" declared. Retro: `docs/retros/sprint-5.md`.)*

**Live status:** `WORK.md`
**Recent decisions:** `DECISIONS.md`
**Founder queue:** `FOUNDER_QUEUE.md`

Critical path: T-98 (synthetic-ticket downstream E2E monitor — the sprint anchor; Production Manager builds the scheduled workflow, QA designs the end-to-end assertion) runs independently of Track B. T-99 (grow eval N past ADR §5.4's small-N caveat) and T-100 (vet additional `triage`/`respond` aliases through the live gate) are parallel Evals-Lead coverage work riding the now-live gate (ADR §8); T-100 needs a Production-Manager eval-key re-scope + fresh Security Lead review only if a candidate alias is outside `LITELLM_EVAL_KEY`'s current scope (the T-96 wall). Deliberately small — anchor + one parallel eval track — holding the overcommit discipline of Sprints 6–9.

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
