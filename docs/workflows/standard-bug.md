# Standard Bug — Standard Operating Procedure

## Trigger

A ticket or internally-found defect falls into this SOP when **all** of the following hold:

- It is a functional defect in existing behavior — something that used to work (or was specified to work) and doesn't, or produces a wrong result. Examples: a triage miscategorization that isn't a live-eval-gate blocker, a dashboard UI bug, a KB article rendering wrong, a metrics/cost-accounting miscalculation, an env var misconfiguration causing degraded (not down) behavior, a `ticket-respond` draft with a wrong-but-not-fabricated fact.
- QA severity is **Medium** or **Low** per the `QA.md` bug report format — not `Critical` or `High`.
- It does **not** involve any of: verifiable data loss, cross-tenant data exposure, an auth failure spike, a production outage, or a compliance/security fabrication (see `T-116`/Sprint 19 for what that looks like). Any of those reclassify the ticket out of this SOP immediately — treat it as an incident, not a standard bug, and follow the relevant escalation rules in `PRODUCTION.md` / `CR.md` instead.
- It does not require an architecture decision or ADR to fix. If root-causing the bug reveals it does, hand off to Tech Lead per the decision authority matrix in `CONSTITUTION.md` — this SOP no longer applies once that happens.

If, during reproduction, the bug turns out to be worse than it looked at intake (e.g., "wrong KB citation" turns out to be "wrong KB citation served across tenants"), stop, re-triage, and exit this SOP — do not keep running the standard path on an incident.

## Owner

**PM** owns intake, triage, and close-out (assign, track in `WORK.md`, log outcome in `DECISIONS.md`).

**Fix owner** (runs point on reproduction → PR) is assigned by PM based on the affected surface, per the roster in `CONSTITUTION.md`:

| Affected surface | Fix owner |
|---|---|
| Dashboard, admin panels, customer-facing UI | Frontend Engineer |
| Observability, metrics, cost accounting (`agent_cost_events`, `agent_cost_daily`) | Data Engineer |
| Integrations, BYOK, tenant onboarding | Solutions Architect |
| KB article content, curation, RAG retrieval quality | Knowledge Lead |
| `ticket-triage` / `ticket-respond` / `kb-learn` prompt behavior (wrong classification, wrong draft, wrong KB write-back) | Tech Lead fixes; **Evals Lead review is mandatory** (see step 7) — a role does not author and gate its own prompt change |
| Cross-cutting, ambiguous, or touches more than one of the above | Tech Lead |

QA, Production Manager, and (conditionally) Security Lead / Evals Lead join per the standard flow below — they never run point on a standard bug, they gate it.

## Severity / priority classification

Standard bugs are, by definition, `Medium` or `Low` on the `QA.md` scale:

- **Medium** — feature is wrong or degraded but has a workaround, or affects a non-critical path (e.g., a dashboard chart mislabels a value; a KB article has a stale link).
- **Low** — cosmetic, or affects an edge case with negligible user impact (e.g., a timestamp is off by a display-format issue, not a data issue).

If reproduction shows the real severity is `Critical` or `High` (data-affecting, tenant-crossing, or security-adjacent), re-triage per the **Trigger** section — this is no longer a standard bug and PM re-routes it.

## Step-by-step procedure

1. **Intake & log — PM.** Ticket enters via the FreeScout → ops-hub triage pipeline, a QA/monitor finding, or a direct report. PM confirms it's not P0/P1 (see Trigger), assigns a `T-` ID, sets severity (Medium/Low), and assigns the fix owner per the table above. **Done:** a `WORK.md` row exists with T-ID, owner, severity, status `todo`.

2. **Reproduce & root-cause — Fix owner.** Reproduce on staging (preferred) or locally, using the `QA.md` bug report format (steps to reproduce, expected vs. actual, environment) as the write-up even though QA hasn't taken it yet. If it cannot be reproduced after a reasonable attempt, do not silently close it — return it to PM to request more detail from the reporter, and it stays `todo` in `WORK.md`. **Done:** repro steps + root cause posted as a `WORK.md` update.

3. **Branch & fix — Fix owner.** Create a fix branch (never push to `main`), implement the minimal change scoped to the root cause. If the diff touches a prompt, an eval file, or model-routing config, flag it for Evals Lead review. If it touches auth, secrets/Vault, migrations/RLS, the model allowlist, or what customer data reaches an LLM, flag it for Security Lead review. **Done:** PR opened against `main`, description states what changed and why, linked to the T-ID.

4. **Test plan & regression test — QA.** Per `QA.md`: write a test plan to `docs/test-plans/<ticket>-<date>.md` covering happy path, error cases, edge cases (null/empty/max/concurrent), and multi-tenant isolation where the surface touches tenant data. A regression test that fails on the original bug and passes on the fix is mandatory — this is a bug fix, not new capability. **Done:** test plan file committed; regression test added to the branch.

5. **CI — automated.** Lint/typecheck/tests run, plus the hermetic Eval Gate schema check (`promptfoo validate`) on every PR, and the live `live-eval-gate` LLM-rubric check if the diff touches prompt surface (neutral-skip otherwise, per `CLAUDE.md`'s eval-gated constraint). **Done:** all required CI checks green.

6. **CR review — CodeRabbit (first pass).** Reviewed across `CR.md`'s dimensions: correctness, security, regressions, code quality, test coverage. **Done:** no unresolved blocking CR finding (advisories may be accepted with a documented rationale in the PR).

7. **Conditional specialist review.** Security Lead review is **required** (not optional) if the diff touches auth, secrets/Vault, migrations/RLS, the model allowlist, or LLM-facing customer data — skipped otherwise, routed by path per `CONSTITUTION.md`. Evals Lead review is **required** if the diff touches a prompt, an eval file, or model-routing config — skipped otherwise. **Done:** sign-off recorded in the PR, or explicitly not-applicable because neither trigger fired.

8. **QA verification — QA.** Confirms the regression test from step 4 reproduces the original bug pre-fix and passes post-fix, runs the full regression suite (not just the changed file), checks edge cases and tenant isolation, and marks `qa_pass` in `WORK.md`. **Done:** `qa_pass` recorded; test plan updated with results.

9. **Merge — Fix owner or PM.** Per `CR.md`'s merge criteria: CR pass + `qa_pass` + CI green + any required Security Lead / Evals Lead sign-off present. No self-merge without those gates satisfied, and never force a merge past a failing or unresolved check. **Done:** PR merged to `main`.

10. **Deploy — Production Manager.** Deploy via Coolify per `PRODUCTION.md`'s pre-deploy checklist; rollback path (feature flag off → redeploy previous image → git revert + redeploy) is written down *before* the deploy starts; record the deploy in `docs/deploys/<date>-<change>.md`; monitor at least 30 minutes post-deploy (24 hours if the change touches auth, data writes, or billing). **Done:** deploy record written, health endpoint and smoke tests pass, monitoring window complete (or anomaly documented).

11. **Close-out — PM.** Move the `WORK.md` task to `done` with the deploy reference. Log any technical decision made along the way (even a small one, e.g., "fixed by X instead of Y because Z") in `DECISIONS.md`. **Done:** `WORK.md` shows `done`; `DECISIONS.md` entry exists if a decision was made.

## Required reviewers / sign-offs before this can close

- **CR (CodeRabbit)** — always, no exceptions (`CR.md`).
- **Security Lead** — required only if the diff touches auth, secrets/Vault, migrations/RLS, the model allowlist, or what customer data reaches an LLM; otherwise skipped, not asked-for.
- **Evals Lead** — required only if the diff touches a prompt, an eval file, or model-routing config; otherwise skipped.
- **QA** — always; `qa_pass` in `WORK.md` is a hard gate, no deploy without it.
- **Production Manager** — always, for the deploy itself and the post-deploy checklist; PM does not deploy, and no one bypasses QA to speed a deploy up regardless of how small the fix looks.

No step in this list is optional when its trigger condition is met, and no step is added when its trigger condition is not met — route by path, not by asking.

## SLA / target timeline

Standard bugs are explicitly **not** held to the P1 bar (`<1hr MTTR`, `CLAUDE.md`) — that number is reserved for production-impacting incidents. It is, however, the anchor this SOP scales down from: a P1 gets under an hour because it's actively hurting the product; a Medium/Low bug earns a proportionally longer but still bounded window, not an open-ended one.

- **Acknowledge & log (step 1):** within 4 business hours of the ticket/report landing.
- **Reproduce & root-cause (step 2):** within 1 business day of acknowledgment.
- **Fix PR opened (step 3):** within 2 business days of root cause being confirmed.
- **Full pipeline complete — CR, conditional specialist review, QA, merge, deploy (steps 4–10):** within 5 business days of intake.

Total target: **intake → production in 5 business days.** This is a target, not itself an SLA-attainment metric — `CLAUDE.md`'s `>95% SLA attainment` and `<$2 CAD/ticket` figures are cost/response targets for the live triage/respond pipeline as a whole; a standard bug fix rolls into that ticket volume and cost, so review depth (steps 4–9) should not be padded just to hit a calendar number, and reproduction (step 2) should not be rushed past the point where root cause is actually confirmed.

## Escalation

Routine standard-bug work should **almost never** reach `FOUNDER_QUEUE.md`. Per `CONSTITUTION.md`: the Founder answers business questions only. Post to `FOUNDER_QUEUE.md`, using the required format, only when one of these actually happens mid-SOP:

- Root-causing reveals this was never a standard bug — it's data loss, tenant data exposure, or a security/compliance finding — **and** the resulting fix or disclosure has a legal/compliance dimension the team can't resolve on its own (per `CR.md`'s security escalation rule). Otherwise, a reclassified P0/P1 is still handled by the team, not the Founder, per `PRODUCTION.md` and `QA.md`'s own escalation rules.
- The fix requires an env var value that is a credential only the Founder holds (`PRODUCTION.md`).
- Fixing it properly requires expanding scope outside the current sprint/charter, or surfaces a pricing/SLA question — a genuine business judgment call, not a technical one.
- This single ticket's investigation or fix is the cause of a sprint slip greater than one week, with a recovery plan attached.

Everything else — including a standard bug that turns out to be annoyingly hard, or one that gets reclassified to High severity but stays technical — is handled within the team, per `QA.md`'s and `PRODUCTION.md`'s own "everything else is handled within the team" rules.

## What "done" looks like

A standard bug ticket is closed only when **all** of the following are true — not when it "feels finished":

- [ ] `WORK.md` task status is `done`, with the deploy reference attached.
- [ ] PR is merged to `main` with: CR pass recorded, `qa_pass` recorded, CI green, and any required Security Lead / Evals Lead sign-off present or explicitly marked not-applicable.
- [ ] A regression test exists in the suite that fails on the original bug and passes on the fix, and it is running in CI (not a manual-only check).
- [ ] `docs/test-plans/<ticket>-<date>.md` exists and is filled in with results, not just the plan.
- [ ] `docs/deploys/<date>-<change>.md` exists with the rollback path that was defined before the deploy, and the outcome of the deploy.
- [ ] The post-deploy monitoring window (≥30 minutes, or 24 hours for auth/data-write/billing changes) completed clean, or any anomaly — even self-resolved — is documented in `DECISIONS.md`.
- [ ] Any technical decision made while fixing this bug is logged in `DECISIONS.md`.
- [ ] There is no open `FOUNDER_QUEUE.md` item tied to this ticket.

If any box is unchecked, the ticket is not done — it is still in flight, and `WORK.md` should say so.