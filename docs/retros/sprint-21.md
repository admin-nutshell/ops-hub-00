# Sprint 21 Retrospective — Eval Coverage Growth Round 2 (T-118) + Bundling-Case Root Cause (T-119/T-120)

**Sprint window:** January 7 – January 21, 2027 (nominal; effective delivery 2026-07-15, same-day as planning)
**Author:** PM
**Date:** 2026-07-15
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Grow all three product evals (`ticket-triage`, `ticket-respond`, `kb-learn`) to ADR-0007 §5.4's ≥20-case target — the safest, lowest-governance-class candidate available when Sprint 21 was scoped, on a track record of surfacing real defects incidentally rather than being a hollow metric exercise.

**Outcome: the eval-growth work (T-118) was clean and additive exactly as scoped, but it walked straight into a pre-existing, unrelated defect (the triage "bundling" case's live-gate instability) that became the sprint's real work.** Diagnosing that defect took three rounds and two corrected mid-session conclusions before landing on the actual root cause — recorded here in full because the wrong turns are the finding a future session should not repeat.

- **Round 1:** the bundling case's failures all reported a row-level score of 0.5, read as a near-threshold grader hedge → concluded "genuine grader/model variance." **Wrong.** The 0.5 was an artifact of promptfoo averaging the case's two assertions (a 0.0 rubric fail + a 1.0 deterministic pass); no genuine near-threshold score ever existed.
- **Round 2 (T-119):** at the user's direct request, turned on T-114/PR #462's dormant multi-sample escalation for the case. The mechanism worked correctly but did not rescue the case — per-draw evidence showed a confident, unanimous grader rejection every time the target answered `high`, not the near-floor hedge multi-sample exists to smooth. This also produced the evidence that overturned Round 1's conclusion.
- **Round 3 (T-120):** matched the target model's raw completions by `system_fingerprint` across all 9 draws gathered so far, confirming the same exact OpenAI `gpt-4o-mini` deployment gave different answers (`critical` vs `high`) to the identical prompt at `temperature:0` — real model-level inconsistency, not eval-gate variance or LiteLLM provider routing. The actual defect was then found in the rubric: it already said "high is tolerable" in prose but the grader failed `high` anyway, reading an adjacent "MUST track the DOMINANT problem" clause as a hard requirement for `critical`. Fixed with a 2-line wording change (same shape as PR #439's original case-(g) fix), verified by deliberately catching and passing the exact `high` failure mode post-fix — not inferred from a lucky pass.

All three tasks landed at the user's explicit "proceed as recommended": T-120 (the fix) merged, T-119 (the now-superseded safety net) closed with reasoning rather than left dangling, and T-118 (updated in place with the fix, inside its existing isolated worktree) merged clean. Final state: `ticket-triage` 20 cases, `ticket-respond` 21, `kb-learn` 20 — the ≥20/eval target is met for all three for the first time.

| Task | Owner | Result |
|---|---|---|
| T-118: Grow all three evals to ≥20 cases, additive-only | Evals Lead | ✅ **Merged.** 7 genuinely distinct new cases (triage +1, respond +4, kb-learn +2), zero existing-case drift. Blocked mid-sprint by an unrelated pre-existing defect, not its own; updated in place with T-120's fix and merged once unblocked. |
| T-119: Turn on the dormant multi-sample escalation for the bundling case (user-directed) | Evals Lead | ✅ **Built, verified working correctly, closed (not merged).** Confirmed the mechanism functions exactly as designed; also confirmed it structurally cannot rescue this specific case (a confident rejection, not a hedge) and produced the evidence that led to the real fix. Closed once T-120 shipped, per its own row's recommendation. |
| T-120: Root-cause and fix the bundling case's rubric | Evals Lead | ✅ **Merged.** Root cause confirmed via raw target-completion inspection (`system_fingerprint` matching), not guessed. 2-line fix, directly verified against the exact failure mode it targets. |

---

## 2. What worked

- **Root-causing via raw provider evidence, not just grader summaries, was decisive.** Matching completions by `system_fingerprint` ruled out a plausible-looking alternative hypothesis (the `triage-model` alias load-balancing between its two registered backends, NVIDIA NIM and OpenAI) and pinned the instability to the actual mechanism — same deployment, same prompt, same `temperature:0`, different answers. Without pulling the raw completions, this would likely have stayed mischaracterized as "grader variance" indefinitely.

- **A proposed fix was verified by deliberately reproducing its target failure mode, not by one clean run.** T-119's mechanism-works-but-doesn't-help finding and T-120's fix-confirmed finding both followed the same discipline: the first live-gate run after each change passed, but neither was accepted as proof until a second, targeted run actually caught the specific scenario (a `high` draw) and showed the new behavior directly.

- **Wrong conclusions were corrected in place, not silently overwritten.** Round 1's "genuine variance" read — which had already been reported to the user before Round 2's evidence contradicted it — was flagged as a correction in both `WORK.md` and the user-facing conversation, with the reasoning for the correction shown rather than just the revised answer.

- **A now-unnecessary safety net was closed instead of left as dead weight.** Once T-120's fix made T-119's multi-sample opt-in redundant for this case, it was closed with an explanation rather than merged anyway or left open indefinitely — avoiding a permanent 3x-cost tax on a case that no longer needs it, while leaving a clear note on how to reopen it if a genuinely near-threshold case surfaces later.

- **Combined-effect verification before merging, not after.** Before merging T-118 and T-120 separately, a throwaway branch combining both was built, tested live, and deleted — confirming the fix actually unblocks the eval-growth work rather than assuming it would from each piece's individual result.

- **None of the three substantive PRs were self-merged; all three merges happened only after the user's own direct, in-the-moment words ("proceed as recommended").** Pure record-keeping docs updates (5 of them this sprint) were self-merged as routine, consistent with how this repo has always treated docs-only PRs — the two categories were kept clearly distinct throughout.

---

## 3. What didn't work (or cost more than it should have)

- **Round 1's misreading of the 0.5 score was reported to the user before it was verified against per-draw evidence.** The row-level average being mistaken for a near-threshold grader score is an easy mistake — nothing in the gate's PR-comment output surfaces the per-assertion breakdown — but it shaped both a WORK.md entry and a user-facing "genuine variance" characterization that later had to be walked back. The per-draw log (which does exist and does disambiguate this) wasn't pulled until Round 2 was already underway for an unrelated reason (verifying the multi-sample mechanism itself).

- **Real spend accumulated across roughly a dozen metered live-eval-gate runs this session** (T-118's original 4 attempts, 2 diagnostic re-runs, T-119's run, T-120's 2 verification runs, the combined-check run, plus the final re-verification runs on the updated branches) while diagnosing one case. Each run costs cents, not dollars, and the budget cap held throughout, but a faster path to the `system_fingerprint` evidence in Round 1 would have saved several of these.

---

## 4. Incidents, blockers, and resolutions

No governance incidents this sprint (contrast Sprint 19). The one operational snag was mechanical: PR #478 (T-120) went stale (`BEHIND`) relative to `main` after several docs-only PRs landed first, and GitHub correctly refused a normal merge until it was updated — resolved with a routine `git merge origin/main` catch-up and a fresh green re-run, no `--admin` override used at any point this sprint.

---

## 5. Process changes for Sprint 22 (and standing, going forward)

1. **NEW — before characterizing any live-gate failure as "near-threshold" or "variance," check whether the case carries more than one assertion.** A row-level `score` is promptfoo's average across all of a case's assertions, not a single grader's confidence — a case with a deterministic companion check (the now-standard ADR-0009 C6 pattern) can show a misleading fractional score even when the actual rubric verdict is a firm 0 or 1. Pull the per-draw `pass`/`score`/`reason` before drawing a conclusion, not just the aggregate.

2. **NEW — when diagnosing model-level inconsistency (not grader inconsistency), match raw completions by a provider-level identifier (`system_fingerprint`, response `id` shape) before attributing the cause to routing, grading, or harness mechanics.** This directly disambiguated "different backend being selected" from "same backend, genuinely inconsistent output" — a distinction that changes what the correct fix is entirely.

3. **Reaffirmed — verify a fix by deliberately reproducing its target failure mode, not by one passing run.** Third sprint in a row (after Sprints 18/19) this exact discipline mattered; keep it as the default bar for "is this actually fixed" rather than "did the last run pass."

4. **Reaffirmed — correct a prior conclusion in place, with the reasoning shown, rather than silently revising it.** Held cleanly this sprint across two corrections (the 0.5-artifact finding, and the "stable rejection, not variance" re-characterization of T-114's original Sprint 17 read).

5. **Reaffirmed — no self-merge of anything touching the shared gate mechanism or an existing case's calibration, ever, without the user's own direct in-the-moment words.** Held cleanly across all three substantive PRs this sprint.

---

## 6. Sprint goal / exit-criteria status

**No milestone was targeted this sprint** — same posture as Sprints 6–20. Per the standing **Milestone numbering note** (`WORK.md`), this work is deliberately **not** labeled M7.

| Exit criterion | Status |
|---|---|
| Grow `ticket-triage`/`ticket-respond`/`kb-learn` to ≥20 cases each, additive-only | ✅ 20 / 21 / 20, verified by direct YAML parse on `main` post-merge |
| Every new case genuinely distinct, not filler | ✅ 7 new cases, each closing a stated, distinct coverage gap (per T-118's own PR description) |
| No existing case's wording/rubric/pass-criteria touched by the growth task itself | ✅ Held — the rubric fix that was needed came from a separate task (T-120), not folded into T-118 |
| Never soften the gate to pass; drop-don't-weaken | ✅ The bundling-case fix widened an already-stated tolerance to match the rubric's own prose, not a new loosening — same precedent class as PR #439 |
| Merge of anything touching the shared gate/calibration needs the user's own direct authorization | ✅ Held across T-119 (closed, not merged) and T-120 (merged only after "proceed as recommended") |

---

## 7. Open risks / carried-forward going into Sprint 22

| Item | Type | Note | Owner |
|---|---|---|---|
| **Sprint 20 never got its own retro.** | Process hygiene | A small, mechanical sprint (one rebase-and-merge task); worth a brief retro or an explicit decision to skip retros for purely mechanical sprints going forward. | Carried (process note) |
| **The French-outage triage case's single-occurrence regression** (seen once during T-119's run, never reproduced or chased). | Watch item | One occurrence is not a pattern; needs its own reproduction before any conclusion. | Tracked, no owner |
| **Root cause of provider-CREDENTIAL divergence** (FQ-69's 401 master-key class). | Risk (non-blocking) → flagged carry, trigger still NOT fired | Unchanged from Sprints 19/20. | Carried (flagged) |
| **`main`'s `enforce_admins` branch-protection mechanic, `LITELLM_URL` Coolify dup-row footgun, T-90 O1–O3.** | Founder-gated / policy / non-blocking hardening | All unchanged. | Carried (flagged) |
| **Per-user session auth (T-77 Option A), FQ-63, FQ-47 action 4b, DNC/FQ-43.** | Carry (founder-gated) | All unchanged. | Carried |
| **`docs/screenshots/` accumulated 29 untracked files this session** (`04.png`–`32.png`, dated 2026-07-06 through 2026-07-13, unrelated to any task this session touched). | Process hygiene | Left untouched throughout — unknown provenance, not part of any task worked this sprint. Worth a direct check with the user on whether these belong in the repo. | Carried (flagged) |

---

*Sprint 21 delivered its scoped goal (eval coverage growth) but the more valuable output was diagnostic: a real defect that had been mischaracterized twice across two prior sprints (Sprint 16's original mischaracterization, corrected in Sprint 17, then re-mischaracterized this sprint before the actual root cause emerged) is now genuinely fixed and verified, not just patched around with a mechanism that couldn't have solved it. Nothing is forced or urgent for Sprint 22; per this project's established pattern (Sprints 17/18/20), the anchor should be put to the user directly rather than picked solo.*
