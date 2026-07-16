# P0 / Critical Incident — Standard Operating Procedure

## Trigger

A ticket or an internal signal is **P0** — not P1, not a routine bug — when it matches at least
one of these, concretely:

1. **A production monitor reports the pipeline itself is broken**, not just degraded:
   - `monitor-litellm-internal-auth.yml` (T-97, every 15 min) reports `auth_rejected` or
     `unreachable` on **2 consecutive runs** (the Sprint 16 / T-113 threshold — one blip pages
     nobody, two does).
   - `monitor-e2e-pipeline.yml` (T-98, every 6h) fails to drive the sentinel ticket to
     `state='responded'`.
   - A **UptimeRobot "down" alert** lands via `repository_dispatch` → `status-incident.yml`
     with `severity: down`.
2. **A human or QA spot-check finds a real backlog of stuck production tickets** that no
   monitor caught — the FQ-69 pattern exactly: 14/20 (70%) of prod tickets sat in
   `state='new'` for 3.6 days while `/health/litellm` stayed green throughout, because that
   endpoint probes `LITELLM_EXTERNAL_URL` and never sends the app's own key. **A green
   `/health` or `/health/litellm` is not evidence against a P0** — it is the exact signal that
   failed to catch FQ-69. Only `/health/litellm-internal` (T-97) and a live ticket-table check
   test the real credential path.
3. **Confirmed or suspected tenant data exposure** — an RLS gap, a missing `tenant_id` scope
   on a new query, or any cross-tenant read/write, confirmed or suspected.
4. **Confirmed data loss** — a migration, write path, or manual DB action destroyed or
   corrupted rows with no clean recovery from the current backup / point-in-time state.
5. **Sustained error-rate spike (>2x baseline) that is customer-visible**, i.e. Production
   Manager's own standing rollback trigger (`PRODUCTION.md`) combined with a real customer
   impact, not a transient blip that self-resolves before anyone acts.

If none of the above apply — a single monitor red that self-resolves, a degraded-but-still-
processing pipeline, a cosmetic bug — it is **not** P0. Route it as a normal bug through
`WORK.md`; this SOP does not apply.

---

## Owner

**Production Manager** runs point, start to close — this category is exactly their charter
(`.claude/team/PRODUCTION.md`: "Deploys, env vars, infra, rollbacks... treat every deploy as a
procedure, not a gamble").

Two mandatory pull-ins, immediate, not optional:

- **Tech Lead** — root-cause diagnosis authority the moment the cause isn't obvious from the
  monitor output alone (per CONSTITUTION.md's decision matrix: "Implementation approach →
  Engineer, escalate to Tech Lead if ambiguous"; this is how FQ-69 actually got root-caused —
  QA found the stuck backlog, Tech Lead root-caused the master-key rejection).
- **Security Lead** — mandatory the instant trigger #3 or #4 is even *suspected*, before any
  other remediation step, per `.claude/team/SECURITY.md`'s own threshold ("active credential
  leak, confirmed or suspected tenant data exposure").

PM (main session) coordinates the cross-agent handoff and keeps `WORK.md` current; PM does not
run the technical remediation itself.

---

## Severity / priority classification

This SOP covers **P0 only** — system down, confirmed data loss, or a confirmed/suspected
security breach, per the Trigger section above. P0 sits above P1 (CLAUDE.md's `<1hr MTTR`
tier — degraded-but-functioning, e.g. one bad triage call, a single slow LLM call, a
non-blocking eval flake) and above routine bugs (handled through normal `WORK.md` flow, no
special SLA). If Production Manager and Tech Lead disagree on whether something is P0 vs P1,
default to P0 until root cause is confirmed otherwise — downgrading is cheap, missing a real
P0 for 3.6 days (FQ-69) is not.

---

## Step-by-step procedure

1. **Detect & acknowledge — Production Manager.**
   Source is either automated (a monitor auto-opens an incident on the `status-content`
   branch) or human (QA/any agent spot-checks the live ticket table and finds a stuck
   backlog — do this the way FQ-69 was actually found: a direct, read-only query, not an
   assumption). Production Manager acknowledges in `WORK.md` within **15 minutes** of
   detection, tagging it `P0`. **Done** = a `WORK.md` row exists with owner, trigger, and
   timestamp.

2. **Classify — Production Manager, Tech Lead if ambiguous.**
   Confirm against the Trigger list above; if trigger #3 or #4 is even possible, pull Security
   Lead in now, not after containment. **Done** = the specific trigger condition is named, not
   "something seems down."

3. **Contain — Production Manager (Security Lead directs if breach/data-loss).**
   Work the rollback decision tree from `PRODUCTION.md`: feature flag off → redeploy previous
   image → git revert + redeploy, in that preference order. For a suspected breach, containment
   means revoking/rotating the exposed credential or closing the RLS gap *before* any other
   remediation — Security Lead's call, not Production Manager's. **Done** = the bleeding has
   stopped (error path is off, credential is rotated, or the leaking query is blocked), even if
   root cause is still unknown. Target: **15 minutes** from acknowledgement
   (`PRODUCTION.md`'s own "mean time to rollback: under 15 minutes").

4. **Root-cause — Tech Lead (or Production Manager if it's clearly infra-shaped).**
   Diagnose with live, read-only evidence first — the `diagnose-*.yml` pattern this repo
   already uses (e.g. `diagnose-ops-hub-prod-triage-blocked.yml` for FQ-69), not a guess.
   Never label something "variance" or "self-resolved" without pulling the raw evidence — the
   same discipline the Evals Lead's playbook enforces for eval failures applies here to
   incidents. **Done** = a root cause stated with the specific evidence that confirms it (a
   log line, a failed auth probe, a query result) — not "seems fixed now."

5. **Fix — the owning engineer opens a PR.**
   Small and surgical where possible (T-120's 2-line rubric fix, T-104's alias fix are the
   house style — the smallest change that closes the real gap). **Done** = PR open, linked to
   the `WORK.md` row.

6. **Review — CR always; Security Lead and Evals Lead per path, per CONSTITUTION.md's flow.**
   - CR (CodeRabbit): first-pass, every PR, no exception.
   - Security Lead: **required** if the diff touches auth, secrets/Vault, migrations/RLS, the
     model allowlist, or customer/tenant data reaching an LLM — true for nearly every P0 fix,
     since P0s live in exactly that surface (credentials, RLS, prod infra). Uses the per-PR
     checklist in `.claude/team/SECURITY.md`.
   - Evals Lead: **required only if** the fix touches a prompt, an eval file, or model-routing
     config (rare for P0 infra fixes, but true if the incident was, e.g., a triage-prompt
     regression). Skipped otherwise — do not invent a review this class of fix doesn't need.
   **Done** = every required reviewer has signed off in the PR; no required-and-skipped gate.

7. **Verify — QA.**
   Reproduce the original failure with a failing test first, then confirm the fix makes it
   pass. Run the full regression suite, not just the touched file. Multi-tenant isolation is
   explicitly re-checked if trigger #3 was in play. **Done** = `docs/test-plans/` entry exists,
   CI green, original bug reproduced-then-resolved, regression suite clean.

8. **Authorize & deploy — Production Manager, with explicit prod-mutation authorization.**
   No agent self-authorizes a production credential or infra mutation — the same discipline
   every prior prod fix in this repo has followed (FQ-69, FQ-75, T-104). State the exact
   action and get it confirmed before running it. Production Manager then deploys per its
   own pre-deploy checklist (rollback path written down, env var changes declared, Security
   Lead sign-off obtained). **Done** = deploy executed, recorded in
   `docs/deploys/<date>-<change>.md`.

9. **Confirm the TRUE all-clear — Production Manager.**
   Never accept a generic `/health` green as the all-clear signal for this class of incident —
   that is the exact blind spot that let FQ-69 run silently for 3.6 days. The real signal is
   specific to the trigger: `/health/litellm-internal` returning 200 **and** the next scheduled
   T-97 run going green **and** (if the pipeline was implicated) the next T-98 run reaching
   `state='responded'` **and**, if a backlog existed, a live query confirming it has fully
   drained to zero. **Done** = all of the applicable specific signals are green, not just the
   generic one.

10. **Document — Production Manager.**
    `DECISIONS.md` gets a post-mortem entry — required even if the incident auto-resolved
    (`PRODUCTION.md`'s own quality bar: "every incident, even auto-recovered, has a post-mortem
    note"). `WORK.md` task moves to `done` with deploy time recorded. **Done** = both files
    updated same-day.

---

## Required reviewers / sign-offs before this can close

- **CR (CodeRabbit)** — every fix PR, no exception.
- **Security Lead** — required whenever the fix touches auth, secrets/Vault, migrations/RLS,
  the model allowlist, or customer data reaching an LLM (the near-default case for P0s).
- **Evals Lead** — required only if the fix touches a prompt, eval file, or model-routing
  config; otherwise not invoked.
- **QA** — mandatory always: functional verification, full regression, and (for trigger #3)
  explicit multi-tenant isolation re-test.
- **Production Manager** — final deploy sign-off and the specific, non-generic all-clear
  signal from step 9.
- **Explicit human/Founder authorization** for the actual prod credential or infra mutation
  step — an agent stating the exact action and getting it confirmed inline counts; an agent
  inventing its own authorization does not.

No self-merge by the PR's own author-agent — same standing rule as every other PR in this repo
(see Sprint 19's governance incident, and Sprint 21's T-118/T-119/T-120, all left for review).

---

## SLA / target timeline

Grounded in CLAUDE.md's own stated bar (`<1hr MTTR on P1s`, `>95% SLA attainment`) — P0 is by
definition at least as severe as P1, so it inherits the same ceiling, with tighter internal
checkpoints:

| Phase | Target | Source |
|---|---|---|
| Detect → acknowledge | 15 min | This SOP, step 1 |
| Acknowledge → contain (bleeding stopped) | 15 min | `PRODUCTION.md`'s stated rollback target |
| Full resolution (root cause fixed, deployed, TRUE all-clear confirmed) | **≤ 1 hour** | CLAUDE.md's P1 MTTR bar, as a floor for the more severe P0 class |
| Post-mortem logged in `DECISIONS.md` | 24 hours | `PRODUCTION.md`'s quality bar |
| Monitoring window post-deploy | 30 min standard; **24 hours** if the fix touched auth, data writes, or billing | `PRODUCTION.md` |

If genuine root-cause diagnosis cannot land inside the 1-hour window (rare — most of this
repo's real incidents, FQ-69 included, were root-caused same-day once someone looked), that is
not itself grounds to relax containment: step 3's 15-minute containment target still applies
regardless of how long root-cause takes. Only if the whole incident stretches past a week does
it become a Founder-queue "sprint slip" item — otherwise it stays team-owned end to end.

---

## Escalation

`FOUNDER_QUEUE.md` is for **authorization and information the team cannot supply itself** — not
a status update. Per CONSTITUTION.md's Founder's-domain framing, post only when:

- The incident caused **confirmed customer-visible data loss or downtime** (`PRODUCTION.md`).
- **Rollback was triggered and root cause is still not understood** (`PRODUCTION.md`).
- A required env var value or credential is one **only the Founder holds**.
- **Two consecutive failed deploys** on the same fix (`PRODUCTION.md`).
- Trigger #3 confirms as an **active credential leak or confirmed tenant data exposure**
  (`SECURITY.md`'s own threshold — not "high severity," specifically "needs the Founder's
  *authority*, not their *awareness*").
- A **vendor outage** (Coolify, Supabase, LiteLLM provider) requires a strategic call the team
  cannot make alone.
- The incident is trending toward a **sprint slip greater than one week**.

Use the required format:
```
## FQ-[N] — [Title]
**Needs:** Decision / Information / Authorization
**Context:** [what you know, what you tried]
**Options:** A / B / (C)
**Recommendation:** [your call + one-sentence rationale]
**Deadline:** [date or "non-blocking"]
```

Everything else — including a full P0 with a confirmed root cause and a known fix — is
resolved **inside the team**. A P0 does not, by itself, require Founder involvement; only the
specific conditions above do. Do not post a raw incident dump "for awareness" — that is what
`WORK.md` and `DECISIONS.md` are for.

---

## What "done" looks like

All of the following are true, checkably, not "it feels resolved":

- [ ] The **specific**, non-generic all-clear signal for the trigger that fired is green
      (`/health/litellm-internal` = 200, next T-97 run green, next T-98 run reaching
      `state='responded'` if the pipeline was implicated) — a green generic `/health` alone
      does **not** satisfy this.
- [ ] If a ticket backlog existed, a live query confirms it is fully drained — zero tickets
      stuck past their expected state transition.
- [ ] Root cause is stated with the live evidence that confirmed it, filed in `DECISIONS.md` —
      not "appears fixed."
- [ ] The fix is merged, deployed to the affected environment, and the deploy is recorded in
      `docs/deploys/<date>-<change>.md` with its rollback path.
- [ ] QA's regression suite is green and the original failure is proven reproduced-then-fixed.
- [ ] Every required reviewer (CR always; Security Lead and/or Evals Lead per path; QA;
      Production Manager) has signed off — no required-and-skipped gate.
- [ ] The post-deploy monitoring window (30 min, or 24h for auth/data-write/billing paths) has
      completed clean — no error-rate spike, no new incident.
- [ ] `WORK.md` shows the task `done`; `DECISIONS.md` carries the post-mortem entry, even if
      the incident auto-resolved.
- [ ] Any `FOUNDER_QUEUE.md` entry opened for this incident is marked resolved and cleared —
      not left open.