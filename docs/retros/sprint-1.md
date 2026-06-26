# Sprint 1 Retrospective — Workspace + Foundation

**Sprint window:** June 23 – July 4, 2026 (Track A architecture work front-loaded from June 18)
**Author:** PM
**Date:** 2026-07-04
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`, founder escalations in `FOUNDER_QUEUE.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Stand up the Ops Hub workspace and foundation — repo, team operating system, infrastructure (Inngest, LiteLLM, LangFuse, FreeScout, Supabase, Sentry, UptimeRobot), CI/CD with an eval gate, and the first end-to-end ticket flow — green-lighting M1 criteria #1–#10.

**Outcome: 20/20 tasks complete (100%). M1 criteria #1–#10 green. M1 foundation declared complete 2026-06-23.**

| Track | Tasks | Result |
|---|---|---|
| A — Architecture & Schema | T-01–T-06 | ✅ All done by 2026-06-21 (Track A artifacts committed 2026-06-18, ahead of the Jun 27 due date) |
| B — Infrastructure Provisioning | T-07–T-14 | ✅ All done by 2026-06-23 |
| C — CI/CD & Eval Gate | T-15–T-18 | ✅ All done by 2026-06-22 |
| D — QA & Knowledge Foundation | T-19–T-20 | ✅ All done by 2026-06-21 |

Notable: the heaviest two items by elapsed effort — T-10 (FreeScout) and T-08 (LiteLLM) — both landed on 2026-06-23, the same day M1 #10 (first ticket end-to-end) was confirmed. The sprint hit 100% inside its window despite the FreeScout deploy consuming a disproportionate share of cycles.

**Founder vs. autonomous resolution (the headline process finding):** Of the ~20 FOUNDER_QUEUE items raised during Sprint 1, the large majority were **not business decisions** — they were manual operations the agents were structurally unable to perform: SQL migrations via the Supabase SQL Editor, GRANTs via `docker exec artisan tinker`, env-var entry in Coolify, FQDN/domain changes in the Coolify UI, manual UptimeRobot monitor creation, and the GitHub Team plan upgrade. The genuine *business* calls the founder made were few (pricing already locked in planning; LangFuse US data residency, FQ-05; repo naming, FQ-03; DNC parked, FQ-04). **The recurring bottleneck in Sprint 1 was infrastructure access, not founder availability.** That distinction drives several of the Sprint 2 process changes below.

---

## 2. What worked

- **Front-loading no-dependency work.** Track A (ADRs, schema, CI/CD spec, test plan) had no infra dependency, so the Tech Lead authored all four artifacts on 2026-06-18 — nine days before their Jun 27 due date. This kept the critical path moving while Track B waited on provisioning. Repeatable pattern: identify dependency-free design work and execute it first.
- **Parallel-track dispatch.** Four tracks ran concurrently with clear owners and exit criteria. WORK.md held the live state so agents did not collide on ownership (with one exception — see §4 worktree collision).
- **The agent-owned-decision operating model (2026-06-20).** Locking "founder answers business/UX only; technical decisions are agent-owned and arrive as recommendations, not questions" removed a whole class of round-trips. Agents stopped asking the founder to choose between technical options and instead executed + logged in DECISIONS.md.
- **Founder-run runbook pattern for privileged operations.** Rather than hand agents the `service_role` key, the Tech Lead wrote copy-paste runbooks (T-11 migrations, T-12 Vault) the founder executes. The security non-negotiable ("agents never hold service_role at runtime") held for the entire sprint with zero exceptions.
- **CI gates as the quality bar in a single-founder repo.** With self-approval impossible, branch protection (4 required checks: Lint & Type Check, Unit Tests, Security Scan, Eval Gate) plus CodeRabbit substituted for human review. `enforce_admins=true` and `required_approving_review_count` dropped 1→0 was the correct, deliberate adaptation — not a weakening.
- **Security Lead rejecting literal-but-wrong task specs.** Twice (T-18 RLS isolation, and the Vault accessor design) the Security Lead refused a spec that would have produced a *false green* — a test that passes in CI while verifying nothing. T-18 as literally specified (supabase-js + `service_role` + `rpc('set_config')`) tests nothing because `service_role` bypasses RLS and the GUC evaporates across PostgREST requests. Replacing it with the `pg`-as-`ops_hub_app_login` path made the isolation guarantee real. This is exactly the judgment we want from a quality gate.
- **Clean pivots when an approach was exhausted.** When the FreeScout REST API path (webhooks module, then Api module) proved unreachable without paid modules or SSH, the team pivoted to Supabase direct polling — same intake, zero new infra dependency, fully testable in CI. The decision was logged, the dead workflows reverted, and T-21 redefined without drama.

---

## 3. What didn't work (or cost more than it should have)

- **The FreeScout deploy was a multi-week, multi-dozen-PR slog.** It is the single largest cost overrun of the sprint (detail in §4). The lesson is not any one bug but the *shape*: a chain of independent root causes on an unfamiliar self-hosted stack with no SSH and a quirky Coolify API, each only visible after the previous was fixed.
- **Free-tier walls appeared mid-task, not at planning.** Branch protection on a private repo required a paid GitHub Team upgrade. UptimeRobot's `newMonitor` API is paid-only. These were discovered during execution, forcing escalation and (in UptimeRobot's case) a permanent fallback to manual dashboard creation. We did not vet free-tier API write-access limits up front.
- **Coolify API has sharp, undocumented edges.** It rejects `fqdn` on docker-image apps (UI-only), has no exec endpoint, no docker-compose endpoint, async DELETE (causing port-bind races), and stores some fields it never applies (`connect_to_docker_network`). Each was discovered the hard way. Coolify is powerful but its API is not a complete control surface — several operations are UI-only and must be planned as founder actions.
- **"Set an env var" was never as simple as it sounds.** LITELLM_URL alone burned two escalations (FQ-36/FQ-37) before the right value — the internal Docker container name *with its numeric suffix* — was found. Pooler usernames needed the project-ref suffix (FQ-33). Each wrong value looked plausible and failed only at runtime.
- **Default endpoints/behaviors bit us repeatedly.** LangFuse SDK defaulted to the EU host while the project is US (PR #86). Sentry crashed the process because a `throw` inside the `http.createServer` callback raised `uncaughtException` (PR #88). These cost a fix-cycle each.
- **One parallel-dispatch collision corrupted branch state** (see §4). The convenience of firing concurrent agents was real, but without isolation it bit us once.

---

## 4. Incidents, blockers, and resolutions

### 4.1 FreeScout deployment — the long tail (T-10)

FreeScout took on the order of **40+ PRs across two phases** (roughly #12–#46 for the database/image saga, then #98–#109 for domain + DB-user finalization; PRs #6 and #8 were the shared deploy-workflow scaffolding, not FreeScout-specific). It was a chain of distinct root causes, each masked by the one before it:

1. **Non-existent image.** `thatwebagency/freescout` returns 404 on Docker Hub — every pull silently failed. The MariaDB sidecar crash was a *symptom*, not the cause. → switched to `tiredofit/freescout`, later `nfrastack/freescout`, on Supabase PostgreSQL (no MariaDB).
2. **VPS firewall blocked outbound TCP:5432** (and 6543). → founder opened the port (FQ-10).
3. **Coolify-managed PostgreSQL is permanently broken on this VPS** — Docker creates the bind-mount dir as `root:root`; Coolify doesn't pre-create it with correct ownership → every fresh DB UUID dies with a permission error. ~10 autonomous fix paths exhausted (PRs #25–#34). → abandoned Coolify-managed PG; reverted to Supabase.
4. **Wrong Supabase pooler hostname** — `aws-0-ca-central-1` vs. the correct `aws-1-ca-central-1` (FQ-11).
5. **Pooler username needs the project-ref suffix** — `freescout_user.yocoljutbiizdbfraapx`, not bare `freescout_user`.
6. **Image/variable mismatches** — `tiredofit` had no `SKIP_DB_READY`; `DB_TIMEOUT` was the wrong variable; `DB_SSL_MODE` vs. `FREESCOUT_DB_PGSQL_SSL_MODE`; URL parser put the hostname into `DB_PORT` when no explicit `:5432` was present.
7. **Domain only settable in the Coolify UI** — the API rejects `fqdn` for docker-image apps (FQ-24). The founder set it; Caddy then routed correctly.

**Resolution:** FreeScout live at `https://freescout-staging.inatechshell.ca` on 2026-06-23 (`nfrastack/freescout` v2.1.2, Supabase via `aws-1` session pooler). M1 #6 met. **Lesson:** for an unfamiliar self-hosted service on this VPS/Coolify combination, budget for a long root-cause chain and assume several steps are founder-only (UI changes, firewall, `docker exec`). Front-load a connectivity/permissions probe before wiring the app.

### 4.2 LiteLLM internal hostname discovery (T-08 / T-22)

`litellm-staging` first 502'd for hours because Coolify set Traefik `loadbalancer.server.port=80` while LiteLLM listens on 4000 (fixed agent-side, PRs #119–#125, FQ-27). Later, ops-hub-app couldn't reach LiteLLM internally: the working URL is the Coolify container name **including its numeric suffix** — `http://h12xz8887fxvbvjts2hac8if-055055304869:4000` — not the bare UUID, not the `https://` public URL (self-signed cert → TLS failure), not sslip.io. Resolved via FQ-36/FQ-37; HTTP 401 from LiteLLM confirmed "alive and auth-gated." **Lesson:** Coolify container DNS names carry a `-{numeric_suffix}`; the internal URL is now pinned in CLAUDE.md as the standing config.

### 4.3 Branch-protection free-tier wall (T-15)

Server-side branch protection on a *private* repo returned 403 on the free plan (both classic protection and rulesets are paid). Resolved by a founder-approved GitHub Team upgrade (2026-06-20). **Lesson:** confirm plan-gated features before a task depends on them.

### 4.4 Agent worktree collision in parallel dispatch (T-23/T-24)

When concurrent agents doing git work were dispatched without isolation, their shared `HEAD` collided and corrupted branch state. **Resolution / standing rule:** concurrent git-writing agents MUST run with `isolation: worktree`; without it, HEAD collisions corrupt branches. This is now a hard process requirement (see §5). It is recorded here because the failure mode is a coordination/tooling lesson, not a code bug — and it will recur the moment we fan out parallel agents again.

### 4.5 Smaller incidents (resolved same-cycle)

- **LangFuse EU/US default** — SDK defaulted to `cloud.langfuse.com` (EU); project is US. Fixed to read `LANGFUSE_BASEURL` → `LANGFUSE_HOST` → US default (PR #86).
- **Sentry process crash** — `throw` in the HTTP callback raised `uncaughtException`. Switched `/debug-sentry` to `Sentry.captureException()` + 500 (PR #89); `instrument.ts` preloaded as line-1 of `index.ts`.
- **UptimeRobot API blocked on free plan** — `newMonitor` is paid-only; 3 monitors created manually in the dashboard (FQ-17).

---

## 5. Process changes for Sprint 2

These are committed, not aspirational. Each came directly out of a Sprint 1 failure.

1. **Worktree isolation for concurrent git agents (HARD RULE).** Any time two or more agents do git work in parallel, each MUST use `isolation: worktree`. Sequential single-agent work is exempt. Rationale: the T-23/T-24 HEAD collision (§4.4).
2. **Env-var REPLACE-not-APPEND rule.** When updating an env var (e.g., LITELLM_URL), delete ALL existing duplicates before re-creating the variable — never append. Stacked duplicate vars produced ambiguous runtime values during the LiteLLM URL hunt. (Codified in the freescout-regrant recovery workflow; applies to every Coolify env-var change.)
3. **sslip.io is diagnostic-only, never standing config.** The internal Docker URL (`http://h12xz8887fxvbvjts2hac8if-055055304869:4000`) is the standing `LITELLM_URL`. sslip.io subdomains are a fallback *diagnostic probe* only and must never be committed or set as the live value. (Now a CLAUDE.md standing constraint.)
4. **Vet free-tier / access limits at planning, not mid-task.** Before a task depends on a third-party write API or a plan-gated platform feature (branch protection, UptimeRobot monitors, Coolify endpoints), confirm the free tier actually permits the operation — otherwise plan it as a founder/manual action from the start.
5. **Name founder asks as ops-vs-business.** When filing to FOUNDER_QUEUE, state explicitly whether the item is a *business decision* or a *manual operation the agent cannot perform* (no SSH, no exec API, UI-only field, free-tier block). This sets correct founder expectations and surfaces access gaps we should close.
6. **Probe before wiring on unfamiliar infra.** For any new self-hosted service on the VPS/Coolify combo, run a connectivity + permissions probe (network reachability, DB auth, directory ownership) *before* deploying the app, so the root-cause chain collapses to one diagnostic run instead of a dozen deploy attempts.

---

## 6. M1 criteria status

From `09_delivery.md`. M1 foundation (criteria #1–#10) declared complete 2026-06-23.

| # | Criterion | Status |
|---|---|---|
| 1 | GitHub repo with full plan + workspace files | ✅ Done (2026-06-18) |
| 2 | Coolify projects provisioned (`ops-hub-staging` + `ops-hub-prod`) | ✅ Done (2026-06-20) |
| 3 | Supabase project for Ops Hub (pgvector) | ✅ Done (2026-06-18) |
| 4 | Inngest + LangFuse + LiteLLM running in staging | ✅ Done (2026-06-23) |
| 5 | All agent specs loaded; agents respond when invoked | ✅ Done (2026-06-18) |
| 6 | FreeScout deployed and connected as ticket intake | ✅ Done (2026-06-23) |
| 7 | CI/CD active: lint + tests + eval gate + staging auto-deploy | ✅ Done (2026-06-22) |
| 8 | ≥1 eval case per agent; eval gate enforced on PRs | ✅ Done (2026-06-22) |
| 9 | Sentry + UptimeRobot wired | ✅ Done (2026-06-23) |
| 10 | ≥1 ticket flowed end-to-end (FreeScout → intake) | ✅ Done (2026-06-23) |
| 11 | First synthetic incident drill + post-mortem | 🔒 Sprint 2 (T-26) — requires live AI pipeline |
| 12 | DNC tickets flowing through Ops Hub | 🔒 Sprint 2 (T-27) — see DNC scope risk in §7 |
| 13 | First monthly founder briefing | 🔗 Scheduled July 31 (T-29) |

M1 foundation is complete. Criteria #11–#13 are correctly scoped into Sprint 2 and the milestone tail — they require the AI triage/response pipeline that Sprint 2 builds, not unfinished Sprint 1 work.

---

## 7. Open risks going into Sprint 2

| Risk | Severity | Note / mitigation | Owner |
|---|---|---|---|
| **Sprint 2 critical path halted at T-22 (FQ-39).** The 2026-06-25 Supabase DB reset wiped FreeScout's `mailboxes` table; the Gmail OAuth mailbox needs reconnecting in the FreeScout UI. Until then FreeScout has 0 conversations and triage cannot be validated. T-23/24/25/26/27 all block downstream. | High | Founder action (~5 min, FreeScout UI). Filed as FQ-39 BLOCKING. PM tracking daily. | PM / Founder |
| **Data durability.** A DB reset wiped live FreeScout state with no restore path — recovery was "reconnect and re-fetch from Gmail," which only works because Gmail is the source of truth. Any data not reproducible from an upstream source would have been lost. | Medium | Define a backup/restore expectation for staging Supabase before M2; treat FreeScout tables as ephemeral until then. | Tech Lead / Prod Mgr |
| **DNC scope is contradictory.** FQ-04 says DNC is *parked* and M3 deferred; M1 #12 says "DNC tickets flowing"; FQ-29 (open) asks what DNC even is. T-27 cannot be scoped until this is reconciled. | Medium | PM to reconcile: either re-scope M1 #12 to a generic project-onboarding proof, or get a one-line DNC definition. Non-blocking for T-21–T-26. | PM / Solutions Architect |
| **FreeScout write-back credential not yet provisioned (T-23).** `respondTicket` is code-complete but dormant: it needs a dedicated least-privilege `freescout_writer` role (INSERT on `threads` only) per Security Lead C1 — NOT the `freescout_user` owner DSN. Provisioning requires the FQ-34 owner-grant path (`docker exec artisan tinker`). | Medium | Runbook ready (`docs/engineering/t23-freescout-writeback-runbook.md`). Prod Mgr provisions when T-22 validates. | Prod Mgr / Security Lead |
| **VPS resource contention.** Inngest + LiteLLM + LangFuse + FreeScout + TTS all share one Hostinger/Coolify VPS. ADR-0001 sets a 70% utilization trigger to escalate a resize. | Medium | Tech Lead monitors; any paid resize is a founder spend decision. | Tech Lead |
| **Free-tier ceilings.** LangFuse Cloud free tier caps at 50K events/mo (35K = 70% trigger); UptimeRobot monitors are manual-only on free plan. Volume rises as the pipeline goes live in Sprint 2. | Low–Medium | Data Engineer watches LangFuse event count; revisit if approaching the trigger. | Data Engineer |
| **Single human in the loop.** Many tasks gate on founder-only manual ops (UI changes, SQL, env vars, `docker exec`) because agents lack SSH / exec API / paid API access. This is the structural throughput limit on the team. | Medium | Process change §5.5 (label ops-vs-business) surfaces these; longer term, close the access gaps (e.g., a controlled exec path) where security allows. | PM |

---

*Sprint 1 delivered its full scope and a complete M1 foundation. The cost was concentrated in unfamiliar self-hosted infrastructure (FreeScout, Coolify, pooler/networking quirks) and in access gaps that turned routine operations into founder round-trips. Sprint 2 inherits a working foundation, a halted critical path (FQ-39), and six concrete process changes meant to keep the next infra surprise from costing a week.*
