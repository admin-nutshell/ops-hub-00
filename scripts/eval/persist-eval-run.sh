#!/usr/bin/env bash
#
# persist-eval-run.sh -- T-93 DB-persistence writer for the live eval gate.
#
# Reads a recordEvalGateRun-shaped JSON payload (produced by
# `compare-baseline.py capture --payload-out`, src/metrics/evalHealth.ts's
# EvalGateRunRecord shape) and INSERTs exactly one row into `eval_gate_runs`,
# using the scoped `eval_gate_ci_writer` Postgres role (T-93 migration
# 20260710000000, Security Lead design review in DECISIONS.md).
#
# WHY A SHELL SCRIPT, NOT recordEvalGateRun() DIRECTLY (src/metrics/evalHealth.ts):
# eval-gate-live.yml never runs `npm ci` (it is a Python-script-driven workflow;
# see STEP 3-5) -- adding the full Node dependency tree just for one INSERT
# would be a heavier footprint than reusing the psql binary GitHub-hosted
# runners already ship (same tool t60-rls-probe.yml / T-90 verify jobs use).
# This script reproduces recordEvalGateRun's INSERT byte-for-byte (same column
# list/order -- see the two files side by side) and is covered by the same
# "equivalent minimal script" allowance the T-93 follow-up task specified.
#
# SECURITY / PARAMETERIZATION (Tech Lead Review Finding condition W3): every
# value that can contain LLM-derived / untrusted content (status, git_sha,
# workflow_run_url, ci_run_at, case_results) is passed to psql via `-v` and
# substituted with the QUOTED `:'var'` form, which psql escapes client-side
# (standard SQL string-literal quoting) -- never string-interpolated into the
# SQL text this script assembles. `project_id` and `run_type` are HARD-CODED
# SQL literals (NULL / 'llm_rubric'), not sourced from the payload at all --
# defense-in-depth beyond W3: no field in the payload can ever influence the
# two columns eval_gate_runs_insert_ci's RLS predicate keys on, even if a
# future caller's payload shape changes.
#
# NON-BLOCKING BY DESIGN (Tech Lead Finding 3): this script's own exit code
# reflects whether the write succeeded, but the caller (eval-gate-live.yml
# STEP 6) wraps it in `continue-on-error: true` -- a DB-persistence failure
# must NEVER fail the gate's pass/fail decision, which is STEP 9's job alone.
#
# USAGE:
#   EVAL_GATE_DB_URL=<DSN> WORKFLOW_RUN_URL=<url> \
#     scripts/eval/persist-eval-run.sh <path-to-payload.json>
#
# Exits 0 on a confirmed write, non-zero on any failure (missing DSN/payload,
# connection error, RLS rejection, etc.). Never prints EVAL_GATE_DB_URL.
set -uo pipefail

PAYLOAD_PATH="${1:-}"

if [ -z "${EVAL_GATE_DB_URL:-}" ]; then
  echo "persist-eval-run.sh: EVAL_GATE_DB_URL not set -- nothing to do (caller should skip calling this script; this is a defensive second guard)."
  exit 1
fi
echo "::add-mask::$EVAL_GATE_DB_URL"

if [ -z "$PAYLOAD_PATH" ] || [ ! -f "$PAYLOAD_PATH" ]; then
  echo "::error::persist-eval-run.sh: payload file '$PAYLOAD_PATH' missing or not passed as \$1."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "::error::persist-eval-run.sh: psql not found on PATH."
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "::error::persist-eval-run.sh: jq not found on PATH."
  exit 1
fi

# Pull the fields we need out of the payload. caseResults is re-serialized
# compactly (jq -c) -- it is inserted as ONE jsonb literal via a single bound
# variable, never spliced into the SQL text.
STATUS=$(jq -r '.status // empty' "$PAYLOAD_PATH")
TOTAL_CASES=$(jq -r '.totalCases // empty' "$PAYLOAD_PATH")
PASSED_CASES=$(jq -r '.passedCases // empty' "$PAYLOAD_PATH")
GIT_SHA=$(jq -r '.gitSha // empty' "$PAYLOAD_PATH")
CI_RUN_AT=$(jq -r '.ciRunAt // empty' "$PAYLOAD_PATH")
WORKFLOW_RUN_URL="${WORKFLOW_RUN_URL:-$(jq -r '.workflowRunUrl // empty' "$PAYLOAD_PATH")}"
CASE_RESULTS=$(jq -c '.caseResults // []' "$PAYLOAD_PATH")

if [ -z "$STATUS" ] || [ -z "$CI_RUN_AT" ]; then
  echo "::error::persist-eval-run.sh: payload missing required fields (status/ciRunAt). Payload: $(cat "$PAYLOAD_PATH")"
  exit 1
fi
if [ "$STATUS" != "pass" ] && [ "$STATUS" != "fail" ]; then
  echo "::error::persist-eval-run.sh: unexpected status '$STATUS' (must be pass|fail) -- refusing to write a malformed row."
  exit 1
fi

# project_id = NULL and run_type = 'llm_rubric' are LITERALS in the SQL below,
# not variables -- see header. total_cases/passed_cases/git_sha/workflow_run_url
# fall back to SQL NULL (via nullif(..., '')) rather than an empty string when
# genuinely absent, matching recordEvalGateRun's `?? null` semantics.
# Quoted delimiter ('SQL_EOF') -- no shell expansion inside; every dynamic value
# is a psql bind var (:'v_xxx'), never a shell-interpolated string.
SQL=$(cat <<'SQL_EOF'
insert into eval_gate_runs
  (project_id, run_type, status, total_cases, passed_cases, git_sha, workflow_run_url, ci_run_at, notes, case_results)
values
  (null, 'llm_rubric',
   :'v_status',
   nullif(:'v_total_cases', '')::int,
   nullif(:'v_passed_cases', '')::int,
   nullif(:'v_git_sha', ''),
   nullif(:'v_workflow_run_url', ''),
   :'v_ci_run_at'::timestamptz,
   null,
   :'v_case_results'::jsonb);
SQL_EOF
)

echo "Persisting eval_gate_runs row: status=$STATUS total_cases=${TOTAL_CASES:-<none>} passed_cases=${PASSED_CASES:-<none>} git_sha=${GIT_SHA:-<none>}"

psql "$EVAL_GATE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -v v_status="$STATUS" \
  -v v_total_cases="$TOTAL_CASES" \
  -v v_passed_cases="$PASSED_CASES" \
  -v v_git_sha="$GIT_SHA" \
  -v v_workflow_run_url="$WORKFLOW_RUN_URL" \
  -v v_ci_run_at="$CI_RUN_AT" \
  -v v_case_results="$CASE_RESULTS" \
  -c "$SQL"
RC=$?

if [ "$RC" -eq 0 ]; then
  echo "Persisted OK: one row inserted into eval_gate_runs (run_type=llm_rubric, project_id=NULL)."
else
  echo "::warning::persist-eval-run.sh: INSERT failed (rc=$RC) -- non-fatal by design (Finding 3), the gate's pass/fail decision is unaffected. Likely causes: EVAL_GATE_DB_URL not yet provisioned with a password (FQ pending), a transient connection issue, or an RLS/grant mismatch -- none of these are a quality regression."
fi
exit "$RC"
