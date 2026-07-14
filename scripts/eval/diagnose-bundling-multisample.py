#!/usr/bin/env python3
"""
diagnose-bundling-multisample.py -- T-114 diagnostic driver (ADR-0009 Option 1).

THE QUESTION THIS ANSWERS
-------------------------
The eval case "Ticket bundling a total outage with a trivial typo classifies on the
dominant (critical) issue" (evals/ticket-triage.yaml) has a rubric that says
`Set "urgency" to "critical" (a "high" read is tolerable)` and a deterministic
ALLOWED=['critical','high'] -- both answers are contractually acceptable. On PR #456
(T-112) the model answered `high` and the grader returned pass:false/score:0.0
("critical is required"), overriding its own rubric's stated tolerance. That is n=1.
n=1 tells us nothing: is the grader's rejection of `high` STABLE (a confident, repeated
disagreement multi-sample cannot and must not overturn), or does it FLIP across draws
(genuine near-threshold variance multi-sample is the right tool for)?

WHY WE CANNOT DIAGNOSE THIS AGAINST `main`
------------------------------------------
`main`'s triage prompt reliably produces `critical` for this ticket (every baseline
capture did) -- so a multi-sample run on main yields all-`critical`/all-pass and reveals
NOTHING about how the grader treats a `high` answer. `high` only appears under T-112's
reworded `high` bullet. So this driver runs against T-112's PROPOSED prompt wording
(read READ-ONLY from PR #456's branch -- we never write to it), which is the only prompt
that elicits the `high` answer whose grading is in question.

TWO INSTRUMENTS (they isolate DIFFERENT variances -- report which each shows)
----------------------------------------------------------------------------
  A. TARGET+GRADER, N draws, T-112 prompt. Real repeated live draws through the shipped
     mechanism (metadata.multiSample -> options.repeat). Shows (1) target stability: does
     the model consistently answer `high` (vs wobbling high<->critical), and (2) the
     grader's per-draw verdict on whatever the target produced.
  B. JUDGE-ONLY re-grade of ONE FROZEN real `high` output, M draws. Pins the target output
     (promptfoo `providerOutput`, no target call) and grades that identical JSON M times.
     Isolates PURE GRADER variance on a `high` answer -- exactly ADR-0009 Option 1's costed
     shape ("re-grade a single fixed target output N times"). This is the decisive
     instrument for the grader-stability question, and the fallback if A happens to draw
     mostly `critical`.

If A and B AGREE the conclusion is robust; if they diverge (e.g. target wobbles while the
grader is stable), that divergence is itself the finding.

This is a DIAGNOSTIC, not the gate: it deliberately does not run the T-91 canary/token-band
guards (it grades one case, not a suite). It prints every raw draw -- the raw distribution,
not a single verdict, is the deliverable.
"""

import argparse
import json
import os
import re
import subprocess
import sys

import yaml

BUNDLING_DESC = "Ticket bundling a total outage with a trivial typo classifies on the dominant (critical) issue"


def sh(cmd, env=None):
    print(f"\n$ {' '.join(cmd)}", flush=True)
    r = subprocess.run(cmd, env=env, text=True)
    return r.returncode


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def find_case(cfg, desc):
    for t in cfg.get("tests") or []:
        if isinstance(t, dict) and t.get("description") == desc:
            return t
    raise SystemExit(f"::error::case not found by description: {desc!r}")


def rubric_assert(case):
    for a in case.get("assert") or []:
        if isinstance(a, dict) and a.get("type") == "llm-rubric":
            return a
    raise SystemExit("::error::bundling case has no llm-rubric assertion")


def rows_of(results_json):
    with open(results_json, encoding="utf-8") as f:
        doc = json.load(f)
    inner = doc.get("results")
    return inner.get("results") if isinstance(inner, dict) else (inner or [])


def urgency_of(row):
    resp = row.get("response") or {}
    out = resp.get("output") or row.get("output")
    if not isinstance(out, str):
        return None
    cleaned = re.sub(r"```$", "", re.sub(r"^```(?:json)?", "", out.strip(), flags=re.I)).strip()
    try:
        return (json.loads(cleaned) or {}).get("urgency")
    except Exception:
        return None


def grader_of(row):
    gr = row.get("gradingResult") or {}
    for c in gr.get("componentResults") or []:
        if ((c.get("assertion") or {}).get("type")) == "llm-rubric":
            return c.get("pass"), c.get("score"), (c.get("reason") or "")
    return None, None, None


def run_fixture(name, cfg_dict, args, env):
    """Write a fixture, gen-live-config it, run promptfoo, apply honor-pass. Return rows."""
    scr = os.path.dirname(os.path.abspath(__file__))
    fixture = os.path.join(args.out_dir, f"{name}.yaml")
    with open(fixture, "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg_dict, f, sort_keys=False, allow_unicode=True)
    live = os.path.join(args.out_dir, f"{name}-live.yaml")
    results = os.path.join(args.out_dir, f"{name}-results.json")
    assert sh([sys.executable, f"{scr}/gen-live-config.py",
               "--eval-file", fixture, "--target-alias", args.target_alias,
               "--judge-alias", args.judge_alias, "--litellm-base", args.litellm_base,
               "--out-dir", args.out_dir], env=env) == 0, "gen-live-config failed"
    # promptfoo returns 100 when a test fails -- expected; do not abort.
    sh(["npx", "-y", f"promptfoo@{args.promptfoo_version}", "eval", "-c", live,
        "--no-cache", "-o", results], env=env)
    assert sh([sys.executable, f"{scr}/apply-honor-pass.py", "--results-json", results], env=env) == 0
    return rows_of(results), results


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--t112-eval-file", required=True, help="READ-ONLY copy of PR #456's evals/ticket-triage.yaml")
    p.add_argument("--target-alias", default="triage-model")
    p.add_argument("--judge-alias", default="fallback-model")
    p.add_argument("--litellm-base", default="https://litellm-staging.inatechshell.ca/v1")
    p.add_argument("--out-dir", default="/tmp/t114-diag")
    p.add_argument("--na", type=int, default=8, help="Instrument A draws (target+grader).")
    p.add_argument("--nb", type=int, default=12, help="Instrument B draws (judge-only on frozen high).")
    p.add_argument("--promptfoo-version", default="0.121")
    args = p.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    env = dict(os.environ)
    t112 = load_yaml(args.t112_eval_file)
    system_prompt = (t112["providers"][0].get("config") or {}).get("system", "")
    bundling = find_case(t112, BUNDLING_DESC)
    print("=" * 78)
    print("T-112 PROPOSED SYSTEM PROMPT urgency bullets (read-only from PR #456):")
    for line in system_prompt.splitlines():
        if line.strip().startswith("urgency "):
            print("   " + line.strip())
    print("=" * 78)

    # ---- INSTRUMENT A: target+grader, N_A draws, T-112 prompt ----
    print(f"\n########## INSTRUMENT A -- target+grader x{args.na} on T-112's prompt ##########")
    a_case = json.loads(json.dumps(bundling))  # deep copy
    a_case.setdefault("metadata", {})["multiSample"] = args.na
    cfg_a = {
        "description": "T-114 diagnostic A -- bundling case, T-112 prompt, N draws",
        "prompts": t112["prompts"],
        "providers": t112["providers"],
        "tests": [a_case],
    }
    rows_a, _ = run_fixture("diagA", cfg_a, args, env)
    print(f"\n--- INSTRUMENT A raw draws (n={len(rows_a)}) ---")
    a_high = a_crit = a_other = 0
    a_high_reject = a_high_accept = 0
    frozen_high = None
    for i, r in enumerate(rows_a):
        urg = urgency_of(r)
        gp, gs, gr = grader_of(r)
        print(f"  draw {i+1}: urgency={urg!r} grader_pass={gp} grader_score={gs} honored_success={r.get('success')}")
        print(f"          reason: {gr[:200]!r}")
        if urg == "high":
            a_high += 1
            if gp is True:
                a_high_accept += 1
            else:
                a_high_reject += 1
            if frozen_high is None:
                frozen_high = (r.get("response") or {}).get("output") or r.get("output")
        elif urg == "critical":
            a_crit += 1
        else:
            a_other += 1
    print(f"\n  A SUMMARY: high={a_high} (grader accepted {a_high_accept}, rejected {a_high_reject}) | "
          f"critical={a_crit} | other={a_other}")

    # ---- INSTRUMENT B: judge-only re-grade of ONE frozen high output, N_B draws ----
    print(f"\n########## INSTRUMENT B -- judge-only x{args.nb} on ONE frozen `high` output ##########")
    if frozen_high is None:
        print("  SKIPPED: Instrument A produced no `high` draw to freeze. "
              "Report A's distribution; B cannot isolate grader variance without a real high output.")
    else:
        print(f"  frozen high output being graded {args.nb}x:\n    {frozen_high!r}")
        b_case = {
            "description": BUNDLING_DESC,
            "providerOutput": frozen_high,          # pin the output; no target call
            "metadata": {"multiSample": args.nb},
            "assert": [rubric_assert(bundling)],     # llm-rubric ONLY -> isolate grader variance
        }
        cfg_b = {
            "description": "T-114 diagnostic B -- frozen high output re-graded N times",
            "prompts": t112["prompts"],
            "providers": t112["providers"],
            "tests": [b_case],
        }
        rows_b, _ = run_fixture("diagB", cfg_b, args, env)
        print(f"\n--- INSTRUMENT B raw draws (n={len(rows_b)}) ---")
        b_accept = b_reject = 0
        for i, r in enumerate(rows_b):
            gp, gs, gr = grader_of(r)
            print(f"  draw {i+1}: grader_pass={gp} grader_score={gs} honored_success={r.get('success')}")
            print(f"          reason: {gr[:200]!r}")
            if gp is True:
                b_accept += 1
            else:
                b_reject += 1
        print(f"\n  B SUMMARY (pure grader variance on a fixed `high` output): "
              f"accepted {b_accept}/{len(rows_b)}, rejected {b_reject}/{len(rows_b)}")

    print("\n########## DIAGNOSIS COMPLETE -- interpret A (target+grader) and B (grader-only) together ##########")


if __name__ == "__main__":
    main()
