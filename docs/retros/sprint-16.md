# Sprint 16 Retrospective — Triage Escalation-Boundary Prompt Fix + T-98 Monitor Consecutive-Fail Threshold

**Sprint window:** October 29 – November 12, 2026 (nominal; effective delivery 2026-07-14, same-week as planning)
**Author:** PM
**Date:** 2026-07-14
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Fix the real triage-prompt-quality finding T-110 banked (the production model over-escalating ambiguous single-user tickets to `high`), and close the T-98 monitor alerting-cadence carry flagged since Sprint 12. **(Anchor, Track A)** T-112 clarifies `src/inngest/ticket-triage.ts`'s `high`-vs-`normal` boundary. **(Track B)** T-113 picks a consecutive-fail threshold for `monitor-e2e-pipeline.yml`'s 6-hourly cadence.

**Outcome: one of two tracks shipped clean. T-113 landed the same day, self-merged correctly outside the shared-safety-net/prod-infra boundary. T-112 is the sprint's real story — a genuine bug found and fixed by coordinator-level review the build agent's own case-by-case reasoning missed, immediately followed by a second, orthogonal issue that could not be self-cleared, ending in an honest, user-directed decision to hold rather than force a merge or hand-patch the shared eval file.** T-112's build agent wrote a defensible-looking fix and reasoned through each existing case individually — but that case-by-case check missed the actual risk: not "would an existing case now fail its allowed set," but "would the model's answer *shift* to a different, still-technically-allowed value that a flaky grader then rejects." Independent review caught a real regression live on the gate (a new guard case the agent itself added), root-caused it from raw request/response evidence rather than trusting the CI summary line, fixed it in one targeted revision, and verified nothing else moved. A second, pre-existing case then surfaced as still red — confirmed via a baseline diff to be a genuine (if in-spec-tolerable) behavior drift compounding onto known grader variance, not a new defect and not noise the fix caused. Rather than either force it through or rewrite the shared rubric to manufacture green, the choice was put to the user plainly, and the user chose to hold.

| Task | Owner | Result |
|---|---|---|
| T-112: Clarify `src/inngest/ticket-triage.ts`'s `high`-vs-`normal` escalation criteria for the single-user/unstated-workaround ambiguity class | Evals Lead (build) + Coordinator (independent review, bug found + fixed) | ⏸️ **Held — NOT merged, PR #456 open.** Core rewording done; a real under-escalation bug (case (q), single-user data-loss misclassified `normal`) found live and fixed in one revision. A second, pre-existing grader-variance case remains red; the user chose to hold rather than merge past it or hand-patch the eval |
| T-113: Consecutive-fail alerting threshold for `monitor-e2e-pipeline.yml`'s 6-hourly schedule | Production Manager + Security Lead | ✅ **Done — merged 2026-07-14 (PR #457), self-merged on green CI, correctly scoped outside §5.1 cat. a/b.** `FAIL_THRESHOLD=2`, gates only the status-page incident-open call; grounded in real run history; failure path proven with 2 chained live dispatches + verified cleanup |

---

## 2. What worked

- **Independent review caught a real bug the build agent's own verification missed — and the miss is instructive, not just lucky.** T-112's build agent reasoned through every existing case and concluded none would shift outcome. That check was the wrong shape: it asked "does this ticket still land in its allowed set," not "does the model's answer move to a *different* allowed value that interacts badly with something else" — in this case, a brand-new guard case (q) whose deterministic contract the new wording violated outright. The gate caught it because the new case existed to catch exactly this; the lesson generalizes past this one bug — a prompt-quality review needs to ask about behavioral *shift*, not just pass/fail per case.

- **Root cause was pulled from raw evidence, not inferred from a CI summary line.** The gate's own regression line ("passed in baseline, FAILS now") doesn't distinguish a real under-escalation from grader noise. Pulling the actual request/response JSON showed the model's literal output and reasoning (`"urgency":"normal"`, "does not involve ... critical data loss") — unambiguous proof this was a real behavior bug, not a scoring fluke. The same discipline, applied to the second red case, pulled the *baseline's* raw output too, which is what actually separated "pure grader noise" from "T-112 nudged something real."

- **A tempting self-clearing shortcut was named and declined on the record, not silently avoided.** The bundling case's rubric already says "a high read is tolerable" — rewriting it to a clean "critical OR high" would have turned the check green with a one-line edit to the shared eval file, and the framing ("just removing ambiguity") was genuinely tempting under merge pressure. Advisor review caught that "critical (tolerable: high)" encodes a preference, not an equivalence, and flattening it would cross from clarity into leniency specifically to manufacture green — exactly what drop-don't-weaken forbids. The edit was never made.

- **One targeted revision, verified once, not a guessing loop across CI cycles.** The case-(q) fix was written, committed, and re-run exactly once before drawing a conclusion — consistent with the standing lesson (Sprint 15) against chasing a lucky green through repeated re-runs. It landed clean on the first attempt and the analysis stopped there rather than continuing to poke at the second issue hoping for a different roll.

- **T-113 landed with no surprises, building directly on two recent touches of the same file.** Reused T-102's proven `gh run list` lookback mechanism verbatim, recalibrated the threshold and lookback window for this file's actual 6-hourly cadence (not a naive copy), and proved the failure path live with 2 chained dispatches plus explicit incident cleanup — the fourth sprint running this exact monitor-failure-path discipline has held without exception.

---

## 3. What didn't work (or cost more than it should have)

- **T-112's build-time verification gave false confidence.** The agent's own report characterized the change as fully verified against every existing case, and that report was wrong in a way that mattered — a real under-escalation regression existed and would have shipped had the gate itself not caught it (case (q) exists only because T-112 added it as a guard; without that specific foresight, the bug could plausibly have gone undetected until a real customer ticket hit it). The gate did its job; the build-time self-review did not.

- **T-112 will not close this sprint.** The anchor task — the one thing this sprint was built around — is not shipping. This is not being spun as a success; it's a genuine partial sprint. The real, fixed bug and all the diagnostic work are preserved and documented, but the deliverable itself is not in `main`.

- **The sprint inherited, and now hands forward, an unresolved eval-gate grader-variance case that predates T-112 and is outside T-112's power to fix cleanly.** The bundling case's flakiness is real and blocking, but the correct fix (per the already-banked T-106/ADR-0009 finding) is a proper grader-robustness mechanism, not a per-case rubric patch — and that mechanism's build was deferred, not built, as of this sprint.

---

## 4. Incidents, blockers, and resolutions

### 4.1 T-112's real bug: single-user critical under-escalated to normal

The build agent's rewording added a single-user carve-out to the `high` bullet and stated, as a trailing parenthetical, that critical triggers still apply regardless of user count. Live-eval-gate on PR #456 failed case (q) — the very guard case T-112 added for this — with a score of 0. The raw model output for a single user's irrecoverable-data-loss ticket was `{"urgency":"normal", ..., "reasoning":"...does not involve...critical data loss."}`, skipping straight past both `high` and the correct `critical`. Root cause: the exception was a weak, distant hedge on a *different* bullet; the new, specific "single user → not high" language out-competed it. Fix: moved the user-count invariance into the `critical` bullet itself (front-loaded) and narrowed the `high` carve-out to an explicit "AND none of the critical triggers above apply." One commit, one re-run, clean: case (q) passes, case (i) unaffected, nothing else shifted.

### 4.2 A second, orthogonal issue: pre-existing grader variance compounded by a real (in-spec) drift

The same re-run left one case red: a pre-existing, T-112-untouched case bundling a total outage with a trivial typo. Its deterministic contract (`ALLOWED = ['critical','high']`) passed; only the llm-rubric component failed (score 0), with the grader effectively overriding its own rubric's stated tolerance for a `high` answer. A baseline diff (pulling the last-green run's raw output for the identical ticket) showed the *baseline* model answered `critical`; both T-112 cuts answered `high`. This means the case's continued redness is grader variance (the already-banked T-106/ADR-0009 class) layered on top of a real, if in-spec-tolerable, behavior drift caused by T-112's wording — not pure noise, and not something T-112's fix commit introduced (both T-112 cuts produced the identical `high` answer). Rewriting the rubric to a hard OR was considered and declined (§2) as leniency dressed as clarity.

### 4.3 The user's hold decision

With one real fix verified and one unresolved, non-self-clearable issue remaining, the choice (continue with a further dedicated fix vs. hold this sprint) was presented to the user in plain, non-technical language via AskUserQuestion. The user chose to hold. PR #456 remains open, unmerged, with the real fix fully committed and documented — nothing forced through, nothing hand-patched to manufacture a green check.

---

## 5. Process changes for Sprint 17 (and standing, going forward)

> **Correction (added 2026-07-14, same day, after this retro's first cut):** items 3 and 4 below, as originally written, stated that "the T-106/ADR-0009 grader-robustness BUILD is still not built." **That is factually wrong and is corrected here rather than silently edited** — see DECISIONS.md 2026-07-14 "CORRECTION" entry for the full record. ADR-0009's mandatory mechanism (honor-`pass` + the C6 deterministic escalation split) was already built in **T-109 (Sprint 14)** and is live on every `live-eval-gate` run today, including the very T-112 runs this retro analyzes (`scripts/eval/apply-honor-pass.py`'s own docstring: "T-109 build of ADR-0009"). The bundling case's `pass:false, score:0` is ADR-0009's Guardrail 2 (never-override-a-fail) working exactly as designed — not a hole in it. What's actually un-built is ADR-0009's **optional, per-case multi-sample escalation** (designed and cost-approved in the ADR, never implemented as code — confirmed via a repo-wide grep for `multiSample`, zero hits outside one docstring mention). Items 3 and 4 are rewritten below to reflect this.

1. **NEW standing lesson — a prompt-quality review must check for behavioral SHIFT, not just per-case pass/fail.** T-112's own build-time review asked "does each existing case still pass" and missed the actual risk: the model moving to a *different*, still-technically-allowed answer that then interacts badly with a flaky grader or an untested boundary. Independent review should specifically diff raw model outputs against the prior baseline's raw outputs on any prompt-touching PR, not just check the pass/fail column.

2. **NEW standing lesson — a rubric that states a preference ("X, tolerate Y") is not equivalent to an OR, and must never be flattened to one to turn a check green.** Caught this sprint before being actioned (§2, §4.2). Applies to any future case where a rubric's own hedge is inconsistently honored by the grader — the fix belongs in grader robustness, not in loosening what the rubric asks for.

3. **~~NEW carry — the T-106/ADR-0009 grader-robustness BUILD is now blocking real shipped work~~ — CORRECTED: the mandatory build already shipped (T-109, Sprint 14) and is not what's blocking T-112.** What's actually open is ADR-0009's *optional* per-case multi-sample escalation (designed, cost-approved, never coded) — a small, already-approved build, not a rediscovery of the whole ADR. Promote wiring it (scoped to the bundling case, or whichever case needs it) for Sprint 17 — it rides ADR-0009's existing acceptance, no fresh ADR/review needed.

4. **NEW carry — T-112 resumes once the bundling case's grader read is properly diagnosed — either via the optional multi-sample escalation (does the grader's `pass:false` on a `high` answer hold up across repeated draws, or was this one draw unrepresentative?) or a T-110-style dedicated fixture/rubric diagnosis.** Note this case has only ONE data point of a `high` answer ever being graded (the baseline always produced `critical`; T-112's wording is what first produced `high`) — n=1 is not enough to call this "known flaky" with confidence either way. PR #456 stays open with its real fix intact; do not let it go stale or get silently abandoned.

5. **Standing (carried, reaffirmed) — one targeted revision, verified once; do not chase a lucky green across repeated CI cycles.** Held again this sprint (§2) on the case-(q) fix.

6. **Standing (carried, reaffirmed) — pull raw request/response evidence before concluding root cause; never infer causation from a CI summary line alone.** Applied twice this sprint (case (q)'s bug, and the baseline diff that separated real drift from pure noise on the bundling case).

7. **Standing (carried) — start concurrent git-writing agent work in an ISOLATED WORKTREE from commit #1.** Held clean.

8. **Standing (carried) — any monitor/alerting workflow change is proven on its FAILURE path before going live, with real dispatches, not reasoning alone.** T-113's fourth consecutive clean application of this discipline.

---

## 6. Sprint goal / exit-criteria status

**No milestone was targeted this sprint** — same posture as Sprints 6–15. Per the standing **Milestone numbering note** (`WORK.md`), this work is deliberately **not** labeled M7.

| Exit criterion | Status |
|---|---|
| Clarify the triage prompt's `high`-vs-`normal` boundary for the single-user ambiguity class | ✅ Written, committed; core rewording verified not to regress case (i) |
| Preserve case (i)'s regression coverage; drop-don't-weaken held | ✅ Unaffected by either T-112 commit |
| Ship T-112 to `main` this sprint | ❌ **Not met — held by explicit user decision**, pending resolution of an orthogonal grader-variance case |
| Catch any real regression the change introduces before merge | ✅ Case (q)'s real under-escalation bug found live, root-caused, and fixed in one targeted revision |
| Do not hand-patch the shared eval file to force a green check | ✅ Rubric-flattening shortcut considered and explicitly declined |
| Decide and implement T-98's consecutive-fail threshold | ✅ T-113 — `FAIL_THRESHOLD=2`, evidence-grounded, not a naive copy of T-102 |
| Prove T-113's failure path live | ✅ 2 chained dispatches + verified incident cleanup |
| Anchor + one parallel track; overcommit discipline held | ✅ Held for the twelfth consecutive sprint (scope, not delivery — the anchor itself did not ship) |

---

## 7. Open risks / carried-forward going into Sprint 17

| Item | Type | Note | Owner |
|---|---|---|---|
| **T-112 (PR #456) is open and held, not merged.** The real single-user-critical fix is complete and correct; blocked only by an orthogonal, pre-existing grader-variance case. | **Sprint 17 candidate (resume, not restart)** | Resume once the bundling case's grader read is properly diagnosed (multi-sample escalation or T-110-style dedicated diagnosis). Do not let this go stale. | Sprint 17 (Evals Lead / Tech Lead) |
| **ADR-0009's OPTIONAL per-case multi-sample escalation is designed and cost-approved but never coded** — corrected from this retro's original (wrong) "the whole ADR-0009 build is missing" framing; see §5 correction note. | **Sprint 17 candidate** | Small, scoped build riding ADR-0009's existing acceptance (no fresh ADR/review needed) — cost bounded to ~$1.50 CAD/month per the ADR's own math if applied to 2-3 cases. Natural first target: the bundling case. | Sprint 17 (Evals Lead / Tech Lead) — merge will need the user's own direct cat-a sign-off per standing norm (modifies the shared eval-gate mechanism) |
| **The "total outage bundled with a trivial typo" eval case's own flakiness** — root-caused this sprint as ADR-0009's Guardrail 2 correctly refusing to rescue a `pass:false` verdict, compounded by a real, in-spec-tolerable model drift; not a gap in the already-built mechanism. Only ONE data point exists of this case ever grading a `high` answer. | Carried, now concretely blocking | Needs its own dedicated diagnosis (does the grader unreliably reject `high` here across repeated draws, or was this single draw unrepresentative?) before T-112 can resume. | Sprint 17 |
| **`main`'s `enforce_admins` branch-protection mechanic.** | Policy question → not a task | Unchanged from Sprint 15. Not escalating. | Carried (flagged, no owner) |
| **Root cause of provider-CREDENTIAL divergence** (FQ-69's 401 master-key class). | Risk (non-blocking) → flagged carry, trigger still NOT fired | Distinct from the URL-suffix class. | Carried (flagged) |
| **Evals still short of ADR-0007 §5.4's ≥20/eval target.** | Coverage hygiene → not a standalone task | Grow opportunistically, additive-only. | Carried (flagged) |
| **`LITELLM_URL` Coolify duplicate-row footgun.** | Cosmetic → standing quirk | Not a task. | Carried (flagged) |
| **T-90 non-blocking observations O1–O3.** | Risk (non-blocking) → flagged carry | Opportunistic hardening on next workflow touch. | Carried (flagged) |
| **Per-user session auth (T-77 Option A).** | Carry (founder-gated) | Revisit on a second dashboard user or SOC-2 need. | Carried |
| **FQ-63, FQ-47 action 4b, DNC / second-tenant onboarding (FQ-43).** | Carry (founder-gated) | All non-blocking founder-gated carries, unchanged. | Carried |

---

*Sprint 16's throughline is that catching a real bug and holding a boundary can both be true in the same task, and the honest outcome is a sprint that didn't fully ship. T-112 is better for the review it got — a genuine under-escalation of a single user's irrecoverable data loss was found and fixed before it could reach a real customer ticket, using the exact discipline (raw evidence over summary lines, one targeted fix over repeated guessing) this project has built up over fifteen prior sprints. But the same discipline that caught and fixed that bug also refused to manufacture a green check on a second, unrelated issue by softening the shared eval file — and refused to merge past a red required check without the user's own call. Holding a real, finished fix out of `main` because a different, honestly-diagnosed problem is still open is not a failure of execution; it is the drop-don't-weaken norm working exactly as designed, including on the sprint that most wanted a finish line.*
