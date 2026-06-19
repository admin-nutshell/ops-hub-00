# 99 — Master Plan

> The Ops Hub at a glance. Read this first; consult the dimension files for depth.

---

## The pitch

**In a Tech-Shell (ITS) is building an AI-native operations platform that runs SaaS products with a team of specialized agents.** The Ops Hub is the platform layer. TTS — Trading in a Tech-Shell, our Canadian food-importer SaaS — is the first product running on it. Founder oversight is reserved for business decisions; agents handle everything operational, governed by hard policies, eval gates, and an audit trail.

---

## What we're building

| Layer | What | Who it serves |
|---|---|---|
| **Ops Hub (platform)** | Agent runtime, ticket workflow, observability, secrets vault, model router, KB, eval framework, governance | All ITS products |
| **ITS projects** | The actual SaaS products (TTS first) | Their tenants |
| **Tenants** | Individual customers using a product (DNC, A-Mart, etc.) | Their end users |

The Ops Hub is **app-agnostic** — built once, runs every product ITS launches. It's **provider-neutral** — via a Model Router (LiteLLM), Claude is default but OpenAI / GLM / Kimi / OpenRouter / local models all swap in. Tenants can eventually supply their own LLM API keys (BYOK in Phase 3).

---

## Why it matters

A solo founder vibe-coding a SaaS product can ship features faster than ever. **What they can't do** is operate that product at quality:

- Triage tickets across multiple tenants 24/7
- Investigate incidents in under 5 minutes
- Author and deploy fixes with eval-gated quality bars
- Maintain SOC 2-adjacent audit trails
- Run blameless post-mortems with structural improvements
- Communicate with tenants in real time during incidents

Hiring a 10-person ops team to do this costs $1M+/year and isn't possible at pre-revenue or early revenue. **An agent team — specialized, policy-governed, audit-logged — does the job at < $300/mo in LLM cost** for typical Phase 2 volume. The founder reviews the FOUNDER_QUEUE 1–2x daily and approves the few decisions that warrant human judgment.

This is what the Ops Hub is for.

---

## Architecture (one-page summary)

### Eight operational concerns

| Concern | Tool | Cost/mo |
|---|---|---|
| Workflow orchestration | Inngest Cloud (free → self-host fallback) | $0 |
| Agent observability | LangFuse Cloud (free → self-host fallback) | $0 |
| Human-in-the-loop gates | Inngest steps + FOUNDER_QUEUE.md + kill switch | $0 |
| Safety & guardrails | Per-agent least-privilege scoping + input sanitization | $0 |
| Shared knowledge & memory | pgvector on existing Supabase | $0 (existing) |
| Prompts-as-code + evals | Promptfoo + LangFuse | $0 |
| SLAs & customer comms | Templates + Production Manager + status page (Cstate) | $0 |
| Cost governance | LiteLLM tracking + per-project budgets + hard stops | $0 |

### Three platform modules (the app-agnostic core)

| Module | What it does | Tool |
|---|---|---|
| **Project Context schema** | Per-project config (app identity, business logic, RBAC, escalation, model preferences) | JSON in git + Supabase row |
| **API Vault** | Encrypted-at-rest LLM provider credentials, scoped per project | Supabase Vault |
| **Model Router** | Provider-agnostic LLM abstraction with fallback chains and cost tracking | LiteLLM (self-hosted) |

### Engineering operating model

Branch strategy (GitHub Flow, eval-gated merges), three environments (dev / staging / prod per project on shared Coolify VPS), CI/CD pipeline with eval gate, feature flags (simple Supabase table for v1), forward-only DB migrations, monitoring thresholds, deploy checklist, secrets rotation, DR plan, hotfix process — all documented as policy files in `docs/`.

**Fixed monthly cost target: ~$0.** LLM tokens are the variable cost (~$50–$300/mo at expected volume).

---

## The team

**Eleven agents + the founder.** Specialized, parallel, coordinating through three shared files (`WORK.md`, `DECISIONS.md`, `FOUNDER_QUEUE.md`).

| Role | Model | Quality bar |
|---|---|---|
| Founder | (human) | Strategic + business decisions only |
| PM | Opus | "Every sprint has a clear goal; every blocker has an owner" |
| Tech Lead | Opus | "Every architectural change has an ADR" |
| QA Manager | Opus | "No regression makes it to prod twice" |
| Production Manager | Codex | "Every deploy is intentional; every incident has a post-mortem" |
| Security Lead | Opus | "No tenant data leak; no credential leak; everything audit-logged" |
| Evals Lead | Opus | "No prompt regresses silently" |
| Knowledge Lead | Sonnet | "Every solved problem becomes a KB article" |
| Frontend Engineer | Sonnet | "UI is clean, accessible, fast" |
| Data Engineer | Sonnet | "Every metric measurable; every alert actionable" |
| Solutions Architect | Opus | "Project onboarding < 1 week; tenant onboarding < 1 day" |
| CodeRabbit | (third-party) | Automated PR review |

The full RACI matrix is in `05_people_and_process.md`. Founder is **R or A only** for: pricing, new projects, new tenants, budget > 20% changes, compliance posture, and High-risk prod deploys. Everything else is agent-owned.

---

## Roadmap

| Phase | Goal | Window | Key milestones |
|---|---|---|---|
| **Phase 1 — Foundation** | Prove the model on TTS with the core agent team and basic ticket flow | July → early Sept 2026 | M1: Foundation infra. M2: Agent team activated. M3: DNC live. **M4: Phase 1 done.** |
| **Phase 2 — Hardening** | Production-grade reliability + Premium SLA tier launched | Sept → late Oct 2026 | M5: Premium tier. M6: A-Mart onboarded (conditional). **M7: Phase 2 done.** |
| **Phase 3 — Scale** | Onboard Project #2; ship BYOK at tenant level; prove app-agnosticism | Nov 2026 → Jan 2027 | M8: Project #2 scoped. M9: Project #2 onboarded. M10: BYOK shipped. **M11: Phase 3 done.** |

Two exogenous dependencies on the critical path:
- **A-Mart pilot conversion** (Phase 2): if it converts, validates Premium tier with a marquee customer. If not, Premium ships anyway with a different first customer.
- **Project #2 identification** (Phase 3): if no candidate by mid-November, Phase 3 pivots to TTS-depth investment.

---

## Numbers

### Cost structure

| Category | Amount | Notes |
|---|---|---|
| Fixed monthly infrastructure | ~$0 | VPS already paid; free-tier tooling |
| Variable LLM cost (Phase 1 volume) | ~$50–$100/mo | 50 tickets/mo |
| Variable LLM cost (Phase 2 volume) | ~$400–$825/mo | 500 tickets/mo |
| Variable LLM cost (Phase 3 volume) | ~$2,550–$5,250/mo | 5,000 tickets/mo |

### Pricing

TTS tiers (basic agent support included):

| Tier | Price | Tenant |
|---|---|---|
| Starter | ~$300 CAD/mo | DNC (Tenant #1) |
| Growth | ~$700 CAD/mo | Standard mid-market |
| Scale | ~$1,200 CAD/mo | Enterprise |
| **Premium SLA add-on** | **+$200 CAD/mo** | 24/7 + sub-1hr P1 |

### Capital target

**Pre-Seed: $150K–$300K CAD.** Sufficient to carry founder time costs through Phase 3 and provide runway for Project #2 acquisition.

### Key KPI targets (Phase 2)

| KPI | Target |
|---|---|
| SLA adherence (P1) | ≥ 99% |
| SLA adherence (P2 / P3) | ≥ 95% |
| Post-mortem completion within 7 days | 100% |
| Hotfix rate | < 4 / quarter |
| Tenant satisfaction (post-resolution) | ≥ 80% positive |
| Founder time on operations | < 15 hours/week |

---

## Top risks

| Risk | Severity | Mitigation summary |
|---|---|---|
| Cross-tenant data leak | High | RLS at DB, namespace isolation in vector store, automated isolation tests in CI |
| Founder unavailable (bus factor) | High | Delegation policy + documented break-glass access |
| VPS outage | High | Daily backups + weekly off-site + 2-hour RTO target + annual DR drill |
| Agent runaway loop | Medium | Per-ticket budget + per-project daily cap + hard stop at 3× expected |
| LLM provider outage | Medium | LiteLLM fallback chains (primary → secondary) |
| Tenant churn from quality issues | Medium | SLA tracking + monthly tenant health review + proactive comms |

Full register (10 risks) in `06_governance.md`.

---

## What makes this different

| Most agent / SaaS plays | The Ops Hub |
|---|---|
| Single LLM provider lock-in | Provider-neutral via Model Router; tenants will BYOK in Phase 3 |
| One product, one team | App-agnostic platform; built once, runs N products |
| Founder is bottleneck | Founder reviews FOUNDER_QUEUE 1–2x/day; agents handle the rest |
| Expensive scaffolding | ~$0/mo fixed cost; free-tier tools throughout |
| "We'll get to ops later" | Operations is the product; agents do it from day one |
| Hidden agent decisions | Every decision logged in DECISIONS.md or audit trail; every prompt versioned in git |
| Eval-as-afterthought | Eval gate on every PR; merge blocked on regression |
| Compliance scramble at SOC 2 time | Compliance evidence collected daily; certification is mechanical when triggered |

---

## What's needed from the founder

| Cadence | What |
|---|---|
| **Daily (1–2x)** | Poll FOUNDER_QUEUE.md; approve or respond to queued items |
| **Weekly (~Friday)** | Skim weekly retro (< 5 min); note any course corrections |
| **Monthly** | Read founder briefing; send monthly investor email; review per-project COGS |
| **Quarterly** | Review risk register refresh; sign off on tool stack review |
| **Annually** | Strategy review; participate in DR drill; refresh delegation policy |

Founder is **never** in the loop for: routine tickets, standard deploys, eval results, agent peer coordination, code reviews on non-sensitive work, cost monitoring (until alert fires), KB updates, secrets rotation (until anomaly).

---

## Where to look for depth

| Question | File |
|---|---|
| Why are we doing this? | `01_strategy.md` |
| Who do we owe what to? | `02_stakeholders.md` |
| What's in / out? | `03_scope.md` |
| How is it built? | `04_architecture.md` + `docs/engineering/*` |
| Who does what? | `05_people_and_process.md` + `.claude/agents/*` |
| How do we stay safe? | `06_governance.md` + `docs/security/*` + `docs/governance/*` |
| What does it cost & earn? | `07_financials.md` |
| How do we talk to tenants? | `08_communications.md` |
| When do we hit which milestone? | `09_delivery.md` |

---

## Status as of plan v0.8

| Dimension | Status |
|---|---|
| Strategy | ✅ Locked |
| Stakeholders | ✅ Locked |
| Scope | ✅ Locked |
| Architecture | ✅ Locked |
| People & Process | ✅ Locked |
| Governance | ✅ Locked |
| Financials | ✅ Locked |
| Communications | ✅ Locked |
| Delivery | ✅ Locked |
| Master synthesis | ✅ Locked (this file) |

**Plan complete. Build phase begins next.**

---

## Build phase kickoff (next actions)

1. **Founder:** create GitHub repo `admin-nutshell/ops-hub`
2. **Founder:** drop the contents of `C:\projects\ops-hub\` into the repo root
3. **Founder:** open Claude Code pointed at the repo
4. **PM agent activates first** — reads this file + `01_strategy.md` + `09_delivery.md` → plans Sprint 1
5. **All other agents pick up from `WORK.md`** as PM populates it
6. **Founder responds only to `FOUNDER_QUEUE.md` items** going forward

Welcome to the operating phase.
