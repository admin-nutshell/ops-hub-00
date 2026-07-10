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
# SCOPE (T-89): this makes the runner work when manually invoked against a
# target+judge alias pair for any eval. It does NOT add the §5 calibration guards
# (token-count assertion, canaries, baseline-relative logic) — that is T-91/T-92 —
# and it does NOT wire itself into CI (T-93, gated on T-90's virtual key).
#
# PARAMETERS (env vars; all but the key have sensible defaults):
#   EVAL_FILE     (required) path to an evals/*.yaml source file (left unchanged)
#   TARGET_ALIAS  (required) LiteLLM alias for the model under test
#   JUDGE_ALIAS   (default: TARGET_ALIAS) LiteLLM alias for the llm-rubric grader
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
JUDGE_ALIAS="${JUDGE_ALIAS:-$TARGET_ALIAS}"
LITELLM_BASE="${LITELLM_BASE:-https://litellm-staging.inatechshell.ca/v1}"
OUT_DIR="${OUT_DIR:-/tmp/eval-live}"
PROMPTFOO_VERSION="${PROMPTFOO_VERSION:-0.121}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required (the LiteLLM key promptfoo authenticates with)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASENAME="$(basename "$EVAL_FILE" .yaml)"
LIVE_CONFIG="$OUT_DIR/$BASENAME-live.yaml"
RESULTS_JSON="$OUT_DIR/$BASENAME-results.json"
EVAL_LOG="$OUT_DIR/$BASENAME-eval.log"

mkdir -p "$OUT_DIR"

echo "::group::Generate self-contained live-run config for $EVAL_FILE"
echo "Target alias: $TARGET_ALIAS | Judge alias: $JUDGE_ALIAS | Base: $LITELLM_BASE"
if [ "$JUDGE_ALIAS" = "$TARGET_ALIAS" ]; then
  echo "NOTE: judge == target for this run (grader != target is a T-91 calibration guard, not enforced here)."
fi
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
npx -y "promptfoo@$PROMPTFOO_VERSION" eval -c "$LIVE_CONFIG" --no-cache --verbose \
  -o "$RESULTS_JSON" \
  2>&1 | tee "$EVAL_LOG"
echo "::endgroup::"

echo "=== Pass-rate summary for $BASENAME ==="
if [ -f "$RESULTS_JSON" ]; then
  jq '.results.stats // .results.table.stats // "no .stats key at this path — see log tail below"' \
    "$RESULTS_JSON" 2>/dev/null || echo "(could not jq-parse results JSON — see log tail below)"
else
  echo "(no results JSON produced)"
fi
echo ""
echo "=== Tail of eval log (pass/fail summary line(s)) ==="
tail -40 "$EVAL_LOG" || true
