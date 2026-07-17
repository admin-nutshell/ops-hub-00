#!/usr/bin/env bash
# deploy-health-gate.sh — T-123 (Sprint 22, Phase 2 Track B)
#
# The real post-deploy health gate named in AUTONOMY.md's `redeploy-already-
# authorized` unlock condition ("Coolify duplicate-env-row guard + real
# deploy-health gate (Phase 2)").
#
# Before this task, "health verification" after a Coolify redeploy was a
# MANUAL runbook step (curl /health, eyeball a dashboard). The existing
# automated check in main-deploy.yml/prod-deploy.yml only polls the shallow
# `/health` route, which returns 200 as soon as the Node process is up —
# it cannot detect a deploy that boots fine but is actually broken (missing
# env vars, a rejected LiteLLM key). Both of those ARE real incidents this
# project has already had:
#   - T-47: 9 required env vars silently vanished from ops-hub-prod's
#     Coolify config; nothing caught it until a human happened to run a
#     live test two days later.
#   - FQ-69: ops-hub-prod's configured LITELLM_MASTER_KEY was silently
#     rejected by LiteLLM; `/health/litellm` stayed green throughout
#     because it never sends an Authorization header, so a 401 still reads
#     as "reachable." Real tickets sat stuck for 3.6 days before anyone
#     noticed.
#
# This script closes that gap by making a redeploy fail LOUDLY (non-zero
# exit, clear reason) when either class of failure is present — deliberately
# reusing the two health endpoints already built and independently proven
# for exactly this purpose, rather than inventing new checks:
#   /health/env              — T-63 (src/healthEnv.ts): 200 only if every
#                               REQUIRED_ENV_VARS key is present on THIS
#                               running process; 503 + the list of missing
#                               keys otherwise. Catches the T-47 class.
#   /health/litellm-internal  — T-97 (src/healthLitellmInternal.ts): makes a
#                               REAL authenticated completion call over the
#                               app's own internal LITELLM_URL/
#                               LITELLM_MASTER_KEY (the same call
#                               classifyTicket makes) and returns 200 only
#                               on a genuine authenticated success, 503 on
#                               auth rejection / unreachable / any other
#                               failure. Catches the FQ-69 class. Live-proven
#                               against real litellm-staging by
#                               verify-litellm-internal-health-handler.yml.
#
# v1 SCOPE DECISION (documented, not silent): this gate FAILS LOUDLY and
# stops there — it does NOT attempt an automatic rollback. Auto-rollback
# (re-patch the previous image tag + restart via the Coolify API) is
# mechanically simple but risky to trigger unattended before a human has
# looked at *why* the gate failed — same reasoning PRODUCTION.md's own
# rollback decision tree already encodes ("no quick path -> git revert +
# redeploy -> notify PM -> post-mortem", not "just retry automatically").
# The existing manual rollback path (re-run prod-deploy.yml / re-patch the
# staging app with the previous SHA) is well understood, already used
# repeatedly in this project's history, and comfortably meets the < 15 min
# mean-rollback-time quality bar. Automatic rollback is a defensible v2,
# and ties naturally into the still-unbuilt Track C (wiring the T-98
# synthetic-ticket monitor into deploy gating, which explicitly names an
# auto-rollback path as one of its own future options) — not invented here.
#
# Usage:
#   deploy-health-gate.sh <base_url> [path1 path2 ...]
#
# Defaults to checking /health/env and /health/litellm-internal if no paths
# are given. Every path must return HTTP 200 or the gate fails (exit 1).
# Retries each path a few times (GATE_MAX_ATTEMPTS / GATE_SLEEP_SECONDS,
# short by design — by the time this script runs, the caller has already
# waited out container boot time via the existing shallow /health poll, so
# these deep checks should answer immediately; the retry here only smooths
# transient blips, not app startup).

set -euo pipefail

BASE_URL="${1:?usage: deploy-health-gate.sh <base_url> [path1 path2 ...]}"
BASE_URL="${BASE_URL%/}"
shift || true

PATHS=("$@")
if [ "${#PATHS[@]}" -eq 0 ]; then
  PATHS=("/health/env" "/health/litellm-internal")
fi

MAX_ATTEMPTS="${GATE_MAX_ATTEMPTS:-3}"
SLEEP_SECONDS="${GATE_SLEEP_SECONDS:-5}"

OVERALL_FAILED=0

for path in "${PATHS[@]}"; do
  echo ""
  echo "--- Deploy health gate: $BASE_URL$path ---"
  PASSED=0
  LAST_HTTP="000"
  BODY_FILE="$(mktemp)"
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    LAST_HTTP=$(curl -s -m 15 -o "$BODY_FILE" -w "%{http_code}" "$BASE_URL$path" || echo "000")
    if [ "$LAST_HTTP" = "200" ]; then
      echo "Attempt $attempt/$MAX_ATTEMPTS: HTTP 200 — OK"
      PASSED=1
      break
    fi
    echo "Attempt $attempt/$MAX_ATTEMPTS: HTTP $LAST_HTTP"
    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
      sleep "$SLEEP_SECONDS"
    fi
  done

  if [ "$PASSED" -ne 1 ]; then
    echo "::error::Deploy health gate FAILED: $path did not return HTTP 200 after $MAX_ATTEMPTS attempts (last HTTP $LAST_HTTP)."
    echo "Response body (last attempt):"
    cat "$BODY_FILE" 2>/dev/null || echo "(empty)"
    OVERALL_FAILED=1
  fi
  rm -f "$BODY_FILE"
done

echo ""
if [ "$OVERALL_FAILED" -ne 0 ]; then
  echo "::error::DEPLOY HEALTH GATE FAILED — this deploy is NOT verified healthy. Do not treat a green build/container-start as a green deploy."
  echo "Rollback path: re-run the deploy workflow with the previous known-good image_tag/SHA (see runbooks/deploy-health-gate.md). No auto-rollback in v1 — human decides next step."
  exit 1
fi

echo "Deploy health gate PASSED: ${PATHS[*]} all returned HTTP 200 against $BASE_URL."
