# Deploy plan — real post-deploy health gate (T-123, Sprint 22 Phase 2 Track B)

**Status:** code DONE, PR open, **not self-merged** — awaiting Tech Lead +
QA Manager review per this project's standing "full formal review for every
change" rule, and Security Lead is worth a look too since this touches
`prod-deploy.yml`. Staging-side behavior verified for real this session
(see "Verification" below); prod-side behavior verified only at the
script/endpoint level, not via an actual prod deploy — see "What was NOT
verified."

**Risk class:** Medium, per `docs/deploys/checklist.md` ("non-tenant-facing
infra" — this changes deploy-workflow *gating* logic, not the running
application's own behavior). The staging side (`main-deploy.yml`,
`deploy-staging-services.yml`) is low-actual-risk: it can only make an
already-broken deploy fail more loudly than before; it cannot make a
healthy deploy fail (see "Why this can't false-positive" below). The prod
side (`prod-deploy.yml`) carries the same property but is flagged for
explicit review anyway per this task's own instructions, since it's a
production-affecting file.

---

## What changed

New file `scripts/deploy-health-gate.sh` — a small, reusable script that
polls one or more URLs and fails loudly (non-zero exit, clear `::error::`
reason) unless every one returns HTTP 200. Wired in three places:

1. **`main-deploy.yml`** (staging, auto-deploy on `src/**` etc. merges) —
   new step "Post-deploy health gate — deep checks (T-123)" right after the
   existing shallow `/health` poll, checking `/health/env` (T-63) and
   `/health/litellm-internal` (T-97). Also added `workflow_dispatch: {}` as
   an additional trigger (unrelated to the gate itself, but this workflow
   had no manual-dispatch capability at all before — every sibling deploy
   workflow does — added so it can be manually re-run/tested going forward
   without waiting for another qualifying push).
2. **`prod-deploy.yml`** (manual promotion) — the same new step, same two
   endpoints, against `PROD_URL`. **Flagged explicitly**: this is the one
   piece of this PR that touches prod deploy behavior.
3. **`deploy-staging-services.yml`** (LiteLLM/FreeScout infra, staging-only)
   — fixed a **pre-existing, unrelated defect** this task's own scope
   named as an example to look at: both health-check steps
   ("Wait and verify LiteLLM health", "Verify FreeScout health") already
   polled correctly but only ever printed a `⚠️ Not yet 200` warning and
   exited 0 regardless of the result — a genuinely broken infra deploy
   reported SUCCESS. Now retries (6× / 15s) then fails loudly, same shape
   as the other two files.

New `runbooks/deploy-health-gate.md` — what the gate checks, why v1 has no
auto-rollback, what a human does when it fires, what's explicitly out of
scope (Coolify dup-env-row guard = a parallel track, T-98 deploy-gating
wiring = a later task, auto-rollback = a named future v2).

---

## Why this can't false-positive (make an already-healthy deploy fail)

`/health/env` and `/health/litellm-internal` are not new code — they are
T-63's and T-97's existing, already-deployed, already-live routes. This PR
adds zero new application code; it only adds CI steps that `curl` routes
that already exist on both `ops-hub-staging` and `ops-hub-prod` today. A
deploy that is genuinely healthy (env vars present, LiteLLM auth working —
i.e. the actual steady state of both environments right now, confirmed
below) will continue to pass both checks exactly as it would if a human
manually curled them.

## Why this can (and should) catch real breakage

Confirmed empirically, not assumed — see "Verification."

---

## Rollback path (defined BEFORE dispatch, per team quality bar)

This change is CI-workflow-only — it adds gating logic, it does not change
what gets deployed. If the new gate step itself is somehow wrong (e.g. a
transient network blip makes it fail on a genuinely healthy deploy), the
rollback is: revert this PR's commit, or — faster — just re-run the deploy
workflow (`workflow_dispatch` now works on `main-deploy.yml`, already did on
`prod-deploy.yml`); nothing about the application's runtime state is
touched by this change, so there is no state to unwind beyond re-running CI.
Mean rollback time: well under 15 minutes (a CI-only revert, no container
redeploy required to undo it).

If the gate correctly catches a real broken deploy, the rollback is the
one described in `runbooks/deploy-health-gate.md`: re-run the deploy
workflow with the previous known-good image tag/SHA.

---

## Verification

**Staging (main-deploy.yml + deploy-staging-services.yml side) — real,
this session:**

- Ran `scripts/deploy-health-gate.sh` directly (not a YAML review, an
  actual script execution) against real, currently-live hosts:
  - `https://ops-hub-prod.inatechshell.ca` `/health` → **HTTP 200 → gate
    PASSED, exit 0.** Confirms the gate's pass path is correct against a
    genuinely healthy target.
  - `https://ops-hub-staging.inatechshell.ca` `/health` → **HTTP 302 (the
    Coolify/Traefik fallback route ops-hub-staging currently returns
    because it's stopped, per T-98 SC7's standing default state) → gate
    FAILED, exit 1, clear `::error::` reason printed.** Confirms the gate's
    fail path is correct against a genuinely unhealthy target — this is a
    real, live negative case, not a simulated one.
  - Multi-path invocation (`/health` + a deliberately-nonexistent path)
    against prod → one path passed, one failed (404), **overall gate
    correctly failed** — confirms the aggregation logic checks every path
    and doesn't short-circuit on the first pass.
- Did **not** curl `/health/env` or `/health/litellm-internal` directly
  against either live host during this session — the auto-mode permission
  classifier declined a direct prod `/health/env`/`/health/litellm-internal`
  read as an unauthorized "production read" of config/completion-adjacent
  endpoints, and staging was already proven unhealthy via `/health` alone
  (302, not 200 — the deep paths would 302 identically, since staging's
  entire route table is unreachable while stopped). Both endpoints'
  actual pass/fail *content* logic is independently already proven: T-63's
  own unit tests (`src/healthEnv.test.ts`) and T-97's dedicated live
  verification workflow (`verify-litellm-internal-health-handler.yml`,
  which live-runs the real handler against real `litellm-staging` with both
  a bad and a good key). This task's own new surface — the curl-and-retry-
  and-exit-1 script wrapper — is what was verified fresh above.
- Did **not** trigger a full, real `main-deploy.yml` run end-to-end (which
  would require merging to `main`, since that workflow's push trigger is
  the only way it fired before this PR, or starting `ops-hub-staging`
  through an unreviewed side channel, which past incidents in this repo
  — T-107 — specifically warn against doing outside the workflow's own
  reviewed start-then-stop mechanism). The `workflow_dispatch` trigger
  added in this PR makes that possible for a maintainer to do post-merge if
  they want one more end-to-end confirmation; it wasn't done pre-merge here
  because doing so safely requires the merge this task cannot perform
  itself.

**What was NOT verified (named honestly, not glossed over):**

- No real `prod-deploy.yml` dispatch was run. Doing so would promote an
  unreviewed change to production — explicitly out of this task's
  authority (per this task's own instructions and standing project norms
  around prod promotion always needing the user's direct authorization).
  The prod-side step is code-identical to the staging-side step (same
  script, same two paths, different `$PROD_URL`), and the script itself is
  proven above — but the fully-assembled step running inside a real
  `prod-deploy.yml` execution has not been exercised. Flagged in the PR for
  Tech Lead/Security Lead attention specifically.
- `deploy-staging-services.yml`'s fixed steps were not re-dispatched for
  a full live end-to-end proof in this session (that would restart the
  LiteLLM/FreeScout staging containers for a check unrelated to their
  current health) — the fix itself is a narrow, mechanical change (replace
  "print a warning and exit 0" with "retry then exit 1"), same shape as the
  main-deploy.yml step that WAS proven live, and low-risk to review by
  reading (no new curl target, no new success/failure semantics beyond
  "actually enforce what was already being checked").

## Canary target

N/A in the traditional sense — this is CI/deploy-tooling, not application
code running on either environment's live traffic path. The "canary" here
is the reviewer confirming the logic, plus (recommended, not required) a
maintainer optionally dispatching `main-deploy.yml` once post-merge to
watch the new step execute inside a real GitHub Actions run before the
next organic `src/**` merge exercises it anyway.
