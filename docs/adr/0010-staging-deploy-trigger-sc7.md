# ADR-0010 — `main-deploy.yml` Staging Trigger Reconciliation with T-98 SC7

- **Status:** Accepted (Production Manager author — deploy mechanics; Security
  Lead perspective on the monitor-correctness angle reasoned through inline
  below, then independently reviewed by a Security Lead pass mid-task — see
  the "Security Lead review" section — rather than dispatched as a full
  separate engagement).
- **Date:** 2026-07-13
- **Author:** Production Manager
- **Deciders:** Production Manager (trigger mechanics + SC7 re-review, this
  ADR); the joint review that scoped this (Tech Lead + Production Manager,
  DECISIONS.md 2026-07-13, PR #446) made the "widen the trigger, prefer an
  allowlist" call and left the SC7 re-review's option selection open,
  explicitly assigning it to this task; Security Lead (independent review,
  see below — corrected a load-bearing factual premise this ADR initially
  carried from the joint review).
- **Supersedes:** none. **Narrows the operating assumption of:** T-98's SC7
  ("ops-hub-staging stays STOPPED" — DECISIONS.md 2026-07-12 T-98 Security
  Lead design review) from an unqualified invariant to a stated steady-state
  with a named, bounded transient exception.
- **Related:** T-107 (the incident that surfaced this — a workflow-file-only
  merge silently started staging, DECISIONS.md 2026-07-13 /
  `docs/deploys/2026-07-13-t107-staging-litellm-url-repin.md`); the joint
  review (DECISIONS.md 2026-07-13, PR #446) that scoped decision (c) and left
  this ADR's decision space open; T-98 (`monitor-e2e-pipeline.yml` — **LIVE**,
  scheduled every 6 hours, see the correction note below — not dormant as the
  joint review's finding assumed); the 2026-06-18 CI/CD lock ("staging
  auto-deploy on merge to main via Coolify webhook, prod manual promotion
  only") that this reconciles against SC7 without reversing.
  Code: `.github/workflows/main-deploy.yml` (T-108's edit).

**CORRECTION, made before this ADR was finalized (not a later patch):** the
joint review that scoped T-108 (DECISIONS.md 2026-07-13, PR #446) and this
ADR's own first draft both stated the T-98 monitor is "DORMANT" pending
FQ-75/SC9 provisioning. **That premise is factually wrong and was checked,
not assumed, before this ADR was accepted:** `gh secret list` /
`gh variable list` confirm `E2E_MONITOR_DB_URL` (set 2026-07-12T19:05Z),
`E2E_MONITOR_INNGEST_KEY` (set 2026-07-12T21:14Z), and
`E2E_SENTINEL_TICKET_ID` (set 2026-07-12T21:23Z, value
`b91f7b21-bd9f-4a8c-b732-1663dc630d0b`) all exist; `gh run list
--workflow=monitor-e2e-pipeline.yml` shows the `cron: "0 */6 * * *"` schedule
firing and succeeding repeatedly through the same day this ADR was written
(latest at 2026-07-13T14:21:37Z). SC9 fully landed in Sprint 10 (WORK.md's
T-98 row: "FULLY RESOLVED, GO-LIVE COMPLETE," first genuine `mode=live` run
green same day) — it was never re-checked before Sprint 13's joint review
carried "dormant" forward as an assumption. **This changes the risk
calculus materially — see "Why (ii) is an immediate fast-follow, not a
future gate" below — but does not change the chosen option; see that
section for why.**

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
perspective on the monitor-correctness angle:** (i) restores the **steady
state** SC7 actually needs — staging stopped between deploys, which is
effectively all the time in a repo with many merges and no deploy-in-flight
at any given moment. It does **not** structurally close a narrower timing
race: while staging is transiently running during a deploy job (build + push
+ patch + start + deployment-poll + health-check + Inngest-sync —
realistically several minutes), its own Inngest cron sweeps (`sweepNewTickets`
and `sla-monitor` every 5 minutes, `sweepRespondedTickets` every 15) are live
like at any other time it's up. **The T-98 monitor is confirmed LIVE (see the
correction above), with a real permanent sentinel ticket reset to `new` and
re-dispatched every 6 hours** — so this is not a hypothetical future
interaction, it is a real, currently-active race: any deploy whose transient
window happens to overlap the sentinel sitting in an actionable state (`new`
right after a monitor reset, or `responded` for however long it takes prod's
own 15-min `sweepRespondedTickets` to auto-resolve it) could let staging's
*own*, independently-scheduled sweep touch the same row a second time — the
exact class of harm SC7 exists to prevent. **A monitor's safety property
should not rest on an assumption enforced by a different system's pipeline
behavior** — that is precisely the shape of gap T-107 exposed in the first
place, and re-creating a narrower version of the same shape (a monitor
invariant that depends on CI plumbing, not on the monitor's own guard) would
be a smaller instance of the same mistake. So: (i) is not a substitute for a
monitor-side check, it is the pipeline-side hygiene layer; the monitor-side
structural close (re-review option (ii) — the monitor itself asserts or
tolerates staging's live state) remains **necessary**, not merely
nice-to-have — and, now that the "dormant" premise is corrected, **overdue**,
not upcoming.

**Why (i) is still shipped now, given the corrected picture, rather than
holding this PR until (ii) also lands:** this PR is a strict improvement over
what is on `main` today on exactly the axis now in question. Today's
denylist starts staging on almost every non-doc merge and has **no stop
step at all** — so today's actual exposure is staging being started and left
running indefinitely (until someone notices), the worst-case form of the same
race, for as long as it takes anyone to catch it. (Confirmed empirically
while writing this ADR: `ops-hub-staging` **is running right now** — see the
Security Lead review section below; a prior merge, ironically the T-107
closeout PR's own conflict-resolution commit touching a workflow file,
re-tripped the still-unfixed old trigger.) This PR (a) starts staging on far
fewer merges (the allowlist) and (b) always stops it again (`if: always()`).
It shrinks the live exposure on the very axis this correction raises concern
about; holding it until a separate, properly-proven monitor change lands
would leave the *larger* version of the same exposure live for longer. (iii)
(`workflow_dispatch`-only, dropping staging auto-deploy) would eliminate the
race structurally and is a **materially closer call now** than the ADR's
original "dormant" framing suggested — logged honestly here rather than
retrofitted quietly — but (i) is still preferred: the bootable-image canary
is real (§ above) and the residual race closes soon via the fast-follow
below, not never.

**Why (ii) is a fast-follow implemented as its own PR, not folded into this
one:** editing `monitor-e2e-pipeline.yml` under this task's time pressure,
without the Sprint 10 §5.1 failure-path proof (the same `mode=simulate-failure`
dispatch discipline T-98's own BC1 fix used) would be exactly the kind of
rushed, unverified monitor change that norm exists to prevent — trading one
haste-shaped risk for another. (ii) deserves its own focused PR and its own
proof run(s); it is not deferred as low-priority, it is sequenced as
**immediate, next work**, named below as a binding, hard-owned follow-up
rather than left as ADR prose alone.

## Binding forward gate — OVERDUE, not future (corrected from the original draft)

**`monitor-e2e-pipeline.yml` needs a staging-stopped precondition/guard NOW**
— either (a) the monitor checks Coolify's application status for
ops-hub-staging and skips/aborts if it is currently running, or (b) the
monitor's sentinel query is scoped so a transiently-running staging
structurally cannot double-grab it (e.g. a run-token / lease column the
monitor and staging's own sweeps both honor). This was originally drafted as
"a hard precondition on SC9 go-live" — that framing is retired because SC9
already landed in Sprint 10; the trigger for this gate has already fired.
**Filed as an immediate fast-follow task** (see WORK.md's carries list),
required to itself pass the Sprint 10 §5.1 failure-path proof (a
`mode=simulate-failure`-style dispatch proving the new guard actually blocks,
the same discipline T-98's own BC1 fix used) before it is trusted. Until it
lands, the residual race described above is real but bounded: RLS is
fail-closed and the synthetic tenant is structurally isolated from every prod
tenant, so the worst credible outcome is synthetic-tenant LLM spend,
duplicate staging-FreeScout notes, or monitor flakiness — not a customer or
security-boundary incident (the same boundary reasoning the Sprint 10 T-98
design review and the Sprint 13 joint review both already established for
this tenant).

## Consequences

- **Positive:** the T-107 incident class (non-doc merges silently starting
  staging) is closed by the allowlist. The steady state matches SC7's stated
  default (stopped) again, and — unlike today's un-patched pipeline — every
  qualifying deploy now self-corrects back to stopped even on failure. The
  bootable-image canary pr-checks lacks is preserved. The residual timing
  race is named, bounded (RLS-isolated synthetic tenant, no customer/security
  boundary crossing), and has a binding, owned, immediate fast-follow rather
  than an unowned assumption or a future milestone dependency.
- **Negative / cost:** every qualifying deploy now does one extra Coolify API
  call (`POST /stop`) and a few seconds of added job time; negligible.
  Staging is briefly, deliberately running during each qualifying deploy —
  by design, to prove the image boots — which is the accepted trade for
  keeping the canary. Concretely, this means every qualifying deploy briefly
  boots staging and its live Inngest cron sweeps get one real chance to fire
  during that window, generating whatever telemetry/LangFuse traces a normal
  staging tick would, **and** (corrected from the original draft) the T-98
  monitor's sentinel ticket is a real, live target for that window today, not
  a hypothetical future one — see the fast-follow gate above. Staging's own
  `freescout-poller.ts` (default `POLLING_TENANT_ID` = the same synthetic
  tenant) can also independently mint new synthetic-tenant tickets from
  staging FreeScout conversations while staging is transiently up — cost/
  noise only, no customer reach, and not new behavior this ADR introduces
  (true any time staging is up, by design since T-98).
- **Failure mode covered:** a failed build/health-check no longer leaves
  staging running (`if: always()` on the stop step) — the stop step is keyed
  off the job-level constant `$OPS_HUB_STAGING_UUID`, not the "Patch and
  deploy" step's output, specifically so it still runs even if that step
  fails *after* issuing the START call but *before* recording its output
  (e.g. the START curl itself times out under `set -euo pipefail`) — an
  output-keyed stop would silently skip in exactly that case, leaving
  staging running. Stopping an app that was never started (or is already
  stopped) is a harmless no-op, so keying off the always-available constant
  is strictly safer than keying off a conditional output.
- **Failure mode NOT covered by this ADR alone:** a `POST /stop` call itself
  failing (network blip, Coolify API error) leaves staging running with no
  automatic retry — the workflow step exits non-zero in that case (a visible
  CI failure, not a silent one), which is the acceptable fallback: a red
  pipeline is a much stronger signal than the silent, invisible violation
  T-107 surfaced. No auto-retry loop was added — treating a stop failure as
  a visible, must-look-at-it CI failure is preferred over papering over it
  with more automation.

## Security Lead review (independent, mid-task — not a rubber stamp)

A Security Lead pass (fable) was run against the PR diff and this ADR's
draft, focused on the monitor-correctness angle. Findings, all incorporated
above rather than left as unaddressed review comments:

1. **The "dormant" premise was wrong** — traced independently against
   `provision-e2e-sentinel-ticket.yml` and `ticket-triage.ts`'s
   `sweepNewTickets` query, then confirmed empirically (`gh secret list`,
   `gh variable list`, `gh run list --workflow=monitor-e2e-pipeline.yml`).
   This is the correction reflected throughout this ADR.
2. **The binding gate was anchored to the wrong event.** The original draft
   bound (ii) to "before SC9 provisioning" — SC9 already happened. Rebound to
   an immediate fast-follow (above), not a future milestone.
3. **A secondary population source exists.** Staging's own
   `freescout-poller.ts` can independently mint synthetic-tenant tickets
   while staging is transiently up — added to Consequences above. Cost/
   noise only, not a new hole this ADR creates.
4. **Verdict: approve with the above incorporated.** The core call — (i) now,
   (ii) as an owned fast-follow rather than built under time pressure — was
   endorsed as correct once anchored to the right facts.

**Separately, while verifying the review's findings:** a read-only status
check (`t107-check-staging-status.yml`, run 29267618042, 2026-07-13T16:44Z)
confirmed **`ops-hub-staging` is running right now**, independent of this PR
(which is not merged). This is almost certainly the *old*, still-unfixed
`main-deploy.yml` firing again on a later merge that touched a workflow file
(`main-deploy.yml`'s own run history shows a "Deploy to Staging" run against
the T-107 closeout commit at 2026-07-13T15:20:27Z) — i.e. a second, live
recurrence of the exact T-107 incident class, on `main` right now, that this
PR has not yet fixed because it isn't merged. **Not stopped unilaterally
here** — per the Sprint 13 §5.1 teaching moment (T-107's own incident was a
self-authorized stop action), this is reported to the user as a live,
separate finding requiring their own decision, not resolved by this task's
own initiative. See DECISIONS.md and the final report for the explicit ask.

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
