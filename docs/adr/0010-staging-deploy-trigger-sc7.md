# ADR-0010 — `main-deploy.yml` Staging Trigger Reconciliation with T-98 SC7

- **Status:** Accepted (Production Manager author — deploy mechanics; Security
  Lead perspective on the monitor-correctness angle reasoned through inline
  below per the joint review's own recommendation, not dispatched as a
  separate review — the change is non-customer-facing infra with a dormant
  downstream monitor, so a full separate Security Lead engagement was judged
  not warranted for this specific call; escalate to a real dispatch if SC9
  provisioning surfaces anything this reasoning didn't anticipate).
- **Date:** 2026-07-13
- **Author:** Production Manager
- **Deciders:** Production Manager (trigger mechanics + SC7 re-review, this
  ADR); the joint review that scoped this (Tech Lead + Production Manager,
  DECISIONS.md 2026-07-13, PR #446) made the "widen the trigger, prefer an
  allowlist" call and left the SC7 re-review's option selection open,
  explicitly assigning it to this task.
- **Supersedes:** none. **Narrows the operating assumption of:** T-98's SC7
  ("ops-hub-staging stays STOPPED" — DECISIONS.md 2026-07-12 T-98 Security
  Lead design review) from an unqualified invariant to a stated steady-state
  with a named, bounded transient exception.
- **Related:** T-107 (the incident that surfaced this — a workflow-file-only
  merge silently started staging, DECISIONS.md 2026-07-13 /
  `docs/deploys/2026-07-13-t107-staging-litellm-url-repin.md`); the joint
  review (DECISIONS.md 2026-07-13, PR #446) that scoped decision (c) and left
  this ADR's decision space open; T-98 (`monitor-e2e-pipeline.yml`, currently
  DORMANT pending FQ-75/SC9 secret + sentinel provisioning); the 2026-06-18
  CI/CD lock ("staging auto-deploy on merge to main via Coolify webhook, prod
  manual promotion only") that this reconciles against SC7 without reversing.
  Code: `.github/workflows/main-deploy.yml` (T-108's edit).

---

## Context

`main-deploy.yml` auto-deploys ops-hub-staging on every push to `main`. This
was a correct, deliberate 2026-06-18 CI/CD decision. T-98 (Sprint 10) later
built a synthetic-ticket E2E monitor whose safety design depends on a NAMED
operating assumption, SC7: staging stays stopped, so its home-scope synthetic
tenant (`00000000-0000-0000-0000-000000000010`) is structurally inert between
monitor runs. These two decisions were never held against each other. The gap
first fired for real during T-107: a workflow-file-only PR (#444) tripped
`main-deploy.yml`'s trigger (a `paths-ignore` denylist that omitted
`.github/workflows/**`), silently starting staging — an accidental SC7
violation caused by CI trigger design, not by any deliberate action. A joint
Tech Lead + Production Manager review (DECISIONS.md 2026-07-13) confirmed the
finding, scoped it staging-only (prod-deploy.yml is `workflow_dispatch`-only;
the other two `push:main` workflows are stateless w.r.t. the app), and decided
on combination (c): **(1)** widen the trigger (this ADR converts the denylist
to an allowlist — see the `main-deploy.yml` header comment for the exact path
set and rationale) **plus (2)** a mandatory SC7 re-review, left open for this
task because widening the trigger alone cannot stop a genuine `src/**` merge
from still needing to build+boot the app.

This ADR is the record of part (2)'s decision.

## Decision

**Chosen: Option (i) — start-then-stop in the pipeline**, implemented in
`main-deploy.yml` as a final `if: always()` step that `POST /stop`s
ops-hub-staging after the existing build → patch → deploy-status-poll →
health-check → Inngest-sync sequence, regardless of whether those steps
succeeded.

**Why (i) over (iii) (workflow_dispatch-only staging):** `pr-checks.yml` (the
required PR gate) runs lint, typecheck, unit tests, and the eval-schema check
— it contains **no `docker build` step**. `main-deploy.yml`'s
build-image → boot → `/health` check is therefore the *only* place in this
repo's CI that proves a merge to `main` produces a bootable, healthy image —
a real, non-redundant canary, not incidental scaffolding. Dropping staging
auto-deploy entirely (iii) would remove that canary outright; a broken
multi-stage Docker build (e.g. a `tsc` failure that only manifests under
`tsconfig.build.json`, a missing runtime dependency not caught by unit tests)
could then sit undetected across an arbitrary number of merges until someone
happens to trigger a manual staging deploy. (iii) is the simplest fix and
remains the right call if this canary is ever judged not worth the
complexity — it is not, today: build-breaks-undetected is a real, recurring
category of incident this repo has hit before (T-54, FQ-70-adjacent
incidents), and the canary is cheap to keep.

**Why (i) over (ii) alone, and why (ii) is not abandoned — Security Lead
perspective on the monitor-correctness angle (reasoned through here, not
separately dispatched):** (i) restores the **steady state** SC7 actually
needs — staging stopped between deploys, which is effectively all the time in
a repo with many merges and no deploy-in-flight at any given moment. It does
**not** structurally close a narrower timing race: while staging is
transiently running during a deploy job (build + push + patch + start +
deployment-poll + health-check + Inngest-sync — realistically several
minutes), its own Inngest cron sweeps (`sweepNewTickets` and `sla-monitor`
every 5 minutes, `sweepRespondedTickets` every 15) are live like at any other
time it's up. If the T-98 monitor were live and had a synthetic ticket
in-flight, a deploy's transient window could in principle overlap one of
those sweeps and let staging's own crons touch the monitor's sentinel ticket
— the exact class of harm SC7 exists to prevent, just probabilistic instead
of guaranteed. **A monitor's safety property should not rest on an assumption
enforced by a different system's pipeline behavior** — that is precisely the
shape of gap T-107 exposed in the first place, and re-creating a narrower
version of the same shape (a monitor invariant that depends on CI plumbing,
not on the monitor's own guard) would be a smaller instance of the same
mistake. So: (i) is not a substitute for a monitor-side check, it is the
pipeline-side hygiene layer; the monitor-side structural close (re-review
option (ii) — the monitor itself asserts or tolerates staging's live state)
remains **necessary**, not merely nice-to-have.

**Why (ii) is deferred rather than built now:** the T-98 monitor
(`monitor-e2e-pipeline.yml`) is DORMANT today — it guards on
`E2E_MONITOR_DB_URL` / `E2E_SENTINEL_TICKET_ID` and exits clean because FQ-75
/ SC9 (secret + sentinel-ticket provisioning) have not landed. No sentinel
ticket exists, so there is currently nothing for a transient staging window
to catch — (i) alone is fully sufficient *today*. Editing live monitor logic
now, before it is provisioned, would buy zero present safety and would still
trigger the Sprint 10 §5.1 norm ("any monitor/alerting workflow change is
proven on its FAILURE path before going live") for a change with no
observable failure mode yet to test against — pure process overhead with no
offsetting benefit. Building (ii) now would also be working ahead of a task
(SC9 provisioning) that isn't scheduled, risking drift between the guard code
and whatever the eventual sentinel schema/query actually looks like.

## Binding forward gate

**SC9 provisioning (the FQ-75 work that brings the T-98 monitor live) MUST
add a staging-stopped precondition/guard to `monitor-e2e-pipeline.yml` before
that monitor is trusted in production** — either (a) the monitor checks
Coolify's application status for ops-hub-staging and skips/aborts if it is
currently running, or (b) the monitor's sentinel query is scoped so a
transiently-running staging structurally cannot double-grab it (e.g. a
run-token / lease column the monitor and staging's own sweeps both honor).
This is not a soft "someone should probably" — it is a hard precondition on
SC9 go-live, cross-referenced here and in WORK.md's T-98 monitor-livecheck
tracking, and it will itself require the Sprint 10 §5.1 failure-path proof
before that monitor is trusted. Until SC9 lands, (i) alone is the complete,
correct reconciliation — there is no live monitor for the residual race to
affect.

## Consequences

- **Positive:** the T-107 incident class (non-doc merges silently starting
  staging) is closed by the allowlist. The steady state matches SC7's stated
  default (stopped) again. The bootable-image canary pr-checks lacks is
  preserved. The residual timing race is named, bounded (harmless while the
  monitor is dormant), and has a binding, citable close condition tied to a
  specific future milestone (SC9) rather than left as an unowned assumption.
- **Negative / cost:** every qualifying deploy now does one extra Coolify API
  call (`POST /stop`) and a few seconds of added job time; negligible.
  Staging is briefly, deliberately running during each qualifying deploy —
  by design, to prove the image boots — which is the accepted trade for
  keeping the canary. Concretely, this means every qualifying deploy briefly
  boots staging and its live Inngest cron sweeps get one real chance to fire
  during that window, generating whatever telemetry/LangFuse traces a normal
  staging tick would — today near-silent (no sentinel ticket exists in an
  actionable state for them to act on; the T-98 monitor is dormant), and
  covered going forward by the (ii)@SC9 binding gate below once the monitor
  is live.
- **Failure mode covered:** a failed build/health-check no longer leaves
  staging running (`if: always()` on the stop step) — verified by dry-run
  reasoning against the job's step ordering; every code path that reaches
  "patch/start ran and recorded `app_uuid`" reaches the stop step regardless
  of what happens afterward.
- **Failure mode NOT covered by this ADR alone:** a `POST /stop` call itself
  failing (network blip, Coolify API error) leaves staging running with no
  automatic retry — the workflow step exits non-zero in that case (a visible
  CI failure, not a silent one), which is the acceptable fallback: a red
  pipeline is a much stronger signal than the silent, invisible violation
  T-107 surfaced. No auto-retry loop was added — treating a stop failure as
  a visible, must-look-at-it CI failure is preferred over papering over it
  with more automation.

## Verification (dry-run reasoning, no live merge performed)

- A workflow-file-only change (the T-107 shape: edits under
  `.github/workflows/**` and nothing else) matches none of the new `paths`
  allowlist entries → GitHub Actions does not even queue the `deploy` job.
  This is the exact incident case; it is now inert.
- `paths` is OR-matched against the full commit's changed-file list: a merge
  touching both a workflow file *and* `src/**` still deploys — correct, since
  product code changed.
- A docs-only or DECISIONS.md/WORK.md-only merge (the previous denylist's
  intended safe case) still does not deploy — no regression there.
- `main-deploy.yml` triggers on `push` to `main`, not on `pull_request` — it
  has no interaction with required PR status checks or branch protection;
  this ADR's dry-run reasoning is sufficient without a live merge.
