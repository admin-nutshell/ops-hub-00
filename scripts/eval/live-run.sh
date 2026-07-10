#!/usr/bin/env bash
#
# live-run.sh — reusable live-run orchestrator for the "real" LLM-rubric eval gate
# (T-89, ADR-0007 §6 step 1). Generalizes T-88's corrected KB Learn harness
# (.github/workflows/run-kb-learn-eval.yml) into a single parameterised entrypoint
# so ALL THREE product evals — and any future one — run through the same path.
#
# It does the three things the CI schema check (`promptfoo validate`) does not,
# by delegating config generation to scripts/eval/gen-live-config.py:
#   1. provider swap  -> openai:chat:<target-alias> against the LiteLLM /v1 endpoint
#   2. system prompt delivered as a REAL {role:'system'} message (the T-84/T-88 fix,
#      encoded once so no per-eval override can reintroduce the config.system bug)
#   3. grader routed through LiteLLM on a SEPARATE <judge-alias> parameter
#
# SCOPE (T-89 base + T-91 guards): runs a live eval for any target+judge alias pair.
# T-91 adds the §5 calibration guards INLINE so they run automatically on every
# invocation (delegated to scripts/eval/calibration-guards.py):
#   - grader != target      (§5.3) — fail FAST, before any metered call.
#   - per-eval token band    (§5.1) — after the product run; a collapse toward
#                            user-only tokens (the T-84 signature) is a HARD ERROR.
#   - must-pass/must-fail canaries (§5.2) — a second harness-integrity probe run
#                            alongside the product eval.
# STILL out of T-91 scope (do not add here): the per-test baseline-relative pass
# logic against eval_gate_runs (T-92) and CI wiring (T-93, gated on T-90's key).
#
# PARAMETERS (env vars; all but the key have sensible defaults):
#   EVAL_FILE     (required) path to an evals/*.yaml source file (left unchanged)
#   TARGET_ALIAS  (required) LiteLLM alias for the model under test
#   JUDGE_ALIAS   (required) LiteLLM alias for the llm-rubric grader; MUST differ
#                  from TARGET_ALIAS (grader != target, §5.3 — enforced fail-fast below).
#   LITELLM_BASE  (default: https://litellm-staging.inatechshell.ca/v1)
#   OUT_DIR       (default: /tmp/eval-live) where generated config + results land
#   OPENAI_API_KEY (required, from the caller's env) the LiteLLM key promptfoo uses
#                  as the OpenAI-compatible bearer token for BOTH target and grader.
#   PROMPTFOO_VERSION (default: 0.121) pinned, matches the schema-check job.
#
# The key is masked in CI (::add-mask::) and never printed. Only the pass/fail
# summary is surfaced.
set -euo pipefail

: "${EVAL_FILE:?EVAL_FILE is required (path to an evals/*.yaml file)}"
: "${TARGET_ALIAS:?TARGET_ALIAS is required (LiteLLM alias of the model under test)}"
# JUDGE_ALIAS is REQUIRED (T-91): no default to TARGET_ALIAS. A missing judge must
# read as "specify a distinct judge", not silently become a same-model self-grade.
: "${JUDGE_ALIAS:?JUDGE_ALIAS is required and MUST differ from TARGET_ALIAS (grader != target, ADR-0007 §5.3 / T-91) — a model grading its own output shares its blind spots}"
LITELLM_BASE="${LITELLM_BASE:-https://litellm-staging.inatechshell.ca/v1}"
OUT_DIR="${OUT_DIR:-/tmp/eval-live}"
PROMPTFOO_VERSION="${PROMPTFOO_VERSION:-0.121}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- T-91 calibration guard 3: grader != target — FAIL FAST, before any metered
# call and before the key is even required (so this trips with no LiteLLM spend and
# with no key present). See scripts/eval/calibration-guards.py grader-target.
if [ "$JUDGE_ALIAS" = "$TARGET_ALIAS" ]; then
  echo "::error::Calibration guard (grader != target, ADR-0007 §5.3 / T-91): JUDGE_ALIAS ('$JUDGE_ALIAS') is identical to TARGET_ALIAS. A model grading its own output shares its blind spots — pick a distinct judge alias."
  exit 3
fi

: "${OPENAI_API_KEY:?OPENAI_API_KEY is required (the LiteLLM key promptfoo authenticates with)}"
BASENAME="$(basename "$EVAL_FILE" .yaml)"
LIVE_CONFIG="$OUT_DIR/$BASENAME-live.yaml"
RESULTS_JSON="$OUT_DIR/$BASENAME-results.json"
EVAL_LOG="$OUT_DIR/$BASENAME-eval.log"

mkdir -p "$OUT_DIR"

echo "::group::Generate self-contained live-run config for $EVAL_FILE"
echo "Target alias: $TARGET_ALIAS | Judge alias: $JUDGE_ALIAS | Base: $LITELLM_BASE"
pip install --quiet pyyaml
python3 "$SCRIPT_DIR/gen-live-config.py" \
  --eval-file "$EVAL_FILE" \
  --target-alias "$TARGET_ALIAS" \
  --judge-alias "$JUDGE_ALIAS" \
  --litellm-base "$LITELLM_BASE" \
  --out-dir "$OUT_DIR"
echo "::endgroup::"

echo "::group::Run promptfoo eval (target + grader both via LiteLLM, no target cache)"
# --no-cache: a cached target completion would hide a regression (ADR §4 lever 3).
echo "::add-mask::$OPENAI_API_KEY"
# Capture promptfoo's exit WITHOUT aborting: it returns 100 when any test fails, but a
# failing product test is a legitimate result the T-91 guards must still run against
# (the guards decide whether that failure is REAL or a broken-harness artifact — the
# T-84 distinction). Real result vs harness artifact is settled below, then re-surfaced.
PRODUCT_EXIT=0
{ npx -y "promptfoo@$PROMPTFOO_VERSION" eval -c "$LIVE_CONFIG" --no-cache --verbose \
    -o "$RESULTS_JSON" 2>&1 | tee "$EVAL_LOG"; } || true
PRODUCT_EXIT="${PIPESTATUS[0]}"
echo "::endgroup::"

echo "=== Pass-rate summary for $BASENAME (promptfoo exit $PRODUCT_EXIT) ==="
if [ -f "$RESULTS_JSON" ] && command -v jq >/dev/null 2>&1; then
  jq '.results.stats // .results.table.stats // "no .stats key at this path — see log tail below"' \
    "$RESULTS_JSON" 2>/dev/null || echo "(could not jq-parse results JSON — see log tail below)"
elif [ ! -f "$RESULTS_JSON" ]; then
  echo "(no results JSON produced)"
fi
echo ""
echo "=== Tail of eval log (pass/fail summary line(s)) ==="
tail -40 "$EVAL_LOG" || true

# ============================================================================
# T-91 CALIBRATION GUARDS (ADR-0007 §5) — run automatically on every live run.
# A broken harness must FAIL LOUD here (non-zero exit via set -e), never silently
# report a pass rate on untrustworthy data. Guard 3 (grader != target) already ran
# fail-fast at the top; guards 1 and 2 run post-product-run below.
# ============================================================================

echo "::group::T-91 guard 1 — per-eval token-count band (ADR §5.1, Tech Lead Finding 5)"
# Per-eval band derived from THIS eval's own reference system+user size (not a global
# constant). A collapse toward user-only tokens (the T-84 config.system-dropped
# signature) is a hard error. Missing/zero usage is also a hard error, never a skip.
python3 "$SCRIPT_DIR/calibration-guards.py" token-band \
  --eval-file "$EVAL_FILE" --results-json "$RESULTS_JSON"
echo "::endgroup::"

echo "::group::T-91 guard 2 — must-pass/must-fail canaries (ADR §5.2)"
EVAL_DIR="$(dirname "$EVAL_FILE")"
CANARY_FILE="$EVAL_DIR/canaries/$BASENAME-canary.yaml"
if [ ! -f "$CANARY_FILE" ]; then
  echo "::error::T-91 guard 2: canary fixture $CANARY_FILE not found. Every eval MUST carry canaries (ADR §5.2); refusing to trust a run with no harness-integrity probe."
  exit 4
fi
CANARY_BASENAME="$(basename "$CANARY_FILE" .yaml)"
CANARY_LIVE="$OUT_DIR/$CANARY_BASENAME-live.yaml"
CANARY_RESULTS="$OUT_DIR/$CANARY_BASENAME-results.json"
CANARY_LOG="$OUT_DIR/$CANARY_BASENAME-eval.log"
python3 "$SCRIPT_DIR/gen-live-config.py" \
  --eval-file "$CANARY_FILE" \
  --target-alias "$TARGET_ALIAS" \
  --judge-alias "$JUDGE_ALIAS" \
  --litellm-base "$LITELLM_BASE" \
  --out-dir "$OUT_DIR"
# The canary run DELIBERATELY contains a failing test (the must-fail canary), so
# promptfoo exits 100 by design — `|| true` prevents that expected failure from
# aborting the script; calibration-guards.py canary-check reads the JSON to decide.
{ npx -y "promptfoo@$PROMPTFOO_VERSION" eval -c "$CANARY_LIVE" --no-cache \
    -o "$CANARY_RESULTS" 2>&1 | tee "$CANARY_LOG"; } || true
python3 "$SCRIPT_DIR/calibration-guards.py" canary-check --results-json "$CANARY_RESULTS"
echo "::endgroup::"

echo "=== T-91 calibration guards PASSED for $BASENAME (grader!=target + token band + canaries). ==="
# Harness verified healthy. Now re-surface a REAL product-test failure (if any) with
# promptfoo's own exit code — a trustworthy red, distinct from a harness error above.
if [ "$PRODUCT_EXIT" != "0" ]; then
  echo "::warning::Product eval for $BASENAME returned exit $PRODUCT_EXIT (real test failure(s), harness verified healthy by the guards above — NOT a harness artifact)."
  exit "$PRODUCT_EXIT"
fi
