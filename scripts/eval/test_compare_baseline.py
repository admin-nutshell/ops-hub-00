#!/usr/bin/env python3
"""Regression tests for compare-baseline.py (T-92).

Run: python3 scripts/eval/test_compare_baseline.py

WHY THIS EXISTS (the seam it guards):
`capture` stores per-test data as a FLAT array in eval_gate_runs.case_results
(the recordEvalGateRun payload's `caseResults`). `compare` originally read the
baseline ONLY as a nested {"evals": {...}} document. So when T-93 materializes the
DB baseline row (a flat array) and feeds it to `compare --baseline`, the reader
would see zero baselined tests and PASS EVERYTHING -- the exact swap-masking
dead-gate T-92 exists to close, reopened one seam over. These tests assert all
three baseline shapes round-trip, that a swap still blocks under the flat DB-row
shape, and that an empty/malformed baseline fails closed instead of green-lighting.

No pytest dependency on purpose: scripts/eval has no test runner wired in CI yet
(that is T-93), so this uses only the stdlib and is runnable by anyone, anywhere.
"""
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "compare_baseline", os.path.join(_HERE, "compare-baseline.py")
)
cb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cb)


def _case(eval_name, desc, passed, score):
    return {
        "test_id": f"{eval_name}::{desc}",
        "eval": eval_name,
        "description": desc,
        "passed": passed,
        "score": score,
    }


# A tiny green baseline: two evals, two passing cases each.
GREEN_CASES = [
    _case("ticket-triage", "A", True, 1.0),
    _case("ticket-triage", "B", True, 1.0),
    _case("kb-learn", "C", True, 1.0),
    _case("kb-learn", "D", True, 1.0),
]

# Nested `capture --out` document shape.
NESTED_DOC = {
    "schema": "eval-baseline/v1",
    "git_sha": "deadbee",
    "captured_at": "2026-07-09T00:00:00Z",
    "total_cases": 4,
    "passed_cases": 4,
    "evals": {
        "ticket-triage": [GREEN_CASES[0], GREEN_CASES[1]],
        "kb-learn": [GREEN_CASES[2], GREEN_CASES[3]],
    },
}

# The eval_gate_runs ROW shape (recordEvalGateRun payload) -- flat array under
# case_results. This is the gate-time source of truth once T-93 reads the DB row.
DB_ROW_DOC = {
    "runType": "llm_rubric",
    "status": "pass",
    "gitSha": "deadbee",
    "caseResults": list(GREEN_CASES),
}

# The bare column value shape -- just the flat array.
BARE_ARRAY_DOC = list(GREEN_CASES)


def _run_compare(baseline_doc, current_cases, strict_new=False):
    """Write baseline + current results to temp files, run cmd_compare, return
    (exit_code, stdout). current_cases is a flat list of normalized cases; we wrap
    it in the promptfoo results shape compare's normalize_results() reads."""
    with tempfile.TemporaryDirectory() as d:
        bpath = os.path.join(d, "baseline.json")
        with open(bpath, "w", encoding="utf-8") as f:
            json.dump(baseline_doc, f)

        # normalize_results reads a promptfoo results file and derives the eval
        # name from the filename, so write one <eval>-results.json per eval with
        # the minimal {"results": {"results": [ {description, success, score} ]}}.
        cur_by_eval = {}
        for c in current_cases:
            cur_by_eval.setdefault(c["eval"], []).append(c)
        cpaths = []
        for eval_name, cases in cur_by_eval.items():
            path = os.path.join(d, f"{eval_name}-results.json")
            rows = [
                {
                    "description": c["description"],
                    "success": c["passed"],
                    "score": c["score"],
                }
                for c in cases
            ]
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"results": {"results": rows}}, f)
            cpaths.append(path)

        args = SimpleNamespace(baseline=bpath, current=cpaths, strict_new=strict_new)
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cb.cmd_compare(args)
        return rc, buf.getvalue()


class LoadBaselineMapTests(unittest.TestCase):
    def test_all_three_shapes_produce_identical_maps(self):
        m_nested = cb._load_baseline_map(NESTED_DOC)
        m_row = cb._load_baseline_map(DB_ROW_DOC)
        m_bare = cb._load_baseline_map(BARE_ARRAY_DOC)
        self.assertEqual(set(m_nested), set(m_row))
        self.assertEqual(set(m_row), set(m_bare))
        self.assertEqual(len(m_nested), 4)
        for k in m_nested:
            self.assertEqual(m_nested[k]["passed"], m_row[k]["passed"])

    def test_empty_and_malformed_map_to_empty(self):
        self.assertEqual(cb._load_baseline_map({}), {})
        self.assertEqual(cb._load_baseline_map([]), {})
        self.assertEqual(cb._load_baseline_map({"evals": {}}), {})
        self.assertEqual(cb._load_baseline_map(None), {})


class SwapRegressionTests(unittest.TestCase):
    """The core T-92 property: a swap (one test flips PASS->FAIL, another
    FAIL->PASS, count unchanged) must BLOCK. Must hold for EVERY baseline shape,
    especially the flat DB-row shape a coarse count check + a nested-only reader
    would both miss."""

    def _swapped_current(self):
        # A now fails; to keep the pass COUNT identical we'd normally flip another
        # test to passing, but all baseline tests already pass -- so the swap here
        # is simply A regressing. The dead-gate bug made this invisible when the
        # baseline was the flat shape (empty map => no regression seen).
        cur = [dict(c) for c in GREEN_CASES]
        cur[0]["passed"] = False
        cur[0]["score"] = 0.2
        return cur

    def test_swap_blocks_under_nested_shape(self):
        rc, out = _run_compare(NESTED_DOC, self._swapped_current())
        self.assertEqual(rc, 1, out)
        self.assertIn("REGRESSION", out)

    def test_swap_blocks_under_db_row_shape(self):
        # THE seam the advisor caught: flat case_results fed as the baseline.
        rc, out = _run_compare(DB_ROW_DOC, self._swapped_current())
        self.assertEqual(rc, 1, out)
        self.assertIn("REGRESSION", out)

    def test_swap_blocks_under_bare_array_shape(self):
        rc, out = _run_compare(BARE_ARRAY_DOC, self._swapped_current())
        self.assertEqual(rc, 1, out)
        self.assertIn("REGRESSION", out)

    def test_clean_rerun_passes_under_db_row_shape(self):
        rc, out = _run_compare(DB_ROW_DOC, GREEN_CASES)
        self.assertEqual(rc, 0, out)
        self.assertIn("GATE PASS", out)

    def test_dropped_test_fails_closed_under_db_row_shape(self):
        # A passing baseline test absent from the current run must BLOCK.
        cur = [c for c in GREEN_CASES if c["description"] != "A"]
        rc, out = _run_compare(DB_ROW_DOC, cur)
        self.assertEqual(rc, 1, out)
        self.assertIn("DROPPED", out)


class EmptyBaselineFailClosedTests(unittest.TestCase):
    def test_empty_baseline_blocks_instead_of_passing_everything(self):
        rc, out = _run_compare({"evals": {}}, GREEN_CASES)
        self.assertEqual(rc, 1, out)
        self.assertIn("ZERO tests", out)

    def test_wrong_shape_baseline_blocks(self):
        # A totally unrecognized doc must not silently green-light.
        rc, out = _run_compare({"nonsense": 123}, GREEN_CASES)
        self.assertEqual(rc, 1, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
