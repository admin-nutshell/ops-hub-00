-- Migration: 20260709020000_t92_eval_gate_case_results
-- Sprint 9 / T-92: Add per-test result identity to `eval_gate_runs` so the real
-- LLM-rubric eval gate (ADR-0007) can do BASELINE-RELATIVE, "zero regressions
-- vs last green baseline" pass logic — not coarse count-comparison.
-- Author: Evals Lead (with Tech Lead input — this IS Finding 4 / Condition C3 of
--   the ADR-0007 Tech Lead Review, which recommends exactly this per-test path).
-- Date: 2026-07-09
--
-- *** FOUNDER-APPLY REQUIRED (Supabase SQL Editor, service_role) — see FQ-71 ***
-- Forward-only. Applied via Supabase SQL Editor as service_role. Agents never hold
-- service_role at runtime (CLAUDE.md non-negotiable #3). Do NOT self-apply. This
-- migration changes nothing until a founder runs it and the verification block
-- below returns the new column.
--
-- WHY THIS MIGRATION EXISTS (full account: WORK.md T-92; ADR-0007 §5.4(b) + Tech
-- Lead Finding 4 / C3):
--   `eval_gate_runs` (T-58) stores an AGGREGATE per run only — total_cases,
--   passed_cases, a GENERATED pass_rate, and free-text notes. It carries NO
--   per-test result identity. ADR-0007 §5.4(b)'s baseline-relative rule is
--   explicitly per-test: "a test that newly fails blocks; a test that was already
--   failing-and-waived does not." Coarse count-comparison (passed_cases this run
--   >= last green passed_cases) is implementable on the existing schema with zero
--   migration, BUT it masks a SWAP-REGRESSION: test A newly fails while test B
--   newly passes, the count stays constant, and the gate — whose entire job is to
--   catch a new regression — goes green on a real regression. Closing that hole
--   needs per-test outcomes persisted. Per Tech Lead C3's recommendation over the
--   coarse and LangFuse-backed alternatives (nothing pushes evals to LangFuse
--   today, so that path is build-not-read), we persist per-test detail HERE.
--
--   NOTE (ADR §7 "no new database schema" is now CONDITIONAL): §7 asserted zero
--   schema work. This migration makes that conditional — a single nullable
--   additive JSONB column. Still within the ADR's "medium" sizing (Tech Lead
--   Finding 7 anticipated exactly this: "a JSONB column is trivial ... still
--   within medium ... §7's 'no new database schema' is conditional, not absolute").
--
-- WHAT THIS MIGRATION DOES:
--   Adds ONE nullable JSONB column, `case_results`, to `eval_gate_runs`. It holds
--   an array of per-test outcomes for run_type='llm_rubric' rows, shape:
--     [ {"test_id":"kb-learn::<description>", "eval":"kb-learn",
--        "description":"...", "passed":true, "score":1.0}, ... ]
--   For run_type='schema_validation' rows it stays NULL (schema checks have no
--   per-test quality outcomes — same spirit as pass_rate being NULL for them).
--
-- SCOPE — deliberately minimal (additive column only):
--   * Nullable + additive: existing rows and existing readers are unaffected.
--     src/metrics/evalHealth.ts / dashboard.ts SELECT named columns only, so a new
--     column does not touch them — the aggregate read path is untouched.
--   * NO new RLS policy, NO grant change: `case_results` is covered by the existing
--     eval_gate_runs_select / eval_gate_runs_write policies and the existing
--     ops_hub_app grants (a column inherits its table's row-level policies and
--     table-level grants). This is a LIGHTER apply than FQ-67/FQ-68 — it opens no
--     new access surface, it adds a column to a table whose access is already
--     locked down.
--   * A light shape guard: when present, case_results must be a JSON array.

alter table eval_gate_runs
  add column if not exists case_results jsonb
    check (case_results is null or jsonb_typeof(case_results) = 'array');

comment on column eval_gate_runs.case_results is
  'Per-test result identity for run_type=llm_rubric rows (T-92, ADR-0007 §5.4(b) / '
  'Tech Lead C3). JSONB array of {test_id, eval, description, passed, score}. Enables '
  'BASELINE-RELATIVE gate logic ("zero regressions vs last green baseline") which the '
  'aggregate total_cases/passed_cases cannot express without masking a swap-regression. '
  'NULL for run_type=schema_validation rows (no per-test quality outcome). The last row '
  'with status=pass AND run_type=llm_rubric is the authoritative green baseline the gate '
  'compares against (scripts/eval/compare-baseline.py).';

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'eval_gate_runs' and column_name = 'case_results';
--     -- expect one row: case_results | jsonb
-- ===========================================================================
