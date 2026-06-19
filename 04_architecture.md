# 04 — Architecture

> How the Ops Hub is built. The 8 operational concerns, the 3 platform modules, and the engineering operating model that ties them together.

---

## Overview

The Ops Hub architecture has three layers:

| Layer | What it covers | Files |
|---|---|---|
| **8 operational concerns** | The day-to-day mechanics of running an agent ops system | This file |
| **3 platform modules** | What makes the hub app-agnostic and provider-neutral | This file |
| **Engineering operating model** | How code gets written, reviewed, deployed, monitored | This file + `docs/engineering/`, `docs/deploys/`, `docs/security/`, `docs/governance/` |

All tool choices follow the **free-tier-first rule**: only pay when a feature is crucial AND demonstrably saves time or improves quality.

---

## The 8 operational concerns

### 1. Workflow orchestration

**What:** The plumbing that hands tickets between agents, retries on failure, prevents two agents from working the same ticket.

**Tool:** **Inngest Cloud free tier** (50K runs/mo, 5 concurrent steps, 3 users). Fallback to self-hosted Inngest on Coolify VPS if limits exceeded.

**Why:** Open source, OpenAI-compatible patterns, visual workflow inspection, durable retries, native step functions. Vibe-coder friendly.

**Decision rule:** If we exceed 50K runs/mo, move to self-hosted Inngest before Pro tier — keeps cost at $0.

### 2. Agent observability

**What:** Every prompt, response, token cost, latency, and reasoning trace logged for every agent call.

**Tool:** **LangFuse Cloud free tier** (50K events/mo, 30-day retention). Fallback to self-hosted LangFuse on VPS if limits exceeded.

**Why:** Open source, purpose-built for LLM tracing, integrates natively with LiteLLM, supports per-project namespacing.

### 3. Human-in-the-loop (HITL) gates

**What:** Specific workflow steps marked as requiring founder approval before proceeding.

**Implementation:**
- Inngest steps marked `humanApproval: true`
- Approval requests posted to `FOUNDER_QUEUE.md`
- Founder polls queue 1–2x daily (no push notification fatigue)
- Workflow pauses until approval recorded

**Categories requiring HITL:**
- Production deploys (after canary window completion)
- Customer email sends with sensitive content
- Database writes to billing or auth tables
- Refund or credit issuance
- Tenant communications during incidents (P1/P2)

**Kill switch:** `FOUNDER_QUEUE.md` includes a top-level emergency stop directive that halts all agent activity. Activated by editing the file with `EMERGENCY_STOP: true`.

### 4. Safety & guardrails

**What:** Least-privilege scoping for each agent's actions; defense against prompt injection from untrusted tenant inputs.

**Implementation:**
- Each agent has a scoped credential (API key with minimum needed access)
- Action allow-lists per agent (defined in `.claude/agents/<agent>.md` Tools section)
- Tenant input sanitization before injection into agent prompts
- Output validation (does code compile? does SQL parse? is JSON valid?)
- Rate limits per agent per ticket (prevent runaway loops)

**Prompt injection defense:** Treat all tenant ticket content as untrusted input. Wrap in delimiters; never let it modify system instructions.

### 5. Shared knowledge & memory

**What:** Searchable index of runbooks, codebase, past tickets, KB articles.

**Tool:** **pgvector on existing Supabase** (already paid via TTS).

**Implementation:**
- Per-project vector namespace (no cross-project leak)
- Knowledge Lead agent owns embedding freshness
- Embeddings refreshed on every Feature Adaptation cycle
- RAG queries traced in LangFuse for retrieval quality measurement

**Per-ticket scratchpad:** Supabase JSONB column per ticket; agents read/write shared context within a single ticket's lifecycle.

### 6. Prompts-as-code + evals

**What:** Every agent prompt versioned in git. Every PR runs an eval suite.

**Tool:** **Promptfoo CLI + LangFuse benchmark storage** — both free / open source.

**Implementation:**
- Prompts live in `agents/<agent>/prompts/*.md`
- Eval cases in `evals/<agent>/cases/`
- Synthetic ticket datasets in `evals/datasets/`
- CI runs full eval suite on every PR touching prompts
- Evals Lead agent owns the discipline (see `.claude/agents/evals_lead.md`)

**Eval gate:** any failing eval blocks merge unless explicitly waived by founder with rationale in `DECISIONS.md`.

### 7. SLAs, severity, customer comms

**What:** Defined severity → SLA mapping, auto-acknowledgments, milestone updates, resolution comms.

**Implementation:** See `08_communications.md` (drafted in Step 6) and the SLA table in `03_scope.md`.

### 8. Cost governance

**What:** Token budget per ticket, per-tenant daily budget, hard stop on runaway loops.

**Implementation:**
- Model Router (LiteLLM) tracks tokens & dollars per call, tagged with project + tenant + agent
- Daily budget per project enforced at Model Router level
- Hard stop: a workflow that exceeds 3× expected cost halts and posts to `FOUNDER_QUEUE.md`
- Cost-per-ticket reported in monthly metrics dashboard

---

## The 3 platform modules (app-agnostic, provider-neutral)

### Module A — Project Context schema

**What it is:** Per-project config bundle telling the hub how to operate that project's tickets.

**Storage:**
- JSON config in git: `projects/<name>/config.json`
- Mirror row in Supabase `projects` table for runtime queries

**What it contains** (TTS example):
- App identity (repo, prod URL, deployment env)
- Business logic dictionary ("Container", "Incoterm", "CFIA form", etc.)
- SLA targets per severity
- RBAC roles
- Escalation rules
- Compliance scope (CFIA, PIPEDA)
- Default model preferences per use case (triage → Haiku, investigation → Sonnet, hard fixes → Opus)
- Knowledge base namespace (`tts/*`)

**Schema evolution:** managed by Knowledge Lead on every Feature Adaptation cycle. Schema changes logged in `DECISIONS.md`.

### Module B — API Vault

**What it is:** Encrypted-at-rest storage for AI provider credentials, scoped per project.

**Tool:** **Supabase Vault** (already paid). Coolify env secrets as simpler fallback for v1.

**Discipline:**
- Only the Model Router reads keys
- Agents never see raw keys — they request a model, not a credential
- Every key access logged for audit
- Per-project, per-environment isolation

**Rotation:** see `docs/security/secrets-rotation.md`.

### Module C — Model Router

**What it is:** Provider-agnostic LLM abstraction. One interface for every AI provider.

**Tool:** **LiteLLM** (open source, self-hosted on Coolify VPS).

**Capabilities:**
- 100+ models out of the box (Claude, OpenAI, GLM, Kimi, Gemini, OpenRouter, local)
- OpenAI-compatible API — agents speak one protocol; LiteLLM translates
- Built-in fallback (primary down → secondary)
- Built-in cost tracking per project / per provider
- Built-in prompt caching support

**Flow:**
1. Agent: *"I need 'investigation' model for project TTS"*
2. Model Router: looks up TTS's `investigation` preference → Sonnet 4.6
3. Pulls TTS's Anthropic key from API Vault
4. Routes the call → returns normalized response
5. Logs `project=tts, provider=anthropic, model=sonnet-4.6, tokens=12k, cost=$0.04`

---

## Cross-cutting concerns

### Audit trail

Every agent decision, state transition, approval, and sensitive operation logged immutably. Stored in dedicated Supabase audit table with append-only enforcement at RLS level.

**Used for:** SOC 2 evidence (future), debugging today, post-mortem material always.

### Tenant isolation

Multi-tenant boundaries enforced at every layer:
- Database: row-level security (RLS) on every tenant-data table
- Vector store: per-tenant namespace in pgvector
- Agent memory: per-ticket scratchpad, scoped by tenant ID
- KB retrieval: filtered by project + tenant before RAG query
- Audit log: tenant ID stamped on every entry

**Test:** every PR touching tenant data must pass cross-tenant isolation tests (defined by QA Manager + Security Lead).

---

## Engineering operating model

The remaining architecture decisions live in dedicated policy documents. Each is short, concrete, and referenced from the relevant agent specs.

| Topic | Document | Owner agent |
|---|---|---|
| Branch strategy | `docs/engineering/branch-strategy.md` | Tech Lead |
| Environments (dev/staging/prod) | `docs/engineering/environments.md` | Tech Lead + Production Manager |
| CI/CD pipeline | `docs/engineering/ci-cd-pipeline.md` | Production Manager |
| Feature flags | `docs/engineering/feature-flags.md` | Tech Lead |
| Database migrations | `docs/engineering/database-migrations.md` | Tech Lead + Data Engineer |
| Monitoring thresholds | `docs/engineering/monitoring-thresholds.md` | Data Engineer + Production Manager |
| Deploy checklist | `docs/deploys/checklist.md` | Production Manager |
| Secrets rotation | `docs/security/secrets-rotation.md` | Security Lead |
| Disaster recovery | `docs/governance/disaster-recovery.md` | Production Manager + Security Lead |
| Hotfix process | `docs/governance/hotfix-process.md` | Production Manager + PM |

---

## Final tool stack (locked)

| Concern | Tool | Plan | Monthly cost |
|---|---|---|---|
| Workflow orchestration | Inngest Cloud | Free (50K runs) | $0 |
| Agent observability | LangFuse Cloud | Free (50K events) | $0 |
| Ticketing intake UI | FreeScout (self-hosted) | Free | $0 |
| Error monitoring | Sentry | Developer (free) | $0 |
| Uptime monitoring | UptimeRobot | Free (50 monitors) | $0 |
| Vector store / KB | pgvector on Supabase | Existing tier | $0 (existing) |
| Secrets vault | Supabase Vault | Built-in | $0 |
| Model router | LiteLLM (self-hosted) | Open source | $0 |
| Eval framework | Promptfoo + LangFuse | Open source / free | $0 |
| PR review | CodeRabbit | Free tier | $0 |
| **Total fixed monthly** | — | — | **~$0** |

The only variable cost is LLM tokens through the Model Router (~$50–$300/mo at expected volumes).

---

## Decision authority

| Decision | Who decides |
|---|---|
| Add a new architectural module | Tech Lead proposes ADR → founder approves |
| Swap a tool (e.g., LangFuse → Helicone) | Tech Lead ADR → founder approves if migration cost > 8 hours |
| Tighten/loosen a guardrail | Security Lead → Tech Lead → founder for material changes |
| Add a new HITL gate category | Tech Lead → founder |
| Change daily cost budget per project | Founder only |
| Change provider preference | Tech Lead ADR (no founder approval needed if budget unaffected) |

All architectural decisions get an ADR in `docs/adr/NNNN-title.md` and a one-line entry in `DECISIONS.md`.

---

## How this file is used

This is the **single source of truth for HOW the hub is built.** When an agent needs to make a technical call, it reads this file plus the relevant policy document.

When the architecture evolves, this file gets updated and a new version is logged in `DECISIONS.md`. Agents always read the current version — they don't cache stale assumptions.
