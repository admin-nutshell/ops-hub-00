# ADR-0007 — The "Real" LLM-Rubric Eval Gate: Design of Record (build deferred to Sprint 9)

- **Status:** Proposed (design-of-record; pending Tech Lead CI/architecture review + PM merge. Build is out of scope — this ADR is the decision-of-record the Sprint 9 build is sized from.)
- **Date:** 2026-07-09
- **Author:** Evals Lead
- **Deciders:** Evals Lead (rubric/threshold design, calibration, cost model — authors); Tech Lead (CI integration + architecture — review section is a placeholder below, not yet reviewed this session); Production Manager (LiteLLM virtual-key provisioning at build time); Founder (only if a provider-cost / quality-delta decision is escalated — none required by this design)
- **Supersedes:** none
- **Related:** ADR-0004 (LiteLLM alias/registry model — the gate targets aliases, not raw provider ids), ADR-0006 Decision A + T-B1 (the curated allowlist as interim mitigation; this ADR is that ADR's "option (b), deferred to Sprint 8"), `src/config/model-allowlist.ts` (T-79 — the selection constraint this gate automates), `.github/workflows/pr-checks.yml` (today's schema-only Eval Gate), `.github/workflows/run-kb-learn-eval.yml` (T-84/T-88 — the corrected live-run harness this generalizes), `evals/ticket-triage.yaml` / `evals/ticket-respond.yaml` / `evals/kb-learn.yaml` (the three product prompt evals), CLAUDE.md "Eval-gated" standing constraint + T-86 interim caveat, WORK.md T-58 / T-79 / T-84 / T-88, `DECISIONS.md` 2026-07-08 T-79. CLAUDE.md non-negotiables #5 (never push to main), #7 (all input untrusted), #10 (CI has no production LLM keys / customer data / founder creds).

---

## Context

### The drift: the constraint says X, CI does Y

CLAUDE.md carries a standing constraint: *"Eval-gated: no prompt or capability change ships without passing the Promptfoo eval suite (> 95% pass rate)."* That sentence has been **materially untrue since T-17/T-58.** The CI "Eval Gate" (`.github/workflows/pr-checks.yml`, the `evals` job) runs exactly one thing:

```
npx -y promptfoo@0.121 validate -c "$f"   # for each evals/*.yaml
```

`promptfoo validate` is a **schema check** — it confirms each eval YAML parses against the promptfoo config schema and is otherwise well-formed. It makes **zero live LLM calls**, invokes **no `llm-rubric` grader**, and needs **no API key** (deliberately — the job is hermetic). A prompt can regress catastrophically in behaviour — start leaking PII, obey injected instructions, misclassify every P1 — and this gate stays green as long as the YAML is syntactically valid. It gates *structure*, not *quality*.

This is itself a species of the exact drift Sprint 8 exists to close: a stated invariant that the system does not actually enforce. It was flagged in **T-58** (dashboard eval-health feed) and again in **T-79** (Sprint 7, the curated allowlist) and never scheduled until now. T-86 landed an interim honesty caveat in CLAUDE.md so the constraint is no longer *silently* false while this ADR is authored; this ADR owns the permanent design.

### What "eval-gated" is enforced by today (the honest inventory)

1. **Schema validation** (`promptfoo validate`) — catches malformed eval files only.
2. **Curated model-routing allowlist** (`src/config/model-allowlist.ts`, T-79) — a *selection constraint*: the dashboard model-router can only choose among aliases already accepted in production; it cannot introduce an un-vetted one. This is real and load-bearing, but it is a constraint on *which models are selectable*, not a live pass/fail on *prompt behaviour*.
3. **Human process** — the T-79 PROCESS block requires a manual `promptfoo eval` run against a new alias's target model (> 95%, recorded in DECISIONS.md) before that alias is added to the allowlist. This is a documented manual step, not automation.

The three product prompt evals (`evals/ticket-triage.yaml`, `evals/ticket-respond.yaml`, `evals/kb-learn.yaml`) already contain real `llm-rubric` assertions (threshold `0.8` each, 4 tests apiece) — they are *ready* to run live; nothing in CI runs them live. T-84/T-88 proved this out end-to-end for KB Learn via a **manual, workflow_dispatch** live run (`.github/workflows/run-kb-learn-eval.yml`), and in doing so surfaced a harness bug (below) that the calibration plan here bakes in a defense against.

### Constraints that bound the design

- **Free-tier-first** (CLAUDE.md): the gate must be cheap enough to run often without a budget approval.
- **CI has no production LLM keys / customer data / founder creds** (non-negotiable #10): the gate cannot use the LiteLLM master key or any production-scoped credential in CI.
- **Provider-neutral** (CLAUDE.md): the gate targets LiteLLM aliases, never a raw provider SDK; judge and target both route through LiteLLM.
- **Never push to main; all PRs** (non-negotiable #5): the gate is a PR status check, never a post-merge cleanup.
- **All input untrusted** (non-negotiable #7): eval fixtures include injection cases; a malicious-fork threat model applies to any PR-triggered job that holds a secret.

---

## Decision

Adopt a **live `llm-rubric` eval gate** that runs the existing promptfoo prompt evals against each function's **actual production target model** (the LiteLLM alias), on a **path-filtered PR trigger**, as a **required, merge-blocking status check**, using a **dedicated budget-capped LiteLLM virtual key (never the master key)**, with **calibration guards that make a broken harness fail loud rather than pass silent**. The gate **automates the allowlist's currently-manual eval-admission step** rather than replacing the allowlist. Build is deferred to Sprint 9; this section is the design of record.

Each numbered subsection maps to a required content item of T-87.

### 1. Problem statement

See Context. In one line: **the eval-gate constraint asserts a live > 95% quality pass; CI performs only schema validation; the delta is an unenforced invariant (drift), flagged twice, now scheduled.**

### 2. The LLM-rubric approach — what "real" means

The "real" gate runs promptfoo's `eval` (not `validate`) over the three product evals, where each test's `llm-rubric` assertion is graded by a **judge model** against a written rubric, and the run produces a machine-readable pass/fail per test plus an aggregate pass rate.

Concretely, the gate must do what the CI schema check deliberately does **not**:

- **Swap the provider to the production target.** The eval files pin `anthropic:claude-sonnet-4-6` as the *prompt-contract reference* (for schema validation and prompt-authoring stability). Production routes each prompt through a **LiteLLM alias** (`triage-model` for all three functions today; `triage`/`respond`/`kb_learn` per `model-allowlist.ts`). The gate generates a **self-contained live-run config** per eval that repoints the provider at `openai:chat:<alias>` against the LiteLLM `/v1` endpoint — exactly the shape `run-kb-learn-eval.yml` already proved.
- **Deliver the system prompt as a real system-role message.** This is the load-bearing lesson from T-84/T-88 (see §5): the openai-compatible provider **ignores `config.system`**; the system prompt must be delivered via a prompt-function that emits a `{role:"system"}` message, or the model runs with *no instructions* and the result is meaningless. The generalized runner (§6) does this once, correctly, for all three evals.
- **Grade with a judge model routed through LiteLLM.** Each `llm-rubric` assertion needs a grader. The grader routes through LiteLLM too (provider-neutral), and — per §5 — must be a **different alias from the target under test** to avoid a model grading its own blind spots.
- **Apply thresholds at two distinct levels** (§5): each `llm-rubric` assertion has its own per-assertion threshold (currently `0.8`); the *gate* aggregates test outcomes into a suite pass rate compared against the CLAUDE.md bar.

What the gate is **not**: it is not a new eval *framework* (promptfoo already is one), not a second router (LiteLLM already is one), and not a replacement for QA's code tests (QA = code behaviour; Evals = LLM behaviour — the standing handoff split).

### 3. CI integration design

**Trigger — path-filtered `pull_request`.** The gate runs only on PRs that touch prompt surfaces, not every PR:

```
on:
  pull_request:
    paths:
      - 'evals/**'
      - 'src/inngest/ticket-triage.ts'
      - 'src/inngest/ticket-respond.ts'
      - 'src/inngest/kb-learn.ts'
      - 'src/config/model-allowlist.ts'
```

Rationale: the vast majority of PRs (docs, dashboard, infra workflows) touch no prompt and need no live LLM spend. Path-filtering is the primary cost lever (§4) and keeps the gate's latency off unrelated PRs. The three `src/inngest/*.ts` files are the prompt bodies; `evals/**` is the eval definitions; `model-allowlist.ts` is included because a change there is a routing-capability change the gate exists to vet.

**What blocks merge.** The gate is registered as a **required status check** on `main` (branch protection). A red gate blocks merge; per non-negotiable #5 this is the only enforcement point (there is no post-merge path to catch a regression). "Red" = any per-assertion `llm-rubric` below its threshold that drops the suite below the pass bar (§5), **or** a calibration-guard trip (§5 — a broken harness is a hard error, never a silent pass).

**How it reports.** Two surfaces, matching the Evals Lead charter:
- A **PR comment** with a per-eval / per-test pass-fail breakdown (the promptfoo run summary), posted via the GitHub MCP / `gh` on every gate run — so a regression is legible in-line, not buried in an Actions log.
- **Persisted results** to the `eval_gate_runs` table (already added in T-58) + **LangFuse traces** (the Evals Lead's standing store), so the dashboard eval-health feed (T-58) reflects real runs and baselines are queryable over time.

**The secret / fork tension — the one sub-decision the Tech Lead review must ratify.** A `pull_request`-triggered job that holds a secret is exfiltratable by a malicious fork PR, and the only LiteLLM credential in the org today is the **master key**, which can register/delete models and mint keys — the Security Lead explicitly rejected handing it around in ADR-0006 T-B4, and non-negotiable #10 forbids production LLM keys in CI. This design resolves it with **three constraints, all required together**:

1. **A dedicated, budget-capped LiteLLM virtual key — never the master key.** LiteLLM supports virtual keys scoped to a **model allowlist** (only the eval target + judge aliases) with a **hard spend cap**. This key can do nothing but run metered completions against a fixed alias set on staging, up to a ceiling. A leak is bounded to that ceiling and cannot touch routing config. This is what satisfies #10: it is a staging, capability-scoped, budget-limited key, not a production key.
2. **`pull_request`, never `pull_request_target`.** The gate must never use `pull_request_target` (which runs with the base repo's secrets against untrusted head code) — the classic fork-secret-exfiltration footgun.
3. **Fork-PR safe default.** On a PR from a fork, the secret is not exposed; the job **neutral-skips** and the gate falls back to a **required manual dispatch** (a maintainer runs the `run-*-eval.yml` workflow_dispatch and the green run is the merge evidence). In practice `admin-nutshell/ops-hub-00` is a private, single-team repo where PRs come from same-repo worktree branches (per the team's worktree-isolation practice), so the fork path is a safety net, not the common case.

**The recorded alternative** (for the Tech Lead review to weigh): keep the live run on **`workflow_dispatch` only** (as T-84/T-88 do today) and make a *green dispatched run attached to the PR* a required manual gate. This is strictly safer on the secret dimension (no secret ever enters PR-triggered context) but trades away automation — a human must remember to dispatch. The recommendation is the auto-trigger with the scoped virtual key **because** the scoped key + `pull_request` + fork-skip removes the exfiltration risk that motivated `workflow_dispatch` in the first place; but this is genuinely the Tech Lead's CI/architecture call and is flagged as the primary open item of their review.

### 4. Cost model — free-tier-first

Anchored on measured data, not guesses. From T-88's corrected runs: a KB Learn call is **~853 prompt tokens + ≤400 output tokens** (`max_tokens: 400`, temp 0.2). Each eval has **4 tests**; there are **3 product evals** → **12 target calls + 12 judge calls = 24 calls** for a full-suite run.

- **Target calls** route through the production alias. `triage-model` currently resolves to a gpt-4o-mini-class model (per `model-allowlist.ts`), roughly $0.15/$0.60 per 1M input/output tokens: 12 × (853·$0.15 + 400·$0.60)/1e6 ≈ **$0.004**.
- **Judge calls** carry the target's prompt+output plus the rubric (~1500 input) and emit a short verdict (~150 output). Using **Claude Haiku 4.5** ($1/$5 per 1M in/out) as the reference judge: 12 × (1500·$1 + 150·$5)/1e6 ≈ **$0.027**.
- **Full-suite run ≈ $0.03 USD** (≈ $0.04 CAD), **judge-dominated.** A single-agent gate (one eval, 4 tests) is ≈ **$0.01**.

**Frequency:** path-filtered PRs only (§3) + one **nightly** full-suite run against `main` as a drift monitor (catches an alias remap that a code diff wouldn't show). Even a heavy month — say 100 prompt-touching PR runs + 30 nightly runs — is ≈ **$4 USD ≈ $5.50 CAD/month**, comfortably inside free-tier-first and far under the < $2 CAD/ticket unit economics (this is a build-time cost, not a per-ticket cost).

**Keeping it cheap (the levers, in priority order):**
1. **Path-filter the trigger** — the single biggest lever; unrelated PRs cost nothing.
2. **Cheap judge model.** Haiku-class judging is sufficient for rubric grading; do not judge with a frontier model by default. (Escalate the judge to `claude-sonnet-4-6` only for a specific eval if Haiku judging proves noisy in calibration — a per-eval override, not a global default.)
3. **`--no-cache` only where correctness demands it.** The live gate must not cache target completions (a cached pass hides a regression), but promptfoo's grader cache can stay on within a run.
4. **Hard budget cap on the LiteLLM virtual key** — a runaway loop cannot exceed the ceiling; the cap *is* the backstop, set to (e.g.) $10 CAD/month with alerting well below.

**Budget ceiling of record:** ~$5 CAD/month expected, $10 CAD/month hard cap on the virtual key. Crossing the hard cap is a signal (a loop or a trigger misconfiguration), not a routine event — it pages the Evals Lead, it does not silently degrade.

### 5. Rubric / threshold calibration plan — bake in the T-84/T-88 lesson

The T-84 live run reported **25% (1/4)** and was initially read as a production vulnerability. It was a **harness bug**: the run copied the system prompt into `config.system`, which the openai-compatible provider **ignores**, so the model ran with *no system prompt* — token evidence: 497 total prompt tokens across 4 calls (~124/call, user-message-only) versus the ~853/call the correct harness produces. The 25% measured a model with no instructions, not KB Learn's real behaviour; T-88's corrected harness scored **100% (4/4), twice**. A broken harness silently under- (or, symmetrically, over-) reports. The calibration plan makes that failure mode **loud**:

1. **Token-count sanity assertion (mandatory, per run).** After the run, assert observed prompt tokens per call are within a band of the expected system+user size (e.g. ≥ 600 tokens/call for the ~853-token KB Learn prompt). If prompt tokens collapse toward user-message-only, the system prompt did not reach the model → the run is a **hard error**, not a 0% pass. This is the exact 497-vs-853 signal, encoded as a gate guard. T-88 already flagged the `config.system`-on-openai-provider bug as a latent class for *any* future live-run override — this assertion is the standing detector for it.
2. **Known-good + known-bad canaries (per eval).** Each eval carries one fixture that **must pass** and one that **must fail** under a correctly-wired harness. If the must-fail canary passes (grader rubber-stamping) or the must-pass canary fails (harness/model broken), the gate presumes the harness is broken and **errors** rather than reporting a pass rate. A harness that can't tell right from wrong is not trusted to gate.
3. **Grader ≠ target.** The judge alias must differ from the target-under-test alias. A cheap model grading its own output shares its blind spots and can't catch its own errors; a distinct judge is a real second opinion. (Recorded because today's manual run used `triage-model` for *both* target and grader — acceptable as a first proof, wrong as a standing gate.)
4. **Two threshold levels, never conflated.**
   - **Per-assertion `llm-rubric` threshold = `0.8`** (already in the eval files) — how confident the judge must be that one test's output satisfies its rubric.
   - **Suite-level pass rate = the CLAUDE.md `> 95%` bar** — the fraction of tests that must pass for the gate to go green.
   - **Small-N caveat (a real calibration decision, not a footnote):** with 4 tests, "> 95%" collapses to **4/4 = 100%** (3/4 = 75% fails). So today the gate is mathematically a **zero-failure** gate. Two honest options for the build to choose between: **(a)** grow each eval to ≥ 20 tests so the percentage is meaningful and one flaky judge call doesn't fail the gate, or **(b)** redefine the gate as **"zero regressions vs the recorded baseline"** (compare this run's per-test results to the last green baseline in `eval_gate_runs`; a test that newly fails blocks, a test that was already failing-and-waived does not) rather than an absolute percentage. **Recommendation: (b) baseline-relative**, because it is robust to judge flakiness and directly answers the question the gate exists to answer — *did this change make something worse?* — while (a) is a slower, ongoing coverage effort worth doing regardless. The build picks the mechanism; the ADR records the trap and the recommended resolution.
5. **Baseline capture before enforcing.** Before the gate blocks anything, run all three evals green against `main` and record the baseline in `eval_gate_runs` + LangFuse. A gate with no baseline is just noise. This is the analog of "baseline the new behaviour before merging" from the Evals Lead new-capability checklist.

### 6. Migration path — schema-only today → real gate (concrete, step by step)

The migration is additive; the schema check stays. Ordered so nothing blocks merges until a green baseline exists.

1. **Generalize T-88's corrected harness into a shared runner.** Extract the `run-kb-learn-eval.yml` live-config generator (provider swap → `openai:chat:<alias>`; system prompt delivered as a real system-role message via a prompt-function; grader routed through LiteLLM) into a **reusable script/composite action** parameterised by eval file + target alias + judge alias. **First thing fixed in the shared runner: the `config.system`-ignored-by-openai-provider bug** (T-88's flagged latent class) — encode it once so no future per-eval override reintroduces it. Files touched: new `scripts/eval/live-run.*` (or a `.github/actions/*` composite); no change to the three `evals/*.yaml` (their reference-provider block stays for schema validation).
2. **Provision the scoped LiteLLM virtual key** (Production Manager, build time): a budget-capped virtual key scoped to the eval target + judge aliases on staging LiteLLM; store as a GitHub Actions secret (e.g. `LITELLM_EVAL_KEY`). **Not** the master key (Security Lead / T-B4).
3. **Add the calibration guards (§5)** to the shared runner: token-count assertion, per-eval canaries, grader≠target enforcement, baseline-relative pass logic reading/writing `eval_gate_runs`.
4. **Capture the green baseline** (§5.5): run all three evals against `main`, record in `eval_gate_runs` + LangFuse. Fix any real red before proceeding — a red baseline is a real finding, routed like T-84→T-88.
5. **Wire the new CI job** — either extend the `evals` job in `pr-checks.yml` or add a sibling workflow (Tech Lead's call): path-filtered `pull_request` trigger, scoped key in `env`, fork-skip guard, PR-comment reporter, `eval_gate_runs` write. The existing schema-only `validate` loop **stays** (it still catches malformed YAML on every PR cheaply and needs no key).
6. **Register as a required status check** on `main` branch protection (founder/Tech Lead — branch protection is an admin action). Add the nightly `schedule:` full-suite drift run.
7. **Retire the manual PROCESS step's dispatch requirement** where the gate now covers it (§8): the T-79 manual "run promptfoo against the alias, record in DECISIONS.md" becomes "the gate does this in CI"; the allowlist file's PROCESS block is updated to point at the gate. Update the **CLAUDE.md "Eval-gated" constraint** to drop the interim caveat and state the real gate — the drift is closed in the doc only once the gate is live.

### 7. Sizing estimate for the Sprint 9 build

**Medium — a focused sprint's anchor, not a mega-project, and not a one-task item.** Roughly:

- **Shared live-run runner** (generalize + harden T-88's harness, fix the `config.system` class): **S–M.** The hard part is already solved once in `run-kb-learn-eval.yml`; this is extraction + parameterisation + the token guard.
- **Calibration guards** (token assertion, per-eval canaries ×3, grader≠target, baseline-relative logic): **M.** The canaries are new fixtures + a small amount of harness logic; the baseline-relative comparison against `eval_gate_runs` is the most novel piece.
- **CI wiring** (trigger, scoped key, fork-skip, PR-comment reporter, `eval_gate_runs` write, nightly): **M**, and carries the one real design risk — the secret/fork trigger decision (§3), which the Tech Lead ratifies.
- **LiteLLM virtual-key provisioning** (Production Manager): **S** — a discrete, well-understood config task.
- **Baseline capture + CLAUDE.md/allowlist doc reconciliation**: **S.**

No new database schema (`eval_gate_runs` exists, T-58). No new external service (promptfoo, LiteLLM, LangFuse, GitHub Actions all already in the stack). The novel surface is the calibration harness and the CI trigger security posture. Comparable in shape to a Sprint-7-style track (T-72→T-79): several small-to-medium pieces with one load-bearing review gate, not a research spike.

### 8. Interaction with T-79's curated allowlist — coexist, and automate its manual step

The gate **does not replace** `src/config/model-allowlist.ts`. They do different jobs:

- The **allowlist is a *selection constraint*** — it bounds *which* aliases the dashboard router may select, so a human click can never introduce an un-vetted model. That job exists independent of any gate and stays.
- The **gate is a *quality check*** — it asserts a given prompt *behaves* correctly against a given target model.

What the gate does is **automate the allowlist's currently-manual eval-admission step.** The allowlist's PROCESS block literally says: *"until the live multi-provider gate (ADR-0006 T-B1 option (b), deferred to Sprint 8) exists, this is a manual `promptfoo eval` run via LiteLLM ... recorded in DECISIONS.md."* This ADR **is** that option (b). Once the gate ships:

- Adding a new selectable alias for a function becomes: register the alias in LiteLLM → **the gate runs that function's eval against the new alias's target model in CI and records the pass to `eval_gate_runs`** → add the alias to the allowlist in the same PR. The manual `promptfoo` run + hand-recorded DECISIONS.md line is replaced by an automated, gate-enforced result.
- The **KB Learn unpin** (WORK.md, deferred to Sprint 9) rides this directly: KB Learn's list is pinned to one model *because it had no eval*; now it has one (T-84/T-88), and once the gate is live, widening `kb_learn`'s allowlist to a second model is gate-gated by construction rather than by memory.

So: **coexist, with the gate subsuming the allowlist's manual admission gate.** Neither is retired; the allowlist becomes the *record of what passed*, and the gate becomes the *mechanism that admits to it*. The trip-wire from T-79 (option (c), accepting raw runtime-swap risk, which would relax a CLAUDE.md constraint and require a founder FQ) remains **not hit** — this design tightens enforcement, it does not relax anything.

---

## Consequences

- **Positive:** the "eval-gated" constraint becomes *true* — a prompt/target regression is caught in CI before a tenant sees it, not by luck. The design is provider-neutral (aliases + LiteLLM), free-tier-first (~$5 CAD/month, judge-dominated, path-filtered), and reuses everything already in the stack (promptfoo, LiteLLM, LangFuse, `eval_gate_runs`, T-88's corrected harness). It closes the class of "green gate, broken behaviour" the same way Sprint 8's other tracks close "record says X, live is Y." The calibration guards mean the gate can't repeat the 25%-vs-100% harness trap — a broken harness errors loudly instead of reporting a confident wrong number. The allowlist's manual admission step becomes automated.
- **Negative / accepted:** a real live gate adds **latency and cost to prompt-touching PRs** (seconds and cents, bounded by path-filter + budget cap). It introduces a **secret into PR-triggered CI** — mitigated to a scoped, budget-capped, staging-only virtual key with a fork-skip, but it is a new (small) surface the Tech Lead review must sign off. **Judge-model noise** is a standing risk of any llm-rubric gate — the baseline-relative threshold (§5.4b) and grader≠target rule (§5.3) are the mitigations, and a persistently-flaky eval is retired/fixed per the monthly coverage review, never left to flap. The build is **one more sprint of deferral** — accepted deliberately (WORK.md §"Why the real eval gate is a design spike here"): building it alongside the reconciliation + KB Learn eval + T-62 closeout would repeat the Sprint 5 overcommit pattern.
- **Open items that must resolve at build time (Sprint 9):** the **trigger/secret posture** (§3 — auto `pull_request` + scoped key vs. `workflow_dispatch`-only required manual run) is the Tech Lead's ratification; the **small-N threshold mechanism** (§5.4 — grow test counts vs. baseline-relative) is the build's to pick with (b) recommended; the **LiteLLM virtual-key** is a Production Manager provisioning task; **branch-protection required-check registration** is an admin/founder action.

---

## Evals Lead Design Rationale

- **Reviewer:** Evals Lead (Prompt Quality) — author of this ADR; this section is the design rationale that stands in for the usual appended review, per the ADR-0006 convention (there, the Evals Lead review was appended by a different author; here the Evals Lead *is* the author, so the rationale is inline).
- **Date:** 2026-07-09
- **Verdict on scope:** this is an agent-owned technical design (CONSTITUTION "could a senior engineer answer this by reading the repo?" → yes). **No FOUNDER_QUEUE escalation is required by this design** — it neither relaxes a standing constraint (it tightens one) nor forces a provider switch with a quality delta (the T-79 trip-wire, option (c), is not hit). The one place a founder action appears is mechanical (branch-protection admin), not a business decision.
- **Why baseline-relative over absolute > 95% (the call I'd defend hardest):** the CLAUDE.md "> 95%" number is honest as an *aspiration* but brittle as a *gate mechanism* at N=4 (it silently means 100%), and an absolute bar makes the gate hostage to judge-model flakiness — one noisy Haiku verdict fails a PR that changed nothing. A baseline-relative gate answers the question the Evals Lead charter actually cares about ("zero *silent regressions* on the eval suite") directly. Growing test counts (option a) is good hygiene and should happen, but it is a slower coverage effort and doesn't fix the flakiness-vs-absolute-bar tension on its own.
- **Why the harness-bug defense is non-negotiable and structural, not procedural:** the T-84 25% was not a careless mistake — it was a silent measurement failure that *looked* like a real signal, and it took a full follow-up task (T-88) and token-count forensics to unmask. "Be careful next time" is not a control. The token-count assertion and the must-pass/must-fail canaries make the same failure mode a **loud hard error** the next time it occurs — including the *symmetric* danger (a harness that silently *over*-reports, passing a genuinely broken prompt). A gate you can't trust to detect its own brokenness is worse than no gate, because it manufactures false confidence.
- **Why coexist-not-replace on the allowlist:** the allowlist and the gate are often conflated ("once we have a real gate we don't need the allowlist"). They answer different questions — *which models are selectable* vs. *does this prompt behave*. Retiring the allowlist when the gate ships would reopen the exact runtime-swap bypass T-79 closed. The correct framing is that the gate *automates the allowlist's manual admission step*, which is what makes the KB Learn unpin (and future multi-model routing) safe by construction.
- **Handoff:** Tech Lead — the CI/architecture review below is yours; the load-bearing item is the §3 trigger/secret posture (auto `pull_request` + scoped virtual key vs. `workflow_dispatch`-only required manual run). PM — this ADR is the decision-of-record; the Sprint 9 build is sized in §7. Production Manager — the LiteLLM virtual-key provisioning (§6 step 2) is a build-time task for you. No founder escalation required.

## Tech Lead Review (CI / Architecture) — PENDING

- **Reviewer:** Tech Lead (CI + Architecture)
- **Status:** **NOT YET REVIEWED.** No live Tech Lead in this authoring session; this placeholder follows the ADR-0006 appended-review convention (cf. its "Security Lead Review" / "Evals Lead Review" sections). To be completed before this ADR moves from *Proposed* to *Accepted*.
- **Requested focus (author's flag for the reviewer):**
  1. **§3 trigger/secret posture — the primary decision.** Ratify or overturn: auto `pull_request` (path-filtered) + a scoped, budget-capped LiteLLM **virtual** key with a fork-skip, **vs.** the recorded alternative of `workflow_dispatch`-only with a required manual-run attachment. Confirm the scoped-virtual-key reading of non-negotiable #10 is sound (staging, capability-scoped, budget-capped ≠ "production LLM API key") and that `pull_request` (never `pull_request_target`) + fork-skip closes the exfiltration path for a private single-team repo.
  2. **CI shape:** extend the existing `evals` job in `pr-checks.yml`, or a sibling workflow? (Author is neutral; the schema-only `validate` loop must stay regardless.)
  3. **§5.4 threshold mechanism:** concur with baseline-relative (recommended) vs. absolute-with-grown-N, and confirm the `eval_gate_runs` schema (T-58) carries what a baseline comparison needs (or size the delta if not).
  4. **§7 sizing:** sanity-check the medium estimate and the piece-by-piece breakdown against Sprint 9 capacity.
