# 03 — Scope

> What the Ops Hub does, what it doesn't, and how those lines are drawn at four layers: platform, project, operational, tenant.

---

## Executive summary

The Ops Hub is **app-agnostic operations infrastructure** for In a Tech-Shell:

- **Platform scope:** runs maintenance, support, debugging, and knowledge for any ITS product
- **Project scope:** each ITS product plugs in via Project Context schema; first is TTS
- **Per-project operational scope:** production incidents, support tickets, compliance queries, KB maintenance, post-mortems
- **Out of scope everywhere:** feature development, sales, marketing, billing disputes, strategic decisions

The single most common failure mode for internal tooling like this is **scope creep into "general IT support."** This document is the boundary control system that prevents that drift.

---

## Layer 1 — Hub-level scope (the platform itself)

### What the hub does as a platform

- Runs as the operations layer underneath every active ITS project
- Provides shared infrastructure: workflow orchestration, agent fleet, knowledge base, API vault, model router
- Enforces multi-project isolation (Project A never sees Project B's data)
- Supports per-project configuration via Project Context schema
- Routes LLM calls to whichever AI provider the project has configured (BYOK)
- Enforces consistent SLA and quality discipline across all projects

### What the hub does NOT do as a platform

- Build product features for any ITS product (that's each product's dev workflow)
- Replace each project's own product roadmap or backlog
- Make business decisions about pricing, customer relationships, or strategy
- Provide a single shared knowledge base across projects — knowledge is namespaced per project
- Cross-pollinate prompts, agents, or learnings between projects without explicit configuration

---

## Layer 2 — Project-level scope

### What "a project" means

An In a Tech-Shell software product with its **own codebase, user base, deployment, and SLA commitments.**

| **Is** a project | **Is NOT** a project |
|---|---|
| TTS (Project #1, live today) | The In a Tech-Shell marketing site |
| Future "X in a Tech-Shell" SaaS products | Internal experiments and prototypes |
| Any acquired or built product ITS commits to operating with an SLA | Daily Needs Canada (it's a *tenant* of TTS, not an ITS project) |

**The test:** does it have a paying user base *or* an SLA that ITS has committed to? If yes → project. If no → the hub does not serve it.

### Project onboarding flow (target: < 1 week from charter to live)

| # | Step | Owner | Output |
|---|---|---|---|
| 1 | Project charter | Founder | Vision, success metrics, business case |
| 2 | Project Context schema authored | Founder + Solutions Architect | `projects/<name>/config.json` |
| 3 | API keys provisioned | Founder | Keys in API Vault for this project |
| 4 | Integration hooks wired | Solutions Architect | Sentry, monitoring, repo webhook, deploy hook |
| 5 | Knowledge base seeded | Knowledge Lead | Initial runbooks + KB articles |
| 6 | Synthetic ticket test | QA Manager | One end-to-end test ticket processed cleanly |
| 7 | Founder approval & go-live | Founder | First real ticket flows through |

The goal: each new project costs **hours of founder time, not weeks of engineering.**

---

## Layer 3 — Per-project operational scope

### In-scope activities

| Activity | Owner agent(s) | Notes |
|---|---|---|
| Production incidents (bugs, outages, performance) | All operator agents | Standard P1–P4 ticket flow |
| Customer support tickets | Support Agent → App Support → others | KB lookup + investigation + resolution |
| Compliance documentation queries | Knowledge Lead | CFIA forms, PIPEDA questions, audit requests |
| Knowledge base maintenance | Knowledge Lead | Article freshness, RAG quality, retrieval accuracy |
| Runbook authoring | Knowledge Lead | Per-failure-mode runbooks |
| Post-mortem authoring | Knowledge Lead + Production Manager | Blameless post-mortems for P1/P2 incidents |
| Monitoring response | SRE / Production Manager | Sentry alerts, UptimeRobot alerts |
| **Feature Adaptation** *(when project ships a feature)* | Knowledge Lead + QA Manager + SRE | See refinement below |

### Out-of-scope activities

| Activity | Why it's excluded | Where it lives instead |
|---|---|---|
| New feature development (designing & writing code) | Hub is operations, not product | Project's dev workflow with Claude Code |
| Sales demos and marketing | Different function entirely | Founder + future sales/marketing roles |
| Billing disputes | Always escalates to founder | `FOUNDER_QUEUE.md` |
| Strategic decisions | Founder only | `FOUNDER_QUEUE.md` |
| Cross-project work (shared component changes) | Handled per project, not centrally | Each project independently |

**Why the boundary matters:** scope creep into "general IT support" is the single failure mode that kills internal tooling like this. Writing the out-of-scope list down now is what prevents drift in month 9.

### Feature Adaptation refinement *(in-scope when projects ship features)*

The hub does **NOT build features** — but it **MUST absorb each feature as it ships** so agents don't give wrong answers to tenants.

| Activity around a new feature | Hub scope |
|---|---|
| Designing and writing the feature code | **Out** — project's dev workflow |
| Production bugs in the new feature once live | **In** — standard ticket flow |
| Tenant questions about the new feature | **In** — KB must know about it |
| Updating Project Context with new terms / modules | **In** — schema delta |
| Adding monitoring & alerts for new feature | **In** — SRE agent task |
| Writing runbook for new failure modes | **In** — Knowledge Lead task |
| Running synthetic test tickets against new feature | **In** — QA agent task |

**Trigger:** every PR merged to a project's `main` → automatic webhook to the hub → Feature Adaptation workflow kicks off.

**Outputs per cycle:**

1. Project Context schema updated (new terms, modules, business logic)
2. KB articles auto-drafted by Knowledge Lead — founder reviews and approves
3. Monitoring & alerts wired by SRE agent
4. Runbook drafted for likely failure modes
5. QA agent runs synthetic tickets to confirm the hub still answers correctly

So when a project ships a new feature Tuesday, the hub is ready to answer tenant questions about it Wednesday — without founder intervention beyond the PR merge itself.

---

## Layer 4 — Tenant relationship

### What the hub does for tenants (through the project)

- Receives tickets they submit via the project's intake channels
- Triages, investigates, resolves
- Sends acknowledgments, milestone updates, resolution notes
- Maintains a KB they can self-serve from
- Honors the SLA tied to their subscription tier (and Premium SLA add-on if applicable)
- Provides compliance documentation when requested (CFIA forms, etc.)

### What the hub does NOT do for tenants

- Configure the project's product for them (their admin's job)
- Provide consulting, training, or implementation services
- Make business decisions about their account (pricing changes, plan changes)
- Cross-share their data with other tenants (isolation is absolute)
- Build custom features for them (out-of-scope per Layer 3)

---

## Service boundaries

### Severity coverage and service hours

All four severity levels are in scope. Service hours vary by severity and Premium SLA status:

| Severity | Definition | Standard service hours | Standard SLA | Premium SLA |
|---|---|---|---|---|
| **P1** | Production down or data integrity at risk | 24/7 | < 1 hr first response | < 1 hr guaranteed |
| **P2** | Major feature broken or significant degradation | 24/7 | < 4 hr first response | < 4 hr guaranteed |
| **P3** | Minor feature broken or workaround available | Business hours (MT, Mon–Fri) | < 24 hr first response | Same + monitored 24/7 |
| **P4** | Cosmetic or non-blocking | Business hours (MT, Mon–Fri) | < 72 hr first response | Same + monitored 24/7 |

### Geographic / regulatory scope

- **Primary:** Canadian regulatory framework (CFIA for TTS, PIPEDA for all projects)
- **Secondary:** US-compatible where applicable
- **Out of v1 scope:** EU GDPR, APAC regulations — addressed in Phase 2 only if tenant base expands beyond North America

### Language scope

- **v1:** English (Canadian / American)
- **Phase 2:** French (Canadian) — important for full Canadian market coverage
- **Phase 3+:** Other languages as tenant base expands

---

## Scope change governance

### How to propose a scope change

1. **Anyone** (founder, agent, advisor) can propose
2. Proposal documented in `FOUNDER_QUEUE.md`: *what's changing, why, impact on metrics*
3. PM agent assesses fit against Charter (Strategy + this Scope doc)
4. Founder approves or declines — **always the founder for scope changes; non-delegable**
5. If approved: this doc updated, change logged in `DECISIONS.md`, affected agent specs touched accordingly

### Decision authority

| Decision type | Who decides |
|---|---|
| Add/remove an in-scope activity | Founder only |
| Add/remove an out-of-scope activity | Founder only |
| Change "what is a project" criteria | Founder only |
| Modify onboarding flow steps | Tech Lead + Solutions Architect propose; founder approves |
| Adjust SLA service hours | Founder only |
| Tighten/loosen severity thresholds | Founder on PM recommendation |
| Expand geographic scope | Founder only (regulatory implications) |
| Add language support | Founder only (resource implications) |

---

## Edge cases — common gray areas

When in doubt, the rule is **escalate, don't assume.**

| Gray area | Default disposition |
|---|---|
| Tenant asks for a small custom workflow | Out of scope. Escalate. Do not build. |
| Tenant reports a bug that turns out to be expected behavior | In scope — answer with explanation, document as KB. Don't dismiss. |
| Tenant asks for help configuring a third-party tool | Out of scope unless it's a project-supported integration |
| Tenant asks for training on the product | Out of scope. Refer to documentation. |
| A regulatory inquiry arrives | Out of scope for agents. Always escalates to founder. |
| Cross-tenant request ("what do other tenants do?") | Out of scope. Tenant isolation is absolute. |
| Founder asks for a one-off report | In scope only if it's a real metric. One-off custom reports go through scope-change governance. |

---

## How this file is used

The Scope dimension is the **boundary control system.** Every new request — from tenant, project, founder, or agent — gets filtered through:

> *Is this in scope?*

If the answer isn't immediately yes, the request goes to `FOUNDER_QUEUE.md` rather than getting guessed at. **Scope ambiguity is itself a failure mode.**

This doc gets reviewed quarterly. Any scope drift discovered during review is either formally adopted (with this doc updated) or actively pruned (with the in-flight work canceled).
