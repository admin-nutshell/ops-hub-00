# 02 — Stakeholders

> Who has a stake in the Ops Hub working, how much power they hold, how interested they are, and how we engage them.

---

## Engagement strategy (Mendelow's grid)

The 16 stakeholders sort onto a power × interest matrix that drives engagement strategy:

| Quadrant | Engagement | Stakeholders |
|---|---|---|
| **High power, high interest** | **Manage closely** | Founder, active investors (raise mode), Al @ NIM (advisor), future ITS team members |
| **High power, low interest** | **Keep satisfied** | CFIA, privacy regulators (PIPEDA), future SOC 2 auditors, passive investors (post-raise) |
| **Low power, high interest** | **Keep informed** | TTS tenants (DNC, A-Mart), tenant end-users, future ITS project teams, AI agents (virtual team) |
| **Low power, low interest** | **Monitor** | AI providers (Anthropic, OpenAI, GLM, Kimi — BYOK-swappable), infrastructure vendors (Hostinger, Supabase, Coolify), open-source maintainers |

---

## Stakeholder Register

| # | Stakeholder | Layer | What they care about | Expectation from the hub | Engagement cadence |
|---|---|---|---|---|---|
| 1 | **Founder (Haytham)** | ITS firm | The hub working without consuming his week | Self-managing ops; < 5 hrs/wk involvement at steady state | Daily ops dashboard, weekly metric review |
| 2 | **Active investors** (Pre-Seed) | External capital | Differentiator + unit economics story | Hub as portfolio-multiplier, falling cost/ticket | Monthly written update, quarterly deep-dive |
| 3 | **Al @ NIM** | Technical advisor | Architecture soundness, OWASP discipline, security posture | Eval-gated changes, audit trail, security reviews | Ad-hoc on major decisions, quarterly review |
| 4 | **Future ITS team** | ITS firm | Sane onboarding, clear roles | Documented playbooks, working evals, low context load | Onboarding handbook + 1:1s when hired |
| 5 | **DNC (Daily Needs Canada)** | TTS tenant #1 | Reliable ticket resolution, transparent comms | Sub-1hr P1 response, clear status updates | Per-ticket comms, monthly tenant health email |
| 6 | **A-Mart YYC** (Nora Choi, Lydia Lee) | TTS pilot tenant | Same as DNC + pilot success | Same + dedicated pilot touchpoints | Bi-weekly during pilot, then standard cadence |
| 7 | **Future TTS tenants** | TTS | Predictable SLA, professional comms | Same as DNC | Per-ticket comms, monthly health |
| 8 | **Future ITS project teams** | ITS firm | Hub onboarding their product fast | < 1 week from charter to live | Onboarding playbook, scheduled office hours |
| 9 | **Tenant end-users** | Tenant employees | Their issue gets resolved | Polite, accurate, fast resolution | Auto-acknowledgment, milestone updates, resolution note |
| 10 | **CFIA** (Canadian Food Inspection Agency) | Regulator | TTS data integrity, traceability | Hub doesn't compromise CFIA-compliant data flow | Annual posture review, ad-hoc on regulatory change |
| 11 | **PIPEDA framework** | Regulatory framework | PII handling discipline | Encrypted-at-rest, audit log, breach response plan | Quarterly internal review against PIPEDA principles |
| 12 | **Future SOC 2 auditors** | Compliance | Immutable audit trail, change controls | Logs and policies ready when audit kicks off | Audit-prep cycle (annual once started) |
| 13 | **AI providers** (Anthropic, OpenAI, Z.AI, Moonshot) | Vendors | Hub uses their API | Standard API usage, BYOK | None — Model Router swaps providers without conversation |
| 14 | **Hostinger / Supabase / Coolify** | Infrastructure | Uptime + payment | Standard SLA | None unless incident |
| 15 | **Open-source maintainers** (LiteLLM, LangFuse, Inngest, FreeScout) | Software | Bug reports, contributions optional | Standard usage | Optional GitHub engagement |
| 16 | **AI agents themselves** | Internal "team" | Clear prompts, good evals, fair reviews | Treated as team members with performance metrics | Weekly eval review, prompt versioning, blameless post-mortems |

---

## Key design implications

A few non-obvious things this map surfaces — each one drives a deliberate architectural choice:

1. **The founder is currently the only "manage closely" stakeholder.** Until raise or hire, every other quadrant decision is the founder's alone. This concentrates risk but also means no committee slowing things down. Trade-off named, not hidden.

2. **Tenants are "keep informed," not "manage closely."** Deliberate. Tenants consume the hub's output; they don't design it. Letting tenant requests drive hub architecture is the fastest way to make it un-reusable across ITS projects.

3. **Regulators are satisfied by design, not by engagement.** CFIA, PIPEDA, and SOC 2 are appeased through *what the hub does* (audit trails, encryption, immutable logs), not *how often we talk to them*. Build it right the first time; talk rarely.

4. **AI providers are deliberately "monitor" status.** The Model Router + BYOK design makes this true. Without that abstraction, Anthropic would have been high-power-high-interest (a lock-in risk). With it, providers are swappable commodities. That's the entire strategic value of provider neutrality.

5. **Agents as virtual team members is a real frame.** Treating agents as stakeholders — with eval reviews, prompt versioning, "performance" metrics, and blameless post-mortems — is what separates a serious agent ops shop from a hobbyist setup.

---

## Communication Plan

| Cadence | Audience | What |
|---|---|---|
| **Daily** | Founder | Ops dashboard (SLA attainment, open tickets, agent costs, eval health) |
| **Per-ticket** | Tenant + tenant end-user | Auto-acknowledge, milestone updates, resolution |
| **Weekly** | Founder + agents | Eval review, prompt regressions, post-mortems for P1/P2 |
| **Bi-weekly** | A-Mart (during pilot) | Pilot status, KPI review, friction log |
| **Monthly** | All tenants | Tenant health email, SLA scorecard |
| **Monthly** | Active investors | Written update with metrics + hub progress |
| **Quarterly** | Al @ NIM, future advisors | Architecture & security review |
| **Quarterly** | Internal | PIPEDA posture self-check |
| **Annually** | CFIA | Regulatory posture review |
| **Audit-cycle** | SOC 2 auditors | Evidence pack from audit trail |

---

## How this file is used

The stakeholder map is the **boundary control system** for the hub. When a request, ticket, or feature idea comes in, the first question is *whose stake does this serve?* — and the answer drives priority.

A tenant request that doesn't move any "manage closely" stakeholder's metric forward is a polite decline. A request that helps multiple quadrants at once is a prioritization win.
