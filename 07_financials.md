# 07 — Financials

> What the hub costs to operate, what it earns, how prices flow, and what story it tells investors.

---

## Standing rule

**Free tier first.** Only pay for a tool when a feature is crucial AND demonstrably saves time or improves quality. This rule drives the tool-stack table below.

---

## Tool stack — free vs paid recommendation per concern

Because the Coolify VPS is already paid (and shared with TTS prod), almost every tool runs at **$0/month** for the first ~12 months. The only real recurring cost is LLM tokens.

| Concern | Free option (recommended) | Paid alternative | Decision |
|---|---|---|---|
| **Workflow orchestration** | Inngest Cloud free tier (50K runs/mo, 5 concurrent steps, 3 users) — OR — self-host Inngest on the VPS | Inngest Pro: $75/mo for 1M executions | **Start free.** Migrate to self-host or Pro only if 50K runs/mo exceeded. |
| **Agent observability** | LangFuse Cloud free (50K events/mo, 30-day retention) — OR — self-host on the VPS | LangFuse Pro: $29/mo for 100K events | **Start free.** Self-host if retention or volume becomes a constraint. |
| **Ticketing system (intake UI)** | FreeScout (lightweight PHP) or Zammad (modern UI) — self-host on the VPS | Zendesk / Help Scout: $25+/agent/mo | **FreeScout.** Lightest to deploy. Zammad if a more polished agent UI is later needed. |
| **Monitoring (errors)** | Sentry Developer tier (5K errors/mo) — already wired to TTS | Sentry Team: $26/mo | **Stay on free Developer tier.** |
| **Monitoring (uptime)** | UptimeRobot free (50 monitors) — already wired | UptimeRobot Pro: $7/mo | **Stay free.** |
| **Knowledge / vector store** | pgvector on existing Supabase | Pinecone, Weaviate Cloud | **pgvector.** Already paid. |
| **Secrets vault** | Supabase Vault (encrypted, built-in) + Coolify env vars | Doppler, HashiCorp Vault | **Supabase Vault + Coolify.** |
| **Model router** | LiteLLM (open source) self-hosted on the VPS | OpenRouter (takes margin), Portkey | **LiteLLM.** Open source, no margin take. |
| **Eval / prompt testing** | Promptfoo (open source CLI) + LangFuse built-in evals | Braintrust ($249/mo) | **Promptfoo + LangFuse.** |
| **PR review** | CodeRabbit free (public repos) | CodeRabbit Pro (private repos) | **Verify free-tier fit at install. Move to Pro only if crucial.** |

**Total fixed monthly tool cost: ~$0** for the first ~12 months.

---

## Operating budget — Year 1 (CAD)

| Category | Item | Monthly | Notes |
|---|---|---|---|
| Infrastructure | Hostinger VPS | already paid | Shared with TTS prod |
| Tools | Workflow / observability / ticketing / monitoring / KB / vault / router / evals | **$0** | All free tiers or self-hosted |
| LLM tokens | Claude / OpenAI / GLM / Kimi (variable, per Model Router routing) | $50–$300 | Scales with volume |
| Domain / SSL | Subdomain for ticket portal | already paid | Traefik on Coolify |
| **Year-1 fixed (new)** | — | **~$0/mo** | — |
| **Year-1 variable** | — | **~$50–$300/mo** | Depends on ticket volume |

For the first 6 months at current tenant count (DNC + A-Mart pilot), the whole hub probably costs **under $100/month** in net new spend.

---

## Per-ticket cost model

Current Claude API pricing (verified June 2026):

| Model | Input ($/MTok) | Output ($/MTok) |
|---|---|---|
| Haiku 4.5 | $1.00 | $5.00 |
| Sonnet 4.6 | $3.00 | $15.00 |
| Opus 4.8 | $5.00 | $25.00 |

Prompt caching = **90% discount** on cached reads. Batch API = **50% off** everything.

A realistic agent-run ticket fires off multiple LLM calls across triage → investigation → fix → QA → customer comms → documentation. Independent benchmarks put a typical agent bug-fix at **$0.54** on Sonnet 4.6 and **$0.90** on Opus 4.8 for a 25-call agent profile with 75% cache hits.

### Formula

```
Cost per ticket = (LLM tokens × rate) 
               + (HITL minutes × loaded hourly) 
               + (fixed costs / ticket volume)
```

### Volume scenarios

(Smart-routing: Haiku for triage/comms, Sonnet for investigation/fix, Opus only for hard P1s.)

| Volume | Marginal LLM/ticket | Fixed allocation | Total/ticket | Monthly LLM bill |
|---|---|---|---|---|
| **50/mo** (today) | $1.00–$2.00 | $0 | $1–$2 | $50–$100 |
| **500/mo** (year 2) | $0.80–$1.50 | $0–$0.15 | $0.80–$1.65 | $400–$825 |
| **5,000/mo** (scale) | $0.50–$1.00 | $0.01–$0.05 | $0.51–$1.05 | $2,550–$5,250 |

**Investor story:** per-ticket cost falls as volume scales — fixed costs amortize, prompt caching efficiency rises. This is the unit-economics narrative for AI-native ops.

---

## Pricing impact on TTS — Option D (locked)

| Component | Decision |
|---|---|
| **Base TTS tiers** | Unchanged at ~$300 / $700 / $1,200/mo CAD |
| **Basic agent support** | **Included in every tier** as a feature ("AI-powered support hub") |
| **Premium SLA add-on** | **+$200 CAD/mo** — 24/7 coverage, sub-1hr P1 response, dedicated escalation |

**Why Option D:** A-Mart hasn't signed yet, so a base-price change creates friction. "Agent-run 24/7 support included" is a marketing line vs. legacy competitors. The +$200 SLA add-on is pure margin once the system is built.

---

## Three-layer cost model

The hub serves multiple layers; each owns distinct costs:

- **Layer 1 — Ops Hub** (platform, built once, used by all projects)
- **Layer 2 — ITS Projects** (TTS today, future ITS products tomorrow)
- **Layer 3 — Tenants of a project** (DNC, A-Mart for TTS)

### Who bears each cost (v1)

| Cost line | Who pays | Notes |
|---|---|---|
| Hub infrastructure (VPS + self-hosted tools) | ITS (founder) | Sunk cost. Coolify VPS hosts everything. |
| LLM tokens for TTS tickets | **TTS** (the project) | TTS's API keys, TTS's bill, factored into TTS pricing |
| LLM tokens for future project tickets | Each project owns its own keys + bill | Per-project COGS, tracked by Model Router |
| Premium SLA revenue | The project charging it | Flows to project, not to hub |
| Tenant subscriptions | TTS (or whichever project) | Tenants pay the project, never the hub |

### TTS unit economics

```
TTS gross margin per tenant = Subscription 
                            + Premium SLA add-on 
                            - Allocated LLM cost 
                            - Allocated VPS share 
                            - Other COGS
```

---

## BYOK clarification

**Per-project BYOK** (each ITS project owns its keys) is the **default v1**. Every project has its own API Vault entry.

The **deeper BYOK question** — should a TTS *tenant* like A-Mart supply their own keys? — is **Phase 2**, not v1:

| Scenario | When it makes sense | Cost effect |
|---|---|---|
| **Default v1: TTS-owned keys** | Most tenants. Keeps onboarding and billing simple. | TTS bears LLM cost, prices it in. |
| **Phase 2: Enterprise-tenant BYOK** | Tenant has data sovereignty or billing-transparency needs | Tenant bears LLM cost. TTS charges only for hub access + support time — higher-margin SKU. |

For v1, every tenant uses TTS-owned keys. Phase 2 enterprise BYOK is a future upsell to the largest tenants.

---

## ROI / Business Case

### Direct cost saved

- 1 Canadian support engineer fully loaded = $80K–$120K CAD/yr
- At 50 tickets/mo, hub replaces ≈ 0.2 FTE → **$16K–$24K/yr** saved today
- At 500 tickets/mo, hub replaces ≈ 1 FTE → **$80K–$120K/yr** saved
- Importantly: it scales **without proportional headcount** — tenant 5 and tenant 500 are the same team size

### Time reclaimed

- Founder dev time stays on product, not firefighting
- The largest single ROI for a solo founder — priceless when raising

### Tenant retention

- 24/7 sub-1hr response on P1 is a churn-killer vs. competitors who reply business-hours-only
- Indirect revenue: deals won because "agent-run 24/7 support" is on your slide

### Investor narrative (Pre-Seed)

- AI-native operations — strong 2026 thesis fit
- Gross margin per tenant *improves* with scale
- Path to 100+ tenants without 100+ support engineers
- Hub itself is potentially productizable for other Canadian SaaS — Phase 3 upside

---

## How this file is used

Financials gates every tool choice (free-tier-first rule), every pricing change (impacts on the unit-economics model above), and every Pre-Seed deck conversation (numbers must trace back to this file).

Any deviation from these numbers gets logged in `DECISIONS.md` with rationale.
