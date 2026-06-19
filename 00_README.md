# Ops Hub — Implementation Plan

> Authoritative plan for the **In a Tech-Shell Ops Hub** build, designed for the Claude Code build team to execute autonomously with founder oversight only on business-logic decisions.

---

## What this directory is

The complete implementation plan for an **app-agnostic, AI-native operations platform** serving every In a Tech-Shell product (starting with TTS as Project #1, provider-neutral via BYOK).

It contains everything the build team needs:

- The 9 charter dimensions (Strategy → Delivery)
- Engineering policy documents (branch strategy, deploy checklist, etc.)
- Agent specifications for the 11-agent build team
- Workspace files for autonomous agent coordination

---

## Directory structure

```
ops-hub/
├── 00_README.md             ← you are here
├── 01_strategy.md           ← vision, mission, success metrics, business case
├── 02_stakeholders.md       ← register + engagement plan
├── 03_scope.md              ← in/out + Feature Adaptation + project definition
├── 04_architecture.md       ← 8 concerns + 3 modules + branch/env/CI/CD/etc.
├── 05_people_and_process.md ← org chart + agents + RACI + ticket lifecycle
├── 06_governance.md         ← risk register + change mgmt + compliance
├── 07_financials.md         ← budget + cost model + pricing + ROI
├── 08_communications.md     ← tenant comms playbook + status + investor updates
├── 09_delivery.md           ← phasing + milestones + KPIs + critical path
├── 99_master_plan.md        ← executive summary (produced last)
├── .claude/
│   └── agents/              ← 11 agent specs + agent-team README
├── docs/
│   ├── engineering/         ← branch-strategy, environments, CI/CD, feature flags, DB migrations, monitoring
│   ├── deploys/             ← deploy checklist
│   ├── security/            ← secrets rotation
│   └── governance/          ← DR, hotfix process
├── WORK.md                  ← live status board (agents write here)
├── DECISIONS.md             ← ADRs and decisions log
└── FOUNDER_QUEUE.md         ← founder-only escalation queue
```

---

## Status of the plan

| # | Dimension | Status |
|---|---|---|
| 01 | **Strategy** | ✅ Locked (`01_strategy.md`) |
| 02 | **Stakeholders** | ✅ Locked (`02_stakeholders.md`) |
| 03 | **Scope** | ✅ Locked (`03_scope.md`) |
| 04 | **Architecture** (largest) | ✅ Locked (`04_architecture.md` + 10 policy docs) |
| 05 | **People & Process** | ✅ Locked (`05_people_and_process.md`) |
| 06 | **Governance** | ✅ Locked (`06_governance.md`) |
| 07 | **Financials** | ✅ Locked (`07_financials.md`) |
| 08 | **Communications** | ✅ Locked (`08_communications.md`) |
| 09 | **Delivery** | ✅ Locked (`09_delivery.md`) |
| 99 | **Master plan synthesis** | ✅ Locked (`99_master_plan.md`) |

Agent specs already delivered in `.claude/agents/` — 11 specs + a team README.

---

## Standing design rules (apply to every dimension)

1. **Free-tier-first** for every tool. Only pay when a feature is crucial AND demonstrably saves time or improves quality.
2. **App-agnostic.** Nothing hardcoded to TTS. Every design must work for Project #2 tomorrow.
3. **Provider-neutral via BYOK.** Claude is the default; OpenAI / GLM / Kimi / others swap in via Model Router.
4. **Founder-as-last-resort.** Agents handle everything except business-logic decisions, which go to `FOUNDER_QUEUE.md`.
5. **Eval-gated change.** No prompt or capability ships without passing the eval suite.
6. **Audit-ready by default.** Every sensitive operation logs to an immutable trail.
7. **Tenant isolation.** Multi-tenant boundaries respected at every layer (data, vector store, agent memory).

---

## Reading order for the founder

1. `01_strategy.md` — *Why are we building this?*
2. `02_stakeholders.md` — *Who do we owe what to?*
3. `03_scope.md` — *What's in and out?*
4. `04_architecture.md` — *How is it built?*
5. `05_people_and_process.md` — *Who does what?*
6. `06_governance.md` — *How do we stay safe and compliant?*
7. `07_financials.md` — *What does it cost and what does it earn?*
8. `08_communications.md` — *How do we talk to tenants?*
9. `09_delivery.md` — *When do we hit which milestones?*
10. `99_master_plan.md` — *The whole picture in two pages.*

---

## How to use this with Claude Code (build phase)

1. Confirm the directory structure is in place at the repo root
2. Initialize `WORK.md`, `DECISIONS.md`, `FOUNDER_QUEUE.md` from their templates (added in a later step)
3. Open Claude Code pointed at this repo
4. The **PM agent** activates first — reads this README + Strategy + Delivery to plan Sprint 1
5. All other agents pick up from `WORK.md` autonomously
6. You respond only to items posted to `FOUNDER_QUEUE.md`

---

## Plan version log

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-06-18 | Initial structure. Strategy, Stakeholders, Financials locked. Agent specs delivered. |
| v0.2 | 2026-06-18 | Scope locked. |
| v0.3 | 2026-06-18 | Architecture locked. 04_architecture.md + 10 engineering policy docs delivered. |
| v0.4 | 2026-06-18 | People & Process locked. RACI matrices + ticket lifecycle + communication protocols. |
| v0.5 | 2026-06-18 | Governance locked. Risk register (10 risks) + change mgmt + PIPEDA / SOC 2 readiness. |
| v0.6 | 2026-06-18 | Communications locked. Tenant comms playbook + internal reporting + investor cadence. |
| v0.7 | 2026-06-18 | Delivery locked. 3 phases, 11 milestones, KPIs per phase, critical path mapped. |
| v0.8 | 2026-06-18 | **Plan complete.** Master plan synthesis (`99_master_plan.md`) authored. All 9 dimensions locked. Ready for build phase. |
