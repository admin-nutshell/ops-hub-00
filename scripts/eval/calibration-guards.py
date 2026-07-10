#!/usr/bin/env python3
"""
calibration-guards.py — the T-91 calibration guards for the shared live-run eval
runner (ADR-0007 §5). These are the controls that make a BROKEN HARNESS FAIL LOUD
instead of silently reporting a confident-but-wrong pass rate — the T-84 lesson
(a run that scored "25%" was actually a harness bug: the system prompt never
reached the model; token forensics — 497 prompt tokens across 4 calls, ~124/call,
vs the ~853/call a correct harness produces — unmasked it) encoded as automated
controls rather than "be careful next time".

Three guards, invoked by scripts/eval/live-run.sh on every live run:

  1. token-band   (ADR §5.1, Tech Lead Finding 5): assert observed per-call TARGET
                  prompt tokens fall inside a band DERIVED FROM EACH EVAL'S OWN
                  reference system+user prompt size — NOT a global >=600 constant
                  (triage's whole prompt is ~200 tokens/call, so a global 600 would
                  false-trip it AND miss a collapse; kb-learn's is ~853). A collapse
                  toward user-message-only size is the exact T-84 signature => HARD
                  ERROR, never a reported pass rate on bad data.

  2. canary-check (ADR §5.2): each eval carries one must-pass and one must-fail
                  canary (evals/canaries/<name>-canary.yaml). A must-fail that PASSES
                  means the grader is rubber-stamping; a must-pass that FAILS means the
                  harness/model is broken (e.g. system prompt dropped). Either => the
                  whole run is untrustworthy => HARD ERROR, not a percentage.

  3. grader-target (ADR §5.3): the judge alias must differ from the target alias.
                  A model grading its own output shares its own blind spots. (The
                  fail-FAST enforcement lives in live-run.sh so it trips BEFORE any
                  metered call; this subcommand mirrors it for reuse/testing.)

DESIGN: fail loud, never silent. Missing / zero / unparseable token usage is a HARD
ERROR ("cannot verify the system prompt reached the model"), never a skipped check —
a guard that silently reads nothing is worse than no guard (the T-84 trap again).

The results-JSON paths below were locked against REAL promptfoo 0.121 output
(not guessed): per-call target usage is `results.results[i].response.tokenUsage.prompt`
(grader tokens sit separately under `row.tokenUsage.assertions`, so this is target-only);
pass/fail is `results.results[i].success`; canary role is `results.results[i].metadata.canary`.

EXIT CODES (distinct so a caller/log can tell guards apart):
  0  guard passed
  2  token-band guard tripped (collapse / out-of-band / missing usage)
  3  grader==target
  4  canary guard tripped (rubber-stamp, broken must-pass, or missing canary)
  5  usage/structure error (results JSON missing/!parseable/empty)
"""

import argparse
import json
import math
import os
import re
import sys

# Emit valid UTF-8 on every platform (CI is UTF-8; keeps the section/§ and dash chars
# in guard messages from mojibaking or crashing on a Windows cp1252 console).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Band tuning — all env-overridable so a documented false-trip is diagnosable and
# fixable without a code change (DECISIONS.md records that triage/respond bands are
# chars/4 estimate-derived; only kb-learn is anchored to a real measured ~853).
CHARS_PER_TOKEN = float(os.environ.get("EVAL_CHARS_PER_TOKEN", "4.0"))
FLOOR_SYS_FRAC = float(os.environ.get("EVAL_TOKEN_FLOOR_FRAC", "0.30"))
CEIL_MULT = float(os.environ.get("EVAL_TOKEN_CEIL_MULT", "2.5"))


def _err(msg: str) -> None:
    # ::error:: is a GitHub Actions annotation; harmless (just a prefix) when run locally.
    print(f"::error::{msg}", file=sys.stderr)


def _note(msg: str) -> None:
    print(msg)


def estimate_tokens(text: str) -> int:
    """Coarse token estimate (chars / CHARS_PER_TOKEN).

    Deliberately dependency-free: a real tokenizer (tiktoken) would need a network
    fetch of the vocab on first use, which the hermetic/free-tier posture avoids.
    The guard only needs to tell a ~5x collapse (system prompt dropped) from a
    healthy run, not to do exact accounting, so a coarse estimate inside a wide
    band is sufficient — and chars/4 UNDER-reads punctuation/JSON-heavy system
    prompts, which makes the floor conservative (lower), avoiding false trips.
    """
    return math.ceil(len(text or "") / CHARS_PER_TOKEN)


def _render_user(template: str, variables: dict) -> str:
    out = template
    for k, v in variables.items():
        out = re.sub(r"\{\{\s*" + re.escape(str(k)) + r"\s*\}\}", str(v), out)
    return out


def compute_band(eval_file: str) -> dict:
    """Per-eval expected per-call TARGET prompt-token band, from the eval's own
    reference system prompt + rendered user messages. Returns floor/ceil + the
    parts that produced them (for a legible log)."""
    import yaml  # lazy: grader-target needs no yaml, keeps that path dependency-free

    with open(eval_file, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    providers = cfg.get("providers") or []
    prompts = cfg.get("prompts") or []
    if not providers or not prompts:
        _err(f"{eval_file}: missing providers/prompts block — cannot derive a token band")
        sys.exit(5)

    system_prompt = (providers[0].get("config") or {}).get("system", "") or ""
    template = prompts[0]
    sys_est = estimate_tokens(system_prompt)

    user_ests = []
    for t in cfg.get("tests") or []:
        user_ests.append(estimate_tokens(_render_user(template, t.get("vars") or {})))
    if not user_ests:
        # No tests to size the user channel from: fall back to the raw template.
        user_ests = [estimate_tokens(template)]
    user_min, user_max = min(user_ests), max(user_ests)

    # floor = full user message + a FRACTION of the system prompt. A collapsed run
    # (system dropped) yields ~user-only tokens, which is BELOW this floor whenever
    # the system prompt is non-trivial; a healthy run carries the whole system
    # prompt (which dominates) and sits well ABOVE it. Using user_MAX in the floor
    # maximises the collapse-detection margin without endangering the healthy case
    # (healthy always includes the dominant system prompt).
    floor = math.floor(user_max + FLOOR_SYS_FRAC * sys_est)
    # ceil catches the symmetric bug: a duplicated/doubled prompt or grader tokens
    # leaking into the target count.
    ceil = math.ceil(CEIL_MULT * (sys_est + user_max))
    return {
        "eval_file": eval_file,
        "sys_est": sys_est,
        "user_est_min": user_min,
        "user_est_max": user_max,
        "floor": floor,
        "ceil": ceil,
    }


def _load_rows(results_json: str) -> list:
    if not os.path.isfile(results_json):
        _err(f"results JSON not found: {results_json} — the promptfoo run produced no output; treating as a harness failure")
        sys.exit(5)
    try:
        with open(results_json, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        _err(f"could not parse results JSON {results_json}: {e}")
        sys.exit(5)
    rows = (((data.get("results") or {}).get("results")) if isinstance(data.get("results"), dict)
            else data.get("results"))
    if not isinstance(rows, list) or not rows:
        _err(f"results JSON {results_json} has no per-test rows (results.results[]) — nothing to verify; harness failure")
        sys.exit(5)
    return rows


def _target_prompt_tokens(row: dict):
    """Per-call TARGET prompt tokens. Primary: row.response.tokenUsage.prompt
    (target-only — grader usage is separate). Fallback: row.tokenUsage.prompt.
    Returns None if genuinely absent (=> caller hard-errors, never skips)."""
    resp = row.get("response") or {}
    tu = resp.get("tokenUsage") or {}
    val = tu.get("prompt")
    if val is None:
        val = (row.get("tokenUsage") or {}).get("prompt")
    return val


def cmd_token_band(args) -> int:
    band = compute_band(args.eval_file)
    _note(
        f"[token-band] {os.path.basename(args.eval_file)}: expected per-call TARGET prompt tokens "
        f"in [{band['floor']}, {band['ceil']}] "
        f"(sys~{band['sys_est']} tok, user~{band['user_est_min']}-{band['user_est_max']} tok; "
        f"floor = user_max + {FLOOR_SYS_FRAC}*sys, ceil = {CEIL_MULT}*(sys+user_max))"
    )
    rows = _load_rows(args.results_json)

    observed, bad = [], []
    for i, row in enumerate(rows):
        pt = _target_prompt_tokens(row)
        desc = (row.get("testCase") or {}).get("description") or f"test #{i}"
        if pt is None or not isinstance(pt, (int, float)) or pt <= 0:
            # Missing/zero usage => cannot verify the system prompt reached the model.
            # Hard error, NOT a skip (the whole point of the guard — T-84).
            bad.append((desc, pt, "missing/zero prompt-token usage"))
            continue
        observed.append((desc, int(pt)))
        if pt < band["floor"]:
            bad.append((desc, int(pt),
                        f"COLLAPSE: below floor {band['floor']} — prompt tokens collapsed toward "
                        f"user-message-only size; the system prompt likely did NOT reach the model "
                        f"(the exact T-84 config.system-dropped signature)"))
        elif pt > band["ceil"]:
            bad.append((desc, int(pt),
                        f"above ceil {band['ceil']} — prompt is larger than expected "
                        f"(possible duplicated prompt or grader tokens counted as target)"))

    for desc, pt in observed:
        _note(f"  ok  {pt:>6} tok  {desc}")
    for desc, pt, why in bad:
        _err(f"[token-band] {desc}: observed {pt} tok — {why}")

    if bad:
        _err(f"[token-band] TRIPPED for {os.path.basename(args.eval_file)}: "
             f"{len(bad)} call(s) outside the expected band. Refusing to report a pass rate on "
             f"un-trustworthy token data (ADR-0007 §5.1 / T-91).")
        return 2
    _note(f"[token-band] PASS: all {len(observed)} target call(s) inside [{band['floor']}, {band['ceil']}].")
    return 0


def cmd_canary_check(args) -> int:
    rows = _load_rows(args.results_json)
    pass_canaries, fail_canaries, plain = [], [], 0
    for i, row in enumerate(rows):
        meta = row.get("metadata") or (row.get("testCase") or {}).get("metadata") or {}
        role = meta.get("canary")
        success = row.get("success")
        desc = (row.get("testCase") or {}).get("description") or f"test #{i}"
        if role == "pass":
            pass_canaries.append((desc, success))
        elif role == "fail":
            fail_canaries.append((desc, success))
        else:
            plain += 1

    # A canary set with a role missing cannot verify the harness in that direction.
    if not pass_canaries or not fail_canaries:
        _err(f"[canary] missing canaries in {args.results_json}: "
             f"found {len(pass_canaries)} must-pass, {len(fail_canaries)} must-fail. "
             f"Every eval MUST carry one of each (metadata.canary: pass|fail) or the harness "
             f"integrity cannot be checked (ADR-0007 §5.2 / T-91).")
        return 4

    violations = []
    for desc, success in pass_canaries:
        if success is not True:
            violations.append(
                f"MUST-PASS canary did NOT pass ('{desc}', success={success}) => harness/model broken "
                f"(e.g. system prompt dropped, model errored, or grader over-strict).")
    for desc, success in fail_canaries:
        if success is not False:
            violations.append(
                f"MUST-FAIL canary did NOT fail ('{desc}', success={success}) => grader is RUBBER-STAMPING "
                f"(it passes output that clearly violates the rubric).")

    for v in violations:
        _err(f"[canary] {v}")
    if violations:
        _err(f"[canary] TRIPPED for {args.results_json}: a harness that cannot tell right from wrong "
             f"is not trusted to gate. Erroring instead of reporting a pass rate (ADR-0007 §5.2 / T-91).")
        return 4
    _note(f"[canary] PASS: {len(pass_canaries)} must-pass passed, {len(fail_canaries)} must-fail failed "
          f"({plain} non-canary row(s) ignored).")
    return 0


def cmd_grader_target(args) -> int:
    if args.target == args.judge:
        _err(f"[grader!=target] JUDGE alias ('{args.judge}') is identical to TARGET alias "
             f"('{args.target}'). A model grading its own output shares its blind spots — pick a "
             f"distinct judge alias (ADR-0007 §5.3 / T-91).")
        return 3
    _note(f"[grader!=target] PASS: judge '{args.judge}' != target '{args.target}'.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="T-91 calibration guards for the live-run eval runner (ADR-0007 §5).")
    sub = p.add_subparsers(dest="cmd", required=True)

    tb = sub.add_parser("token-band", help="Assert per-call target prompt tokens are within the eval's own band.")
    tb.add_argument("--eval-file", required=True)
    tb.add_argument("--results-json", required=True)
    tb.set_defaults(func=cmd_token_band)

    cc = sub.add_parser("canary-check", help="Assert the must-pass canary passed and the must-fail canary failed.")
    cc.add_argument("--results-json", required=True)
    cc.set_defaults(func=cmd_canary_check)

    gt = sub.add_parser("grader-target", help="Assert judge alias != target alias (fail fast).")
    gt.add_argument("--target", required=True)
    gt.add_argument("--judge", required=True)
    gt.set_defaults(func=cmd_grader_target)

    eb = sub.add_parser("expected-band", help="Print the computed per-eval token band (no results needed).")
    eb.add_argument("--eval-file", required=True)
    eb.set_defaults(func=lambda a: (_note(json.dumps(compute_band(a.eval_file))), 0)[1])

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
