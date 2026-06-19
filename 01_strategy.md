# 01 — Strategy

> Why the Ops Hub exists, who wins when it works, and how we know.

---

## Vision

> *An app-agnostic, AI-native operations platform that runs maintenance, debugging, and customer support autonomously for every In a Tech-Shell product — starting with TTS as Project #1 and provider-neutral so every new ITS product plugs in through configuration, not code.*

## Mission

> *Detect, triage, resolve, and document production issues across every ITS project using any AI provider the founder chooses (Claude, OpenAI, GLM, Kimi, or future entrants) — with sub-1hr P1 response, >95% SLA attainment, and minimal founder involvement at any scale of project or tenant.*

---

## Strategic Role (four frames at once)

| Role | What it means | Priority |
|---|---|---|
| **Internal infrastructure for ITS** | Every future ITS product gets ops-day-1 instead of building from scratch | **Primary** |
| **Competitive moat** | "Agent-run 24/7 support" is undefendable for legacy competitors (Descartes, SAP GTS) without a years-long investment | Co-primary |
| **Sellable feature** | Premium SLA add-on at +$200/mo per project | Secondary |
| **Future product** | Potentially "Ops in a Tech-Shell" as a separate SaaS down the line | Long horizon |

**Primary frame for trade-offs:** when in doubt, optimize for **tenant experience** first, cost second — within budget.

---

## Architectural commitments from this dimension

The Strategy commits the Architecture to three additional modules beyond the 8 standard ops concerns:

| Module | Purpose | Owner agent |
|---|---|---|
| **Project Context schema** | Per-project config: app details, business logic, RBAC, escalation rules, SLA targets | Tech Lead + Knowledge Lead |
| **API Vault** | Secure per-project storage of provider credentials | Security Lead |
| **Model Router** | Provider-agnostic LLM abstraction | Tech Lead |

These are non-negotiable consequences of the platform reframe.

---

## Success Metrics

| Category | Metric | 6-month target | 12-month target |
|---|---|---|---|
| **Speed** | MTTR P1 | < 4 hr | < 1 hr |
| **Speed** | MTTR P2 | < 24 hr | < 4 hr |
| **Speed** | MTTR P3 / P4 | < 72 hr | < 48 hr |
| **Quality** | First-contact resolution | > 50% | > 70% |
| **Quality** | CSAT (tenant satisfaction) | > 4.0 / 5 | > 4.5 / 5 |
| **Reliability** | SLA attainment | > 90% | > 95% |
| **Efficiency** | Cost per ticket (CAD) | < $5 | < $2 |
| **Efficiency** | Founder time on support | < 10 hr/wk | < 5 hr/wk |
| **Growth** | KB articles published per month | 5+ | 15+ |
| **Growth** | Premium SLA adoption | 1 tenant | 3+ tenants |
| **Reusability** | New project onboarding time | n/a (only TTS live) | < 1 week from charter to live |
| **Provider neutrality** | Projects with ≥ 2 providers configured | TTS only | 100% of active projects |
| **Cost optimization** | % of calls routed to cheapest-suitable model | n/a | > 60% |

---

## Business Case

### Direct cost saved (CAD)

- Replaces **0.2–1+ FTE** of a Canadian support engineer = **$16K–$120K/yr** at full ramp
- Founder dev time reclaimed for product work — the largest single ROI for a solo founder

### Revenue enabled — Premium SLA add-on (+$200 CAD/mo per tenant)

| TTS tenants | 30% adoption | Monthly | Annual |
|---|---|---|---|
| 5 | ≈ 1 tenant | $200 | $2,400 |
| 10 | ≈ 3 | $600 | $7,200 |
| 25 | ≈ 8 | $1,600 | $19,200 |
| 50 | ≈ 15 | $3,000 | $36,000 |

### Strategic value (harder to quantify but real)

- **Reusable infrastructure:** every future ITS product launch saves ~3–6 months of ops scaffolding work
- **Vendor neutrality:** cost-optimize by routing to cheapest-suitable model, switch providers without lock-in
- **Indirect revenue:** deals won because "agent-run 24/7 support" is on your slide and not on competitors'

### Investor narrative (Pre-Seed deck)

- Demonstrates AI-native operations (strong 2026 thesis fit)
- Gross margin per tenant *improves* with scale (per-ticket cost falls)
- Clear path to 100+ tenants without 100+ support engineers
- Premium SLA add-on shows monetizable ops differentiation, not just product features

---

## Decision Rule — "Is the hub working?"

At **month 12**, the hub is **working** if all six tests pass:

- ✅ ≥ 4 of 5 SLA targets being met
- ✅ CSAT > 4.5 / 5
- ✅ Cost per ticket < $2 CAD
- ✅ Founder time on support < 5 hrs / week
- ✅ ≥ 3 paying tenants on Premium SLA
- ✅ ≥ 2 providers configured per active project (provider neutrality test)

If **three or more** of these are missed, we **re-architect** — not patch.

This rule prevents the most common internal-tooling failure mode: keeping something on life support past its expiry because nobody wrote down what success was supposed to look like.

---

## Time Horizon

| Month | What's true | Anchor proof |
|---|---|---|
| **6** | Hub MVP operational. TTS (Project #1) running on it. Multi-provider routing live. | First P1 resolved end-to-end via Model Router → Claude call, with zero founder touch |
| **12** | Hub at full feature set. Project #2 onboarded. 5–10 TTS tenants on Premium SLA. | First non-TTS project goes live in < 1 week from charter |
| **24** | 3–5 ITS projects on the hub. 50+ TTS tenants. Hub is the headline slide for follow-on raise. | Investor follow-on cites the hub as portfolio multiplier, not just a TTS feature |

---

## How this file is used

**Every later decision is filtered through Strategy.** When picking between two tools, two policies, two pricing experiments — the question is always: *which one moves us toward these metrics?*

If the answer to that question isn't clear, that's a flag to revisit Strategy before committing.
