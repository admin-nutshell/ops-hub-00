#!/usr/bin/env bash
# t98-gate.sh — T-124 (Sprint 22, Phase 2 Track C)
#
# Wires the T-98 synthetic-ticket downstream E2E monitor (live since FQ-75,
# .github/workflows/monitor-e2e-pipeline.yml) into the production promotion
# path. T-98 has ALWAYS alerted (opens a status-page incident on N=2
# consecutive real failures, T-113) but until this script existed, nothing
# outside that monitor's own paging channel ever CHECKED its signal before a
# prompt/capability change went live — a human had to remember to go look.
# AUTONOMY.md names exactly this wiring as the missing Phase-2 half of the
# `production-promotion-new-change` / `prompt-or-capability-change` autonomy
# unlock conditions (Phase 1's half, the durable audit trail, is G6/PR #512,
# already merged).
#
# REUSES, DOES NOT REBUILD, T-98: this script never touches the monitor
# itself (no new dispatch, no new credential). It only reads T-98's own
# already-recorded run history via the GitHub Actions API (`gh run list` /
# `gh run view`), the exact same read-only technique T-98's own T-113
# consecutive-fail-streak step already uses against its own history.
#
# ── THE STALENESS PROBLEM (found live while building this, not hypothetical) ──
# T-98's `staging_guard` step (T-111/SC7) cleanly SKIPS the real downstream
# check whenever ops-hub-staging is caught running (its crons share T-98's
# synthetic tenant and would double-process the sentinel ticket). A clean
# skip still reports the Actions run's own conclusion as `success` — so
# `gh run list`'s conclusion field ALONE cannot tell "the pipeline was
# checked and is healthy" apart from "the pipeline was not checked at all
# this cycle." Verified against real history at build time (2026-07-16): the
# 16 most recent completed `event=schedule` runs of monitor-e2e-pipeline.yml
# all report `conclusion=success`, but 13 of them are clean `staging_guard`
# skips — the most recent run that actually exercised reset/dispatch/poll/
# LangFuse was ~74 HOURS earlier (ops-hub-staging apparently left running
# through this same day's heavy deploy activity). A gate that trusted
# `conclusion=success` blindly would have waved through a promotion on top
# of THREE DAYS of unverified downstream-pipeline coverage — exactly the
# "green health signal while the real path is broken" failure class T-98
# exists to catch (T-71/FQ-69/FQ-70), just one level up the stack. See
# DECISIONS.md 2026-07-16 "T-124" for the full evidence trail.
#
# THIS SCRIPT THEREFORE DOES TWO THINGS, NOT ONE:
#   1. Walks backwards through recent `event=schedule` runs (schedule events
#      never carry workflow_dispatch inputs, so MODE always resolves to
#      'live' on cron per the monitor's own header — no separate mode lookup
#      needed) until it finds the most recent one that took a REAL reading
#      (its "Guard — required credentials..." step ran, i.e. was not itself
#      skipped by staging_guard or credentials-missing).
#   2. Gates on BOTH that real check's own result (pass/fail) AND its AGE
#      against T98_MAX_STALENESS_HOURS. Either an unhealthy real result or a
#      stale one fails this gate loudly.
#
# workflow_dispatch runs on monitor-e2e-pipeline.yml are deliberately
# EXCLUDED from consideration: that file's own header reserves
# workflow_dispatch for mode=simulate-failure / mode=simulate-staging-running
# verification-only dispatches, which must never be mistaken for a real
# production signal.
#
# WHY 24h, NOT SOMETHING ELSE (documented, not defaulted into — same
# discipline T-113 used for its own FAIL_THRESHOLD/STREAK_LOOKBACK_HOURS
# calibration): T-98 runs every 6h (4 cycles/day). A single benign skip
# (staging transiently up mid a legitimate main-deploy.yml start-then-stop
# window) is expected and self-heals within one cycle — this gate must not
# block every prod promotion over one ordinary blip. 24h absorbs up to four
# consecutive benign skips (a full day of staging left up for active dev
# work, exactly what the live evidence above shows happened) while still
# catching a genuine multi-day blind spot before a prompt/capability change
# ships on top of it. This is deliberately STRICTER than T-98's own internal
# FAIL_THRESHOLD=2/STREAK_LOOKBACK_HOURS=10 (which gates a CUSTOMER-FACING
# page and is tuned to avoid crying wolf on a single transient HTTP/DB
# blip) — this gate protects a PRODUCTION PROMOTION, a much higher-stakes,
# much lower-frequency action, where erring toward "block and make a human
# look" costs far less than erring toward "promote blind."
#
# HARD-BLOCK, NOT FLAG-ONLY (the "flag vs. block" fork this task's own
# instructions named as a real design choice): both an unhealthy real
# result AND a stale one fail this script with a non-zero exit, the same
# posture as T-123's deploy-health-gate.sh (fail loud, no auto-rollback, a
# human decides the next step) and consistent with PRODUCTION.md's own
# standing quality bar ("zero deploys without X... no exceptions, no matter
# how small the change"). A flag-only mode would be trivial to add
# (downgrade `exit 1` to a `::warning::` + `exit 0`) but would mean this
# gate could be silently ignored exactly the way T-98's OWN alert-only
# signal was silently ignorable before this task existed — which is the
# precise gap Track C exists to close. The remediation this script's own
# error message points to (stop ops-hub-staging, then either wait for the
# next 6h cycle or manually dispatch monitor-e2e-pipeline.yml with mode=live
# for a fresh real reading) is a normal, well-understood operational action,
# not a dead end.
#
# APPLIES TO EVERY PROD PROMOTION, NOT JUST PROMPT/CAPABILITY ONES (the
# second named design fork): prod-deploy.yml is a single manual,
# human-triggered workflow_dispatch with no existing "what kind of change is
# this" input, and there is no reliable way to infer "is this specific
# promotion a prompt/capability change" from the workflow's own inputs
# (image_tag is just a SHA/tag) without adding new plumbing whose only
# purpose would be to let a human self-tag their way around the gate.
# Gating unconditionally is the simpler, harder-to-route-around choice, and
# T-98's own signal ("is the real ticket pipeline healthy") is relevant
# context for ANY prod promotion, not only prompt-touching ones — the same
# reasoning T-123 already applied when it gated ALL prod promotions on
# /health/env + /health/litellm-internal rather than trying to scope itself
# to "risky" deploys only.
#
# Usage:
#   t98-gate.sh
#
# Requires: gh CLI (authenticated via GH_TOKEN in CI), jq. Reads
# monitor-e2e-pipeline.yml's own run history in this repo — mutates nothing.
#
# Env overrides (all optional):
#   T98_WORKFLOW              default: monitor-e2e-pipeline.yml
#   T98_MAX_STALENESS_HOURS   default: 24
#   T98_LOOKBACK_RUNS         default: 20   (total runs fetched before
#                                            filtering to event=schedule;
#                                            generous enough to survive a
#                                            multi-day staging-guard skip
#                                            streak like the one found live)
#   T98_REPO                  default: $GITHUB_REPOSITORY, else `gh repo view`

set -euo pipefail

WORKFLOW="${T98_WORKFLOW:-monitor-e2e-pipeline.yml}"
MAX_STALENESS_HOURS="${T98_MAX_STALENESS_HOURS:-24}"
LOOKBACK_RUNS="${T98_LOOKBACK_RUNS:-20}"
REPO="${T98_REPO:-${GITHUB_REPOSITORY:-}}"

if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

echo "T-98 deploy gate: checking $WORKFLOW's most recent REAL (non-skip) schedule-triggered result in $REPO..."
echo "(staleness threshold: ${MAX_STALENESS_HOURS}h; lookback: last $LOOKBACK_RUNS runs)"

RUNS_JSON=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" \
  --json databaseId,conclusion,status,createdAt,event --limit "$LOOKBACK_RUNS")

# Only completed event=schedule runs are ever a candidate real signal — see
# header for why workflow_dispatch runs on this workflow are excluded.
SCHEDULE_RUNS=$(echo "$RUNS_JSON" | jq '[.[] | select(.event == "schedule" and .status == "completed")] | sort_by(.createdAt) | reverse')
COUNT=$(echo "$SCHEDULE_RUNS" | jq 'length')

if [ "$COUNT" -eq 0 ]; then
  echo "::error::T-98 gate FAILED: no completed schedule-triggered runs of $WORKFLOW found in the last $LOOKBACK_RUNS runs. Cannot confirm the downstream ticket pipeline is healthy — refusing to treat unverified as a pass."
  exit 1
fi

NOW_EPOCH=$(date -u +%s)

for i in $(seq 0 $((COUNT - 1))); do
  RUN_ID=$(echo "$SCHEDULE_RUNS" | jq -r ".[$i].databaseId")
  CREATED_AT=$(echo "$SCHEDULE_RUNS" | jq -r ".[$i].createdAt")
  CONCLUSION=$(echo "$SCHEDULE_RUNS" | jq -r ".[$i].conclusion")

  # Substring match on the RESET step's name (id: reset in
  # monitor-e2e-pipeline.yml), NOT the credentials-guard step — deliberately
  # not exact equality, resilient to minor wording edits over time.
  #
  # Fixed 2026-07-16 per independent Tech Lead review: an earlier version of
  # this script keyed on the "Guard — required credentials + sentinel ticket
  # id all present" step instead. That step is the WRONG discriminator — it
  # also runs and exits 0 (success) in the DORMANT path (missing creds/
  # sentinel; monitor-e2e-pipeline.yml lines ~440-447), which is exactly the
  # same "no real check taken" case a clean staging_guard skip is. Keying on
  # it would have made a dormant monitor look identical to a real pass — the
  # exact false-pass class this gate exists to prevent, one level up.
  #
  # `reset` (monitor-e2e-pipeline.yml, gated on `steps.guard.outputs.ready ==
  # 'true'`) is the correct discriminator: it only runs when the guard step
  # found real credentials AND a real sentinel ticket id present, i.e. only
  # when a genuine downstream check was actually attempted this cycle. It is
  # NOT keyed on `langfuse` or any later step — those are gated on upstream
  # step outcomes too (e.g. `poll.outcome == 'success'`), so a genuinely
  # FAILED real check would itself skip them, which would make a broken
  # cycle look like "no real check taken" and walk the gate past a real
  # failure to an older, stale pass — strictly worse than the bug being
  # fixed here.
  REAL_CHECK_CONCLUSION=$(gh run view "$RUN_ID" --repo "$REPO" --json jobs \
    --jq '[.jobs[0].steps[] | select(.name | contains("Reset sentinel ticket"))][0].conclusion // empty' \
    2>/dev/null || echo "")

  if [ "$REAL_CHECK_CONCLUSION" = "skipped" ] || [ -z "$REAL_CHECK_CONCLUSION" ]; then
    echo "run $RUN_ID ($CREATED_AT): no real check taken this cycle (reset step skipped — staging running, monitor dormant, or run unreadable) — not a valid signal, checking further back."
    continue
  fi

  echo "run $RUN_ID ($CREATED_AT): REAL check found — job conclusion=$CONCLUSION."

  CREATED_EPOCH=$(date -u -d "$CREATED_AT" +%s)
  AGE_HOURS=$(( (NOW_EPOCH - CREATED_EPOCH) / 3600 ))
  echo "Most recent real check age: ${AGE_HOURS}h (threshold ${MAX_STALENESS_HOURS}h)."

  if [ "$CONCLUSION" != "success" ]; then
    echo "::error::T-98 gate FAILED: the most recent REAL downstream-pipeline check (run $RUN_ID, $CREATED_AT) reports conclusion=$CONCLUSION. The synthetic-ticket monitor confirms the production ticket pipeline is NOT healthy — refusing to promote a change on top of a known-broken pipeline. Inspect https://github.com/$REPO/actions/runs/$RUN_ID before retrying. This is exactly the failure class T-98 exists to catch (T-71/FQ-69/FQ-70)."
    exit 1
  fi

  if [ "$AGE_HOURS" -gt "$MAX_STALENESS_HOURS" ]; then
    echo "::error::T-98 gate FAILED: the most recent REAL downstream-pipeline check passed, but it is ${AGE_HOURS}h old (threshold ${MAX_STALENESS_HOURS}h). T-98 runs every 6h; a gap this large usually means ops-hub-staging has been left RUNNING (its own SC7 guard silently skips real checks while staging is up — see monitor-e2e-pipeline.yml). Stop ops-hub-staging, then either wait for the next scheduled cycle or manually dispatch $WORKFLOW (mode=live) for a fresh reading before promoting."
    exit 1
  fi

  echo "T-98 gate PASSED: most recent real check (run $RUN_ID) is ${AGE_HOURS}h old (<= ${MAX_STALENESS_HOURS}h) and confirms the downstream pipeline healthy."
  exit 0
done

echo "::error::T-98 gate FAILED: scanned the $COUNT most recent completed schedule-triggered runs of $WORKFLOW and found NO real (non-skip) check in any of them — every cycle in the lookback window was a clean skip (ops-hub-staging apparently left running throughout). Cannot confirm the downstream pipeline is healthy. Stop ops-hub-staging and dispatch $WORKFLOW manually (mode=live) for a fresh reading before promoting, or widen T98_LOOKBACK_RUNS if this window is genuinely too short."
exit 1
