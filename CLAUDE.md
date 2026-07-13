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

**Sprint 13 — Eval-Gate Grader Robustness (ADR) + Staging Internal-URL Re-Pin**
Window: September 17 – October 1, 2026 (nominal)
Goal: Fix the systemic eval-gate brittleness Sprint 12's own governance episode (FQ-77) exposed, and close the one honest residual T-104 left behind. **Anchor (T-106):** author an ADR for durable **eval-gate grader robustness** — the `live-eval-gate`'s hard 0.8 threshold can override the grader's own `pass:true` on genuinely-borderline cases (per-run llm-rubric variance; the Evals Lead's second FQ-77 finding, banked as systemic, not the case-(g)-specific fix). Choose among multi-sample grading vs. margin-based grading vs. a grader-`pass`-with-threshold-override hybrid (cost/latency-per-gate-run, calibration, and provider-neutrality are the trade-offs), **build deferred to Sprint 14** (ADR-then-build precedent). **CRITICAL — this ADR's eventual BUILD modifies the SHARED merge-blocking safety net (the eval-gate grading mechanism itself); per the NEW Sprint 12 §5.1 norm its merge will require the user's OWN direct, in-the-moment authorization — standing self-merge does NOT cover it. The ADR itself is docs-only and self-mergeable.** **Parallel (T-107):** re-pin ops-hub-staging's own `LITELLM_URL` to the already-proven `litellm-staging` network alias (T-104 killed the URL-suffix class on prod but staging still carries the exposure; cheap, same proven mechanism). **Classifier-boundary caveat:** this touches *staging* Coolify config — confirm with the user at pickup whether staging-only counts as "production infrastructure" for classifier purposes (§5.1 category b), or is materially lower-stakes as non-customer-facing; **plan to pause and ask, do not assume standing auth.** No milestone targeted — see WORK.md's "Milestone numbering note."

*(Sprint 12 — Durable Internal-URL Fix (BUILD) + Triage Injection Hardening — COMPLETE 2026-07-13. No milestone (capability/hardening). Executed the deferred half of Sprint 11's ADR-then-build precedent. **T-104** BUILT the durable `LITELLM_URL` fix LIVE in prod — the staging-spike-first discipline paid off: a persistent Coolify `custom_network_aliases` (Option 1) was proven surviving a real redeploy on the free staging canary (mechanism verified against Coolify's own source, not guessed), then applied to prod, `LITELLM_URL` re-pinned to a stable `http://litellm-prod:4000`, both break-glass workflows' wrong verify endpoints corrected — **Option 2 never needed**. Clean but not detour-free: a mid-deploy 401 that wore FQ-69's master-key-rejection signature was run down READ-ONLY and ruled out (stale *test* credential, not the class re-firing, not an incident), and the Coolify dup-row footgun was confirmed to fire from a *single* API call. **T-105** hardened triage against prompt-injection (untrusted-input clause + re-admitted body-injection eval case, proven `[new/passing]` ×5, drop-don't-weaken intact). **T-105-sub** REFUTED T-103's n=1 respond-completeness finding via a careful n=5 re-run (reading each grader's reasons: completeness never failed; the docks were all anti-fabrication) — no non-defect hardened. **The sprint's teaching moment was FQ-77:** T-105's proven fix needed a one-line calibration to the SHARED live-eval-gate safety net, and the governance classifier correctly refused to let any agent self-approve it — blocking BOTH a coordinator relay AND the coordinator's own direct merge attempt, until the user's own fresh words landed it (banked as the NEW §5.1 norm: self-merge authorization crosses neither a shared-safety-net boundary nor a coordinator-relay boundary). Honest residual: ops-hub-staging's own `LITELLM_URL` still un-repinned (out of T-104's prod-only scope). Retro: `docs/retros/sprint-12.md`.)*
*(Sprint 11 — Durable Internal-URL Fix (ADR) + Eval Coverage Depth — COMPLETE 2026-07-12. No milestone (capability/hardening). Discipline over reflex: the `LITELLM_URL` redeploy-orphan class came due for a 4th manual re-align and the team refused it — **T-101** authored ADR-0008 instead (durable fix design of record; **Option 1** persistent Coolify network alias, spike-contingent, **Option 2** re-sync hook pre-committed fallback; independent Tech Lead+Production Manager review; **build deferred to Sprint 12**), also surfacing a latent bug (both break-glass workflows verify the wrong endpoint). **T-102** shipped the cheap in-sprint mitigation — a 3-consecutive-fail threshold on the internal-auth monitor, proven on its FAILURE path by 4 real dispatches (the NEW Sprint 10 §5.1 norm's first application). **T-103** grew each product eval N=9→15/13/14 (27→42 baselined) and — the quiet dividend — the coverage growth surfaced a REAL triage body-injection vulnerability (dropped, not weakened; committed to Sprint 12). One process failure: a shared-main-tree HEAD collision between two concurrent agents (recovered clean, banked as a standing worktree-isolation norm). Honest ledger: URL class designed-not-fixed, break-glass endpoints still wrong, two prompt gaps open. Retro: `docs/retros/sprint-11.md`.)*
*(Sprint 10 — End-to-End Pipeline Monitoring + Eval Coverage Depth — COMPLETE 2026-07-12. No milestone (capability/hardening). T-98 synthetic-ticket **downstream** E2E monitor is BUILT and LIVE (scheduled 6-hourly, first genuine `mode=live` run green through `state='responded'` + LangFuse trace) — its go-live was defense-in-depth working as designed: five verification layers (harness safety classifier → Security Lead design review → SC1–SC10 negative tests → final sign-off BC1 → mid-fix re-verify) each caught a distinct real problem pre-prod. FQ-76 (live prod `LITELLM_URL` stale after FQ-70's redeploy — the T-71 URL class, 3rd instance) caught by the T-97 monitor **before any customer ticket was affected** and fixed same day. T-99 grew each product eval N=4→N=9; T-100 vetted a 2nd model into both `triage`+`respond` allowlists. Retro: `docs/retros/sprint-10.md`.)*
*(Sprint 9 — Real LLM-Rubric Eval Gate (build) + Monitoring Hardening — COMPLETE 2026-07-12. No milestone (capability-building). The ADR-0007 real eval gate is BUILT and LIVE: `live-eval-gate` is a required, calibration-guarded, baseline-relative merge-blocking check (T-89–T-95) — CLAUDE.md's "Eval-gated" constraint is now literally true. T-96 widened `kb_learn`'s allowlist; T-97 closed the FQ-69 internal-auth blind spot. FQ-70 prod-fallback incident found + fixed mid-sprint. Retro: `docs/retros/sprint-9.md`.)*
*(Sprint 8 — Drift Reconciliation + Eval Coverage — COMPLETE 2026-07-09. No milestone (capability/hardening). T-83 closed the `pg_policy` drift class proactively; FQ-69 (70% of prod tickets stuck 3.6 days on a rejected master key) found mid-sprint and fully resolved. Retro: `docs/retros/sprint-8.md`.)*
*(Sprint 7 — Ops Dashboard Settings / Write Surface — COMPLETE 2026-07-09. No milestone (capability-building). Retro: `docs/retros/sprint-7.md`.)*
*(Sprint 6 — Ops Dashboard MVP + Reliability Debt Closure — COMPLETE 2026-07-08. No milestone (capability-building). Retro: `docs/retros/sprint-6.md`.)*
*(Sprint 5 — Reliability Hardening + TTS Production Go-Live — COMPLETE 2026-07-03/04. M6 "TTS Live in Production" declared. Retro: `docs/retros/sprint-5.md`.)*

**Live status:** `WORK.md`
**Recent decisions:** `DECISIONS.md`
**Founder queue:** `FOUNDER_QUEUE.md`

Critical path: Track A is the anchor — T-106 (ADR for durable eval-gate grader robustness; Evals Lead author + Tech Lead review) addresses FQ-77's systemic finding: the `live-eval-gate`'s hard 0.8 threshold can override the grader's own `pass:true` on borderline cases (per-run llm-rubric variance). Choose among multi-sample vs. margin-based vs. grader-`pass`-with-threshold-override grading; **build deferred to Sprint 14** (ADR-then-build precedent). The ADR is docs-only and self-mergeable, but its eventual BUILD modifies the SHARED merge-blocking safety net → its merge will need the user's OWN direct, in-the-moment authorization (NEW Sprint 12 §5.1 norm — standing self-merge does NOT cross a shared-safety-net boundary). T-107 (re-pin ops-hub-staging's `LITELLM_URL` to the proven `litellm-staging` alias; Production Manager) is the parallel track — cheap, same mechanism T-104 proved on prod; **classifier-boundary caveat:** it touches staging Coolify config, so confirm with the user at pickup whether staging-only counts as "production infrastructure" (§5.1 category b) and plan to pause-and-ask rather than assume standing auth. Deliberately small — anchor + one parallel track — holding the overcommit discipline of Sprints 6–12 (now seven straight). Do NOT fold the provider-credential-divergence carry into any URL work: it is the URL-suffix class (T-71) only, distinct from the master-key-rejection class, whose trigger has still not fired (T-104's mid-deploy 401 wore its signature but was ruled out read-only).

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
