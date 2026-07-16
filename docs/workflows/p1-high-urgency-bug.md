# P1 / High-Urgency Bug — Standard Operating Procedure

---

## Trigger

A ticket or internal finding falls into this category when **all** of the following are true:

- The system is **degraded, not down** — `ticket-triage`, `ticket-respond`, `kb-learn`, FreeScout
  intake, or the LiteLLM routing path is still running and still serving traffic. (A full outage —
  intake stopped polling, LiteLLM unreachable on all routes, the app down — is P0, not this SOP.)
- The defect is **customer- or data-impacting in a way that cannot wait for the next sprint**.
  Concrete examples, not hypotheticals:
  - A live customer ticket receives a **wrong AI classification with real consequence** — e.g.
    today's actual finding: a data-loss report auto-triaged as `normal` instead of escalated,
    meaning it would have sat in queue with no urgency signal.
  - A **partial feature failure** — e.g. `ticket-respond` drafts replies but `kb-learn` silently
    stops ingesting resolved tickets, so the KB quietly goes stale.
  - A **degraded-but-functioning system** — e.g. LiteLLM latency has tripled and is pushing
    triage decisions past a useful window, or the live eval gate is failing on a merged prompt
    that's already serving production traffic.
- It is not yet confirmed as a full outage (P0) and not merely cosmetic or low-frequency (P2/P3
  — see classification below).

If in doubt whether an incident is P0 or P1: if intake or the LLM path is fully unreachable,
treat as P0 and do not use this SOP. If it's still processing tickets — even wrongly — it's P1.

---

## Owner

**PM (Claude, main session) runs point on the incident** — owns the `WORK.md` entry, coordinates
across roles, and tracks the incident to close. PM does not diagnose or fix; PM routes.

Root-cause and fix ownership is assigned by failure type (Decision authority matrix,
`CONSTITUTION.md`):

| Failure type | Fix owner |
|---|---|
| Wrong AI classification / bad draft / prompt behavior (the triage-miss example above) | **Evals Lead** |
| Application logic / integration bug (FreeScout polling, Inngest workflow, DB query) | **Tech Lead** (architecture call) → **Engineer** (implementation) |
| Infra / deploy / env var / LiteLLM routing degradation | **Production Manager** |

QA Manager owns reproduction and fix verification regardless of which of the above applies —
QA is never the fix author, only the gate (`QA.md`).

---

## Severity / priority classification

| Severity | Definition | Example |
|---|---|---|
| **P0** | Full outage — intake stopped, LLM path fully unreachable, app down | LiteLLM prod alias down on all routes |
| **P1 (this SOP)** | Degraded but functioning; wrong output or partial failure with real customer/data consequence | Data-loss ticket misclassified `normal`; `kb-learn` silently failing |
| **P2** | Wrong output with low frequency or no material consequence; feature limitation | Rare edge-case misclassification with no downstream harm |
| **P3** | Cosmetic, dashboard-only, no customer path affected | Dashboard label bug |

Classify by **worst plausible consequence of the live instance**, not by how it was found. A
misclassification is P1 if the *category* of ticket it hit (data loss, security, billing) carries
real harm — even if this is the only occurrence found so far. Escalate the severity call to
Tech Lead if PM and QA disagree; never let severity ambiguity delay Step 1 below.

---

## Step-by-step procedure

1. **Immediately mitigate the live instance — before anything else.**
   Whoever finds it (any agent, QA, Data Engineer via monitoring, or a founder report) manually
   corrects the actual live ticket/state right now, independent of the systemic fix: re-classify
   or escalate the mis-triaged ticket in FreeScout, re-run the failed `kb-learn` ingest, or
   whatever stops the immediate harm. **Done:** the live customer-facing instance is no longer
   sitting in a wrong state. This step does not wait for root cause.

2. **Log and classify.** PM opens a `WORK.md` entry (next `T-` number) tagged P1, with the
   concrete example (ticket ID, expected vs. actual). QA Manager confirms the severity call
   against the table above and files a bug report in the format from `QA.md` (`Severity`,
   `Reproduces`, `Steps to reproduce`, `Expected`, `Actual`, `Environment`, `First seen`).
   **Done:** `WORK.md` row exists; bug report exists; severity agreed.

3. **Route to root-cause owner.** PM assigns per the Owner table above. **Done:** a named agent
   owns diagnosis, logged in `WORK.md`.

4. **Diagnose from raw evidence, not inference.** The root-cause owner inspects the actual
   completion/log/trace — LangFuse trace for the specific request, raw LLM output, or the
   relevant DB row — before concluding anything. Do not label a one-off as "model variance" or
   "flaky" without direct evidence; this team has been wrong about that exact call before (see
   `DECISIONS.md` 2026-07-15, T-119/T-120). **Done:** root cause is stated with the evidence that
   proves it, not a guess.

5. **Branch and fix.** The fix owner opens a branch and PR with the smallest change that
   addresses the confirmed root cause — a prompt/rubric line, a code fix, or a config/env change.
   No unrelated scope rides along. **Done:** PR open, linked to the `WORK.md` row.

6. **CR (CodeRabbit) first-pass review.** Automatic on PR open. **Done:** CR review completed,
   no unresolved blocking comments.

7. **Security Lead review — conditional, required if the diff touches** auth, secrets/Vault,
   migrations/RLS, the model allowlist, or what customer data reaches an LLM. Skipped otherwise.
   **Done:** sign-off recorded, or explicitly not required and noted why.

8. **Evals Lead review — conditional, required if the diff touches** a prompt, an eval file
   (`evals/*.yaml`), or model-routing config. For the wrong-classification example, this is
   **always required**. Includes explicit authorization for any eval baseline recapture — never
   silent. **Done:** sign-off recorded, or explicitly not required and noted why.

9. **QA verification.** QA reproduces the original bug with a failing test/case first, then
   confirms the fix makes it pass. Runs the full regression suite (not just the touched file),
   confirms both eval-gate checks are green (`promptfoo validate` schema check + the live
   `live-eval-gate` rubric check), and explicitly checks multi-tenant isolation if the change
   touches any ticket/tenant-scoped query. **Done:** `qa_pass` recorded in `WORK.md` per the
   exit criteria in `QA.md`.

10. **Production Manager deploys.** Standard pre-deploy checklist from `PRODUCTION.md`: rollback
    path written down before deploying, env var changes (if any) declared and REPLACE-not-append,
    Security Lead sign-off confirmed if required. Deploy via Coolify. Monitor at least 30 minutes
    post-deploy (this is a correctness fix, not an auth/billing/data-write critical-path change,
    so the 30-minute window applies, not the 24-hour one — escalate to the 24-hour window if the
    fix itself touches data writes). **Done:** health check + smoke test pass, no error-rate
    spike, deploy recorded in `docs/deploys/<date>-<change>.md`.

11. **Close.** PM updates `WORK.md` to `done`, logs the fix and root cause in `DECISIONS.md`
    (even if small — this is an ADR-adjacent record per `CONSTITUTION.md`), and confirms the
    Step 1 mitigation is now redundant (i.e., the systemic fix would have produced the same
    correct outcome). **Done:** both `WORK.md` and `DECISIONS.md` reflect the closed incident.

---

## Required reviewers / sign-offs before this can close

- **CR (CodeRabbit)** — always, first-pass, every PR.
- **Security Lead** — required only if the diff touches auth, secrets/Vault, migrations/RLS,
  the model allowlist, or customer data reaching an LLM.
- **Evals Lead** — required if the diff touches a prompt, eval file, or model-routing config.
  For AI-classification/behavior bugs (the headline example of this category), this is the
  default expectation, not the exception.
- **QA Manager** — always, explicit `qa_pass`, never inferred from "tests pass locally."
- **Production Manager** — deploy sign-off with rollback path and monitoring window, always.

No step is skippable. No merge without CR. No merge on a Security-Lead-required change without
Security Lead. No merge on an Evals-Lead-required change without Evals Lead. No deploy without QA.

---

## SLA / target timeline

Grounded in the platform goal of **< 1hr MTTR on P1s and > 95% SLA attainment** (`CLAUDE.md`).
MTTR is time-to-restore-correct-state for the customer, and **Step 1's mitigation is what
satisfies it**: the live instance is corrected within 15 minutes, comfortably inside the 1-hour
P1 bar. The fix timeline below is a separate ceiling on landing the *permanent, systemic* fix —
it does not relax MTTR, because the customer-facing harm is already stopped before it starts:

| Milestone | Target |
|---|---|
| Step 1 (immediate mitigation of the live instance — this is what meets the <1hr P1 MTTR bar) | **within 15 minutes** of detection — matches Production Manager's own 15-minute rollback target in `PRODUCTION.md` |
| Step 4 (root cause confirmed from evidence) | **within 2 hours** of detection |
| Steps 5–10 (permanent fix reviewed, verified, deployed) | **same working day**, target 4 hours from detection, hard ceiling 24 hours |
| Step 11 (closed in `WORK.md`/`DECISIONS.md`) | within 1 hour of deploy |

If the permanent fix cannot land within 24 hours, that is itself an escalation trigger (see
below) — not a reason to quietly let the SOP timeline slip. MTTR is already satisfied at that
point; this ceiling exists so the underlying defect doesn't linger and produce a repeat P1.

---

## Escalation

Staying within this SOP — routine, agent-owned, no Founder involvement — covers the large
majority of P1s, including the headline example (a misclassification is a technical defect;
diagnosing and fixing it is agent work per `CONSTITUTION.md`'s "could a senior engineer answer
this by reading the repo?" test).

Post to `FOUNDER_QUEUE.md`, using the required format, only when:

- The live instance caused **verifiable tenant data loss or data exposure** (not just a risk of
  it) — mirrors `QA.md`'s own escalation rule.
- The fix is projected to take **longer than the 24-hour ceiling** above, i.e. heading toward the
  CONSTITUTION's ">1 week sprint slip" territory — post before it gets there, with a recovery plan.
- Root-cause diagnosis reveals the defect requires **scope expansion beyond the current charter**
  (e.g. the fix needs a new capability, not a bug fix) — a business/product judgment call, not
  a technical one.
- Fixing it correctly would change **pricing, packaging, or an SLA commitment** — always
  Founder's domain, never agent-decided.

Never escalate "how to fix it" or "was this variance or a real bug" — those are exactly the
technical calls this team is trusted to make by reading the evidence (see Step 4).

---

## What "done" looks like

This incident is closed only when **all** of the following are simultaneously true:

- [ ] The specific live instance (the actual mis-triaged ticket, the actual failed ingest, etc.)
      has been manually corrected — not just the systemic bug fixed going forward.
- [ ] `WORK.md` shows the task `done`, with the fix PR linked.
- [ ] `DECISIONS.md` has an entry recording root cause and fix, even if the fix was small.
- [ ] The fix PR is merged with all required sign-offs recorded (CR always; Security Lead and
      Evals Lead per the conditional triggers above; QA `qa_pass` always).
- [ ] Both eval-gate checks (hermetic schema + live `live-eval-gate`) are green on `main` post-merge.
- [ ] The fix is deployed to production via Coolify, with a `docs/deploys/` record and a
      completed monitoring window showing no error-rate spike or new anomaly.
- [ ] No `FOUNDER_QUEUE.md` item was required — or, if one was posted, it has been resolved and
      cleared, not left open.

"Done" is never "the PR is open" or "it looks fixed." It is the checklist above, verified.