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

**Sprint 11 — Durable Internal-URL Fix (ADR) + Eval Coverage Depth**
Window: August 20 – September 3, 2026 (nominal)
Goal: Turn Sprint 10's loudest carried thread forward the disciplined way. **Anchor (T-101/T-102):** the `LITELLM_URL` redeploy-orphan class has recurred 3× (T-71, FQ-69-URL, FQ-76) — re-aligning by hand a fourth time is not the answer. **T-101:** author an ADR for the durable fix (stable internal address vs. post-redeploy re-sync hook vs. app-side service-name resolution; provider-neutral / survives Project #2), **build deferred to Sprint 12** (ADR-then-build precedent). **T-102:** ship the cheap in-sprint mitigation FQ-76 named — a 2–3-consecutive-fail monitor threshold so transient blips stop crying wolf while sustained breaks still page (proven on its failure path per the NEW Sprint 10 §5.1 norm). **Parallel (T-103):** continue the eval-depth arc — grow each product eval from N=9 toward ADR-0007 §5.4's ≥20/eval target. No milestone targeted — see WORK.md's "Milestone numbering note."

*(Sprint 10 — End-to-End Pipeline Monitoring + Eval Coverage Depth — COMPLETE 2026-07-12. No milestone (capability/hardening). T-98 synthetic-ticket **downstream** E2E monitor is BUILT and LIVE (scheduled 6-hourly, first genuine `mode=live` run green through `state='responded'` + LangFuse trace) — its go-live was defense-in-depth working as designed: five verification layers (harness safety classifier → Security Lead design review → SC1–SC10 negative tests → final sign-off BC1 → mid-fix re-verify) each caught a distinct real problem pre-prod. FQ-76 (live prod `LITELLM_URL` stale after FQ-70's redeploy — the T-71 URL class, 3rd instance) caught by the T-97 monitor **before any customer ticket was affected** and fixed same day. T-99 grew each product eval N=4→N=9; T-100 vetted a 2nd model into both `triage`+`respond` allowlists. Retro: `docs/retros/sprint-10.md`.)*
*(Sprint 9 — Real LLM-Rubric Eval Gate (build) + Monitoring Hardening — COMPLETE 2026-07-12. No milestone (capability-building). The ADR-0007 real eval gate is BUILT and LIVE: `live-eval-gate` is a required, calibration-guarded, baseline-relative merge-blocking check (T-89–T-95) — CLAUDE.md's "Eval-gated" constraint is now literally true. T-96 widened `kb_learn`'s allowlist; T-97 closed the FQ-69 internal-auth blind spot. FQ-70 prod-fallback incident found + fixed mid-sprint. Retro: `docs/retros/sprint-9.md`.)*
*(Sprint 8 — Drift Reconciliation + Eval Coverage — COMPLETE 2026-07-09. No milestone (capability/hardening). T-83 closed the `pg_policy` drift class proactively; FQ-69 (70% of prod tickets stuck 3.6 days on a rejected master key) found mid-sprint and fully resolved. Retro: `docs/retros/sprint-8.md`.)*
*(Sprint 7 — Ops Dashboard Settings / Write Surface — COMPLETE 2026-07-09. No milestone (capability-building). Retro: `docs/retros/sprint-7.md`.)*
*(Sprint 6 — Ops Dashboard MVP + Reliability Debt Closure — COMPLETE 2026-07-08. No milestone (capability-building). Retro: `docs/retros/sprint-6.md`.)*
*(Sprint 5 — Reliability Hardening + TTS Production Go-Live — COMPLETE 2026-07-03/04. M6 "TTS Live in Production" declared. Retro: `docs/retros/sprint-5.md`.)*

**Live status:** `WORK.md`
**Recent decisions:** `DECISIONS.md`
**Founder queue:** `FOUNDER_QUEUE.md`

Critical path: Track A is the anchor — T-101 (ADR for the durable `LITELLM_URL` redeploy-orphan fix; Tech Lead, build deferred to Sprint 12) and T-102 (cheap in-sprint 2–3-consecutive-fail monitor threshold; Production Manager, proven on its failure path per the NEW Sprint 10 §5.1 norm) run independently of each other and of Track B. T-103 (grow each product eval from N=9 toward ADR §5.4's ≥20 target) is parallel Evals-Lead coverage work riding the now-live gate (ADR §8). Deliberately small — anchor + one parallel eval track — holding the overcommit discipline of Sprints 6–10. Do NOT fold the provider-credential-divergence carry into T-101: FQ-76 is the URL-suffix class (T-71), a distinct failure from the master-key-rejection class, and that carry's trigger has not fired.

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
