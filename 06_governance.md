# 06 — Governance

> How we stay safe, compliant, and disciplined as the Ops Hub grows. Three sections: risk register, change management of the plan itself, and compliance posture.

---

## Section 1 — Risk register

### Scoring scale

| Severity | Meaning |
|---|---|
| **High** | Existential or contract-breaking impact (tenant loss, legal exposure, business shutdown) |
| **Medium** | Material but recoverable (multi-week revenue impact, reputational dent, costly cleanup) |
| **Low** | Manageable (one-time spend, one tenant frustrated, recoverable in days) |

| Likelihood | Meaning |
|---|---|
| **High** | Expected within 6 months if uncontrolled |
| **Medium** | Plausible within 12 months |
| **Low** | Possible but unlikely without specific trigger |

### Top 10 risks

| # | Risk | Severity | Likelihood | Owner | Primary mitigation | Residual risk |
|---|---|---|---|---|---|---|
| R1 | **Cross-tenant data leak** — an agent or query exposes tenant A's data to tenant B | High | Low | Security Lead | RLS at DB, namespace isolation in vector store, per-ticket scratchpad scoping, automated isolation tests in CI | Low |
| R2 | **Agent runaway loop** — workflow exceeds expected cost by 10×+, drains budget | Medium | Medium | Production Manager | Per-ticket token budget, per-project daily cap, hard stop at 3× expected, FOUNDER_QUEUE alert | Low |
| R3 | **Prod deploy breaks tenant workflow** — regression slips past canary into prod | High | Low | Production Manager | Eval gate, canary window (4–72h per risk class), auto-rollback triggers, 60-min post-deploy watch | Low |
| R4 | **Secret leak** — API key committed to git, leaked in logs, or accessed inappropriately | High | Low | Security Lead | gitleaks pre-commit + CI, Sentry/LangFuse log scrubbing, Vault access audit log, 90-day rotation | Low |
| R5 | **VPS outage** — Hostinger VPS down for hours, affecting all projects | High | Low | Production Manager | Daily backups + weekly off-site, documented rebuild runbook, annual DR drill, 2h RTO target | Medium |
| R6 | **LLM provider outage** — Anthropic / OpenAI down, blocking all agent work | Medium | Medium | Tech Lead | LiteLLM fallback chains (primary → secondary), per-use-case model preferences, tenant comms playbook | Medium |
| R7 | **Founder unavailable (bus factor)** — single-founder business, no continuity plan | High | Low–Medium | Founder | Delegation policy in `docs/governance/delegation.md` (drafted separately), documented break-glass access | Medium |
| R8 | **PIPEDA breach** — tenant PII exposed through a vulnerability or misconfiguration | High | Low | Security Lead | Encryption at rest, access controls, audit log, breach notification runbook, PIPEDA-aware code review | Low |
| R9 | **Tenant churn from quality issues** — repeat incidents erode trust, tenants leave | Medium | Medium | Solutions Architect + PM | SLA tracking, monthly tenant health review, proactive comms, retention plays | Medium |
| R10 | **Free-tier limit hit unexpectedly** — Inngest, LangFuse, or other free tier maxes out, blocking ops | Low | Medium | Data Engineer | Usage monitoring with 50% / 80% / 95% alerts, documented self-host fallback paths, headroom review monthly | Low |

### Risk review cadence

| Cadence | What | Who |
|---|---|---|
| Continuous | New risks surfaced via incidents or post-mortems | All agents (post to PM) |
| Monthly | Review of register; reassess likelihood/severity based on observed signals | PM + Tech Lead + Security Lead |
| Quarterly | Full risk register refresh; add/remove/reword as scope evolves | Founder + PM + all leads |
| Post-incident | After any P1, the relevant risks are re-scored; mitigations updated if gaps revealed | Tech Lead authors post-mortem |

### Adding a new risk

When an agent identifies a new risk:

1. Post to `WORK.md` under "Risks under consideration"
2. PM evaluates within 1 sprint
3. If accepted, added to the register with owner, severity, likelihood, mitigation
4. Logged in `DECISIONS.md`

### Closing a risk

A risk is **closed** (removed from register) only if:

- The underlying condition no longer exists (e.g., we removed the affected component)
- OR mitigation has been demonstrably effective for ≥ 6 months
- AND closure is approved by the risk owner + Founder

Closed risks move to `docs/governance/risk-archive.md` for historical reference.

---

## Section 2 — Change management of the plan

The 9-dimension plan in this directory is itself a controlled document set. Changes need discipline so the build team doesn't act on stale assumptions.

### Document classification

| Class | Files | Change approval |
|---|---|---|
| **Charter** | `01_strategy.md` through `09_delivery.md`, `99_master_plan.md` | Founder only |
| **Architecture** | `04_architecture.md`, `docs/engineering/*`, `docs/deploys/*`, `docs/security/*`, `docs/governance/*` (this file) | Tech Lead (or Security Lead for security docs); founder for material changes |
| **Agent specs** | `.claude/agents/*.md` | Tech Lead, with peer review by the agent's collaborators |
| **Workspace** | `WORK.md`, `DECISIONS.md`, `FOUNDER_QUEUE.md` | Per their own rules (live updates by all agents) |

### Versioning

Each charter document carries its own implicit version through `DECISIONS.md` entries. The top-level `00_README.md` "Plan version log" is the **authoritative** plan version.

| Bump | When | Example |
|---|---|---|
| Patch (v0.4.x) | Typo, clarification, formatting | v0.4.1 |
| Minor (v0.x.0) | New section, new RACI row, refined SLA | v0.5.0 |
| Major (vX.0.0) | Architectural shift, scope change, new dimension | v1.0.0 |

### ADR process

For any decision that:

- Changes architecture
- Adopts or removes a tool
- Tightens or loosens a guardrail
- Establishes a new policy

…author an ADR (Architecture Decision Record) in `docs/adr/NNNN-title.md`.

#### ADR template

```markdown
# ADR-NNNN — <Title>

**Status:** proposed | accepted | superseded by ADR-MMMM
**Date:** YYYY-MM-DD
**Author:** <agent name>
**Decision approvers:** <names>

## Context
What's the situation that prompted this decision?

## Decision
What we're doing.

## Alternatives considered
What else we looked at and why we didn't choose it.

## Consequences
- Positive:
- Negative:
- Neutral:

## Migration / rollout
How we get from current state to the new state.

## Review trigger
What would cause us to revisit this decision?
```

#### ADR lifecycle

| Status | Meaning |
|---|---|
| `proposed` | Author drafted; waiting on approvers |
| `accepted` | Approved; in force |
| `superseded by ADR-MMMM` | Replaced by a newer decision |
| `deprecated` | No longer in force; may not have a successor (rare) |

ADRs are **append-only**. We never edit an accepted ADR's substance. We supersede it with a new ADR.

### How the build team learns about plan changes

1. PM updates `00_README.md` plan version log + dimension status table
2. PM posts a "plan update" note to `WORK.md`
3. Affected agents re-read the changed file at next session start

Agents are designed to re-read context every session — they don't cache assumptions.

---

## Section 3 — Compliance posture

### Today: PIPEDA (Personal Information Protection and Electronic Documents Act)

Canada's federal privacy law applies because we operate in Canada and process tenant personnel and business data. Our posture today:

| PIPEDA principle | Our implementation |
|---|---|
| **Accountability** | Founder is designated privacy officer for In a Tech-Shell |
| **Identifying purposes** | Each project's Project Context schema declares its data categories and processing purposes |
| **Consent** | Tenant onboarding includes data processing terms; revocation procedure documented |
| **Limiting collection** | Per-project data minimization rules in Project Context; agents collect only what's needed |
| **Limiting use, disclosure, retention** | RLS-enforced isolation; defined retention windows per data type; no sharing without explicit consent |
| **Accuracy** | Tenants can correct their own data through self-service UI; audit log tracks changes |
| **Safeguards** | Encryption at rest (Supabase), encryption in transit (TLS), Vault for secrets, access controls, audit log |
| **Openness** | Privacy policy published; data handling documented in this directory |
| **Individual access** | Data export per tenant request; documented in `docs/runbooks/data-export-request.md` (drafted in Phase 2) |
| **Compliance challenge** | Documented complaint procedure; founder is point of contact |

### Breach notification readiness

PIPEDA requires notification of breaches that pose "real risk of significant harm." Our process:

1. **Detection** — Security Lead or Production Manager identifies a potential breach
2. **Initial assessment** — Within 4 hours, Security Lead + Founder assess scope and harm
3. **Containment** — Stop the leak; preserve evidence
4. **Decision** — Is this a notifiable breach? Founder decides with Security Lead input
5. **Notification** — If yes: tenants notified + Office of the Privacy Commissioner of Canada (OPC) notified within reasonable timeframe (typical: 72 hours for material breaches)
6. **Record** — Log in `docs/governance/breach-log.md` (created upon first breach event; required by PIPEDA regardless of notification)
7. **Post-mortem** — Standard Tech Lead post-mortem applies

Templates and runbook in `docs/runbooks/breach-response.md` (drafted in Phase 2).

### Tomorrow: SOC 2 readiness path

We are **not currently SOC 2 certified.** Certification would unlock enterprise tenants but costs ~$30–50K and 6–9 months of preparation. Decision deferred until tenant demand justifies it.

In the meantime, we're building the operational habits that map to SOC 2 controls so the future audit is mechanical, not transformational:

| SOC 2 Trust Service Criteria | Where our current work maps |
|---|---|
| **Security** (CC1–CC9) | Risk register (this file), access controls (RACI), audit log, encryption (`docs/security/`) |
| **Availability** (A1) | SLA definitions (`03_scope.md`), monitoring (`docs/engineering/monitoring-thresholds.md`), DR plan (`docs/governance/disaster-recovery.md`) |
| **Confidentiality** (C1) | Tenant isolation, Vault, secrets rotation |
| **Processing Integrity** (PI1) | Eval gate, QA discipline, post-mortem cycle |
| **Privacy** (P1–P8) | PIPEDA posture above; same controls largely apply |

### Decision trigger for pursuing SOC 2

We start formal SOC 2 work when **any** of the following becomes true:

- A prospect is offering > $50K ARR contingent on SOC 2
- We have ≥ 5 enterprise tenants asking
- A regulatory regime (e.g., PHIPA, FedRAMP) makes it strategically necessary
- Investor due diligence specifically requires it

Until then: keep the habits; track the gap; don't pay for certification.

### Per-project compliance scope

Different projects have different regulatory exposure. Tracked in each project's Project Context schema.

| Project | Regulatory scope |
|---|---|
| Ops Hub | Internal platform; no direct regulatory scope beyond PIPEDA on operations data |
| TTS | PIPEDA (tenant PII), CFIA SFCR (food safety documentation), Canadian customs regulations (CBSA — informational, not custodial) |
| Future projects | Scope assessed at onboarding by Solutions Architect + Security Lead; documented in project's Context schema |

### Compliance evidence collection

We collect evidence continuously, not retrospectively. Examples:

| Control | Evidence collected | Storage |
|---|---|---|
| Access management | Audit log of vault access, RLS test results | Supabase audit table |
| Change management | DECISIONS.md, ADRs, PR review history | Git + Supabase |
| Incident response | Post-mortems, incident tickets | `docs/post-mortems/`, FreeScout |
| Backup verification | Monthly verification logs | `docs/security/rotation-log.md`, `docs/governance/backup-verification.md` |
| DR drill | Annual drill post-mortem | `docs/post-mortems/dr-drill-<year>.md` |
| Training | (N/A — solo founder; future hires will require training log) | TBD |

When SOC 2 audit time comes, the auditor receives pointers to these evidence streams, not a frantic month of evidence assembly.

---

## How this file is used

- **Risk register** is the most actively referenced part — reviewed monthly by PM + Tech Lead + Security Lead.
- **Change management** governs how this plan itself evolves; PM enforces.
- **Compliance posture** is referenced when:
  - A new project is onboarded (Solutions Architect assesses scope)
  - A tenant asks about our security/privacy practices (Founder + Security Lead respond)
  - A potential incident has compliance implications (Security Lead consults this)
  - A SOC 2 decision is on the table (Founder + Tech Lead + Security Lead refresh the trigger criteria)

This file is reviewed quarterly. Updates logged in `DECISIONS.md` with plan version bump.
