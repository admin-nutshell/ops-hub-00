# ADR-0002 — Tool Stack Rationale

- **Status:** Accepted
- **Date:** 2026-06-18
- **Author:** Tech Lead
- **Deciders:** Tech Lead (proposer); founder pre-approved the stack at the planning stage (`DECISIONS.md`, 2026-06-18 — "Approved tool stack: Inngest + LangFuse + LiteLLM + Supabase Vault + Promptfoo + FreeScout + Cstate")
- **Supersedes:** none
- **Related:** `04_architecture.md` ("Final tool stack (locked)"), ADR-0001, `docs/engineering/ci-cd-pipeline.md`

---

## Context

The Ops Hub needs tooling for the 8 operational concerns and the 3 platform modules described in `04_architecture.md`. The founder already approved the stack at planning time; this ADR is the **decision-record of why each tool was chosen over its alternatives, and what the self-host fallback is when a free tier is exhausted.** It exists so that six months from now — or when a quarterly tool-stack review happens, or when a free-tier limit bites — the reasoning is on record and the swap criteria are explicit, rather than re-litigated from memory.

Two standing rules govern every choice here, both locked in `DECISIONS.md` (2026-06-18):

1. **Free-tier-first** — only pay when a feature is crucial AND demonstrably saves time or improves quality.
2. **Provider-neutral via BYOK** — no architectural lock-in to a single LLM provider; the Model Router is the seam that guarantees this.

A corollary the founder set in `04_architecture.md` under "Decision authority": swapping a tool needs a Tech Lead ADR, and founder approval only if migration cost exceeds 8 hours. Choosing tools whose data we can export and self-host keeps every one of these swaps cheap.

---

## Decision

Adopt the seven-tool stack below. For each: **what it does**, **why over the alternatives**, and **the self-host / exit fallback when the free tier is exhausted.** Every tool is either open-source-and-self-hostable or has a documented fallback that is, so no choice creates lock-in beyond what an ADR could reverse in under the 8-hour threshold.

### Summary table

| Concern | Tool | Plan now | Cost | Self-host / exit fallback |
|---|---|---|---|---|
| Workflow orchestration | Inngest | Cloud free (50K runs/mo) | $0 | Self-hosted Inngest on VPS |
| Agent observability | LangFuse | Cloud free (50K events/mo) | $0 | Self-hosted LangFuse on VPS |
| Model router | LiteLLM | Self-hosted on VPS | $0 | Already self-hosted (it *is* the fallback layer) |
| DB + Vault + vector | Supabase | Existing paid project | $0 marginal | Self-hosted Supabase / plain Postgres + pgvector + pgsodium |
| Evals | Promptfoo | OSS CLI in CI | $0 | None needed — runs locally/in CI, no service |
| Ticket intake | FreeScout | Self-hosted on VPS | $0 | Already self-hosted |
| Status page | Cstate | Static site generator | $0 | Already static — host anywhere |

---

### 1. Inngest — workflow orchestration

**What it does.** Durable workflow engine that hands tickets between agents, retries failed steps, enforces concurrency (prevents two agents working one ticket), and provides human-in-the-loop pause/resume steps (used for FOUNDER_QUEUE gates). Steps are durable: a crash resumes from the last completed step, not the start.

**Why over alternatives.**
- *vs. Temporal:* Temporal is more powerful but heavier — it wants its own cluster and a steeper operational model. Inngest's event-driven, step-function model is vibe-coder-friendly and has a managed free tier that needs zero infra. At our scale, Temporal's power is unearned complexity.
- *vs. raw cron + queues (BullMQ/Redis):* would force us to build durability, retries, observability, and HITL gates ourselves. That's the exact undifferentiated plumbing Inngest gives us for free.
- *vs. n8n / Make:* visual-first low-code tools, not code-first; poor fit for prompts-as-code and eval-gated CI.

**Self-host fallback.** Inngest is open source and self-hostable on the VPS. **Trigger:** exceed 50K runs/mo on the Cloud free tier. **Decision rule (from `04_architecture.md`):** move to self-hosted Inngest *before* paying for the Pro tier — keeps cost at $0. Self-hosting is the fallback, not the Pro plan. Note for ADR-0001 sizing: self-hosted Inngest adds VPS load; re-check headroom at that point.

### 2. LangFuse — agent observability

**What it does.** LLM-native tracing: every prompt, completion, token count, latency, cost, and reasoning trace, organized per project/tenant/agent. It also stores eval results for trend comparison (paired with Promptfoo, §5). It is how we see system behavior at scale and how the Evals Lead detects silent prompt regressions.

**Why over alternatives.**
- *vs. Helicone:* Helicone is a proxy-first model; LangFuse's SDK-first tracing gives richer nested spans for multi-step agent workflows and integrates natively with LiteLLM. LangFuse is also straightforwardly self-hostable, which Helicone's hosted-first model makes less clean.
- *vs. generic APM (Datadog/Grafana):* not LLM-aware — no notion of prompt/completion/token/cost as first-class. We'd be bolting LLM semantics onto a metrics tool.
- *vs. build-our-own on Supabase:* possible, but reinvents trace UI, cost rollups, and eval comparison we'd otherwise get free.

**Self-host fallback.** LangFuse is open source and self-hostable on the VPS. **Trigger:** exceed 50K events/mo or need >30-day retention on the Cloud free tier. **Sizing caveat (cross-ref ADR-0001 §6):** self-hosted LangFuse brings Postgres + ClickHouse and is the single largest potential VPS consumer in the stack — re-run the VPS sizing assessment before self-hosting it; this is the most likely event to force a VPS resize.

### 3. LiteLLM — model router (Platform Module C)

**What it does.** Provider-agnostic LLM abstraction. Exposes one OpenAI-compatible API; translates to 100+ models (Claude, OpenAI, GLM, Kimi, Gemini, OpenRouter, local). Provides built-in fallback chains (primary down → secondary), per-project/per-provider cost tracking, and prompt-caching support. **It is the architectural seam that makes the "provider-neutral via BYOK" rule real** — agents request a *capability* ("investigation model for TTS"), never a vendor or a key.

**Why over alternatives.**
- *vs. direct provider SDKs:* would hard-wire each agent to a vendor, violating the provider-neutral rule and making BYOK (Phase 3) a rewrite instead of a config change.
- *vs. OpenRouter as the only abstraction:* OpenRouter is itself a hosted gateway (a vendor + a margin + a dependency). We keep it as *one routable provider behind* LiteLLM, not as the abstraction layer. LiteLLM self-hosted means the routing logic, fallback chains, and cost data live with us.
- *vs. LangChain/LlamaIndex routing:* heavier framework lock-in; we want a thin, swappable proxy, not a framework.

**Self-host fallback.** LiteLLM is **already self-hosted** on the VPS — it is itself the resilience layer. Its own fallback mechanism (provider A → provider B) is how we survive an LLM provider outage (a Medium risk in the register). There is no upstream free tier to exhaust. Exit cost is low: it speaks the OpenAI protocol, so replacing it means re-pointing a base URL.

### 4. Supabase — database + Vault + vector (Platform Modules A-mirror & B; Concern 5)

**What it does.** Three jobs in one already-paid service:
- **Postgres** — the Ops Hub's relational store (tickets, tenants, projects, audit_log, feature_flags, kb_articles; see the schema design doc and ADR-driven migrations).
- **pgvector** — the KB / shared-memory vector store, per-project namespaced (Concern 5).
- **Supabase Vault** — encrypted-at-rest storage for LLM provider credentials, scoped per project/env (Platform Module B). Only the Model Router reads keys; agents never see raw credentials.

Critically, Supabase gives us **Row-Level Security (RLS)** — the database-layer tenant isolation boundary that is non-negotiable from day one.

**Why over alternatives.**
- *vs. separate Postgres + Pinecone + HashiCorp Vault:* three vendors, three bills, three integrations, three audit surfaces — to do what one already-paid Supabase project does. pgvector is sufficient for our retrieval volume; a dedicated vector DB is unearned at this scale.
- *vs. Pinecone/Weaviate for vectors:* recurring cost and a second data home that complicates the per-tenant isolation story (we'd have to reproduce RLS-equivalent isolation in the vector DB). Keeping vectors in the same Postgres that enforces RLS keeps the isolation model in one place.
- *vs. building our own encrypted secret store:* rolling our own crypto is a standing anti-pattern; Vault (pgsodium-backed) is audited and built-in.

**Self-host fallback.** Supabase is open source and fully self-hostable; the underlying pieces are plain Postgres + pgvector (extension) + pgsodium (Vault crypto). If the managed tier ever became a constraint, we self-host on the VPS with no schema change — our migrations are vanilla SQL. **Vault-specific fallback (from `04_architecture.md`):** Coolify env secrets are the simpler fallback for v1 if Vault setup slips, but Vault is the target because it gives per-key access audit logging that env vars cannot.

### 5. Promptfoo — evals

**What it does.** Runs the eval suite that gates every PR touching prompts, agents, the Model Router config, or the Project Context schema. Declarative YAML test cases per agent; pass/fail with assertions; runs in CI (GitHub Actions). Results published to LangFuse for trend tracking. This is what makes "no prompt regresses silently" enforceable rather than aspirational.

**Why over alternatives.**
- *vs. LangSmith evals:* ties evals to the LangChain ecosystem and a hosted vendor; Promptfoo is provider-neutral and runs anywhere, matching our provider-neutral rule.
- *vs. custom pytest/jest eval harness:* we'd rebuild assertion types (semantic similarity, rubric grading, JSON-schema checks) and the matrix runner. Promptfoo provides these and is config-first, fitting prompts-as-code.
- *vs. Braintrust / other hosted eval SaaS:* recurring cost and another vendor for something a CLI does for free.

**Self-host fallback.** None required — Promptfoo is an OSS CLI with **no hosted service to exhaust.** It runs in GitHub Actions (CI minutes are the only budget, covered by the GitHub Free allowance) and locally. Its "storage" of record is LangFuse, which has its own fallback (§2). Lowest-lock-in tool in the stack.

### 6. FreeScout — ticket intake

**What it does.** The ticket intake UI and inbox. Tenants (and internal sources like DNC) submit tickets; FreeScout is where they land before triage hands them to the agent workflow (Inngest). Self-hosted shared inbox / help-desk.

**Why over alternatives.**
- *vs. Zendesk / Intercom / Freshdesk:* all recurring per-seat SaaS — directly against free-tier-first, and overkill for a single-product Phase 1.
- *vs. building our own intake UI now:* the Frontend Engineer's scope is deliberately minimal in Sprint 1 (`WORK.md`); FreeScout gives a working, battle-tested inbox immediately so engineering effort goes to the agent workflow, not CRUD for tickets. A custom portal can come later behind the same data model.
- *vs. plain email + a Supabase table:* loses threading, assignment, status, and a usable human inbox for the founder/agents to inspect.

**Self-host fallback.** FreeScout is **already self-hosted** (PHP app + its own DB on the VPS) — there is no upstream free tier to exhaust. The exit path if we outgrow it is the custom portal on our own ticket data model; tickets already live in our Supabase `tickets` table (FreeScout is intake, not the system of record), so swapping the intake UI does not migrate the data of record.

### 7. Cstate — status page

**What it does.** Public status page (`status.inatechshell.ca`) communicating incident state to tenants. v1 is manually updated (per `09_delivery.md` Phase 1 scope); Phase 2 wires automatic updates from monitoring signals.

**Why over alternatives.**
- *vs. Statuspage.io / Better Uptime hosted status:* recurring SaaS cost for a page we can generate statically for free.
- *vs. a hand-rolled HTML page:* Cstate gives incident history, RSS/JSON feeds, and a maintained template for nearly the same effort as raw HTML, while staying a static site.

**Self-host fallback.** Cstate is a **static site generator** — output is plain HTML hosted anywhere (GitHub Pages, the VPS, any object store). No service, no free tier to exhaust, no lock-in. Lowest-risk tool in the stack alongside Promptfoo.

---

## Options considered (at the stack level)

### Option A — The seven-tool free-tier/self-host stack above (CHOSEN)

- **Pros:** ~$0 fixed monthly cost; every tool is OSS-and-self-hostable or has a documented fallback that is; provider-neutral preserved by LiteLLM; every swap is reversible under the 8-hour ADR threshold; data of record (tickets, traces, secrets) lives in systems we can export.
- **Cons:** More moving parts than a single integrated SaaS; some operational burden (we run LiteLLM + FreeScout, and possibly self-host Inngest/LangFuse later); free tiers have ceilings we must monitor.

### Option B — Single integrated commercial platform (e.g., a LangSmith- or Datadog-centric stack)

- **Pros:** Fewer integrations; one vendor relationship; less self-host ops.
- **Cons:** Recurring cost from day one; vendor lock-in (>12-month commitment — an escalation trigger); ties us to one ecosystem's view of agents/evals, weakening provider-neutrality. **Rejected:** violates free-tier-first and the no-lock-in quality bar with no offsetting need at our scale.

### Option C — Build more in-house (own orchestrator, own trace store, own eval harness)

- **Pros:** Zero third-party dependency; total control.
- **Cons:** Rebuilds undifferentiated plumbing (durability, retries, trace UI, eval matrix) the chosen OSS tools provide for free; slows M1 dramatically; a small team should not maintain a workflow engine and an observability platform. **Rejected:** "allergic to over-engineering" — this is the over-engineered branch.

### Option D (do-nothing) — Pick tools per-task, no recorded stack

- **Cons:** No coherence, divergent choices across agents, no fallback rules, no swap criteria. **Rejected** — this ADR exists specifically to prevent it.

---

## Consequences

**Positive**
- Fixed cost held at ~$0; only LLM tokens vary (~$50–$300/mo at expected volume).
- Every tool has a written exit/fallback, so no choice here is a >12-month vendor commitment requiring founder escalation today.
- Provider-neutrality is structurally enforced (LiteLLM), not just a policy.

**Negative / risks accepted**
- Free-tier ceilings (Inngest 50K runs, LangFuse 50K events) must be monitored; crossing them triggers self-host work, which adds VPS load (ties to ADR-0001 §6 sizing trigger).
- Operating several self-hosted services is real ops burden, owned by the Production Manager and the DR plan.

**Follow-ups**
- Data Engineer: monitor Inngest run count and LangFuse event count monthly; alert at 70% of free-tier limit (gives lead time before the self-host scramble).
- Tech Lead: quarterly tool-stack review (per `99_master_plan.md` founder cadence) re-checks each fallback trigger.
- Any self-host migration (Inngest, LangFuse) gets its own short ADR recording the trigger that fired and the VPS sizing re-check.
