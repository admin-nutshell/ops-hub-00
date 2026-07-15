#!/usr/bin/env python3
"""
aggregate-multisample.py -- T-114 build of ADR-0009 Option 1 (the OPTIONAL, per-case
multi-sample escalation the ADR designed + cost-approved but left uncoded).

WHAT THIS SOLVES
----------------
ADR-0009's DEFAULT grading mechanism is T-109 honor-pass (re-decide each llm-rubric row
by the grader's OWN `pass` within a floor). Honor-pass fixes the (P1) threshold-discards-
pass class. It does NOT smooth (P2) per-run grader scatter on a case whose true mean sits
right at the boundary -- averaging is the tool for that, and the ADR retained multi-sample
"only as an optional, calibration-gated, per-case escalation" for the narrow set of cases
EMPIRICALLY shown to be near-threshold variance-prone (ADR-0009 Decision; Option 1; §(c)
cost math: ~$1.50 CAD/month if applied to 2-3 cases at N=3).

THE MECHANISM
-------------
A case opts in with `metadata.multiSample: N` (N>=2) in evals/*.yaml. gen-live-config.py
translates that marker into promptfoo's NATIVE per-test `options.repeat: N`, so the shared
runner makes N REAL target+grader calls for that one case (real repeated live draws, not
synthesized variance). Each draw is decided FIRST by honor-pass (apply-honor-pass.py runs
before this script), so every per-draw floor + never-override-a-fail guardrail is already
applied. THIS script then AGGREGATES the N honored per-draw verdicts into ONE row:

    aggregated case PASS  <=>  a strict MAJORITY of the N honored draws PASSED.

  - MAJORITY, never "any draw passed" (that would be gate-softening by attrition -- the
    ADR + WORK.md Sprint 17 constraints forbid "keep sampling until one passes"). All N
    draws are counted; there is no early stop and no best-of.
  - A tie on an even N -> FAIL (conservative; N=3, the default, has no ties).
  - It can only smooth a case that genuinely FLIPS around the line. It CANNOT rescue a
    case the grader stably rejects (majority pass:false -> aggregated FAIL) -- by design.
    Multi-sample smooths scatter; it does not overturn a confident, repeated disagreement.

WHY MAJORITY OF THE *HONORED* DRAW (order matters)
--------------------------------------------------
apply-honor-pass.py MUST run before this script (live-run.sh wires it that way). Each draw
row's `success` is therefore already the honor-pass verdict (grader.pass && score>=floor,
AND-ed with the deterministic C6 over/under-escalation + JSON + enum checks). We aggregate
those honored booleans. Honor-pass per draw first, majority-vote second.

THE WRITE-POINT (mirrors apply-honor-pass.py C3)
------------------------------------------------
We collapse the N repeat rows to ONE row IN PLACE, before compare-baseline.py and the
DB-persist capture read the file. We KEEP the first real draw's row (preserving its
`response.tokenUsage` -- so the token-band guard still sees genuine usage -- and its
`componentResults`), overwrite that row's `success`/`gradingResult.pass` with the majority
verdict, attach a per-draw evidence summary under `gradingResult.multiSampleAggregate`, and
DROP the other N-1 rows. The kept row preserves the exact `description`, so the case's
`test_id` stays stable against the baseline (which holds ONE row for it). Cases without the
marker are not touched at all -- zero effect on the rest of the suite.

FAIL LOUD, NEVER SILENT (the T-84 lesson)
-----------------------------------------
If a case DECLARES `metadata.multiSample: N` but the results expose FEWER THAN 2 rows for
it, `options.repeat` did not take effect (a harness/version fault) and we would be silently
grading a "multi-sample" case on a single draw -> HARD ERROR (exit 6), never a silent
single-sample pass masquerading as an N-draw verdict.

EXIT CODES
  0  applied cleanly (0+ groups collapsed)
  5  results JSON missing / unparseable / no rows
  6  harness fault: a case marked multiSample:N exposed <2 draws to aggregate.
"""

import argparse
import json
import os
import re
import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

LLM_RUBRIC = "llm-rubric"


class HarnessFault(Exception):
    """A shape/harness problem that must fail loud, never silently single-sample a row."""


def _err(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)


def _note(msg: str) -> None:
    print(msg)


def _load(path: str) -> tuple[dict, dict, list]:
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
        container = inner
        rows = inner.get("results")
    elif isinstance(inner, list):
        container = doc
        rows = inner
    else:
        container = doc
        rows = None
    if not isinstance(rows, list) or not rows:
        _err(f"results JSON {path} has no per-test rows (results.results[]) -- nothing to aggregate; harness failure")
        raise SystemExit(5)
    return doc, container, rows


def _multisample_n(row: dict):
    tc = row.get("testCase") or {}
    md = tc.get("metadata") or {}
    n = md.get("multiSample")
    return n if isinstance(n, int) and n >= 2 else None


def _desc(row: dict, i: int) -> str:
    tc = row.get("testCase") or {}
    return str(tc.get("description") or row.get("description") or f"row #{i}")


def _urgency_of(row: dict):
    """Best-effort parse of the target's urgency from its raw output, mirroring the eval's
    own fence-strip. Evidence-only -- never affects the pass/fail decision."""
    resp = row.get("response") or {}
    out = resp.get("output")
    if out is None:
        out = row.get("output")
    if not isinstance(out, str):
        return None
    cleaned = re.sub(r"```$", "", re.sub(r"^```(?:json)?", "", out.strip(), flags=re.I)).strip()
    try:
        return (json.loads(cleaned) or {}).get("urgency")
    except Exception:
        return None


def _grader_verdict(row: dict):
    """Return (pass, score, reason) from the row's llm-rubric componentResult, or (None,)*3."""
    gr = row.get("gradingResult") or {}
    for c in gr.get("componentResults") or []:
        if ((c.get("assertion") or {}).get("type")) == LLM_RUBRIC:
            return c.get("pass"), c.get("score"), (c.get("reason") or "")[:280]
    return None, None, None


def _draw_summary(row: dict) -> dict:
    gp, gs, gr = _grader_verdict(row)
    return {
        "honored_success": bool(row.get("success")),
        "urgency": _urgency_of(row),
        "grader_pass": gp,
        "grader_score": gs,
        "grader_reason": gr,
    }


def aggregate(path: str) -> int:
    doc, container, rows = _load(path)

    # Group indices of marked rows by description, preserving file order.
    groups: dict[str, list[int]] = {}
    marked_declared: dict[str, int] = {}
    for i, row in enumerate(rows):
        n = _multisample_n(row)
        if n is None:
            continue
        d = _desc(row, i)
        groups.setdefault(d, []).append(i)
        marked_declared[d] = n

    if not groups:
        _note(f"[multi-sample] {os.path.basename(path)}: no multiSample-marked cases; nothing to aggregate (no-op).")
        return 0

    # Fail loud on a marked case that produced < 2 draws (repeat did not take effect).
    for d, idxs in groups.items():
        if len(idxs) < 2:
            raise HarnessFault(
                f"'{d}': marked metadata.multiSample:{marked_declared[d]} but only "
                f"{len(idxs)} draw row(s) present -- options.repeat did not take effect. "
                f"Refusing to report a single-draw verdict as an N-draw aggregate."
            )

    drop_indices: set[int] = set()
    collapsed = 0
    for d, idxs in groups.items():
        draws = [_draw_summary(rows[i]) for i in idxs]
        n_actual = len(idxs)
        passes = sum(1 for x in draws if x["honored_success"])
        fails = n_actual - passes
        verdict = passes > (n_actual / 2)  # strict majority; even-N tie -> fail

        keep = idxs[0]
        rep = rows[keep]
        rep["success"] = bool(verdict)
        gr = rep.get("gradingResult")
        if isinstance(gr, dict):
            gr["pass"] = bool(verdict)
            gr["multiSampleAggregate"] = {
                "declared_n": marked_declared[d],
                "n_draws": n_actual,
                "passes": passes,
                "fails": fails,
                "rule": "majority-of-honored-draws (tie->fail)",
                "verdict": bool(verdict),
                "draws": draws,
            }
        for extra in idxs[1:]:
            drop_indices.add(extra)
        collapsed += 1

        urg = [x["urgency"] for x in draws]
        _note(
            f"[multi-sample] '{d}': {passes}/{n_actual} honored draws PASSED -> "
            f"aggregated {'PASS' if verdict else 'FAIL'} (majority; tie->fail). "
            f"urgency answers across draws: {urg}"
        )
        for k, x in enumerate(draws):
            _note(
                f"    draw {k+1}: honored_success={x['honored_success']} "
                f"urgency={x['urgency']!r} grader_pass={x['grader_pass']} "
                f"grader_score={x['grader_score']} reason={x['grader_reason']!r}"
            )

    if drop_indices:
        new_rows = [r for i, r in enumerate(rows) if i not in drop_indices]
        container["results"] = new_rows
        # Keep promptfoo's stats.* count fields loosely consistent if present (best-effort;
        # compare-baseline recounts from the rows, so this is cosmetic for logs/jq).
        stats = container.get("stats") if isinstance(container.get("stats"), dict) else None
        if stats is not None:
            for key in ("successes", "failures"):
                stats.pop(key, None)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)

    _note(
        f"[multi-sample] {os.path.basename(path)}: collapsed {collapsed} case(s); "
        f"dropped {len(drop_indices)} extra draw row(s); one aggregated row per case remains."
    )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description="Collapse per-case multiSample repeat draws into one majority-vote row (ADR-0009 Option 1, T-114)."
    )
    p.add_argument("--results-json", required=True, help="promptfoo results.json to aggregate IN PLACE (run AFTER apply-honor-pass.py).")
    args = p.parse_args()
    try:
        return aggregate(args.results_json)
    except HarnessFault as hf:
        _err(f"[multi-sample] HARNESS FAULT for {args.results_json}: {hf} "
             f"(ADR-0009 fail-loud: a marked case with <2 draws is a silent single-sample risk).")
        return 6


if __name__ == "__main__":
    raise SystemExit(main())
