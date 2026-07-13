#!/usr/bin/env python3
"""
apply-honor-pass.py -- T-109 build of ADR-0009 (Option 3, the hybrid).

WHAT THIS SOLVES
----------------
The live-eval-gate grades each product-eval row with an `llm-rubric` assertion whose
grader returns a structured verdict `{pass, score, reason}`. Historically every rubric
assertion carried `threshold: 0.8`, so promptfoo decided the assertion by
`pass = grader.pass && score >= 0.8` -- which turns an HONEST `pass:true, score:0.75`
borderline verdict (a nuance the rubric's own tolerance forgives) into a FAIL, exactly
as hard as a real contract violation. In FQ-77 (Sprint 12) that blocked a proven
security fix for a reason the grader itself disagreed with. This is the grader-
robustness class ADR-0009 designed the durable fix for.

THE RULE THIS ENFORCES (ADR-0009 Decision, C1/C2/C3)
---------------------------------------------------
Per row, re-decide the pass/fail by HONORING THE GRADER'S OWN `pass` within a floor:

    an llm-rubric component passes  <=>  grader.pass === true  AND  score >= FLOOR
    row success                     =    (every llm-rubric component honor-passes)
                                         AND (every deterministic component passes,
                                              exactly as promptfoo computed it)

  - Guardrail 1 (hard floor): a low-scored `pass:true` still FAILS (nothing below FLOOR
    can be rescued by honor-pass).
  - Guardrail 2 (never-override-a-fail asymmetry): a grader `pass:false` ALWAYS fails,
    at any score -- honor-pass only ever resolves the band in the direction the grader
    already points. (Implemented naturally: honor-pass requires `grader.pass is True`.)
  - Companion hardening (C6): objective contract checks -- valid-JSON, closed-enum, and
    each triage case's over/under-escalation ALLOWED-SET -- live in separate deterministic
    `javascript` assertions AND-ed with the rubric. honor-pass operates on the rubric
    component ONLY and can NEVER shadow a deterministic fail, so over-escalation, malformed
    output, and out-of-enum results hard-fail GRADER-INDEPENDENTLY (drop-don't-weaken).

WHY A POST-PROCESSOR (C1 -- "relocate the threshold decision", not "read a field")
----------------------------------------------------------------------------------
The companion YAML change REMOVES the per-assertion `threshold: 0.8`. Verified against
promptfoo 0.121 `runJsonGradingPrompt`: with no threshold the rubric componentResult's
`pass` is the grader's UNMODIFIED boolean and `score` its raw score (the `if threshold ...
pass = pass && score >= threshold` branch is simply skipped). We then re-decide LOCALLY
from that already-returned verdict -- ZERO added metered LLM cost, ZERO added latency
(no second judge call; multi-sample was rejected in the ADR for cost). Guardrail 2 is
impossible to implement from `score` alone, which is exactly why the threshold had to be
relocated here rather than scraped.

THE WRITE-POINT (C3)
--------------------
We overwrite each row's `success` AND `gradingResult.pass` with the final honor-pass
verdict IN PLACE, before `compare-baseline.py` (reads `success` first, then
`gradingResult.pass`) and `calibration-guards.py::cmd_canary_check` (reads `success`)
consume the file. That keeps the baseline comparator a pure file diff and the decision
logic in ONE place (this script), not split across two files.

PROVIDER-NEUTRAL (ADR-0009 (a))
-------------------------------
Reads only the structured fields any `llm-rubric` grader emits (`pass`, `score`) plus a
numeric FLOOR from config. No model assumption anywhere; a grader swap re-runs the same
green-baseline capture every grader change already requires.

FAIL LOUD, NEVER SILENT (the T-84 lesson, cf. calibration-guards.py)
--------------------------------------------------------------------
If a row DECLARES an llm-rubric assertion (in `testCase.assert`) but no rubric verdict can
be located in its `componentResults` AND the row would otherwise be reported as a PASS, that
is a harness/shape fault -> HARD ERROR (exit 6), never a silent green. A row that is already
failing is left untouched (honor-pass cannot rescue it; nothing silent about a red staying red).

EXIT CODES
  0  applied cleanly (0+ rows restamped)
  5  results JSON missing / unparseable / no rows
  6  harness fault: a passing row declares an llm-rubric assertion but exposes no rubric
     verdict to honor (would be a silent pass) -- refuse instead of green-lighting.
"""

import argparse
import json
import os
import sys

# Emit valid UTF-8 on every platform (CI is UTF-8; a Windows cp1252 console must not
# crash on the section/dash chars in messages -- same guard the sibling scripts use).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

LLM_RUBRIC = "llm-rubric"

# FLOOR -- model-independent, provider-neutral numeric config (ADR-0009 (a)/(b), C2).
# 0.6 is set STRICTLY BELOW the observed (P1) borderline band (0.70-0.75, FQ-77 case (g)),
# so honor-pass can rescue a rubric-sanctioned borderline verdict but a genuinely-low
# `pass:true` (a broken/rubber-stamping grader emitting e.g. score 0.2-0.4) still fails.
# Env-overridable so a documented re-calibration needs no code change (the pattern
# calibration-guards.py uses for its token bands). Rationale is logged in DECISIONS.md.
DEFAULT_FLOOR = 0.6


class HarnessFault(Exception):
    """A shape/harness problem that must fail loud, never silently pass a row."""


def _err(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)


def _note(msg: str) -> None:
    print(msg)


def resolve_floor(cli_floor) -> float:
    if cli_floor is not None:
        floor = float(cli_floor)
    else:
        floor = float(os.environ.get("EVAL_RUBRIC_FLOOR", DEFAULT_FLOOR))
    if not (0.0 < floor < 1.0):
        raise SystemExit(
            f"::error::EVAL_RUBRIC_FLOOR must be in (0,1); got {floor}. The floor is a "
            f"borderline-band sanity floor, not a pass threshold."
        )
    return floor


def _load_rows(path: str) -> tuple[dict, list]:
    if not os.path.isfile(path):
        _err(f"results JSON not found: {path} -- the promptfoo run produced no output; harness failure")
        raise SystemExit(5)
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        _err(f"could not parse results JSON {path}: {e}")
        raise SystemExit(5)
    inner = doc.get("results")
    if isinstance(inner, dict):
        rows = inner.get("results")
    elif isinstance(inner, list):
        rows = inner
    else:
        rows = None
    if not isinstance(rows, list) or not rows:
        _err(f"results JSON {path} has no per-test rows (results.results[]) -- nothing to re-decide; harness failure")
        raise SystemExit(5)
    return doc, rows


def _row_declares_llm_rubric(row: dict) -> bool:
    tc = row.get("testCase") or {}
    for a in tc.get("assert") or []:
        if isinstance(a, dict) and a.get("type") == LLM_RUBRIC:
            return True
    return False


def _row_desc(row: dict, i: int) -> str:
    tc = row.get("testCase") or {}
    return str(tc.get("description") or row.get("description") or f"row #{i}")


def honor_pass_verdict(row: dict, floor: float, index: int = 0):
    """Return the final honor-pass row success (bool), or None if the row is not subject
    to honor-pass (no rubric component; leave promptfoo's own `success`). Raises
    HarnessFault when a PASSING row declares a rubric but exposes no rubric verdict."""
    declares_rubric = _row_declares_llm_rubric(row)
    gr = row.get("gradingResult") or {}
    comps = gr.get("componentResults")

    if not isinstance(comps, list) or not comps:
        # No component breakdown to honor. Only dangerous if it would leave a PASS
        # unverified; a row already failing is safe to leave (a red staying red).
        if declares_rubric and row.get("success") is True:
            raise HarnessFault(
                f"'{_row_desc(row, index)}': row declares an llm-rubric assertion and is "
                f"reported PASS, but exposes no componentResults to honor -- cannot verify "
                f"the grader's own verdict. Refusing to pass it silently."
            )
        return None

    rubric_passes: list[bool] = []
    det_pass = True
    for c in comps:
        atype = ((c.get("assertion") or {}).get("type"))
        if atype == LLM_RUBRIC:
            score = c.get("score")
            gpass = c.get("pass")
            rp = (gpass is True) and isinstance(score, (int, float)) and (score >= floor)
            rubric_passes.append(bool(rp))
        else:
            # Deterministic component (javascript / is-json / contains / ...). honor-pass
            # NEVER touches it: over-escalation, malformed, out-of-enum stay grader-independent.
            det_pass = det_pass and bool(c.get("pass"))

    if not rubric_passes:
        # No rubric component surfaced. If the row declared one and is a PASS, that's a
        # shape fault -> fail loud. Otherwise it's a deterministic-only row: leave as-is.
        if declares_rubric and row.get("success") is True:
            raise HarnessFault(
                f"'{_row_desc(row, index)}': row declares an llm-rubric assertion and is "
                f"reported PASS, but no llm-rubric component was found among "
                f"{[((c.get('assertion') or {}).get('type')) for c in comps]}. Refusing to "
                f"pass it silently."
            )
        return None

    return all(rubric_passes) and det_pass


def apply(path: str, floor: float) -> int:
    doc, rows = _load_rows(path)
    changed = 0
    demoted = 0
    promoted = 0
    honored = 0  # rows whose success is now driven by the grader's own verdict
    for i, row in enumerate(rows):
        before = row.get("success")
        verdict = honor_pass_verdict(row, floor, i)
        if verdict is None:
            continue
        honored += 1
        if verdict != before:
            changed += 1
            if before is True and verdict is False:
                demoted += 1
            elif before is False and verdict is True:
                promoted += 1
                # clear a stale assert-failure marker so downstream readers aren't misled
                if row.get("error"):
                    row["error"] = None
        row["success"] = verdict
        gr = row.get("gradingResult")
        if isinstance(gr, dict):
            gr["pass"] = verdict

    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)

    _note(
        f"[honor-pass] {os.path.basename(path)}: floor={floor} | "
        f"{honored} rubric row(s) re-decided by grader verdict; "
        f"{changed} restamped ({promoted} promoted below-0.8-but-grader-passed, "
        f"{demoted} demoted below-floor-or-grader-failed)."
    )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description="Re-decide live-run rows by honoring the grader's own pass within a floor (ADR-0009, T-109)."
    )
    p.add_argument("--results-json", required=True, help="promptfoo results.json to re-decide IN PLACE.")
    p.add_argument(
        "--floor",
        default=None,
        help="Sanity floor (default env EVAL_RUBRIC_FLOOR or 0.6). A pass:true below this still fails.",
    )
    args = p.parse_args()
    floor = resolve_floor(args.floor)
    try:
        return apply(args.results_json, floor)
    except HarnessFault as hf:
        _err(f"[honor-pass] HARNESS FAULT for {args.results_json}: {hf} "
             f"(ADR-0009 fail-loud: a passing rubric row with no verdict to honor is a dead-gate risk).")
        return 6


if __name__ == "__main__":
    raise SystemExit(main())
