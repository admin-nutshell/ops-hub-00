# Communication Standard
## How PM talks to the team — and how the team talks back

---

## The one rule

> **Say exactly what you mean. Say it once. Make the next action obvious.**

Every message — whether it is a task assignment, a status update, a blocker, or a done report — must answer three questions:
1. What is the current state?
2. What happens next?
3. Is anything blocking that?

If your message does not answer all three, rewrite it before sending.

---

## Principles

**Short over long.** If it takes more than 90 seconds to read, it is too long. Cut it.

**Specific over vague.** "In progress" is not a status. "Step 3 of 5 done; step 4 blocked on X" is a status.

**Evidence over assertion.** "It works" is not a done report. A commit SHA, a passing test run, or a live URL is evidence.

**Options over problems.** Never send a blocker without at least one proposed resolution. Come with a path, not just a wall.

**One topic per message.** Do not combine a status update with a blocker report with a question. Send separate structured messages.

**No trailing filler.** Do not end messages with "Let me know if you have any questions" or "Happy to discuss." State what you need and stop.

---

## Message types

### 1 — TASK ASSIGNMENT `PM → Agent`

Used when PM hands work to an agent.

```
## TASK: [T-XX] — [Title]
To:        [Agent name]
Priority:  P1 / P2 / P3
Context:   [1–3 sentences — why this exists, what preceded it]
Scope:     [Exactly what to do]
Not scope: [What NOT to do — prevents overreach]
Criteria:  [Done when: specific, binary, testable]
Deadline:  [Date]
Handoff:   [Who gets it when done, and what to pass]
```

**PM commits to:** every field filled before the task is assigned. No vague scope. No missing exit criteria. No unstated deadline.

---

### 2 — TASK RECEIPT `Agent → PM`

Sent within one working step of receiving a task. Confirms understanding; flags any ambiguity before work starts.

```
## RECEIPT: [T-XX] — [Title]
From:      [Agent]
Understood: Yes / Clarification needed
Clarification: [If needed — one specific question only]
ETA:       [Expected completion date]
Starting:  [First concrete action]
```

If scope or criteria are unclear, raise it here — not halfway through the work.

---

### 3 — STATUS UPDATE `Agent → PM`

Sent proactively when: a task crosses a meaningful milestone, the ETA shifts, or a decision point is reached. Do not wait to be asked.

```
## STATUS: [T-XX] — [Title]
From:      [Agent]
State:     in_progress / blocked / review_ready / done
Progress:  [One sentence — what has been completed]
Next:      [One sentence — what happens next]
ETA:       [On track for [date] / Revised to [date] — reason for change]
Blockers:  None / [Description + proposed resolution]
```

---

### 4 — BLOCKER REPORT `Agent → PM`

Sent immediately when work cannot proceed. Do not sit on a blocker.

```
## BLOCKED: [T-XX] — [Title]
From:      [Agent]
Blocked since: [Time]
What I tried:
  - [Attempt 1 and outcome]
  - [Attempt 2 and outcome]
What I need:  [Specific ask — decision / information / action from whom]
Impact:       [What slips if unresolved by when]
Proposed path: [Your best option, even if uncertain]
```

**Rule:** a blocker report without a proposed path is incomplete. Send it back.

---

### 5 — DONE REPORT `Agent → PM`

Sent when a task meets its exit criteria. Not when you think it is close — when it is done.

```
## DONE: [T-XX] — [Title]
From:      [Agent]
Completed: [Date]
What was done:
  - [Outcome 1]
  - [Outcome 2]
What was found: [Surprises, side effects, or new information — "Nothing unexpected" is valid]
Evidence:  [PR link / commit SHA / test output / live URL — at least one]
WORK.md:   Updated ✓
DECISIONS.md: [Updated — [what was logged] / Not needed]
Handoff:   [Agent notified / nothing to hand off]
```

No done report is accepted without at least one piece of evidence.

---

### 6 — HANDOFF `Agent → Agent (via WORK.md or direct)`

Used when passing work from one agent to the next stage of the pipeline.

```
## HANDOFF: [T-XX] — [Title]
From:      [Sending agent]
To:        [Receiving agent]
State:     [What was completed; what tests/checks passed]
Artefacts: [Files, branches, PRs, URLs the next agent needs]
Watch out: [Known issues, gotchas, assumptions made]
Criteria:  [What "done" looks like for the next stage]
Deadline:  [If time-sensitive]
```

The receiving agent sends a RECEIPT within one step. If there is an issue with the handoff — missing artefacts, unclear criteria — raise it immediately, not after starting work.

---

### 7 — ESCALATION `Agent → FOUNDER_QUEUE.md`

Only for the Founder. Format defined in `CONSTITUTION.md` and `FOUNDER.md`. Do not use any other message type to reach the Founder.

---

## PM's communication commitments

PM will always:
- Assign tasks with every field in the TASK template filled
- Respond to BLOCKED messages before the next working session
- Confirm handoffs received and next agent assigned within one step
- Update `WORK.md` after every status change — agents read the board, they do not chase PM for status

PM will never:
- Send a vague ask ("look into X")
- Assign work without a deadline
- Leave a blocker unacknowledged
- Make a decision without logging it in `DECISIONS.md`

---

## Team's communication commitments

Every agent will:
- Send a RECEIPT when assigned a task
- Send a STATUS UPDATE at every meaningful milestone — proactively, not when asked
- Send a BLOCKER REPORT immediately when stuck, with a proposed path
- Send a DONE REPORT with evidence before marking done in `WORK.md`
- Update `WORK.md` after every state change

Every agent will never:
- Say "done" without evidence
- Sit on a blocker for more than one working step without reporting
- Send a wall of text — structure it or cut it
- Ask a question that can be answered by reading `DECISIONS.md`, `WORK.md`, or `CLAUDE.md`
- Ask the Founder a question that belongs to an agent

---

## Anti-patterns — do not do these

| Anti-pattern | What to do instead |
|---|---|
| "I'm working on it" | Send a STATUS UPDATE with specifics |
| "It's almost done" | Send a STATUS UPDATE with what remains |
| "There's a problem" | Send a BLOCKER REPORT with a proposed path |
| "What should I do about X?" | Check `DECISIONS.md`; if genuinely unresolved, send a BLOCKER REPORT |
| "Done!" with no evidence | Send a DONE REPORT with a commit SHA or PR link |
| Long narrative paragraph | Use the structured template for the message type |
| Asking the Founder for a technical decision | Resolve it or route it to the right agent |
| Silent progress | Update `WORK.md` — the team reads the board |

---

## WORK.md as the primary channel

Most communication happens through `WORK.md`, not direct messages. The board is the truth.

- Every state change is a `WORK.md` update
- Every blocker is in `WORK.md` as a flagged row
- Every done task has its evidence link in `WORK.md`
- PM reads `WORK.md` at session start — not direct message history

Direct messages (Agent tool invocations) are for task assignments and responses that require back-and-forth. Persistent state lives on the board.

---

## Response SLA

| Message type | Expected response |
|---|---|
| TASK ASSIGNMENT | RECEIPT within one working step |
| BLOCKED | PM acknowledges before next session; agent does not sit idle |
| HANDOFF | RECEIPT within one working step |
| STATUS UPDATE | No response required unless PM has a direction change |
| DONE REPORT | PM updates `WORK.md` to `done`; hands off to next agent if applicable |
| FOUNDER_QUEUE item | Founder resolves on their schedule; agents do not chase |
