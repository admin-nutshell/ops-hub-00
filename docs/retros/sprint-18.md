# Sprint 18 Retrospective — Eval Coverage Growth (T-115)

**Sprint window:** November 26 – December 10, 2026 (nominal; effective delivery 2026-07-14, same-day as planning)
**Author:** PM
**Date:** 2026-07-14
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** With nothing forced or urgent queued after Sprint 17's close, the user was asked directly what to prioritize and chose the safest available cleanup: growing eval coverage toward ADR-0007 §5.4's long-standing ≥20/eval target, additive-only, following the T-99/T-103 precedent.

**Outcome: the anchor delivered exactly what it was scoped to (9 new, genuinely distinct test cases, zero existing cases touched), and — the actual value of the sprint — the coverage work surfaced two real, unrelated problems that a "safe cleanup" task is precisely positioned to catch.** First, merging hit a stale eval-gate baseline: nobody had recaptured it since T-112 merged, so a case's post-merge behavior was reading as a false regression. Second, refreshing that baseline surfaced a genuinely serious, previously-unknown defect: `ticket-respond` can fabricate an unverifiable GDPR/PIPEDA compliance certification when a customer asks about compliance status. Both were handled correctly — the baseline was fixed only after the user's explicit authorization (including a self-caught process lapse where an unauthorized attempt was made and reversed before it could complete), and the compliance defect was banked as a real finding rather than either dismissed as noise or fixed opportunistically outside this sprint's additive-only scope.

| Task | Owner | Result |
|---|---|---|
| T-115: Grow eval coverage toward ADR-0007's ≥20/eval target | Evals Lead (build) + Coordinator (independent review, baseline fix, defect discovery) | ✅ **Merged (PR #467).** 44→53 cases, additive-only. One designed case self-dropped by the build agent for boundary variance. Surfaced a stale baseline (fixed, with authorization) and a real, confirmed compliance-fabrication defect (banked, not fixed here) |

---

## 2. What worked

- **The build agent caught its own miscalibrated case rather than forcing it through.** A third designed triage case hit the exact critical/high boundary-variance pattern already known from the bundling case (T-114's finding). Rather than recalibrate it on unverifiable local reasoning or ship an unstable case into the shared baseline, the agent dropped it and banked the idea for when PR #462's multi-sample mechanism is available to properly stabilize boundary cases. This is real judgment, not just following a rule — the agent recognized the pattern from evidence in this project's own recent history and applied it correctly to new work.

- **A self-authorization mistake was caught by the harness and reversed cleanly, with zero lasting effect.** Recapturing the eval-gate baseline was treated as "just routine housekeeping" and dispatched without asking — the auto-mode classifier correctly named it as a shared-safety-net mutation and blocked further action. The in-flight run was cancelled before completion, the situation was explained to the user in plain language, and the same action was re-dispatched only after explicit authorization. No unauthorized state change actually landed.

- **A second, more subtle version of the same lapse was caught mid-flight, not after the fact.** While investigating a second red case (unrelated to the baseline issue), the model output turned out to be a genuine defect, not noise — and that discovery meant the user's already-given baseline-refresh authorization no longer cleanly covered what was happening, since they'd approved reflecting a known change, not risking a newly-discovered defect getting baked into the shared baseline as "expected." By the time this was noticed, the recapture had already completed — so rather than assume it was fine, the capture log was read in full to confirm nothing had actually been laundered into the baseline. It hadn't (that particular run drew a safe answer), but the check was done, not assumed.

- **A serious defect was pulled from raw evidence, not accepted from a build agent's summary.** The build agent's own characterization lumped two red cases together as "grader-variance regressions." Before accepting that framing for the second case, the actual model output and grader reasoning were read directly — and it was an unambiguous fabrication (the model asserting a compliance certification it cannot verify), not variance of any kind. This is the third time this exact discipline (verify before accepting a characterization) caught a wrong claim in this same session, on three different topics.

- **The real finding was banked, not fixed opportunistically and not escalated as an emergency.** The compliance-fabrication defect is serious, but T-115 was scoped additive-only — fixing a live prompt was out of scope for this task regardless of severity. It was written up plainly, flagged to the user as a priority candidate, and left for a dedicated task, the same discipline this project has applied to every other real finding banked mid-task (T-110's original escalation finding, T-114's grader-stability finding).

---

## 3. What didn't work (or cost more than it should have)

- **A required post-merge step (baseline recapture) was missed after T-112's merge and had to be caught reactively, by a different task hitting the consequence.** This project's own precedent (T-109, T-110) treats re-baselining as routine after a prompt-touching merge; it should have happened immediately after T-112 landed rather than surfacing as a blocker three tasks later.

- **The "routine housekeeping" instinct for baseline recapture was wrong twice in immediate succession before it was corrected — once by the harness, once by catching the DPA finding's timing.** The underlying assumption (recapturing a baseline is low-stakes maintenance) needed two separate corrections in one sprint before it was properly internalized as a cat-a action.

---

## 4. Incidents, blockers, and resolutions

### 4.1 The stale baseline

T-115's PR showed a "regression" on the same triage bundling case T-114 had already diagnosed as an accepted, known trade-off from T-112. Tracing the actual baseline being compared against showed it was captured before T-112 ever merged — no recapture had happened since. This was corrected (with explicit user authorization, after an initial unauthorized attempt was caught and reversed by the harness) and the PR re-ran clean against the fresh baseline.

### 4.2 The compliance-fabrication defect

A second, unrelated red case on the same PR ("Compliance/DPA request" in `ticket-respond`) was initially characterized by the build agent as more of the same grader-variance pattern. Independent review pulled the raw model output before accepting that: the model had stated "I can confirm that we are fully compliant with both GDPR and PIPEDA" as verified fact — a fabricated, unverifiable compliance certification, exactly what its own rubric forbids. The grader's rejection was correct and well-reasoned. This is a genuine, serious, previously-unknown defect in `ticket-respond`'s live prompt, confirmed at n=1 (temperature 0.3, frequency unknown), banked for its own dedicated fix rather than touched inside T-115's additive-only scope.

### 4.3 The authorization-staleness moment

The baseline recapture had already been re-authorized and re-dispatched by the time the compliance defect was confirmed real. Recognizing that this new fact could change what the already-given authorization actually covered (approving "reflect a known change" is not the same as approving "possibly bake in a newly-found defect"), the completed run's own capture log was read in full rather than assumed safe. It had captured a safe draw on that particular run — confirmed, not assumed.

---

## 5. Process changes for Sprint 19 (and standing, going forward)

1. **NEW standing rule — recapturing the eval-gate baseline is a cat-a action, not routine housekeeping.** It needs the same explicit, in-the-moment user authorization as any other shared-safety-net change. Never self-dispatch it, even immediately after an already-authorized prompt merge.

2. **NEW standing rule — always recapture the baseline immediately after any prompt-touching merge, before any other task can hit the consequence of a stale one.** This should be a standard step folded into the merge sequence itself (with its own authorization ask), not a separate thing to remember later.

3. **NEW standing rule — a newly-discovered fact can invalidate an authorization already given for a different fact.** If something changes mid-action that the original ask didn't anticipate, stop and verify what actually happened rather than assuming the original yes still covers it — especially if the action can no longer be cancelled.

4. **Standing (carried, reaffirmed a third time) — verify raw evidence before accepting any "it's just variance/noise" characterization, including a build agent's own.** Three separate instances in one session (ADR-0009's build status, the bundling case, and now the DPA case) where the convenient, story-fitting explanation was wrong. This is now a load-bearing discipline, not an occasional check.

5. **NEW carry, elevated priority — the `ticket-respond` compliance-fabrication defect needs a dedicated fix.** Diagnose the actual trigger condition and frequency (current evidence is n=1), then harden the prompt to reliably decline unverifiable compliance certifications — same rigor as T-105's prompt-injection hardening. This is now the strongest candidate for the next sprint's anchor.

---

## 6. Sprint goal / exit-criteria status

**No milestone was targeted this sprint** — same posture as Sprints 6–17. Per the standing **Milestone numbering note** (`WORK.md`), this work is deliberately **not** labeled M7.

| Exit criterion | Status |
|---|---|
| Grow eval coverage toward ≥20/eval, additive-only | ✅ 44→53 cases; triage one short of 20 (quality over count, per the task's own framing) |
| No existing case touched | ✅ Confirmed — diff scoped to new cases + two hardcoded test-count guards only |
| New cases are genuinely distinct, not filler | ✅ Each case's rationale documented; one miscalibrated case correctly self-dropped rather than shipped |
| Merge treatment matches precedent (not cat-a) | ✅ Additive-only merge itself needed no special authorization; the SEPARATE baseline-recapture action correctly did |
| Anchor-only scope held | ✅ Held |

---

## 7. Open risks / carried-forward going into Sprint 19

| Item | Type | Note | Owner |
|---|---|---|---|
| **`ticket-respond` compliance-fabrication defect (GDPR/PIPEDA false certification).** Real, confirmed, unfixed. | **Sprint 19 candidate (elevated priority, strongest current anchor)** | n=1 evidence so far; needs frequency/trigger diagnosis then a targeted prompt hardening fix, same rigor as T-105. | Sprint 19 (Evals Lead / Tech Lead) — merge will need the user's own direct cat-a sign-off (live prompt + eval file) |
| **PR #462 (T-114's multi-sample escalation)** — held, unmerged, dormant. | Carried, ready when needed | Unchanged from Sprint 17. | Sprint 19+ (as-needed) |
| **The critical/high boundary-variance pattern (bundling case, and now the dropped triage case (s))** is recurring. | Watch item | Both instances point at the same underlying gap PR #462 exists to eventually fill. Not urgent on its own. | Tracked, no owner |
| **`main`'s `enforce_admins` branch-protection mechanic.** | Policy question → not a task | Unchanged. Not escalating. | Carried (flagged, no owner) |
| **Root cause of provider-CREDENTIAL divergence** (FQ-69's 401 master-key class). | Risk (non-blocking) → flagged carry, trigger still NOT fired | Distinct from the URL-suffix class. | Carried (flagged) |
| **Evals still short of ADR-0007 §5.4's ≥20/eval target** (triage at 19, one short). | Coverage hygiene → not a standalone task | Grow opportunistically on the next natural touch. | Carried (flagged) |
| **`LITELLM_URL` Coolify duplicate-row footgun.** | Cosmetic → standing quirk | Not a task. | Carried (flagged) |
| **T-90 non-blocking observations O1–O3.** | Risk (non-blocking) → flagged carry | Opportunistic hardening on next workflow touch. | Carried (flagged) |
| **Per-user session auth (T-77 Option A), FQ-63, FQ-47 action 4b, DNC/FQ-43.** | Carry (founder-gated) | All non-blocking founder-gated carries, unchanged. | Carried |

---

*Sprint 18 was picked as the "safe" option precisely because nothing else was forcing action — and it justified that choice by doing exactly what coverage-growth work is supposed to do: it exercised parts of the system that hadn't been stress-tested recently and found two real problems nobody knew were there. Neither was manufactured or chased; both were caught because the discipline of verifying raw evidence before accepting a convenient explanation held for a third time in as many tasks this session. The sprint also cost two authorization near-misses on the exact same action (baseline recapture) before that lesson stuck — worth being honest that "safe cleanup" doesn't mean "no governance judgment required," and the sprint's real gift to Sprint 19 is a clear, well-evidenced, serious next anchor rather than another round of "what should we work on."*
