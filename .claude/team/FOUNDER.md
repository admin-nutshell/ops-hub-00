# Founder Role & Boundaries
## For agents: read this before deciding to escalate. For the Founder: this is your contract with the team.

---

## The Founder's role

The Founder is the **product owner and strategic authority**. Their time is the team's scarcest resource. The team's job is to protect it — by solving technical problems autonomously and only surfacing decisions that genuinely require the Founder's authority.

---

## What reaches the Founder

Only items that meet one or more of these criteria:

| Category | Example |
|---|---|
| Feature scope change | "Customer X wants Y — is that in scope for this sprint?" |
| Pricing or packaging | "Should this feature be in the free tier or paid tier?" |
| Customer / tenant SLA | "Can we commit to 99.9% uptime for Tenant A?" |
| Revenue-impacting trade-off | "We can ship faster but it means no audit log — proceed?" |
| External vendor decision | "Should we add a new paid service (Sentry Pro, Datadog, etc.)?" |
| Sprint slip > 1 week | "We're 8 days behind — here are three recovery options." |
| Security incident with customer impact | "A bug exposed Tenant A's data to Tenant B — next steps?" |
| Cross-project priority conflict | "Both Project A and Project B need the same resource this week." |

---

## What does NOT reach the Founder

The following are **agent-owned**. Do not escalate them:

| Category | Who owns it |
|---|---|
| Architecture choices | Tech Lead |
| Database schema design | Tech Lead |
| Test coverage decisions | QA |
| Deploy timing | Production Manager |
| Env var values (non-secret) | Production Manager |
| Bug fixes | Tech Lead / Engineer |
| CI/CD configuration | Production Manager |
| Code review findings | CR / Tech Lead |
| Internal tooling choices | Tech Lead |
| Sprint decomposition | PM |
| Rollback decisions | Production Manager |
| Technical debt prioritization | PM + Tech Lead |

If you are about to escalate one of the above — stop. Resolve it yourself or route it to the correct agent.

---

## How to reach the Founder

**Channel:** `FOUNDER_QUEUE.md` only.

No ad-hoc chat questions. No "quick check-ins." Post to the queue and the Founder will review it on their schedule.

**Required format for every entry:**

```
## FQ-[N] — [One-line title]
**Date:** YYYY-MM-DD
**Needs:** Decision / Information / Authorization (pick one)
**Context:** [2-4 sentences: what we know, what we tried, why we're stuck]
**Options:**
  A. [Option] — [Upside] — [Downside]
  B. [Option] — [Upside] — [Downside]
  C. [Option if applicable]
**Recommendation:** [Your call, one sentence rationale]
**Deadline:** [Date, or "non-blocking"]
```

Entries that arrive without this format will be returned to the originating agent to reformat before the Founder reviews them.

---

## The Founder's response style

The Founder answers:
- Business and product questions: yes
- "Which option do you recommend, A or B?": yes
- "Can we do X?": yes (scope / priority)
- "How does X work technically?": no — look it up or ask the Tech Lead
- "Is X a bug or expected behavior?": no — that is QA's call
- "Should we add error handling for X?": no — that is the engineer's call

---

## Founder availability contract

The Founder is NOT available for:
- Real-time pairing on technical problems
- Approving every PR or every deploy
- Answering questions already answered in `DECISIONS.md` or `WORK.md`
- Reviewing code

The team reads `WORK.md` and `DECISIONS.md` to stay current — the Founder is not a status broadcast service.

---

## For the Founder: what to expect from the team

The agents will:
- Make all technical decisions autonomously
- Log those decisions in `DECISIONS.md` for your review (you can always read and question them)
- Post only genuine business-logic decisions to `FOUNDER_QUEUE.md`
- Come to you with options and a recommendation — never with raw problems
- Protect your time as the team's primary constraint

You should never need to debug code, configure infrastructure, or manage sprints. If you find yourself doing any of those things, something has broken down in the team protocol — raise it.
