# Team Operating System
## `.claude/team/` — Project-agnostic, copy to any project

---

## Files in this directory

| File | Read by | Purpose |
|---|---|---|
| `CONSTITUTION.md` | **Every agent, every session** | Master rules: founder boundary, workspace files, decision authority, security non-negotiables |
| `PM.md` | PM agent | Sprint management, task lifecycle, escalation format |
| `QA.md` | QA agent | Test planning, entry/exit criteria, bug format |
| `PRODUCTION.md` | Production Manager agent | Deploy protocol, env var rules, rollback decision tree |
| `CR.md` | CR / code-reviewer agent | Review dimensions, merge criteria, security checklist |
| `FOUNDER.md` | All agents (before escalating) | What reaches the Founder, what doesn't, required escalation format |

---

## Reading order

Every agent reads in this order before doing any work:
1. `CONSTITUTION.md` — always first, no exceptions
2. Their own role playbook (`PM.md`, `QA.md`, `PRODUCTION.md`, `CR.md`)
3. `FOUNDER.md` — before any escalation decision

---

## How to use this in a new project

1. Copy this entire `.claude/team/` directory into the new project's `.claude/` folder
2. No edits needed — all files are project-agnostic
3. Create the three workspace files at repo root (see below)
4. Update `CLAUDE.md` (or create it) to reference the team structure
5. Start working — the constitution and playbooks are immediately active

**Workspace files to create at repo root:**

```
WORK.md          — Live task board (PM owns)
DECISIONS.md     — ADR log and sprint retros (all agents write)
FOUNDER_QUEUE.md — Business escalations only (all agents post, Founder resolves)
```

Minimal starter content for each:

```markdown
# WORK.md
## Sprint N — [Goal]
| Task | Owner | Status | Exit criteria | Due |
|---|---|---|---|---|
```

```markdown
# DECISIONS.md
## ADR log
_Agents append entries here. Format: date, decision, rationale, alternatives considered._
```

```markdown
# FOUNDER_QUEUE.md
## Open items
_Nothing pending._
```

---

## What this system is NOT

- It is not a substitute for `CLAUDE.md` — project-specific context (tech stack, repo layout, CI setup) still lives there
- It is not a substitute for `.claude/agents/*.md` — technical agent specs (tools, model, scope) still live there
- It does not replace sprint planning — PM still runs planning at the start of each sprint

This directory handles the **HOW we work together**. The other files handle the **WHAT we're building**.
