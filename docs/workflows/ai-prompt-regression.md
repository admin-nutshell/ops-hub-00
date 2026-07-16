# AI / Prompt Quality Regression — Standard Operating Procedure

## Trigger

This SOP applies whenever any of the following happens:

1. **The live `live-eval-gate` required status check goes red** on a PR that touches `evals/**`, `src/inngest/ticket-triage.ts`, `src/inngest/ticket-respond.ts`, `src/inngest/kb-learn.ts`, or `src/config/model-allowlist.ts` (ADR-0007 §3 path filter). This is the overwhelming majority of cases — the automated gate already ran the real `llm-rubric` evals against the production LiteLLM target alias and found a baseline-relative regression, or one of its calibration guards (token-count sanity, must-fail/must-pass canary, grader≠target) tripped.
2. **A live pipeline monitor or nightly full-suite drift run reports a regression on `main`** with no PR in flight (`monitor-e2e-pipeline.yml` / the ADR-0007 §4 nightly full-suite run) — an alias remap or provider-side drift a code diff wouldn't show.
3. **A prompt-behavior defect is found in production** by any agent, QA, or the user, independent of the gate — e.g. a triage misclassification a tenant reported, or a compliance-fabrication answer surfaced by manual review (the Sprint 18/19 T-115→T-116 class). This is an **escaped regression**: the gate did not catch it, either because coverage didn't reach that phrasing/case or because it predates the current eval suite.

This SOP is explicitly about **the human process around the automated gate**, not the gate itself. What is already automated and NOT re-litigated by this SOP: schema validation (`promptfoo validate`, every PR, hermetic), the live `llm-rubric` run against the production target alias (ADR-0007), the two-level threshold model, the calibration guards (token-count assertion, per-eval canaries, grader≠target), and the honor-`pass` grading mechanism with its deterministic objective-check split (ADR-0009, live on `main` since Sprint 14 / T-109). This document starts at the point a human has to look at a red gate, an escaped defect, or a rubric-calibration question and decide what to do.

**Out of scope for this SOP:** eval-coverage growth toward ADR-0007 §5.4's ≥20-cases-per-eval target (a separate, additive, opportunistic hygiene arc — see WORK.md's coverage-growth tasks) and routine model-allowlist additions that pass the gate cleanly. Both are normal engineering work, not a regression response.

---

## Owner

**Evals Lead** runs point on every instance of this SOP (CONSTITUTION.md decision-authority matrix: "Prompt / AI-behavior change → Evals Lead"). This is true whether the trigger is a red gate, a drift-monitor alert, or a reported production defect — diagnosis, root-cause, and the fix (prompt change, rubric-calibration change, or coverage addition) are all Evals Lead territory.

The Evals Lead pulls in help by cause, not by default:
- **Tech Lead** — if the red gate or defect looks architectural (harness/CI wiring, not prompt/rubric content), or if the fix would touch the shared grading mechanism itself (a genuine ADR-0009-class change, not a rubric wording tweak).
- **Security Lead** — if the regression involves what customer/tenant data reaches an LLM, a compliance-adjacent fabrication (GDPR/PIPEDA/HIPAA-style, per the Sprint 19 T-116 precedent), or a prompt-injection class defect (per the Sprint 13 T-103/T-105 precedent).
- **Production Manager** — only if the fix requires a LiteLLM alias change, a virtual-key/budget action, or a deploy; never for the diagnosis or the prompt/rubric edit itself.
- **QA Manager** — only if the underlying change also touches non-LLM code logic (QA owns code behavior, not LLM/prompt evals — QA.md is explicit that LLM/prompt evals are Evals Lead's, not QA's).

## Severity / priority classification

Severity is driven by **where the defect is caught**, not by the category of prompt behavior in the abstract:

| Class | Definition | Severity |
|---|---|---|
| **Caught in CI (gate red, PR blocked)** | The regression never reached a tenant. The merge is blocked; nothing is customer-facing yet. | Not a production incident. Treat as a blocked-merge diagnosis task, worked promptly but without paging anyone. |
| **Caught by the nightly drift run / monitor, no PR** | Same containment (no tenant impact yet), but `main` itself now differs from its last-known-good behavior. | Elevated over a routine PR block — `main` is the thing every future PR baselines against; diagnose same-day. |
| **Escaped to production — behavioral (e.g. a real ticket misclassified, an SLA-relevant urgency miss)** | A tenant-facing ticket was actually handled wrong. | **High.** Anchor to CLAUDE.md's own stated harms: a triage miss on a real P1 directly threatens the < 1hr MTTR / > 95% SLA-attainment goals this whole platform is graded on. |
| **Escaped to production — trust/compliance (e.g. the Sprint 19 GDPR/PIPEDA/HIPAA-style compliance-certification fabrication class)** | The AI said something false about a matter of legal/compliance substance to a customer. | **Critical.** This is the class most likely to have legal or revenue consequences and is the one category in this SOP most likely to also need a FOUNDER_QUEUE post (see Escalation). |

An escaped regression is always also logged as a coverage gap: if the eval suite didn't catch it, that gap gets closed with a permanent regression-lock case (see "What done looks like"), not just a one-off prompt fix.

---

## Step-by-step procedure

1. **Confirm the trigger and pull the raw evidence — do not classify from a pass/fail summary alone.** (Evals Lead.) Open the actual run: `eval_gate_runs.case_results` (JSONB, per-case detail) and/or the LangFuse trace for the failing case(s), citing the run ID. Read the raw target completion and the raw grader verdict (`pass`, `score`, `reason`) yourself. This step exists because this team has been burned three times by skipping it: T-84 misread a harness bug (system prompt silently dropped) as a 75%-worse prompt; a same-session review flagged calling something "grader variance" without per-draw evidence as a repeated, specific error. **"Done" for this step:** you can quote the actual completion text and the actual grader `{pass, score, reason}` for the failing case(s), not just "it went from PASS to FAIL."
2. **Classify the cause.** (Evals Lead.) Using the raw evidence from step 1, place the failure into exactly one of these buckets — they demand different fixes and different authorization paths, so getting this right is the point of the SOP:
   - **(A) Real regression** — the PR's prompt/logic change genuinely made the output worse against the rubric's own stated bar.
   - **(B) Harness/calibration-guard break** — the token-count sanity assertion tripped, a must-fail canary passed (rubber-stamping) or a must-pass canary failed, or grader≠target was violated. This is a **broken measurement**, not a quality signal (the T-84/T-88 25%-vs-100% class) — treat it as a hard CI defect, not a prompt defect.
   - **(C) Threshold-vs-rubric-tolerance misalignment (P1, per ADR-0009)** — the grader returned `pass:true` with a score in the honor-`pass` borderline band, but a *different* case's rubric wording is ambiguous enough that the grader still lands on the disfavored side, or an objective-contract case needs its deterministic allowed-set/rubric prose tightened. This is exactly the class T-120 root-caused: a genuine temperature-0 model inconsistency colliding with rubric wording that said the tolerated value was okay but not clearly enough for the grader to honor it consistently.
   - **(D) Per-run grader variance (P2)** — raw evidence shows the *same* input scattering across multiple draws with no wording ambiguity to point to (per-draw evidence required — see T-119's finding that turning on multi-sample for the "bundling" case was necessary to prove this cleanly and, in that instance, still did not by itself unblock the case; multi-sample proves or disproves variance, it doesn't guarantee a fix).
   - **(E) Legitimate baseline shift** — the change under review is an intended behavior change and the old green baseline is simply stale for that case.
   - Escaped-to-production defects (found outside the gate) are classified the same way, retroactively, plus **(F) coverage gap** — the suite had no case that would have caught this at all.
3. **Take the cause-specific action.** (Evals Lead, unless noted.)
   - **(A) Real regression:** fix the prompt in the source PR (or open a follow-up if already merged — treat as an escaped regression per step 2's retroactive classification). Do not touch the rubric or the gate to make it pass.
   - **(B) Harness break:** file/fix as a CI defect (Tech Lead co-owns if it's the shared runner). Never treat a calibration-guard trip as license to weaken the guard — the guard existing and tripping is it working correctly.
   - **(C) Rubric-calibration change:** edit the rubric wording for precision, not leniency — state the tolerated value explicitly rather than loosening the pass bar (the T-120 precedent: a 2-line wording clarification, not a threshold change). This touches the shared eval file that the merge-blocking gate reads — see the authorization note in step 5 before merging.
   - **(D) Variance:** either accept the case's existing calibration if variance is bounded and rare, or opt the specific case into the dormant per-case `multiSample` escalation (ADR-0009 — built, merged, ships dormant, opt-in per case only, never a blanket default because of its judge-cost multiplier). Turning it on is itself a decision to log in DECISIONS.md with the empirical justification, per the same T-119 precedent — it is diagnostic instrumentation, not automatically a fix.
   - **(E) Baseline shift:** proceed to baseline recapture (step 5) once the new behavior is confirmed correct and reviewed — never recapture to make an unreviewed change go green.
   - **(F) Coverage gap:** add a permanent regression-lock eval case that would have caught the miss (the Sprint 19 case-(q) precedent) in addition to whatever fix step 2's primary classification calls for.
4. **Verify the fix directly, not by re-running the same gate and hoping.** (Evals Lead.) Re-run the specific case(s) enough times to have real confidence given the cause classified in step 2 (a single re-run is not evidence against variance you just diagnosed). For an escaped/compliance-class defect, use real repeated sampling across multiple phrasings before declaring it fixed (the Sprint 19 T-116 precedent: near-default 10/10 fabrication rate found only by direct repeated sampling, not a single probe).
5. **Route the change through the correct authorization path — these are three distinct gates, not one, and none of them is a FOUNDER_QUEUE post:**
   - **No self-merge, ever**, on any PR (standing CONSTITUTION rule) — including one that only "looks small."
   - **If the fix touches the shared, repo-wide `live-eval-gate` mechanism itself, its rubric/calibration content in the product eval files, or the honor-`pass`/floor/multi-sample configuration** — this crosses the shared-safety-net boundary (CONSTITUTION + Sprint 12/13 §5.1 norm). It requires the **user's own direct, in-the-moment authorization**, freshly given for this change. A standing self-merge authorization does not cover it. A coordinator relaying "the user said this is fine" does not satisfy it. An agent supplying its own workflow-dispatch confirmation input does not satisfy it either. Only the user's own fresh words do (ADR-0009 §(d), FQ-77's banked governance lesson).
   - **If the fix requires recapturing the eval-gate baseline** (`eval_gate_runs`), that recapture needs its own explicit authorization, separate from the PR-merge authorization — do not fold it silently into a merge approval.
   - None of the above three items are business decisions and none of them belong on `FOUNDER_QUEUE.md` — see Escalation below for what does.
6. **Land it and close the loop.** (Evals Lead.) Merge (once authorized), confirm the gate re-enforces green against the new baseline, update `WORK.md` with the outcome, and log the root cause plus the raw evidence citation (run ID) in `DECISIONS.md` — including explicitly naming the cause bucket from step 2, since that bucket is what future diagnoses will search for.

---

## Required reviewers / sign-offs before this can close

Per CONSTITUTION.md's review pipeline, applied to this category specifically:

- **CR (CodeRabbit)** — always, first-pass automated review on every PR.
- **Evals Lead** — always required; this is by definition a prompt/eval-file/model-routing change (CONSTITUTION: "Evals Lead review — REQUIRED if the diff touches a prompt, an eval file, or model-routing config").
- **Security Lead** — required only if the fix touches auth, secrets/Vault, migrations/RLS, the model allowlist, or what customer data reaches an LLM — which is *always* true for a compliance-fabrication or prompt-injection-class defect (Sprint 19/T-103 precedent), and not automatically true for an ordinary triage-wording fix.
- **QA Manager** — only if the underlying change also touches non-LLM code logic; QA does not render the pass/fail verdict on LLM behavior (QA.md is explicit on this split) and is not a required sign-off for a pure prompt/rubric edit.
- **Production Manager** — only if the fix requires a LiteLLM alias/model-routing change, a virtual-key or budget action, or a deploy of the app runtime itself; not required for a prompt/eval-file-only change.
- **The user, directly** — required specifically for the shared-safety-net merge authorization and any baseline recapture authorization named in step 5, in addition to (not instead of) the above technical reviews.

No merge on an Evals-Lead-required change without Evals Lead sign-off; no merge on a Security-Lead-required change without Security Lead sign-off — both per CONSTITUTION.md's flow, with no step skipped.

---

## SLA / target timeline

Split by containment, because a blocked merge and a live incident are not the same thing:

- **Caught in CI (gate red, PR blocked):** diagnose (steps 1–2) within the same working session the red gate is noticed. Fix-to-green or an authorized baseline recapture should land within **one working day**; if root-causing genuinely needs longer (e.g. it needs multi-sample evidence per T-119's precedent), that is acceptable but must be stated as an explicit next step in `WORK.md`, not left silently red. It must never be closed by forcing the gate past a red result (`gh pr merge --admin` on a required check is forbidden regardless of pressure to land).
- **Caught by nightly drift / monitor on `main`, no PR in flight:** diagnose same-day; this is elevated over a routine PR block because every future PR baselines against `main`'s current state.
- **Escaped to production — behavioral:** inherits CLAUDE.md's own stated bar for production issues — **< 1hr MTTR** target once identified as escaped, > 95% SLA attainment as the standing product goal this defect threatens.
- **Escaped to production — trust/compliance class (fabrication, over-claiming compliance status, etc.):** treat with the same urgency as a Production Manager critical-path incident — PRODUCTION.md's rollback discipline (mean time to rollback under 15 minutes) applies if the fix requires disabling or reverting a live prompt path while the durable fix is prepared, rather than leaving a known-bad answer live while it's diagnosed properly.

In every case, the SLA is met by **fix-to-green or an authorized baseline recapture** — never by suppressing, skipping, or force-merging past the gate.

---

## Escalation

Post to `FOUNDER_QUEUE.md` only when the situation is a genuine business call, per CONSTITUTION.md's Founder's-domain framing — which is almost never within this SOP, because the gate mechanism, rubric calibration, and merge authorization are all agent-owned technical/governance matters (every ADR-0007/0009 design explicitly confirms "no FOUNDER_QUEUE escalation required" for the mechanism itself). The narrow cases that do qualify:

- A fix requires **switching model provider/alias** for a function (e.g. moving off a provider showing a persistent quality delta) — a provider-cost/quality-delta trade the Evals Lead charter itself reserves for founder input.
- An **escaped, trust/compliance-class defect** (the fabrication class) has plausible **customer-facing legal or revenue impact** — post per CONSTITUTION.md's "customer/tenant-facing decisions with revenue or legal impact."
- Diagnosing or fixing the regression would **slip the current sprint by more than one week**, with a proposed recovery plan attached.
- A genuine **security incident** is uncovered in the course of diagnosis (e.g. the regression turns out to be an active prompt-injection exploit in production, not just a quality miss) — per CLAUDE.md's standing security-incident escalation trigger.

Use the required `FOUNDER_QUEUE.md` format (Needs / Context / Options / Recommendation / Deadline) and come with options, never a raw problem dump. **Do not** post routine rubric-calibration questions, baseline-recapture requests, or merge-authorization requests to `FOUNDER_QUEUE.md` — those are handled directly with the user per step 5's governance-gate language, not through the business-escalation queue.

---

## What "done" looks like

This SOP instance is closed only when **every** item below is true — not when the gate merely goes green:

- [ ] The raw evidence (target completion + grader verdict, run ID cited) was inspected directly — the cause classification in `DECISIONS.md` is not asserted from a pass/fail summary alone.
- [ ] The cause bucket (A–F) is explicitly named in the `DECISIONS.md` entry.
- [ ] The fix matches the cause: a real regression got a prompt fix, a harness break got a harness fix, a rubric-ambiguity got a wording clarification (not a threshold loosening), variance got either an accepted calibration or a logged, justified `multiSample` opt-in, and any coverage gap got a new permanent regression-lock case.
- [ ] The fix was verified with enough repeated sampling to be real evidence given the cause classified (not a single re-run) — and, for a compliance/fabrication-class defect specifically, verified across multiple phrasings.
- [ ] Drop-don't-weaken held: nothing about the fix reduced the gate's ability to catch a genuinely bad output in the future (a rubric wording change increased precision, it did not loosen the bar; a threshold/floor/mechanism change, if any, was itself reviewed against ADR-0009 §(b)'s guardrails).
- [ ] The correct authorization was obtained and is traceable: no self-merge occurred; if the change crossed the shared-safety-net boundary, the user's own direct, in-the-moment authorization is recorded (not inferred, not relayed, not self-manufactured); if a baseline recapture was needed, its own separate authorization is recorded.
- [ ] The `live-eval-gate` reads green against the newly-correct baseline (confirmed by a real post-merge run, not assumed from the PR's last CI result).
- [ ] `WORK.md` reflects the outcome and `DECISIONS.md` carries the full trail (cause, evidence, fix, verification, authorization).
- [ ] If the defect was escaped-to-production, the customer/tenant-facing impact (if any) has been assessed and, if it met the Escalation bar above, has already been posted to `FOUNDER_QUEUE.md` — this checklist item is not satisfied by "it hasn't come up yet."