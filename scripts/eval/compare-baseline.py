#!/usr/bin/env python3
"""
compare-baseline.py -- baseline-relative pass logic for the real LLM-rubric eval
gate (T-92, ADR-0007 §5.4(b) + Tech Lead Finding 4 / Condition C3).

WHAT THIS SOLVES
----------------
The gate must answer ONE question: *did this change make something WORSE?* -- not
"is the absolute pass rate >95%". At N=4 tests/eval an absolute bar collapses to
100% and is hostage to one flaky judge call (ADR §5.4). So the gate is
BASELINE-RELATIVE: "zero regressions vs the last green baseline."

Coarse count-comparison (passed_cases_now >= passed_cases_baseline) is NOT enough:
it MASKS A SWAP-REGRESSION -- test A newly fails while test B newly passes, the
count is unchanged, and a gate whose whole job is catching a new regression goes
green on a real one. Closing that hole needs PER-TEST identity, which is why
eval_gate_runs gained a `case_results` JSONB column (migration 20260709020000).

This script is a PURE FUNCTION OVER FILES -- it holds no secret and talks to no
network or DB. The caller (the capture workflow / T-93's CI job) materializes the
last green baseline into a file (from eval_gate_runs.case_results) and this script
compares it to the current run's promptfoo results. That decoupling keeps the
merge-blocking comparator credential-free (Tech Lead Finding 3 is the caller's
problem, not this script's).

TEST IDENTITY
-------------
`test_id = "<eval>::<description>"`. `<eval>` = the eval file basename
(kb-learn / ticket-triage / ticket-respond); `<description>` = the test's
`description:` field (stable, human-readable, unique within an eval). Editing a
test's description is a DELIBERATE re-baseline of that test -- acceptable, since a
description edit is itself a prompt-surface change. Duplicate descriptions within
one eval are disambiguated with a `#<n>` suffix in file order.

THE RULES (per baseline test_id; fail-closed)
---------------------------------------------
  baseline PASS  -> current PASS     : OK (stable)
  baseline PASS  -> current FAIL     : REGRESSION -> BLOCK   (the core case)
  baseline PASS  -> current MISSING  : REGRESSION -> BLOCK   (dropped/errored/renamed
                                       test = a swap-hole one level up; fail-closed)
  baseline FAIL  -> current FAIL     : OK (pre-existing failure, waived by baseline)
  baseline FAIL  -> current PASS     : OK (improvement; fold into next baseline)
  baseline FAIL  -> current MISSING  : OK (a waived failure that's gone; not a
                                       regression -- but reported)
New test present in current but NOT in baseline:
  current PASS   : OK (new-and-passing; fold into next baseline)
  current FAIL   : NOT blocked by default (no prior state to regress from) but
                   surfaced LOUDLY. `--strict-new` promotes new-and-failing to a
                   block (use once a baseline is meant to be complete).

SUBCOMMANDS
-----------
  capture  --results r1.json [r2.json ...] [--git-sha SHA] [--out baseline.json]
      Normalize one-or-more promptfoo results.json files into a baseline document
      and print the aggregate + the exact recordEvalGateRun payload.

  compare  --baseline baseline.json --current r1.json [r2.json ...] [--strict-new]
      Compare current promptfoo results against a captured baseline. Exit 0 = no
      regressions (gate PASS); exit 1 = at least one regression (gate FAIL).

Each promptfoo results file corresponds to ONE eval (live-run.sh writes
`<eval>-results.json`); the eval name is derived from the filename by stripping a
trailing `-results` / `-live-results`.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


BASELINE_SCHEMA = "eval-baseline/v1"


def _eval_name_from_path(path: str) -> str:
    base = os.path.basename(path)
    for suffix in (".json",):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    for tail in ("-live-results", "-results", "-live"):
        if base.endswith(tail):
            base = base[: -len(tail)]
            break
    return base


def _iter_result_entries(doc: dict) -> list:
    """Return the per-test result array from a promptfoo results.json, tolerant of
    the two shapes promptfoo has used: top-level {results:{results:[...]}} (what
    live-run.sh's `.results.stats` jq path implies) and the flatter {results:[...]}.
    """
    results = doc.get("results", doc)
    if isinstance(results, dict):
        entries = results.get("results", [])
    elif isinstance(results, list):
        entries = results
    else:
        entries = []
    if not isinstance(entries, list):
        return []
    return entries


def _entry_passed(entry: dict) -> bool:
    if "success" in entry and entry["success"] is not None:
        return bool(entry["success"])
    grading = entry.get("gradingResult") or {}
    return bool(grading.get("pass"))


def _entry_score(entry: dict):
    if entry.get("score") is not None:
        return entry["score"]
    grading = entry.get("gradingResult") or {}
    return grading.get("score")


def _entry_description(entry: dict, index: int) -> str:
    tc = entry.get("testCase") or {}
    desc = tc.get("description") or entry.get("description")
    if desc:
        return str(desc)
    # Fallback: a stable-ish label so an unlabeled test still gets an identity
    # rather than silently collapsing with its siblings.
    return f"(unlabeled test #{index})"


def normalize_results(path: str) -> list:
    """One promptfoo results file -> list of {test_id, eval, description, passed, score}."""
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    eval_name = _eval_name_from_path(path)
    entries = _iter_result_entries(doc)
    cases = []
    seen: dict[str, int] = {}
    for i, entry in enumerate(entries):
        desc = _entry_description(entry, i)
        # Disambiguate duplicate descriptions within one eval, in file order.
        seen[desc] = seen.get(desc, 0) + 1
        disamb = desc if seen[desc] == 1 else f"{desc} #{seen[desc]}"
        cases.append(
            {
                "test_id": f"{eval_name}::{disamb}",
                "eval": eval_name,
                "description": disamb,
                "passed": _entry_passed(entry),
                "score": _entry_score(entry),
            }
        )
    if not cases:
        sys.stderr.write(
            f"::warning::{path} produced ZERO test entries -- a results file with no "
            f"tests is almost always a harness failure, not a real empty eval.\n"
        )
    return cases


def build_baseline(result_paths: list, git_sha: str | None) -> dict:
    evals: dict[str, list] = {}
    for path in result_paths:
        cases = normalize_results(path)
        if not cases:
            continue
        name = cases[0]["eval"]
        evals.setdefault(name, []).extend(cases)
    total = sum(len(v) for v in evals.values())
    passed = sum(1 for v in evals.values() for c in v if c["passed"])
    return {
        "schema": BASELINE_SCHEMA,
        "git_sha": git_sha,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "total_cases": total,
        "passed_cases": passed,
        "evals": evals,
    }


def _flatten(evals: dict) -> dict:
    """{eval: [cases]} -> {test_id: case}."""
    out = {}
    for cases in evals.values():
        for c in cases:
            out[c["test_id"]] = c
    return out


def cmd_capture(args) -> int:
    baseline = build_baseline(args.results, args.git_sha)
    text = json.dumps(baseline, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"Wrote baseline -> {args.out}")

    total = baseline["total_cases"]
    passed = baseline["passed_cases"]
    status = "pass" if total > 0 and passed == total else "fail"
    print("=== Captured baseline (per-eval) ===")
    for name, cases in baseline["evals"].items():
        p = sum(1 for c in cases if c["passed"])
        print(f"  {name}: {p}/{len(cases)} passed")
        for c in cases:
            mark = "PASS" if c["passed"] else "FAIL"
            print(f"      [{mark}] {c['description']} (score={c['score']})")
    print(f"=== Aggregate: {passed}/{total} -> status={status} ===")
    if total == 0:
        print("::error::no test cases captured -- refusing to call this a green baseline")
        return 1

    # The exact payload recordEvalGateRun (src/metrics/evalHealth.ts) wants -- so
    # capturing the DB baseline row is a copy-paste once the case_results column
    # is applied (FQ-71). NOT written here: agents hold no ops_hub_app runtime DB
    # credential, and the column isn't live yet.
    payload = {
        "runType": "llm_rubric",
        "status": status,
        "totalCases": total,
        "passedCases": passed,
        "gitSha": baseline["git_sha"],
        "ciRunAt": baseline["captured_at"],
        "caseResults": [c for cases in baseline["evals"].values() for c in cases],
    }
    print("=== recordEvalGateRun payload (for the eval_gate_runs baseline row) ===")
    print(json.dumps(payload, indent=2))
    return 0


def cmd_compare(args) -> int:
    with open(args.baseline, encoding="utf-8") as f:
        baseline_doc = json.load(f)
    base = _flatten(baseline_doc.get("evals", {}))

    cur_evals: dict[str, list] = {}
    for path in args.current:
        for c in normalize_results(path):
            cur_evals.setdefault(c["eval"], []).append(c)
    cur = _flatten(cur_evals)

    regressions: list[str] = []
    warnings: list[str] = []
    ok_lines: list[str] = []

    # Every baselined test must be accounted for in the current run.
    for test_id, bcase in base.items():
        ccase = cur.get(test_id)
        if ccase is None:
            if bcase["passed"]:
                regressions.append(
                    f"[REGRESSION: DROPPED] {test_id} -- passed in baseline, ABSENT from "
                    f"current run (harness dropped/errored/renamed it). Fail-closed."
                )
            else:
                warnings.append(
                    f"[waived-gone] {test_id} -- was failing-and-waived in baseline, absent now."
                )
            continue
        if bcase["passed"] and not ccase["passed"]:
            regressions.append(
                f"[REGRESSION] {test_id} -- passed in baseline, FAILS now "
                f"(score={ccase['score']})."
            )
        elif not bcase["passed"] and not ccase["passed"]:
            warnings.append(f"[still-failing/waived] {test_id} -- failing in baseline and now.")
        elif not bcase["passed"] and ccase["passed"]:
            ok_lines.append(f"[improved] {test_id} -- failing in baseline, PASSES now.")
        else:
            ok_lines.append(f"[stable] {test_id} -- passes in baseline and now.")

    # Tests present now but not in the baseline.
    for test_id, ccase in cur.items():
        if test_id in base:
            continue
        if ccase["passed"]:
            warnings.append(
                f"[new/passing] {test_id} -- not in baseline, passes. Fold into next baseline."
            )
        else:
            msg = (
                f"[new/FAILING] {test_id} -- not in baseline and FAILS "
                f"(score={ccase['score']})."
            )
            if args.strict_new:
                regressions.append(msg + " Blocking (--strict-new).")
            else:
                warnings.append(msg + " Not blocking (no baseline state); surfaced loudly.")

    print("=== Baseline-relative comparison ===")
    print(f"  baseline: {args.baseline} (git_sha={baseline_doc.get('git_sha')})")
    print(f"  baselined tests: {len(base)} | current tests: {len(cur)}")
    for line in ok_lines:
        print("  " + line)
    for line in warnings:
        print("  " + line)
    for line in regressions:
        print("  " + line)

    if regressions:
        print(f"::error::GATE FAIL -- {len(regressions)} regression(s) vs last green baseline.")
        return 1
    print("GATE PASS -- zero regressions vs last green baseline.")
    return 0


def _harden_output_encoding() -> None:
    # Test descriptions legitimately contain non-ASCII (e.g. "->" rendered as an
    # arrow). The gate's diagnostic output must NEVER crash on a console codepage
    # (Windows cp1252 raises UnicodeEncodeError on such chars). Force UTF-8 with
    # replacement so a comparator crash can't be misread as a gate failure.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass  # older/replaced stream — best effort


def main() -> int:
    _harden_output_encoding()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    cap = sub.add_parser("capture", help="Normalize promptfoo results into a baseline document.")
    cap.add_argument("--results", nargs="+", required=True, help="One or more promptfoo results.json files.")
    cap.add_argument("--git-sha", default=os.environ.get("GITHUB_SHA"), help="Commit the baseline is captured at.")
    cap.add_argument("--out", help="Write the baseline JSON here (also printed).")
    cap.set_defaults(func=cmd_capture)

    cmp = sub.add_parser("compare", help="Compare current results against a captured baseline.")
    cmp.add_argument("--baseline", required=True, help="A baseline JSON produced by `capture`.")
    cmp.add_argument("--current", nargs="+", required=True, help="Current promptfoo results.json files.")
    cmp.add_argument("--strict-new", action="store_true", help="Block on a new (not-in-baseline) test that fails.")
    cmp.set_defaults(func=cmd_compare)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
