#!/usr/bin/env python3
"""Regression tests for apply-honor-pass.py (T-109, ADR-0009).

Run: python3 scripts/eval/test_apply_honor_pass.py

These are the drop-don't-weaken PROOFS the build task demands: a genuinely-bad case
(over-escalation, malformed, out-of-enum, below-floor, grader-declared-fail) must STILL
FAIL under honor-pass, while a rubric-sanctioned borderline (grader pass:true, 0.75) that
the old 0.8 threshold wrongly blocked (the FQ-77 case) now passes.

No pytest dependency on purpose (matches test_compare_baseline.py): stdlib only, runnable
by anyone, anywhere. Builds synthetic promptfoo-0.121-shaped rows (shape verified in-repo:
row.success = gradingResult.pass; componentResults[i].assertion.type present for single AND
multi-assertion rows).
"""
import importlib.util
import json
import os
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "apply_honor_pass", os.path.join(_HERE, "apply-honor-pass.py")
)
hp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hp)


def _rubric_comp(passed, score):
    return {"pass": passed, "score": score, "reason": "r", "assertion": {"type": "llm-rubric", "value": "..."}}


def _js_comp(passed):
    return {"pass": passed, "score": 1 if passed else 0, "reason": "js", "assertion": {"type": "javascript", "value": "..."}}


def _row(desc, comps, declared_types=("llm-rubric",)):
    """Build a promptfoo-shaped row. promptfoo sets row.success = AND(component passes);
    we reproduce that as the pre-honor-pass baseline so the test mirrors reality."""
    pf_success = all(bool(c["pass"]) for c in comps)
    return {
        "success": pf_success,
        "score": comps[0]["score"] if comps else 0,
        "testCase": {"description": desc, "assert": [{"type": t} for t in declared_types]},
        "gradingResult": {"pass": pf_success, "score": comps[0]["score"] if comps else 0, "componentResults": comps},
    }


class HonorPassVerdict(unittest.TestCase):
    FLOOR = 0.6

    def v(self, row):
        return hp.honor_pass_verdict(row, self.FLOOR, 0)

    # --- P1: the FQ-77 case. grader pass:true, score 0.75 -> old threshold 0.8 FAILED it;
    #         honor-pass now PASSES it (0.75 >= floor and grader said pass). ---
    def test_borderline_grader_pass_now_passes(self):
        # With threshold removed, promptfoo's rubric component pass = grader.pass = True.
        row = _row("borderline (g)", [_rubric_comp(True, 0.75)])
        self.assertTrue(self.v(row))

    # --- Guardrail 1 (floor): grader pass:true but score below floor still FAILS. ---
    def test_below_floor_pass_true_still_fails(self):
        row = _row("rubber-stamp low score", [_rubric_comp(True, 0.4)])
        self.assertFalse(self.v(row))

    def test_at_floor_passes(self):
        row = _row("exactly at floor", [_rubric_comp(True, 0.6)])
        self.assertTrue(self.v(row))

    # --- Guardrail 2 (asymmetry): grader pass:false ALWAYS fails, even at a high score.
    #     This is the TIGHTENING half of the bidirectional delta (Tech Lead Finding 2). ---
    def test_high_score_grader_fail_now_fails(self):
        row = _row("grader said fail at 0.85", [_rubric_comp(False, 0.85)])
        self.assertFalse(self.v(row))

    def test_grader_fail_at_top_score_fails(self):
        row = _row("grader fail at 1.0", [_rubric_comp(False, 1.0)])
        self.assertFalse(self.v(row))

    # --- C6 / drop-don't-weaken: a genuinely-bad OVER-ESCALATION. Even if the rubric
    #     grader erroneously returned pass:true at a sub-0.8 score (0.65 >= floor, so
    #     honor-pass alone would pass it), the deterministic escalation-bound javascript
    #     component FAILS -> the row hard-fails GRADER-INDEPENDENTLY. This is the exact
    #     hole C6 closed. ---
    def test_over_escalation_fails_even_if_grader_lenient(self):
        row = _row(
            "over-escalated urgency, grader wrongly lenient",
            [_rubric_comp(True, 0.65), _js_comp(False)],   # js = allowed-set check FAILED
            declared_types=("llm-rubric", "javascript"),
        )
        self.assertFalse(self.v(row))

    # --- Malformed output / out-of-enum: deterministic component fail hard-fails the row
    #     even with a passing high-score rubric. ---
    def test_deterministic_fail_overrides_good_rubric(self):
        row = _row(
            "valid-looking rubric but malformed JSON",
            [_rubric_comp(True, 0.95), _js_comp(False)],
            declared_types=("llm-rubric", "javascript"),
        )
        self.assertFalse(self.v(row))

    def test_both_pass_multi_assertion(self):
        row = _row(
            "clean pass, both components",
            [_rubric_comp(True, 0.72), _js_comp(True)],
            declared_types=("llm-rubric", "javascript"),
        )
        self.assertTrue(self.v(row))

    # honor-pass must NOT rescue a deterministic fail even when the rubric is borderline-pass
    def test_borderline_rubric_but_det_fail(self):
        row = _row(
            "borderline rubric + det fail",
            [_rubric_comp(True, 0.7), _js_comp(False)],
            declared_types=("llm-rubric", "javascript"),
        )
        self.assertFalse(self.v(row))

    # --- Single-assertion row (respond-shaped): only the rubric component. This is where a
    #     silent-pass bug would hide, per the advisor. Verify honor-pass drives it. ---
    def test_single_rubric_row_respond_shape(self):
        row = _row("respond case, rubric only", [_rubric_comp(True, 0.78)])
        self.assertTrue(self.v(row))
        row2 = _row("respond case, grader fail", [_rubric_comp(False, 0.9)])
        self.assertFalse(self.v(row2))

    # --- Deterministic-only row (no rubric declared): leave promptfoo's success as-is. ---
    def test_deterministic_only_row_untouched(self):
        row = _row("det only", [_js_comp(True)], declared_types=("javascript",))
        self.assertIsNone(self.v(row))

    # --- FAIL LOUD: a PASSING row that declares a rubric but exposes no rubric verdict is a
    #     harness/shape fault -> raise, never silently pass. ---
    def test_fail_loud_passing_row_no_componentresults(self):
        row = {
            "success": True,
            "testCase": {"description": "shape fault", "assert": [{"type": "llm-rubric"}]},
            "gradingResult": {"pass": True, "score": 0.9},  # no componentResults
        }
        with self.assertRaises(hp.HarnessFault):
            self.v(row)

    def test_fail_loud_passing_row_rubric_component_missing(self):
        # Declares llm-rubric, reported pass, but only a javascript component present.
        row = _row("rubric declared but absent", [_js_comp(True)], declared_types=("llm-rubric", "javascript"))
        row["success"] = True
        row["gradingResult"]["pass"] = True
        with self.assertRaises(hp.HarnessFault):
            self.v(row)

    def test_failing_row_no_componentresults_is_left_not_raised(self):
        # Already failing (e.g. provider error) -> safe to leave, no silent pass, no raise.
        row = {
            "success": False,
            "testCase": {"description": "provider errored", "assert": [{"type": "llm-rubric"}]},
            "gradingResult": {"pass": False, "score": 0},
        }
        self.assertIsNone(self.v(row))


class ApplyStampsFile(unittest.TestCase):
    """End-to-end: apply() must overwrite success AND gradingResult.pass in the file so
    compare-baseline.py (reads success first) and canary-check (reads success) agree."""

    def _write(self, rows):
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"results": {"results": rows}}, f)
        return path

    def test_demote_below_floor_stamps_both(self):
        rows = [_row("low pass", [_rubric_comp(True, 0.3)])]  # promptfoo success True (no threshold)
        path = self._write(rows)
        try:
            self.assertEqual(hp.apply(path, 0.6), 0)
            with open(path, encoding="utf-8") as f:
                out = json.load(f)["results"]["results"][0]
            self.assertFalse(out["success"])
            self.assertFalse(out["gradingResult"]["pass"])
        finally:
            os.unlink(path)

    def test_promote_borderline_stamps_both(self):
        # Simulate the OLD-world file where promptfoo (with threshold) had marked it False,
        # then threshold removed -> component pass True/0.75; apply should promote to True.
        comp = _rubric_comp(True, 0.75)
        row = {
            "success": False,  # stale (as if a prior threshold had failed it)
            "testCase": {"description": "borderline", "assert": [{"type": "llm-rubric"}]},
            "gradingResult": {"pass": False, "score": 0.75, "componentResults": [comp]},
            "error": "Score 0.75 below threshold 0.8",
        }
        path = self._write([row])
        try:
            hp.apply(path, 0.6)
            with open(path, encoding="utf-8") as f:
                out = json.load(f)["results"]["results"][0]
            self.assertTrue(out["success"])
            self.assertTrue(out["gradingResult"]["pass"])
            self.assertIsNone(out.get("error"))
        finally:
            os.unlink(path)

    def test_apply_fails_loud_exit6_on_shape_fault(self):
        row = {
            "success": True,
            "testCase": {"description": "shape fault", "assert": [{"type": "llm-rubric"}]},
            "gradingResult": {"pass": True, "score": 0.9},
        }
        path = self._write([row])
        try:
            # main() maps HarnessFault -> exit 6; apply() raises it.
            with self.assertRaises(hp.HarnessFault):
                hp.apply(path, 0.6)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
