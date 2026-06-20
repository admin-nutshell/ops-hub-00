# 05 — People & Process

> Who does what, when, and how decisions flow. Designed so the founder is involved **only** in business-logic decisions — every operational decision has a clear owner among the agents.

---

## Org chart (recap)

```
                          Founder
                             │
                             │ (business decisions only)
                             ▼
                     PM (Sprint orchestrator)
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
   Tech Lead          Production Manager      Solutions Architect
   (architecture)     (deploys, incidents)    (onboarding)
       │                     │                     │
   ┌───┼─────┐          ┌────┴────┐                │
   ▼   ▼     ▼          ▼         ▼                ▼
  QA  Evals Frontend   Data    Security      (per-project)
  Mgr Lead   Eng       Eng     Lead
                       │
                  ┌────┴────┐
                  ▼         ▼
              Knowledge   CodeRabbit
              Lead        (GitHub bot)
```

Full agent specs in `.claude/agents/`. This file defines how they work together.

---

## RACI matrix — Day-to-day ticket operations

R = Responsible (does the work), A = Accountable (owns the outcome), C = Consulted, I = Informed

| Activity | Founder | PM | Tech Lead | QA Mgr | Prod Mgr | Sec Lead | Evals Lead | Knowledge | Frontend | Data | Sol Arch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ticket intake (FreeScout) | I | I | — | — | I | — | — | — | — | — | — |
| Severity triage | I | A | C | — | R | — | — | — | — | — | — |
| Auto-acknowledgment to tenant | I | A | — | — | R | — | — | — | — | — | — |
| Investigation / root cause | I | A | R | C | C | C* | — | C | — | — | — |
| Fix authoring (code) | I | A | R | C | — | C* | C* | — | R* | R* | — |
| Code review (PR) | I | I | R | C | — | C | C | — | — | — | — |
| Test authoring | I | I | C | R | — | — | — | — | — | — | — |
| Eval case authoring | I | I | C | C | — | — | R | — | — | — | — |
| QA sign-off | I | I | C | A/R | — | — | — | — | — | — | — |
| Security review | I | I | C | C | — | A/R | — | — | — | — | — |
| Staging deploy | I | I | C | C | A/R | — | — | — | — | — | — |
| Canary monitoring | I | I | C | C | A/R | C* | C* | — | — | C | — |
| Prod deploy execution | A* | I | C | C | A/R | C | — | — | — | — | — |
| Resolution comms to tenant | I | A | — | — | R | — | — | C | — | — | C |
| Post-mortem authoring | I | C | A/R | C | C | C* | C* | — | — | — | — |
| KB update from incident | I | I | C | — | — | — | — | A/R | — | — | — |
| Feature Adaptation cycle | I | I | C | C | — | — | C | A/R | — | — | — |

*= when relevant to the specific ticket (security-sensitive ticket → Security Lead involved; prompt-affecting ticket → Evals Lead involved; UI fix → Frontend Engineer does the fix; data layer fix → Data Engineer does the fix).

**Founder accountability for prod deploy** applies only to **High-risk class** changes (see `docs/deploys/checklist.md`). For Low and Medium risk, Production Manager is fully accountable.

---

## RACI matrix — Engineering & platform work

| Activity | Founder | PM | Tech Lead | QA Mgr | Prod Mgr | Sec Lead | Evals Lead | Knowledge | Frontend | Data | Sol Arch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sprint planning | C | A/R | C | C | C | C | C | C | C | C | C |
| ADR authoring | I | I | A/R | — | — | C | — | — | — | — | C |
| Architecture changes | A | I | R | — | — | C | — | — | — | — | C |
| New agent capability design | A | I | R | C | — | C | C | — | — | — | — |
| Prompt changes | I | I | C | C | — | — | A/R | — | — | — | — |
| Eval suite changes | I | I | C | C | — | — | A/R | — | — | — | — |
| Database migration authoring | I | I | A | — | C | C | — | — | — | R | — |
| Database migration deploy | I | I | C | — | A/R | C* | — | — | — | C | — |
| Secrets rotation (routine) | I | I | C | — | R | A | — | — | — | — | — |
| Emergency secret rotation | I | I | C | — | R | A/R | — | — | — | — | — |
| Monitoring threshold tuning | I | I | C | — | C | — | — | — | — | A/R | — |
| Feature flag creation | I | I | A/R | — | C | C* | — | — | — | — | — |
| Feature flag toggling (prod) | A* | I | C | — | R | C* | — | — | — | — | — |

*= for sensitive flags affecting tenant data, billing, or auth.

---

## RACI matrix — Project & tenant management

| Activity | Founder | PM | Tech Lead | QA Mgr | Prod Mgr | Sec Lead | Evals Lead | Knowledge | Frontend | Data | Sol Arch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| New project onboarding (e.g., Project #2) | A | I | C | — | C | C | — | C | — | — | R |
| Project Context schema authoring | A | I | C | — | — | C | — | C | — | — | R |
| New tenant onboarding (TTS) | A | I | — | — | C | C | — | C | — | — | R |
| BYOK setup (future, Phase 2) | A | I | C | — | C | A | — | — | — | — | R |
| SLA breach response | I | A | C | — | R | — | — | — | — | — | C |
| Tenant escalation handling | A | A/R | C | — | C | — | — | — | — | — | C |
| Premium SLA pricing decisions | A/R | I | — | — | — | — | — | — | — | — | C |
| Tenant churn risk identification | A | I | — | — | — | — | — | — | — | — | A/R |

---

## RACI matrix — Security, governance, finance

| Activity | Founder | PM | Tech Lead | QA Mgr | Prod Mgr | Sec Lead | Evals Lead | Knowledge | Frontend | Data | Sol Arch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Security incident response | A | I | C | — | C | A/R | — | — | — | — | — |
| Vulnerability disclosure handling | A | I | C | — | C | A/R | — | C | — | — | — |
| Compliance documentation (PIPEDA) | A | I | C | — | — | A/R | — | C | — | — | — |
| Compliance documentation (SOC 2, future) | A | I | C | C | C | A/R | C | C | — | C | — |
| Disaster recovery drill | A | C | C | — | A/R | C | — | — | — | C | — |
| Budget approval | A/R | I | — | — | — | — | — | — | — | — | — |
| Cost spike investigation | A | I | C | — | R | — | — | — | — | A/R | — |
| Per-project COGS reporting | A | I | — | — | — | — | — | — | — | A/R | C |
| Vendor / tool selection | A | I | A/R | — | C | C | C | C | C | C | — |

---

## Ticket lifecycle

Every ticket — internal or tenant-reported — moves through the following states. Production Manager owns the state machine; PM is informed of transitions.

### States

| State | Meaning | Typical owner agent | Auto-actions |
|---|---|---|---|
| `new` | Just submitted, not yet seen | (none yet) | Auto-route to triage |
| `triaged` | Severity assigned, ticket categorized | Production Manager | Auto-acknowledge to tenant; assign |
| `acknowledged` | Tenant has been told we're on it | (system) | Move to investigating |
| `investigating` | Root cause analysis in progress | Tech Lead (or domain agent) | Post diagnosis to ticket comments |
| `awaiting_founder` | Blocked on a HITL approval | PM (escalates to founder) | Post to FOUNDER_QUEUE.md |
| `in_fix` | Code is being written | Tech Lead / Frontend / Data Eng | PR opened linked to ticket |
| `in_qa` | Fix is in QA review | QA Manager | Tests + evals run |
| `in_staging` | Deployed to staging, in canary | Production Manager | Monitoring active |
| `awaiting_promotion` | Canary complete, waiting prod deploy | Production Manager | Founder approval for High-risk |
| `in_production` | Deployed to prod, monitoring | Production Manager | First-60-min watch |
| `resolved` | Confirmed working in prod | PM | Tenant comms sent |
| `closed` | Tenant confirmed satisfaction (or 7-day auto-close) | PM | Archive to KB-eligible pool |
| `post_mortem` | (Optional follow-on) post-mortem in progress | Tech Lead | Doc in `docs/post-mortems/` |
| `won_t_fix` | Triaged as not worth fixing | PM (with founder approval) | Tenant comms explaining |
| `duplicate` | Same as another ticket | Production Manager | Linked, closed |

### State transitions

```
new
 │
 ▼
triaged ────────► won't_fix / duplicate (terminal)
 │
 ▼
acknowledged
 │
 ▼
investigating ──► awaiting_founder ──► (back to investigating after answer)
 │
 ▼
in_fix
 │
 ▼
in_qa ◄─── (back to in_fix if QA fails)
 │
 ▼
in_staging
 │
 ▼
awaiting_promotion ──► (back to in_fix or in_staging if canary fails)
 │
 ▼
in_production
 │
 ▼
resolved
 │
 ▼
closed ──────────► post_mortem (for P1/P2; runs in parallel with closed)
```

### State-transition rules

- **Only one agent** owns a ticket at a time. Ownership is recorded on the ticket.
- **Every state transition** is logged with timestamp + agent who triggered it.
- **`awaiting_founder`** is the ONLY state where the founder is required. All other states are agent-owned.
- **Stale tickets:** any ticket > 48h in `investigating`, `in_fix`, or `in_qa` without movement triggers PM escalation.
- **No backwards skip:** a ticket cannot jump from `investigating` to `in_staging`. The path is enforced.

---

## Communication protocols

Three shared workspace files coordinate agent activity. Founder reads (occasionally) but rarely writes.

### `WORK.md` — live status board

| What | Where to write | Cadence |
|---|---|---|
| Current ticket being worked | Top of file | Updated by owner agent |
| Sprint goals | Section near top | Updated by PM on sprint start |
| Today's planned activities | Per-agent section | Updated each agent's "start of session" |
| Blocked items | Dedicated section | Updated as blocks emerge |
| Recently resolved tickets | Bottom of file | Auto-archived weekly |

Agents read `WORK.md` at session start to understand context. Founder reads to get a status snapshot without asking anyone.

### `DECISIONS.md` — append-only decision log

Every meaningful decision gets one line + (optionally) a link to a detailed ADR.

```
2026-06-18 [Tech Lead] Locked LiteLLM as Model Router → ADR-0007
2026-06-18 [Founder] Approved $200/mo Premium SLA tier pricing
2026-06-19 [Production Manager] Promoted v1.2.0 to prod, canary green for 48h
2026-06-19 [Security Lead] Rotated Anthropic key for TTS prod → see rotation-log.md
```

### `FOUNDER_QUEUE.md` — escalations to founder

Only items needing founder input. Polled by founder 1–2x/day.

```
URGENT: [Production Manager] Prod deploy v1.3.0 ready for promotion — need approval
        Risk class: Medium. Canary 24h green. ETA to deploy after approval: 10 min.

[Solutions Architect] A-Mart YYC requesting Premium SLA — confirm pricing?
        Context: pilot started 2026-06-15, premium tier mentioned in onboarding call.

[Tech Lead] ADR-0012 proposes adding OpenRouter as fallback provider — review?
        Cost impact: none. Risk: low. Link: docs/adr/0012-add-openrouter.md
```

Each item has: agent who posted it, ask, context, ETA / unblock impact. Founder responds in-line (`APPROVED:` or `REJECTED:` or `MORE INFO:`).

### Peer-to-peer agent communication

Agents communicate primarily through the shared files. For real-time coordination, Claude Code's Task tool is used to invoke a sub-agent inline — e.g., Tech Lead invoking QA Manager mid-task to review a proposed test.

---

## Cadence

### Daily

| Time | What | Who |
|---|---|---|
| Session start (each agent) | Read WORK.md, post today's plan | All agents |
| Continuous | Monitor alerts, ticket queue | Production Manager, Data Engineer |
| End of day | Update WORK.md with status | All agents |

### Weekly

| Day | What | Who |
|---|---|---|
| Monday | Sprint planning (small) — review prior week, set this week's priorities | PM + all leads |
| Wednesday | Mid-week PR cleanup — close stale branches, address blockers | Tech Lead + Production Manager |
| Friday | Weekly retro — what worked, what to change | PM (writes retro to `docs/retros/`) |

### Monthly

| What | Who | Output |
|---|---|---|
| Per-project COGS review | Data Engineer | Cost report to Founder |
| Eval trend review | Evals Lead | Regression report to Tech Lead |
| Feature flag audit | Tech Lead | Sunset list, cleanup actions |
| Alert hygiene review | Data Engineer | Threshold tuning recommendations |
| Founder briefing | PM | One-page status, sent monthly |

### Quarterly

| What | Who | Output |
|---|---|---|
| Backup verification | Data Engineer, Production Manager, Security Lead | Verification log |
| Tool stack review | Tech Lead | Free-tier headroom + paid-tier decision points |
| Tenant satisfaction review | Solutions Architect + PM | Retention + churn risk report |

### Annually

| What | Who | Output |
|---|---|---|
| Full DR drill | Production Manager + Founder | Post-mortem + policy updates |
| Strategy review | Founder + PM | Updated `01_strategy.md` |
| Architecture review | Tech Lead | Updated `04_architecture.md`; ADRs for any major shifts |
| Compliance review | Security Lead | Audit-readiness gap report |

---

## Decision-making protocol

Three categories of decisions, with explicit boundaries:

### 1. Agent-owned (no founder needed)

Examples: which test framework to use, whether to refactor a function, when to retry a failed workflow, which P3 alerts to ignore, what to embed in the KB, how to phrase a tenant acknowledgment.

→ Decision made by accountable agent per RACI. Logged in `DECISIONS.md` if material.

### 2. Lead-owned (consults relevant peers, no founder)

Examples: adding a new ADR, swapping a tool, tightening a guardrail, adjusting a monitoring threshold, adding a new agent capability that fits existing architecture.

→ Decision made by lead with C-marked peers consulted. ADR authored. Founder informed via `DECISIONS.md` but not asked.

### 3. Founder-owned

Founder-owned decisions: pricing, new projects, new tenant approval, budget changes > 20%, Premium SLA scope, UI/UX direction, business logic definitions, compliance posture commitments, and prod deploys for High-risk class.

NOT founder-owned (agent-owned with recommendation): tool selection, security configuration, architecture choices, CI/CD configuration, monitoring thresholds, secret rotation, deployment approach, framework selection.

→ Posted to `FOUNDER_QUEUE.md`. Agent brings a recommendation WITH rationale — not a choice between options. Founder approves explicitly.

**Default to category 1 or 2.** If unclear, the agent makes the call, logs it in `DECISIONS.md`, and informs the founder — agents do not ask the founder to choose between technical options.

---

## Quality bars per role

| Role | Their quality bar |
|---|---|
| PM | "Every sprint has a clear goal, every blocker has an owner, founder gets one weekly summary." |
| Tech Lead | "Every architectural change has an ADR. No accidental complexity ships." |
| QA Manager | "No regression makes it to prod twice. Every fix has a test." |
| Production Manager | "Every deploy is intentional. Every incident has a post-mortem. RTO targets met." |
| Security Lead | "No tenant data leak. No credential leak. Every audit-relevant action logged." |
| Evals Lead | "No prompt regresses silently. Every PR runs evals. Score trends visible." |
| Knowledge Lead | "Every solved problem becomes a KB article. RAG quality improves monthly." |
| Frontend Engineer | "UI is clean, accessible, fast. Tenants find what they need." |
| Data Engineer | "Every metric measurable. Every alert actionable. Costs visible per project." |
| Solutions Architect | "Every project onboarding < 1 week. Tenant onboarding < 1 day. Templates kept fresh." |

---

## How this file is used

- **Founder** reads this once to understand the operating model; refers back when unsure where a decision belongs.
- **PM agent** reads at the start of every sprint to anchor cadence and decision flow.
- **All other agents** read their RACI rows + quality bar at onboarding (i.e., when their agent spec is first loaded into a Claude Code session).
- **This file evolves** as the team matures. Material changes logged in `DECISIONS.md` with version bump.
