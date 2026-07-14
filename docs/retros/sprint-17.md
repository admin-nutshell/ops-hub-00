# Sprint 17 Retrospective — ADR-0009 Optional Multi-Sample Escalation (build) → T-112 Resume

**Sprint window:** November 12 – November 26, 2026 (nominal; effective delivery 2026-07-14, same-day as planning)
**Author:** PM
**Date:** 2026-07-14
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Unblock T-112 (held at Sprint 16's close) by properly diagnosing the eval-gate case blocking it — build ADR-0009's optional per-case multi-sample escalation (designed, cost-approved, never coded) and apply it to determine whether the grader's rejection of the bundling case was genuine near-threshold variance or something else.

**Outcome: the anchor delivered a diagnosis, not the unblock it was scoped to produce — and that is the correct, honest result, not a shortfall.** T-114 built the mechanism cleanly and, more importantly, used it to show that the case blocking T-112 was never variance at all: the grader rejects a `high` answer on this ticket stably and confidently (12/12 real re-grades, all score 0.0), with defensible reasoning (a full-staff lockout plausibly is "system down"). That finding reclassified T-112's blocker from "an eval-gate quirk to route around" to "a real, if rare, behavior trade-off in T-112's own prompt wording" — which converted the sprint's task from a technical fix into a product decision that could only be the user's to make. It was put to the user in two clean, separated questions (hold vs. merge the now-dormant tool; ship vs. hold T-112 given the trade-off), and both were resolved the same day. T-112 (PR #456) merged following the user's explicit go-ahead — one sprint late, landed honestly rather than forced.

The sprint also surfaced and corrected its own predecessor's mistake before compounding it: Sprint 16's closeout had wrongly stated that ADR-0009's grader-robustness mechanism was "still not built." It was built in T-109 (Sprint 14) and has been live the entire time. T-114's own diagnosis depended on getting this right, and the correction was filed and verified before any further decision was built on top of the wrong premise.

| Task | Owner | Result |
|---|---|---|
| T-114: Build ADR-0009's optional per-case multi-sample escalation; diagnose the case blocking T-112 | Evals Lead (build) + Coordinator (independent verification) | ✅ **Built — PR #462 open, held unmerged by the user's own explicit choice** (ships dormant; no case currently needs it). Diagnosis: the bundling case is a stable grader rejection, not variance — corrected this session's own prior mischaracterization |
| T-112 resume | Evals Lead + Tech Lead (continuation) + Coordinator (merge) | ✅ **Merged (PR #456), by the user's own direct authorization and an explicit product-trade-off decision** — see Sprint 16's T-112 row for the full merge record |

---

## 2. What worked

- **The mechanism was built cleanly and, more importantly, used honestly against its own admission criterion.** T-114 didn't just wire multi-sample and declare victory when the numbers looked convenient — it ran two separate instruments (target+grader repeated draws, and a judge-only re-grade of a frozen output) specifically designed to distinguish "the grader is noisy" from "the grader is confident and the target is what's unstable." The evidence pointed away from multi-sample being the right tool, and the build correctly said so instead of forcing the mechanism onto the case anyway.

- **A tempting, plausible-sounding conclusion (grader variance) was checked against raw evidence and found wrong before it went any further.** 12 real re-grades at a stable score of 0.0 is not variance by any reasonable definition, and the diagnosis said so plainly rather than fitting the finding to the sprint's original framing.

- **A second self-authored mistake was caught before it compounded the first.** Independent review didn't stop at "the diagnosis looks solid" — it verified the diagnostic actually used T-112's exact prompt bytes (a byte-for-byte comparison against the T-112 branch's real HEAD commit), which turned "an unexplained 24-vs-2 discrepancy" into "confirmed genuine, rare model-level stochasticity, not a reconstruction artifact." That single check is what separated a defensible finding from a plausible-looking one.

- **A "the obvious fix" was checked against a truth table before being proposed, and rejected on the numbers, not on principle.** Tightening the bundling case's allowed-answer set to `critical`-only looked like a clean way to align the eval with the grader's real behavior. Working through row-success logic explicitly (rubric-fail AND deterministic-fail vs. rubric-fail AND deterministic-pass) showed a `high` draw fails either way — the tightening changes the failing *score*, never the pass/fail outcome. It was correctly never proposed as a T-112 unblock.

- **The user's phrasing feedback was treated as a signal to redo the question, not just reword it.** The first attempt at the product trade-off question used no code jargon but still leaned on a ratio ("1 in 13") and an abstract framing ("trade-off," "under-flag") — and drew "that so technical." The second attempt used a concrete before/after story with no numbers and got a clean, decisive answer. Worth keeping: "plain language" is a bar about concreteness, not just about avoiding technical vocabulary.

- **A lucky CI pass was named as lucky, not claimed as resolution.** When PR #456 was re-checked after a merge-conflict resolution, `live-eval-gate` happened to pass — the bundling case drew its modal `critical` answer on that particular run. This was explicitly recorded as a fortunate draw that did not change the underlying accepted risk, not as evidence the problem had gone away. The user's ship-it decision already accounted for the risk independent of any one run's luck.

---

## 3. What didn't work (or cost more than it should have)

- **Sprint 16's closeout error had to be found and fixed mid-sprint rather than never happening.** "ADR-0009's build is still not built" was written into three documents (WORK.md, DECISIONS.md, the Sprint 16 retro) without a one-command check (`scripts/eval/apply-honor-pass.py`'s own docstring) that would have caught it immediately. It cost a same-day correction cycle across all three documents before T-114's real diagnosis work could be trusted.

- **The "grader variance" framing was carried across multiple documents before T-114's evidence overturned it.** Same root cause as the item above: a plausible-sounding, narratively-convenient claim was written down before it was verified, and had to be corrected as a dated addendum rather than caught before it was ever recorded.

- **Two distinct wrong-before-verified claims in one session is a pattern, not two isolated slips.** Both times, the wrong claim was the one that most conveniently closed the loop on the story so far. That is exactly the shape of claim most worth an extra beat of verification before it gets written into a durable record.

---

## 4. Incidents, blockers, and resolutions

### 4.1 The Sprint 16 correction, carried forward

T-114's own scoping depended on an accurate premise about what ADR-0009's build status actually was. Before trusting the diagnosis, the premise itself was re-verified against `scripts/eval/apply-honor-pass.py`'s docstring ("T-109 build of ADR-0009") and this session's own earlier CI log reads (which had already shown honor-pass running on the very PRs being analyzed). The correction was filed as a dated DECISIONS.md addendum and propagated to WORK.md and the Sprint 16 retro the same day it was found — not silently edited over the wrong version.

### 4.2 The two-instrument diagnosis and the reconstruction-artifact check

T-114's diagnostic ran two instruments against T-112's exact proposed prompt (read read-only from the PR branch, never written to): 24 live target+grader draws, and 12 judge-only re-grades of a frozen `high` output. Both converged on the same conclusion — the grader stably rejects `high` here. Before accepting this, independent review pulled the diagnostic run's own logged system-prompt extraction and diffed it byte-for-byte against the T-112 branch's actual HEAD commit, confirming the diagnostic hadn't accidentally graded a different or stale prompt. This is what turned "an interesting but unexplained discrepancy" (24/24 critical in this fresh sample vs. 2/2 high in T-112's own earlier gate runs) into "confirmed genuine, rare target-model stochasticity" rather than a methodology question left hanging.

### 4.3 Two-part authorization, correctly kept separate

Landing T-112 required two distinct decisions from the user, and they were asked separately rather than bundled: first, the product trade-off itself (ship T-112 knowing the rare risk, or hold it for further work); second, once CI was confirmed still red, the specific branch-protection override mechanism needed to merge past it. A generic "ship it" to the first question was correctly not treated as authorizing the second, distinct action — consistent with this project's standing norm that a bypass mechanism needs its own explicit ask naming it directly.

### 4.4 A real merge conflict, then a lucky green

After the override was authorized, the first merge attempt failed — not on the expected red check, but on a genuine merge conflict (main had moved on with this session's own intervening docs commits). The branch-protection setting was restored immediately rather than left off while the conflict was resolved by hand (never forced with `--admin`). Once resolved and CI re-ran, the bundling case happened to draw its modal `critical` answer and the check passed on its own — the final merge needed no override at all. This was recorded explicitly as a fortunate draw, not evidence of resolution, so a future reader doesn't mistake one green run for the accepted risk having disappeared.

---

## 5. Process changes for Sprint 18 (and standing, going forward)

1. **NEW standing lesson — don't record a causal/mechanistic claim as fact before verifying it, especially when it conveniently closes the loop on the story so far.** Confirmed twice in one session (ADR-0009's build status, then the bundling case's "grader variance" framing). Before writing such a claim into WORK.md, DECISIONS.md, a retro, or a report to the user, do the one-command check that would falsify it first.

2. **NEW standing lesson — "plain language" for this user is a bar about concreteness, not just about removing code vocabulary.** A ratio, a percentage, or an abstract noun like "trade-off" can still read as too technical even with zero jargon. Default to a concrete before/after scenario over a statistic when framing a decision for the user.

3. **NEW standing lesson — before proposing an eval-side fix for something that looks fixable there, work the pass/fail logic through explicitly (a truth table), not just intuition.** The bundling case's "obvious" fix (tighten the allowed set) would not have changed T-112's mergeability at all — only checking the actual row-success computation caught this before it was proposed as a solution.

4. **Standing (carried, reaffirmed) — a lucky CI pass is not evidence a known, accepted risk has resolved.** Held again this sprint (§4.4), same discipline as the T-109/T-110 "don't chase a lucky green" lesson, applied here to *not claiming* a green run resolved something rather than to *not re-running for* one.

5. **Standing (carried, reaffirmed) — a bypass-style merge authorization needs its own explicit ask naming the specific mechanism, kept separate from the underlying product/technical decision it enables.** Held again this sprint (§4.3).

6. **Standing (carried) — never use `gh pr merge --admin` to force past a genuine merge conflict; resolve it by hand, restoring any temporarily-lifted protection immediately if the merge doesn't go through.** Held again this sprint (§4.4).

---

## 6. Sprint goal / exit-criteria status

**No milestone was targeted this sprint** — same posture as Sprints 6–16. Per the standing **Milestone numbering note** (`WORK.md`), this work is deliberately **not** labeled M7.

| Exit criterion | Status |
|---|---|
| Build ADR-0009's optional multi-sample escalation | ✅ Built, tested, verified dormant by default |
| Diagnose whether the case blocking T-112 is grader variance or something else | ✅ Diagnosed as a stable, confident grader rejection — NOT variance, correcting Sprint 16's own mischaracterization |
| Resolve without weakening the gate | ✅ Multi-sample correctly not applied to the case; no rubric/eval softening at any point |
| Resume/land T-112 | ✅ Merged, by explicit user authorization and product-trade-off decision |
| Correctly scope each task's merge-authorization boundary | ✅ Both PR #462 (held) and PR #456 (merged) treated as cat-a; two distinct authorizations kept separate for T-112 |
| Anchor-only scope held (no manufactured parallel track) | ✅ Held |

---

## 7. Open risks / carried-forward going into Sprint 18

| Item | Type | Note | Owner |
|---|---|---|---|
| **T-112's accepted trade-off (~1-in-13 rare under-escalation of total-outage tickets to `high` instead of `critical`)** is now live in production. | Operational watch item, accepted by explicit user decision | Not a bug to fix — a known, accepted risk. Revisit only if real-world tickets show this actually firing at meaningful volume. | Tracked, no owner (accepted, not open) |
| **PR #462 (multi-sample escalation) is built, tested, and held — unmerged, dormant.** | Carried, ready when needed | Merge whenever a genuine near-threshold-variance case is found that needs it; don't force it in earlier. | Sprint 18+ (as-needed) |
| **`main`'s `enforce_admins` branch-protection mechanic.** | Policy question → not a task | Unchanged. Not escalating. | Carried (flagged, no owner) |
| **Root cause of provider-CREDENTIAL divergence** (FQ-69's 401 master-key class). | Risk (non-blocking) → flagged carry, trigger still NOT fired | Distinct from the URL-suffix class. | Carried (flagged) |
| **Evals still short of ADR-0007 §5.4's ≥20/eval target.** | Coverage hygiene → not a standalone task | Grow opportunistically, additive-only. | Carried (flagged) |
| **`LITELLM_URL` Coolify duplicate-row footgun.** | Cosmetic → standing quirk | Not a task. | Carried (flagged) |
| **T-90 non-blocking observations O1–O3.** | Risk (non-blocking) → flagged carry | Opportunistic hardening on next workflow touch. | Carried (flagged) |
| **Per-user session auth (T-77 Option A).** | Carry (founder-gated) | Revisit on a second dashboard user or SOC-2 need. | Carried |
| **FQ-63, FQ-47 action 4b, DNC / second-tenant onboarding (FQ-43).** | Carry (founder-gated) | All non-blocking founder-gated carries, unchanged. | Carried |

---

*Sprint 17's throughline is that a diagnosis can be the right deliverable even when it isn't the unblock the sprint was scoped to produce. T-114 set out to unblock T-112 and instead proved that nothing about T-112 was actually broken by an eval-gate quirk — the safety net was correctly, if rarely, catching a real behavior in T-112's own prompt wording. That reframing turned a technical task into a product decision, which is exactly where it belonged, and both decisions it produced were resolved cleanly and quickly once put to the user in the right terms. The sprint's harder lesson is that two separate, plausible-sounding claims got written into durable records before they were actually verified — both caught and corrected the same day, but both avoidable with a one-command check up front. That is the discipline to tighten going into Sprint 18, not the diagnosis discipline itself, which held up under real scrutiny both times it mattered.*
