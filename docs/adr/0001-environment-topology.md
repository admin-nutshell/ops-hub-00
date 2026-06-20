# ADR-0001 — Environment Topology

- **Status:** Proposed — pending Production Manager deployability sign-off (touches deploy/rollback path)
- **Date:** 2026-06-18
- **Author:** Tech Lead
- **Deciders:** Tech Lead (proposer), Production Manager (deployability sign-off required), Founder (informed — no founder-owned decision triggered)
- **Supersedes:** none
- **Related:** `docs/engineering/environments.md`, `docs/engineering/branch-strategy.md`, `docs/engineering/ci-cd-pipeline.md`, `04_architecture.md`, ADR-0002

---

## Context

The Ops Hub is an app-agnostic operations platform. Project #1 (TTS) runs on it today; Project #2 will run on it in Phase 3. Both the Ops Hub itself and each hosted project need a path from local development to a live system serving real tenants, with a safe place to verify changes in between.

We have one paid resource already on the books: a **single Hostinger VPS** managed through **Coolify** (the open-source, self-hostable PaaS layer). The free-tier-first rule (locked in `DECISIONS.md`, 2026-06-18) means we do not provision additional paid infrastructure unless a feature is crucial AND demonstrably saves time or improves quality.

This ADR records the decision on **how many environments we run, where they run, how they are isolated, how they are named, and what "dev" means for a Claude Code–native project.** It is the canonical rationale behind `docs/engineering/environments.md`; that file is the operational reference, this ADR is the "why" and the rejected alternatives.

### Terminology note

`docs/engineering/environments.md` calls the box the "Hostinger VPS"; the Sprint 1 task brief calls it the "shared Coolify VPS." These are the **same machine** — Hostinger is the hosting provider, Coolify is the deployment control plane running on it. This ADR uses "the VPS" to mean that single Hostinger machine with Coolify on top.

---

## Decision

**Three environments per project — `dev`, `staging`, `prod` — with `staging` and `prod` running as separate Coolify projects on one shared VPS, and `dev` defined as a local-first developer/agent context rather than a hosted environment.**

### 1. Three tiers, per project

| Env | Where it runs | Purpose |
|---|---|---|
| `dev` | Local machine + per-agent Claude Code session (see §4) | Development, agent prototyping, local verification |
| `staging` | Dedicated Coolify project on the shared VPS | Pre-prod verification, canary target, 24h migration soak |
| `prod` | Dedicated Coolify project on the shared VPS | Live system serving real tenants |

Each project (Ops Hub, TTS, future Project #2) gets its own `staging` and `prod`. There is no shared staging or shared prod across projects.

### 2. Shared VPS, not separate hosts (cost rationale)

`staging` and `prod` for **every** project share one VPS. They are isolated by Coolify project boundary, container, database, env-var set, secret namespace, domain, and observability namespace — but not by hardware.

The driver is cost. The VPS is already paid for; spinning up additional hosts per environment would convert a $0 marginal-cost decision into a recurring monthly bill with no quality benefit at Phase 1/2 volumes (50 → 500 tickets/mo). The free-tier-first rule says we don't pay until a feature is crucial and demonstrably pays for itself. Hardware isolation between staging and prod is not yet crucial at this scale; logical isolation (below) covers the real risk, which is cross-environment data or config bleed, not noisy-neighbor CPU contention.

### 3. Isolation strategy between environments

Sharing hardware is acceptable **only because everything above the hardware is separated.** The boundaries (detailed in `docs/engineering/environments.md`):

| What | Isolation mechanism |
|---|---|
| Compute | Separate Docker containers per env per project, under separate Coolify projects |
| Database | Separate Supabase project per env (Ops Hub `staging` ≠ Ops Hub `prod`); RLS is the *intra*-database tenant boundary, the separate-project boundary is the *inter*-environment one |
| Config | Separate Coolify env-var set per Coolify project |
| Secrets | Separate vault namespace per env: `vault://<project>/staging/*`, `vault://<project>/prod/*` |
| Domains | `staging.app.inatechshell.ca` vs `app.inatechshell.ca` |
| Observability | Separate Sentry environment + separate LangFuse namespace per env |

**Data-flow rule (non-negotiable):** prod data never flows to staging or dev in raw form. Lower environments use synthetic or anonymized data only. Staging is throwaway by definition. This is restated as policy in `environments.md` and is the load-bearing reason shared hardware is safe: a staging compromise cannot expose real tenant data because real tenant data is never present in staging.

### 4. What "dev" means for a Claude Code–native project

This is the decision most specific to our operating model, so it is stated explicitly.

`dev` is **not a hosted, always-on environment.** There is no `ops-hub-dev` Coolify project. `dev` is the **local context in which an agent (via a Claude Code session) or a human develops and verifies a change before opening a PR.** Concretely:

- The unit of "dev" is a **feature branch checked out locally + the running developer/agent session**, not a server.
- Local dependencies are run on demand: local Docker for app containers, local Postgres or a Supabase free-tier scratch project for the DB, the Inngest local dev server, an optional local LangFuse, and a local LiteLLM config.
- Each agent's Claude Code session is an ephemeral dev context. Two agents working two branches are two independent `dev` contexts; they do not share state. Shared state between agents flows through `WORK.md` / `DECISIONS.md` / the PR, never through a shared dev server.
- `dev` is where log verbosity is `DEBUG`, rate limits are loosest, and there are no cost-budget caps (per `environments.md`).
- The first hosted environment a change ever reaches is `staging`, on merge to `main`.

Rationale: a Claude Code–native team produces parallel, short-lived branches from many concurrent agent sessions. A single shared hosted `dev` environment would become a contention point and a source of "works on the shared dev box" drift. Defining `dev` as local-and-ephemeral keeps the hosted footprint to exactly two environments per project (the two that cost real isolation effort) and pushes all integration risk onto `staging`, which is monitored and gated.

### 5. Naming convention for Coolify apps

One Coolify project per `<project>-<env>` for the two hosted tiers:

| Project | dev | staging | prod |
|---|---|---|---|
| Ops Hub | local (no Coolify project) | `ops-hub-staging` | `ops-hub-prod` |
| TTS | local | `tts-staging` | `tts-prod` |
| Future Project #2 | local | `<project>-staging` | `<project>-prod` |

Pattern: `<project-slug>-<env>`, lowercase, hyphenated, env suffix always last. Subdomains follow the same logic (`staging.` prefix for staging, bare apex for prod). This pattern is what M1 checklist item #2 provisions (`ops-hub-staging`, `ops-hub-prod`) and is the contract the Production Manager builds Coolify app configs against.

### 6. VPS sizing and resource-contention review (required by WORK.md risk register)

WORK.md flags "VPS resource contention (Inngest + LiteLLM + LangFuse + FreeScout on one VPS)" as a Medium risk and assigns the sizing review to this ADR. Assessment:

**What actually lands on the VPS.** Several of the "8 concerns" tools are *cloud free-tier* and do **not** consume VPS resources in the default configuration:

| Tool | Default placement | VPS load |
|---|---|---|
| Inngest | Inngest Cloud free tier | None (until self-host fallback) |
| LangFuse | LangFuse Cloud free tier | None (until self-host fallback) |
| LiteLLM | Self-hosted on VPS | Yes — small (stateless proxy) |
| FreeScout | Self-hosted on VPS (staging first) | Yes — PHP app + its DB |
| Supabase | Managed Supabase (off-VPS) | None |
| Cstate | Static site (off-VPS / Pages) | None |
| Promptfoo | Runs in CI (GitHub Actions) | None |

So at Sprint 1 the genuinely VPS-resident services are **LiteLLM and FreeScout**, both modest, plus each project's app containers across `staging` and `prod`.

**Headroom posture.** This is comfortable at Phase 1 (50 tickets/mo) and Phase 2 (500 tickets/mo) volumes. The contention risk is real only in two scenarios:
1. **Self-host fallback triggers.** If Inngest or LangFuse free-tier limits are exceeded (50K runs/mo, 50K events/mo respectively) we self-host them on the VPS per ADR-0002. LangFuse self-hosted in particular brings its own Postgres + ClickHouse and is the single largest potential VPS consumer. **Decision rule:** before self-hosting LangFuse, re-run this sizing assessment; a self-host of LangFuse is the most likely trigger for a VPS upgrade.
2. **Multiple projects in prod simultaneously** (Phase 3, Project #2 live). Two projects' worth of `staging`+`prod` containers plus self-hosted middleware is the point at which a VPS resize becomes plausible.

**Monitoring + trigger.** Production Manager wires VPS-level resource monitoring (CPU, memory, disk) as part of Track B. **Decision rule:** if sustained memory utilization exceeds **70%** or disk exceeds **70%**, Tech Lead opens a follow-up ADR proposing a VPS resize; because a VPS upgrade is a **paid infrastructure change**, that ADR escalates to `FOUNDER_QUEUE.md` for approval (founder owns budget changes per RACI). We do **not** pre-emptively upsize — free-tier-first means we wait for the signal.

**Conclusion of the sizing review:** no VPS upgrade is required to deliver M1. The risk is correctly rated Medium and is mitigated by (a) keeping cloud-hosted tools off the VPS by default, (b) the 70% monitoring trigger, and (c) a documented escalation path for the resize decision.

---

## Options considered

### Option A — Three environments; staging+prod share one VPS; dev is local (CHOSEN)

- **Pros:** $0 marginal cost (uses existing VPS); strong logical isolation; two hosted environments is the minimum that still gives a real pre-prod gate; "dev = local" fits the parallel-agent operating model; scales to N projects by adding Coolify projects, not hosts.
- **Cons:** No hardware isolation between staging and prod (mitigated by §3 + the no-prod-data-in-staging rule and the 70% monitoring trigger); a VPS outage takes down staging and prod for all projects at once (accepted — covered by the DR plan in `docs/governance/disaster-recovery.md`, 2h RTO target).

### Option B — Three environments, each on its own host (full hardware isolation)

- **Pros:** Strongest isolation; staging load can never affect prod; per-env blast radius.
- **Cons:** Recurring monthly cost per host per project — directly violates free-tier-first with no demonstrated need at current scale. The risk it buys down (noisy-neighbor contention) is not the risk we actually have (cross-env data bleed, which logical isolation already handles). **Rejected:** pays real money to mitigate a non-problem.

### Option C — Two environments only (dev + prod, no staging)

- **Pros:** Simplest; least to provision; lowest VPS footprint.
- **Cons:** No safe place to soak migrations (the migrations policy requires 24h staging verification), no canary target, no pre-prod smoke tests. Eliminates the gate that prevents regressions reaching tenants. **Rejected:** removes the single most valuable safety layer to save resources we already have.

### Option D — Managed PaaS (Vercel / Render / Fly.io) instead of Coolify-on-VPS

- **Pros:** Less ops overhead; managed scaling; per-env environments are first-class.
- **Cons:** Recurring cost that grows with usage; we'd be paying for managed convenience while a paid VPS sits underused; introduces a vendor we'd commit to for >12 months (an escalation trigger per the agent spec). **Rejected for now:** revisit only if VPS ops burden becomes material; would require its own ADR and founder sign-off on the spend.

### Option E (do-nothing) — No defined topology; deploy ad hoc

- **Cons:** Guarantees config drift, no reproducibility, no isolation guarantees, no audit story. Incompatible with the SOC 2-adjacent posture the platform is meant to maintain. **Rejected.**

---

## Consequences

**Positive**
- Fixed infrastructure cost stays at ~$0; only LLM tokens are variable.
- Adding a project is "create two Coolify projects + two Supabase projects," a repeatable onboarding step the Solutions Architect playbook can encode — supports the app-agnostic goal at the 24-month horizon.
- The local-first `dev` definition removes a shared-state contention point for a parallel-agent team.

**Negative / risks accepted**
- VPS is a single point of failure for all hosted environments → owned by the DR plan, not this ADR.
- Shared hardware means a runaway staging process could theoretically starve prod → mitigated by the 70% monitoring trigger and Coolify per-container resource limits (Production Manager to set sane limits on FreeScout/LiteLLM).
- Self-hosting LangFuse later is the most likely event to force a VPS resize → flagged with a decision rule so it doesn't surprise us.

**Follow-ups**
- Production Manager: wire VPS-level CPU/mem/disk monitoring with a 70% alert (Track B).
- Tech Lead: if the 70% trigger fires, open a resize ADR → `FOUNDER_QUEUE.md`.
- No change required to `environments.md`; this ADR is its rationale of record.
