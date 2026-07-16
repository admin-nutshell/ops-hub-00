# Feature Request / Enhancement Intake — Standard Operating Procedure

## Trigger

This SOP applies to anything that is **not a bug** — i.e., not "existing behavior is broken" —
and instead asks for new or changed capability. Concretely, a ticket or idea falls into this
category when:

- A FreeScout ticket comes through the intake pipeline (FreeScout → poller → `ticket-triage`
  Inngest workflow) and the triage classification's `category`/`reasoning` describes a request
  for capability that does not exist today, rather than a reproduction of broken behavior.
  `ticket-triage`'s `category` field is a free-text LLM output, not a fixed enum — there is no
  guaranteed `feature_request` label to grep for. Treat any triage output whose reasoning reads
  as "customer wants X to work differently / wants a new capability" as a candidate, and confirm
  by reading the ticket body directly before proceeding.
- A ticket that starts as a bug report but, on inspection, turns out to describe intended
  behavior working as designed and the requester wants it changed (a "not a bug, but I wish it
  did Y" ticket) — reclassify it into this SOP rather than the bug-fix path.
- An internally-raised idea: any agent (PM, Tech Lead, Evals Lead, etc.) or the Founder proposes
  new capability, hardening, or a workflow improvement with no originating support ticket — the
  same kind of work Sprints 18–21 generated internally (eval coverage growth, multi-sample
  escalation, prompt hardening).

If the ticket describes something that used to work and now doesn't, or contradicts a documented
spec/eval, it is a **bug**, not a feature request — route it elsewhere. This SOP is for net-new
or changed capability only.

---

## Owner

**PM** runs point on intake, scoping, and the in-charter/out-of-charter call (CONSTITUTION.md's
decision matrix: "Scope change | PM assessment | Founder if outside charter").

**Tech Lead** is pulled in for feasibility and architecture when the request is non-trivial
enough to warrant an ADR, or when PM cannot assess technical feasibility alone.

Whoever eventually builds the feature (Engineer, Frontend Engineer, Evals Lead, Solutions
Architect, etc., depending on surface) is assigned by PM once the request is accepted into a
sprint — same as any other `WORK.md` task.

---

## Severity / priority classification

Feature requests do not use QA's bug-severity scale (Critical/High/Medium/Low) — that scale
measures broken-behavior impact, which doesn't apply to net-new capability. Classify instead
along three axes:

1. **Charter-fit** — in-charter (extends/hardens the existing TTS triage → respond → kb-learn
   pipeline, its eval coverage, or its supporting infra) vs. out-of-charter (new product
   surface, new tenant-facing capability, anything outside `01_strategy.md`–`09_delivery.md`'s
   scope). Charter-fit determines whether PM can decide alone (see next section).
2. **Size** — does it fit PM.md's rule that "no task should take more than 3 days"? If not,
   decompose it into multiple `WORK.md` tasks before it can enter a sprint, the same way any
   sprint goal gets decomposed.
3. **Priority relative to the active sprint** — does it compete with the current sprint goal, or
   can it be backlogged for the next sprint-planning cycle? PM makes this call the same way any
   other task gets sequenced; it is not a Founder decision unless the request also trips the
   out-of-charter line below.

There is no "P1 feature request" — nothing in this category is an incident. If a request is
urgent enough to threaten a customer relationship or a committed SLA, that urgency itself is a
business signal and routes to escalation below, not to a compressed timeline within this SOP.

---

## Step-by-step procedure

1. **Log the request.** Whoever receives it (PM, for a triaged ticket; the originating agent,
   for an internal idea) adds an entry to `WORK.md` in `backlog` state with a one-line
   description and source (ticket ID, or "internally raised by <agent>"). Done when: the entry
   exists in `WORK.md` with a source reference.

2. **PM reads the full request** (ticket body, not just the triage summary) and classifies it
   against the axes above: charter-fit, size, sprint priority. Done when: PM has a written
   one-paragraph scoping note ready for `DECISIONS.md`.

3. **PM applies the in-charter / out-of-charter test.** A request is **out-of-charter** — and
   requires Founder sign-off before any further work — if it trips any of these (mirrors
   CONSTITUTION.md's founder's-domain list and the standing constraints in `CLAUDE.md`):
   - It expands product scope beyond the current charter (new product surface, not an extension
     of triage/respond/kb-learn or their supporting infra).
   - It would hardcode anything to TTS specifically, breaking the **app-agnostic** standing
     constraint (must work for Project #2 with config only) — if the only way to build it is
     TTS-specific, that itself is a scope question for the Founder, not a technical one to solve
     around.
   - It requires a **new paid vendor or service** — violates **free-tier-first** and is also a
     literal founder's-domain item ("External vendor contracts or spend authorizations").
   - It changes pricing, packaging, or any customer/tenant-facing SLA commitment — always
     Founder, per the decision authority matrix, no exceptions.
   - It makes a revenue- or legal-impact commitment to a specific tenant.

   If none of the above apply, the request is **in-charter** and PM proceeds without the
   Founder — this is the default outcome, matching CONSTITUTION.md's "resolve it yourself unless
   it's genuinely a business call."

   Done when: PM has explicitly checked each of the five triggers and recorded the verdict
   (in-charter / out-of-charter) in the scoping note.

4. **If out-of-charter:** PM posts to `FOUNDER_QUEUE.md` in the required format (Needs /
   Context / Options A-B-(C) / Recommendation / Deadline) before any implementation work starts.
   No build work begins on an out-of-charter request until the Founder responds. Done when: the
   FQ entry exists and, once resolved, the Founder's decision is logged back into `DECISIONS.md`.

5. **If in-charter:** PM decides sprint placement — either slots it into the active sprint (only
   if it doesn't jeopardize the current sprint goal) or backlogs it for the next sprint-planning
   cycle. If the request needs architectural judgment (new data model, new external integration,
   an ADR-worthy pattern), PM routes it to Tech Lead for a feasibility read before committing it
   to a sprint. Done when: the request either has a sprint assignment or an explicit backlog
   position, both recorded in `WORK.md`.

6. **PM decomposes the accepted request into `WORK.md` tasks** per the normal sprint protocol —
   each task ≤3 days, with an owner and exit criteria — and assigns the appropriate specialist
   agent(s) (Engineer, Frontend Engineer, Evals Lead, Solutions Architect, etc., by surface
   touched). Done when: every resulting task in `WORK.md` has owner + exit criteria + status
   `backlog` or `in_progress`.

7. **Build proceeds through the standard task lifecycle** (`backlog → in_progress → review →
   qa_pass → deploy_ready → done`) exactly as any other `WORK.md` task — this SOP does not
   invent a parallel build process. See CONSTITUTION.md's "How work flows" for the review
   pipeline that gates the eventual PR (next section).

---

## Required reviewers / sign-offs before this can close

This SOP has two distinct closure points — don't conflate them:

**A. Intake decision closes** (the scoping call itself, before any code exists) when:
- PM has logged the charter-fit verdict in `DECISIONS.md`.
- Tech Lead has signed off on feasibility, if an ADR-level architecture question was involved.
- The Founder has responded, if the request was out-of-charter (step 4).

There is no CR/Security/Evals/QA review of a backlog decision — those gates review diffs, and a
scoping note has no diff yet.

**B. The eventual build closes** through CONSTITUTION.md's standard review pipeline once code
exists, same as any other change:
- **CR (CodeRabbit)** — always required, first-pass review on every PR.
- **Security Lead** — required only if the diff touches auth, secrets/Vault, migrations/RLS, the
  model allowlist, or what customer/tenant data reaches an LLM. Skipped otherwise, routed by
  path, not asked-for.
- **Evals Lead** — required only if the diff touches a prompt, an eval file, or model-routing
  config. Skipped otherwise.
- **QA** — always required; produces a test plan in `docs/test-plans/`, verifies functional +
  regression + multi-tenant isolation, signs `qa_pass` in `WORK.md`.
- **Production Manager** — deploys only after `qa_pass`, with a written rollback path.

No merge without CR. No deploy without QA sign-off. Security/Evals sign-off is mandatory, not
optional, whenever the diff trips their trigger conditions above.

---

## SLA / target timeline

The `<1hr MTTR on P1s` target in `CLAUDE.md` is an **incident** metric — it does not apply here.
Feature requests are planned work, not production emergencies, and forcing an incident SLA onto
planned scoping work would be a category error. Use these targets instead:

| Stage | Target |
|---|---|
| Acknowledge + log in `WORK.md` | Within 1 business day of the ticket/idea surfacing |
| In-charter / out-of-charter determination (step 3) | Within 1 business day of acknowledgment |
| If out-of-charter: FQ posted | Same day as the determination — do not sit on it |
| Founder response (if escalated) | Per the FQ's own `Deadline` field — non-blocking unless the requester stated urgency |
| Sprint placement decision (in-charter) | By the next sprint-planning boundary |
| Individual build tasks | ≤3 days each (PM.md's task-sizing rule); larger requests must be decomposed, not exempted |

If a request sits un-acknowledged past 1 business day, or un-scoped past 2 business days, that is
a process gap PM should surface in the next standup — not silently carried.

---

## Escalation

Escalation to `FOUNDER_QUEUE.md` should be **rare** within this SOP — it is the exception path,
triggered only by step 3's out-of-charter test, never routine. Per CONSTITUTION.md's founder's
domain and FOUNDER.md's explicit "what does NOT reach the Founder" table:

- Do **not** escalate: architecture choices, sprint decomposition, task sizing, deploy timing,
  which specialist agent builds it, or "is this a good idea technically." Those are agent-owned.
- **Do** escalate, using the required FQ format (Needs / Context / Options / Recommendation /
  Deadline), only when the request:
  - Expands scope beyond the current charter,
  - Requires new pricing, packaging, or an SLA commitment,
  - Requires a new paid vendor/service,
  - Makes a revenue- or legal-impact commitment to a specific tenant, or
  - Creates a cross-project priority conflict (e.g., competes with Project #2 resourcing).

Never post a raw "should we build this?" question without the PM having first run the
in-charter/out-of-charter test and attached a recommendation — FOUNDER.md returns unformatted or
recommendation-less entries to the originating agent.

---

## What "done" looks like

Intake for this SOP is done — a checkable state, not a feeling — when exactly one of these four
recorded outcomes exists:

- **Accepted:** a `WORK.md` task (or set of tasks) exists with owner, exit criteria, and status
  beyond `backlog`, and the charter-fit scoping call is logged in `DECISIONS.md`.
- **Deferred:** the request is in `WORK.md` backlog with an explicit sprint-placement rationale
  (why not this sprint) logged in `DECISIONS.md` — not silently dropped.
- **Escalated and resolved:** an FQ entry was posted in the required format, the Founder's
  decision is recorded, and the resulting disposition (accepted/deferred/rejected) is logged in
  `DECISIONS.md`.
- **Rejected:** PM (or the Founder, if it was escalated) determined the request should not be
  built, and the rationale is logged in `DECISIONS.md` with the requester informed (via FreeScout
  reply, if it originated from a ticket).

Intake-done is **not** the same as feature-shipped. A task moving from `backlog` through the full
`in_progress → review → qa_pass → deploy_ready → done` lifecycle is tracked and closed under the
normal `WORK.md`/CONSTITUTION.md review pipeline (section above), not under this SOP a second
time.
