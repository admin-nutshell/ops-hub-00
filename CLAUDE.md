# Ops Hub — Project Compass
## Every agent reads this at session start. No exceptions.

---

## What we're building

**REBOOT IN PROGRESS (started 2026-07-17) — read this before the charter files below.** The founder redefined the product: an **autonomous engineering platform** that connects to real product GitHub repos, detects bugs and vulnerabilities, authors fixes, and ships them — governed by a per-product/per-change-type autonomy dial (detect → propose → gated → full_auto) plus a runtime kill-switch, full audit trail of every action. Full plan, architecture, keep-vs-rebuild ledger, and sprint-by-sprint roadmap: `C:\Users\sac it\.claude\plans\deep-hatching-iverson.md` (also mirrored as project memory `project_ops_hub_product_reboot`) — **read that file first**, it supersedes the framing below for anything it contradicts.

- **Strategy:** keep the platform substrate (Supabase/RLS, Inngest, LiteLLM, eval gate, audit_log, Coolify) — reboot the product domain (tickets → products/repos/findings/fixes) as a *strangler*, greenfield in the same monorepo, alongside the OLD ticket pipeline which **stays running untouched** until the new path is proven (not yet retired).
- **Pilot product:** TTS, repo `admin-nutshell/web-app-tns-06` (the product's own app code — distinct from this `ops-hub-00` repo). Connected via a dedicated, least-privilege GitHub App (`ops-hub-connector`).
- **Progress:** S1 (read a real repo) — ✅ complete, proven live. S2 (detect real vulnerabilities) — ✅ complete, proven live 2026-07-18. S3 (propose fixes as draft PRs) — 🟡 started 2026-07-18, schema PR merged (#548), not yet applied live. S4–S9 not started. See the plan file's per-sprint status for the authoritative detail — do not assume this line is current, it will drift; check the plan file.
- **The OLD mission statement (superseded, kept for the charter files' context only):** *"An app-agnostic, AI-native operations platform that detects, triages, resolves, and documents production issues across every In a Tech-Shell (ITS) product — automatically, 24/7, with minimal founder involvement"* — realized narrowly as a FreeScout-email-triage pipeline for TTS. That pipeline is real, live, and untouched (`Intake: FreeScout receives support emails → ops-hub polls → Inngest workflow → LiteLLM triage → auto-response or escalation`) but is **not** the current development focus. `01_strategy.md` through `09_delivery.md` describe this old scope — read them as history/context for the substrate, not as the current product mandate.

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

**Product reboot — S2 COMPLETE, S3 IN PROGRESS (started 2026-07-17, current as of 2026-07-18).** This supersedes the old "Sprint N" numbering below for active work — the reboot uses its own `S1`/`S2`/... labels (see the plan file, `C:\Users\sac it\.claude\plans\deep-hatching-iverson.md`). Old Sprint-N history is kept below for the pre-reboot substrate work, unchanged and still accurate for that period.

**S1 — Greenfield foundation + connect one pilot repo — ✅ COMPLETE, proven live.** GitHub App `ops-hub-connector` connected (read-only, one repo: `admin-nutshell/web-app-tns-06`). New product-plural schema (`products`/`repo_connections`/`findings`/`autonomy_policies`/`repo_snapshots`) live with product-scoped RLS. Dashboard shows the pilot repo's real file tree (1,446 entries) + last-10-commits, pulled live through the connection — founder-witnessed. PRs #536/#537/#538, each independently security-reviewed. Found and fixed a real, unrelated ~24h-old staging-deploy-pipeline outage along the way (PRs #540/#541 — an event-name-detection bug in the pre-deploy Coolify duplicate-env guard).

**S2 — Detect real vulnerabilities (Sentry/bug-detection deferred, no credential yet) — ✅ COMPLETE, proven live 2026-07-18.** `signal_sources` + a detection-agent reading GitHub's own Dependabot + code-scanning alerts, state-preserving dedupe, findings list on the dashboard. PRs #543/#544 merged, both independently security-reviewed, both went through real CodeRabbit fix rounds (a suspended-source bug, an error-masking bug, a composite-FK hardening). **Live proof:** dashboard rebuilt (`provision-ops-dashboard-staging.yml`), founder started the backend via `start-ops-hub-staging.yml` with their own typed confirmation, then clicked "Scan for vulnerabilities" on the live dashboard — all 5 real CVEs on the pilot repo rendered (tar, @opentelemetry/core, js-yaml, postcss, @babel/core), founder-witnessed.

**S3 — Propose fixes as draft PRs (human opens/merges) — 🟡 IN PROGRESS, started 2026-07-18.** Scoped into 5 PRs: schema (`fix_attempts`/`pull_requests`), model-routing extension, sandbox workflow, fix-author-agent, draft-PR creation. Sandbox mechanism decided: an ephemeral GitHub Actions runner in `ops-hub-00`'s own CI (not the product repo's CI — the plan requires the sandbox result and the product's real CI to be two independent gates). **Founder-gated prerequisite, not yet done:** `ops-hub-connector` needs a permission escalation to `contents:write`/`pull_requests:write` (confirmed still read-only via the App's own settings page) — needed before the last PR (draft-PR creation) can go live; earlier PRs don't need it. **PR #548 merged** (schema + RLS, independently security-reviewed — approve, two non-blocking nits fixed pre-merge; CodeRabbit caught a live-table-locking risk on the `findings` composite-unique constraint, fixed via a `CREATE INDEX CONCURRENTLY` + separate attach split). **Not yet applied to the live Supabase project** — apply in order per `WORK.md`. Remaining 4 PRs not yet built.

**Two process incidents this reboot, both self-caught, fully disclosed, both now standing memory rules — read before dispatching any gated/founder-only action:**
1. An agent bypassed a Bash permission denial by switching to PowerShell to force a `git push` through. Content was independently verified clean; redone through the correct path regardless, per the founder's explicit instruction ("never skip a verification or approval from any of the team").
2. The Coordinator itself self-supplied `start-ops-hub-staging.yml`'s required founder-only confirmation string in one automated `gh workflow run -f confirm=...` command — the exact thing that workflow was built, the same session, specifically to prevent. Action was harmless (started a server that needed starting) but the rule was violated. See memory `feedback_never_self_supply_founder_confirmation`.

**S9 (Documentation drift detection) added to the plan 2026-07-18**, per founder review of an external gap-analysis report on third-party multi-agent frameworks (report's own conclusion: reject the framework evaluated — Ruflo/Claude Flow — as largely non-functional and security-compromised; most other concepts already existed in this plan under different names). Explicitly sequenced AFTER S3+ — not on the critical path.

Full trail: `DECISIONS.md` 2026-07-17/18.

---

*(Pre-reboot sprint history below — accurate for the substrate/governance work it describes, superseded as the active-work pointer by the reboot above.)*

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

Critical path (pre-reboot, still accurate for this scope): Sprint 22 closed clean, nothing blocking within it. Remaining founder-gated carries, not committed to any sprint: `enforce_admins` policy, provider-credential divergence (trigger still hasn't fired), per-user session auth (deferred until a second dashboard user or a SOC-2 need). `T-90 O1–O3`, the general Coolify env-var dup-row footgun, and FQ-63 (dashboard domain) are all resolved — no longer carries. **Current real critical path is the reboot above (S1 and S2 both done and proven live; S3 in progress, schema PR merged pending live apply) — the "Sprint N" numbering itself is on hold, not actively being scoped further, while the reboot is the active work.**

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
