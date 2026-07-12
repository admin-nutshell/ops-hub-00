# Deploy record — LiteLLM internal-auth monitor: consecutive-fail threshold (T-102)

**Status:** DONE. Code merged to `main` (PR #422, `15c02be`), a follow-up
docs-only PR recorded status (#424, `d2fa91e`), and a small typo fix (the
ordinal in the paging error message) is folded into this record's follow-up
commit. Full failure-path proof executed live, pre-merge, on the feature
branch, per the Sprint 10 §5.1 hard gate. Written retrospectively, after the
fact — same posture as T-97's record (this task's exit criteria require live
proof, so verification happened inline as part of getting to "done").

**Risk class:** Low. Pure workflow-YAML change to one existing scheduled
monitor (`monitor-litellm-internal-auth.yml`). No application code, route,
schema, or env var touched. No new secret, repo variable, or state file. No
change to the probe URL, the probed endpoint, or the recovery/resolve path —
only an added gate in front of the existing incident-open call.

---

## What changed

1. **`.github/workflows/monitor-litellm-internal-auth.yml`** — added a
   `FAIL_THRESHOLD: "3"` env var and a new "Determine consecutive-fail
   streak" step that runs a read-only `gh run list` lookback whenever the
   probe fails. The existing "On failure" step (open incident) is now
   additionally gated on `steps.streak.outputs.threshold_met == 'true'`; a
   new "On failure (sub-threshold)" step handles the self-clearing case
   (still `exit 1` so the run's own conclusion accurately reflects the probe
   result, preserving the pre-existing GitHub failed-run-email backstop, but
   without paging). The "On success — resolve" step is unchanged.
2. No application code touched. No new secret/permission — reuses the job's
   existing `actions: write` permission + `GH_TOKEN`.

## Why this exists

FQ-76 follow-up #2 (`docs/retros/sprint-10.md` §4.2/§7): the monitor paged
on a single failed poll, so the 07-10/07-11 self-healing hiccups churned
open/resolve noise on every transient blip — the exact noise that made
FQ-76's real 3-day sustained break harder to read at a glance. N=3 chosen
over N=2: at this monitor's 15-minute cron cadence, 3 consecutive fails
(T+0/T+15/T+30) opens the incident at T+30 — inside the task's ~30-45 minute
SLA, whereas N=2 (T+15) would undershoot it.

## Full exit-criteria proof (Sprint 10 §5.1 hard gate — proven on the
## FAILURE path via real dispatches, not YAML review)

Four real `workflow_dispatch` runs on branch
`t102-litellm-monitor-fail-threshold` (via `--ref`, pre-merge), each awaited
to `completed` (`gh run watch --exit-status`) before the next was fired:

1. **Run A** (`mode=simulate-failure`) — run `29210699251`, conclusion
   `failure`. Streak step: 0 prior same-event completed runs in the 2h
   window → `threshold_met=false` → "Sub-threshold: only 1/3" → no incident
   opened. Confirmed by positive evidence: `gh run list --workflow
   status-incident.yml` shows no dispatch at this timestamp.
2. **Run B** (`mode=simulate-failure`) — run `29210726416`, conclusion
   `failure`. Streak step: Run A counted as 1 prior failure →
   `threshold_met=false` → "Sub-threshold: only 2/3" → no incident opened
   (same check, clean). **Proves (a):** N-1=2 consecutive fails do not page.
3. **Run C** (`mode=simulate-failure`) — run `29210741763`, conclusion
   `failure`. Streak step: Runs A+B counted as 2 prior failures →
   `threshold_met=true` → "Streak confirmed: this is consecutive failure #3"
   → incident **opened**: `status-incident.yml` run `29210745813` →
   `status-content` commit `77b21c7`
   (`status/content/2026-07-12-litellm-internal-auth-probe-failing-on-ops-hub-pro.md`,
   `resolved: false`). **Proves (b):** the Nth (3rd) consecutive fail DOES
   open a real incident.
4. Confirmed real prod healthy first (`curl
   https://ops-hub-prod.inatechshell.ca/health/litellm-internal` → `200`)
   before firing the recovery run — avoiding the failure mode where a
   workflow_dispatch recovery attempt during a genuine live break would open
   a *second* incident instead of resolving the first (`status-incident.yml`
   resolves the most-recent-open file, not by title match).
5. **Run D** (`mode=live`) — run `29210773889`, conclusion `success` (real
   prod probe). "On success — resolve" fired → `status-content` commit
   `6077e4e` flips the same file to `resolved: true`, `resolvedWhen:
   2026-07-12T22:03:10Z`. **Proves (c):** a subsequent recovery
   auto-resolves it.
6. **(d) No spurious side-effects:** scanned the full `status-content`
   branch after Run D — zero files with `resolved: false` remained.

**Post-merge smoke test on `main`'s actual copy** (not just the branch):
dispatched `monitor-litellm-internal-auth.yml --ref main -f mode=live` —
run `29211161378`, conclusion `success`
(`https://ops-hub-prod.inatechshell.ca/health/litellm-internal` → `200`).
Confirms the merged code path executes cleanly against real prod and starts
this change's monitoring window.

## CI

PR #422: Eval Gate, Lint & Type Check, Security Scan, Unit Tests, CodeRabbit,
and `live-eval-gate` all green. `live-eval-gate` neutral-skipped in ~6s as
expected (only `.github/workflows/monitor-litellm-internal-auth.yml`
touched — no prompt surface).

## Rollback path (defined before dispatch, per team quality bar)

- **Feature-flag-equivalent:** none needed — the change is additive gating
  logic, not a behavior swap. If the threshold ever misbehaves (e.g. the
  `gh run list` lookback returns unexpected results), `git revert 15c02be`
  restores single-fail paging immediately; takes effect on the very next
  scheduled run (≤ 15 minutes), no redeploy of the app itself required since
  nothing outside this one workflow file changed.
- **Mean rollback time target < 15 minutes:** met — a revert PR merges in
  the time CI takes to go green (~2 minutes per this PR's own run), and the
  next cron tick picks up the reverted YAML automatically.
- **Blast radius if this change misbehaves:** worst case is either (i) a
  real sustained break takes up to ~30 minutes longer to page than the old
  single-fail behavior (bounded, still within the task's stated SLA), or
  (ii) the streak lookback itself errors and the "Determine consecutive-fail
  streak" step fails — which would surface as a workflow run failure
  (visible in Actions + the failed-run email backstop) rather than a silent
  miss, so it fails loud, not quiet.

## Canary / monitoring window

No staged rollout needed (this is a CI/ops workflow, not an app deploy) —
the four dispatched proof runs plus the post-merge `mode=live` smoke test
are themselves the canary. Ongoing monitoring is the existing 15-minute
schedule this task modifies, now running the new threshold logic live.
Standard 24-72h passive watch: confirm no unexpected incident opens/silences
on the real schedule over the next few days (first real opportunity to see
N=3 fire on genuine, not simulated, failures).

## Not done / flagged, not decided

`monitor-e2e-pipeline.yml` (T-98) runs 6-hourly. Mechanically copying this
threshold there would push detection to 12-18+ hours, working against why
T-98 exists. Left untouched — flagged in PR #422's body and WORK.md's T-102
row as a separate, undecided carry for a future task.

## Feature Adaptation / Knowledge Lead handoff

Not triggered. PRODUCTION.md's "trigger Feature Adaptation on every prod
deploy" handoff is scoped to application/product deploys (new or changed
end-user-facing behavior); this is an internal CI/ops-alerting threshold
change with no product surface, matching how T-97's own monitor-threshold
work was NOT logged as a Feature Adaptation trigger either. No KB article or
runbook content changes as a result of this task.

## What's left

- Nothing blocking. The `*/15 * * * *` schedule now runs the threshold logic
  unattended going forward.
- Passive watch: confirm the threshold fires correctly on the next genuine
  (non-simulated) sustained failure, whenever that next occurs.
