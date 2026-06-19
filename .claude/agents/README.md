# Ops Hub Build Team — Agent Specs

Agent specifications for the **In a Tech-Shell Ops Hub** build team. Drop this `.claude/agents/` folder into your Ops Hub repo for Claude Code to pick up natively.

---

## Team composition (11 agents)

| Agent | Model | Role |
|---|---|---|
| **pm** | Opus | Sprint planning, charter alignment, delivery tracking |
| **tech_lead** | Opus | Architecture decisions, cross-agent technical arbitration |
| **qa_manager** | Opus | Functional + integration + regression testing |
| **production_manager** | Codex | Coolify deploys, canary rollouts, rollback paths |
| **security_lead** | Opus | OWASP audits, API Vault discipline, secrets hygiene |
| **evals_lead** | Opus | Prompt evals, regression detection, eval suite ownership |
| **knowledge_lead** | Sonnet | KB curation, RAG quality, runbook consistency |
| **frontend_engineer** | Sonnet | Ticket portal UI, ops dashboard, admin panels |
| **data_engineer** | Sonnet | Observability pipelines, metrics, eval data infrastructure |
| **solutions_architect** | Opus | Customer integrations, enterprise BYOK, tenant onboarding |
| **coderabbit** | n/a | Third-party automated PR review (GitHub bot) |

---

## How agents coordinate

The team uses **shared workspace + async coordination** — no copy-paste between agents, no constant interruption of the founder.

### Workspace files (at repo root)

| File | Purpose |
|---|---|
| `WORK.md` | Live status board: in-flight work, agent ownership, blockers |
| `DECISIONS.md` | Architecture Decision Records (ADRs) and autonomous calls logged for review |
| `FOUNDER_QUEUE.md` | Items needing founder's business-logic decision (polled by founder) |

### Communication protocol

1. Agents read `WORK.md` to know what's in flight
2. Agents update progress in `WORK.md` after each meaningful step
3. Agents log architectural calls in `DECISIONS.md`
4. Agents invoke each other via Claude Code's **Task tool** (peer-to-peer)
5. **Only** business-logic decisions get posted to `FOUNDER_QUEUE.md` for founder review

### Escalation triggers

Founder is consulted **only** when:
- Scope expansion outside the charter is requested
- Pricing change required
- New SLA needs negotiation
- Significant sprint slip (> 1 week)
- Tenant-impacting trade-off needs a call
- Security risk above the defined threshold
- Cross-project priority conflict

Everything else runs autonomously.

---

## Setup checklist

1. Drop this `.claude/agents/` folder into your Ops Hub repo
2. Configure MCP servers in your Claude Code settings (each agent's `Tools` section lists what it needs)
3. Initialize the three workspace files at repo root (`WORK.md`, `DECISIONS.md`, `FOUNDER_QUEUE.md`) — templates to be added separately
4. Define Claude Code hooks for auto-updating workspace files after each agent action
5. Confirm CodeRabbit GitHub app is installed on the repo and reads `.coderabbit.yaml`

---

## Naming conventions

- Agent files: lowercase with underscores (`pm.md`, `tech_lead.md`)
- Workspace files: uppercase at repo root (`WORK.md`, `DECISIONS.md`, `FOUNDER_QUEUE.md`)
- ADRs: `docs/adr/NNNN-title.md` referenced from `DECISIONS.md`
