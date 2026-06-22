# KB Taxonomy — Ops Hub Knowledge Base

**Author:** Knowledge Lead
**Date:** 2026-06-21
**Status:** Active — v1.0

---

## Purpose

This document defines the taxonomy, naming conventions, embedding model, and search pattern for the Ops Hub knowledge base. Every KB article stored in `kb_articles` must fit one of the six categories below. Agents and the Data Engineer pipeline use this taxonomy to classify new content, route retrieval queries, and measure coverage gaps.

The `kb_articles` table lives in Supabase (pgvector). See `supabase/migrations/20260618120000_initial_schema.sql` for the schema and `20260618120100_enable_rls_policies.sql` for the RLS policies that enforce project-scoped isolation.

---

## Categories

### 1. `runbooks`

**Purpose:** Step-by-step procedures for recurring operational tasks or known failure modes. A runbook answers "what do I do right now?" — it does not explain why the failure occurs.

**Who creates articles:** Knowledge Lead (after identifying a pattern), Production Manager (after a deploy incident), QA Manager (after a test failure that revealed an undocumented fix path).

**Example titles:**
- `FreeScout → Ops Hub ticket intake runbook`
- `LiteLLM API error — retry and failover steps`
- `Coolify deploy stuck — force-redeploy runbook`

**Retention policy:** No runbook article may go unreviewed for more than 90 days. If the underlying system has changed (image, config, dependencies), the article must be updated or retired. Retired runbooks are soft-deleted: mark `body` with `RETIRED (date): reason`, do not hard-delete rows.

---

### 2. `incident-postmortems`

**Purpose:** Permanent record of incidents that reached production or degraded service quality. Each post-mortem captures root cause, timeline, contributing factors, remediation taken, and at least one follow-up action (a KB article or runbook entry derived from the incident).

**Who creates articles:** Knowledge Lead authors; PM and Production Manager contribute timeline/impact data.

**Example titles:**
- `2026-06-21 — FreeScout DB connection timeout (P2)`
- `2026-06-29 — LiteLLM rate limit exceeded during batch triage (P1)`

**Retention policy:** Post-mortems are permanent records. They are never deleted or retired. Stale-article policy (90-day re-validation) does not apply.

---

### 3. `architecture-decisions`

**Purpose:** Summaries of ADRs (from `docs/adr/`) translated into plain language for operators and tenants. An ADR lives in the docs tree and is owned by the Tech Lead; this category holds the KB-layer digest — what it means operationally, what questions it answers at runtime.

**Who creates articles:** Knowledge Lead, triggered when the Tech Lead publishes a new ADR.

**Example titles:**
- `Why Inngest for async jobs (ADR-0002 summary)`
- `Environment topology: dev/staging/prod on shared VPS (ADR-0001 summary)`

**Retention policy:** Re-validate whenever the source ADR is superseded or amended. Tag with the ADR number for retrieval linkage.

---

### 4. `onboarding`

**Purpose:** Getting-started material for new tenants, new operators, and new agents. Covers platform orientation, account setup, and the ticket lifecycle. Content here is the first thing a new user should read.

**Who creates articles:** Knowledge Lead (for platform content), Solutions Architect (for project-specific tenant onboarding), PM (for process/workflow orientation).

**Example titles:**
- `Ops Hub — Getting Started`
- `How to submit a support ticket (tenant guide)`
- `New operator orientation — agent roles and ticket states`

**Retention policy:** Re-validate every 90 days or whenever the ticket state machine or agent roster changes.

---

### 5. `troubleshooting`

**Purpose:** Diagnosis guides for known error conditions, misconfiguration patterns, and integration failures. Differs from runbooks in that troubleshooting articles explain the problem space and offer branching diagnosis paths; runbooks are purely prescriptive.

**Who creates articles:** Knowledge Lead (from closed tickets and post-mortems), QA Manager (from test failures), Tech Lead (from architecture-level failure modes).

**Example titles:**
- `Supabase connection refused — common causes and checks`
- `pgvector ANN index not returning results`
- `Inngest event not received by handler`

**Retention policy:** 90-day re-validation. Cross-reference with the `runbooks` category: if a troubleshooting article consistently leads to the same fix, promote that fix path to a runbook.

---

### 6. `api-reference`

**Purpose:** Developer-facing reference for internal APIs, agent SDKs, webhook contracts, and integration endpoints. Covers request/response shapes, authentication patterns, and rate-limit behaviour.

**Who creates articles:** Knowledge Lead (from PR-merged feature changes), Data Engineer (for embedding/RAG API surface), Tech Lead (for platform API contracts).

**Example titles:**
- `Ops Hub REST API — ticket endpoints`
- `LiteLLM proxy — embedding endpoint reference`
- `FreeScout webhook payload schema`

**Retention policy:** Re-validate within 48 hours of any PR that changes an API contract. Mark articles `DRAFT` when the referenced API is in active development.

---

## Article naming convention

All article titles follow this pattern:

```
<Subject> — <action or descriptor>
```

- Use an em dash ( — ) as the separator, not a hyphen or colon.
- Subject is the system, project, or concept being documented.
- Action/descriptor is a gerund phrase or short noun phrase.
- No trailing punctuation in the title.
- Incident post-mortems prefix with the ISO date: `YYYY-MM-DD — <subject> (<severity>)`.

Examples of correct titles:
- `FreeScout → Ops Hub ticket intake runbook` (arrow acceptable for intake-path runbooks)
- `Ops Hub — Getting Started`
- `2026-06-21 — FreeScout DB connection timeout (P2)`

Examples of incorrect titles:
- `Ops Hub Getting Started` (missing separator)
- `FreeScout: ticket intake` (colon instead of em dash)
- `Getting started with the Ops Hub.` (trailing period)

---

## Embedding model

The `embedding` column in `kb_articles` is `vector(1536)`, dimensioned for **OpenAI `text-embedding-ada-002`** (1536 dimensions). This is a documentation note, not a hardcoded constraint in the KB structure itself. The Data Engineer pipeline sets the embedding model at query time. If the default embedding model changes, a Data Engineer migration must re-embed all existing rows and update this document.

ANN index note: the `ivfflat` or `hnsw` index on the `embedding` column is intentionally deferred until the Data Engineer populates real vectors. An ANN index over null or empty vectors has nothing to train on and returns incorrect results. The schema migration comment in `20260618120000_initial_schema.sql` references "T-20" as the trigger for adding the index — that comment predates the decision to defer it. The index is added by the Data Engineer as part of the T-09 follow-up embedding pipeline, not during KB structure initialization.

---

## Search pattern — mandatory cross-tenant isolation rule

Every KB query **must** filter by `project_id` before applying the vector similarity operator. Never run a cross-tenant vector search.

Correct pattern:
```sql
select id, title, body, embedding <=> $2 as distance
from kb_articles
where project_id = $1          -- ALWAYS first
order by embedding <=> $2
limit $3;
```

Incorrect (cross-tenant leak risk):
```sql
-- WRONG: no project_id filter
select id, title, body
from kb_articles
order by embedding <=> $1
limit 10;
```

This rule is enforced at the application layer by convention and at the database layer by the `kb_articles_select` RLS policy in `20260618120100_enable_rls_policies.sql`, which gates reads on `current_project_id()`. Both layers must hold — RLS is the safety net, not the primary enforcement.

---

## RAG quality targets

| Metric | Target | Measurement |
|---|---|---|
| KB freshness | No article > 90 days without re-validation (except post-mortems) | Monthly KB review |
| Retrieval accuracy | ≥ 85% on benchmark queries | LangFuse trace analysis |
| Feature Adaptation latency | Every merged PR triggers KB update within 24 h | LangFuse trace timestamps |
| Post-mortem KB yield | Every post-mortem produces ≥ 1 KB or runbook artifact | Post-mortem checklist |

---

## Taxonomy map

```
kb_articles
├── runbooks/              (prescriptive: what to do)
├── incident-postmortems/  (permanent: what happened)
├── architecture-decisions/(digest: what it means operationally)
├── onboarding/            (orientation: where to start)
├── troubleshooting/       (diagnostic: why it's broken)
└── api-reference/         (reference: how it works)
```

The `category` is tracked as a tag in the article body or as a prefix convention — the `kb_articles` table v1 does not have a dedicated `category` column. If retrieval analysis shows category filtering improving recall, add a `category text` column and index in a future migration.
