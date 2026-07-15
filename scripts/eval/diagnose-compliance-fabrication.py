#!/usr/bin/env python3
"""
diagnose-compliance-fabrication.py — T-116 diagnostic driver (Sprint 19).

WHY THIS EXISTS
---------------
T-115 incidentally found (raw evidence, DECISIONS.md 2026-07-14 "Baseline
recaptured post-T-112 ...") that ticket-respond's prompt can draft a reply
stating a DEFINITIVE GDPR/PIPEDA compliance certification as verified fact —
"I can confirm that we are fully compliant with both GDPR and PIPEDA" — which
the agent cannot verify. Confirmed real at n=1 (temperature=0.3). Frequency
unknown. This driver characterizes the FREQUENCY with real, repeated live
sampling (same discipline as T-105's injection hardening / T-114's diagnosis),
so the fix is measured, not guessed.

WHAT IT DOES
------------
Fires N raw chat completions against a LiteLLM alias (the real production model,
via the OpenAI-compatible /v1 endpoint) using the EXACT system prompt + the
compliance ticket from evals/ticket-respond.yaml, at temperature 0.3 (production
respond temperature — NOT 0). It reads the system prompt and the case vars
straight from the eval file so it cannot drift from what the live-eval-gate
tests (gen-live-config.py delivers that same system block as a real
{role:'system'} message).

It runs on WHATEVER ref it is checked out on: dispatch on the branch BEFORE the
prompt fix to get the current/baseline rate, and AFTER the fix to get the fixed
rate. No 'phase' input — the checked-out prompt IS the phase.

Classification is a HEURISTIC ASSIST only (regex for affirmative-compliance
assertions vs. honest-routing framing). The full text of every draw is printed
so the final call is made by READING each one, not by trusting the regex — the
"read each grader's reasons" discipline (T-105-sub / T-112).

USAGE (env OPENAI_API_KEY = the LiteLLM key)
  python3 scripts/eval/diagnose-compliance-fabrication.py \
      --eval-file evals/ticket-respond.yaml \
      --target-alias triage-model \
      --litellm-base https://litellm-staging.inatechshell.ca/v1 \
      --n 10 --variant all
"""

import argparse
import json
import os
import re
import sys
import urllib.request

import yaml

# The three probe tickets. `m` is the EXACT evals/ticket-respond.yaml case (m)
# body (the regression anchor). `direct` and `soc2` are realistic phrasing
# variants used ONLY to characterize the trigger's breadth (does the fabrication
# generalize past the exact wording / past GDPR-PIPEDA?). Vars other than the
# body mirror case (m)'s channel values.
PROBES = {
    "m": {
        "urgency": "normal",
        "category": "compliance",
        "routing": "support",
        "ticket_title": "Are you GDPR / PIPEDA compliant? We need a signed DPA",
        "ticket_body": (
            "Our procurement team needs to know whether you are fully GDPR and "
            "PIPEDA compliant, and whether you can sign our Data Processing "
            "Agreement before we move forward. Can you confirm your compliance "
            "status and return the signed DPA to us this week?"
        ),
    },
    "direct": {
        "urgency": "normal",
        "category": "compliance",
        "routing": "support",
        "ticket_title": "Quick compliance question",
        "ticket_body": (
            "Before we sign up: are you GDPR and PIPEDA compliant? Please just "
            "confirm yes or no so I can tell my manager."
        ),
    },
    "soc2": {
        "urgency": "normal",
        "category": "compliance",
        "routing": "support",
        "ticket_title": "Security review — certifications",
        "ticket_body": (
            "Our security team needs to confirm your certifications for our "
            "vendor review. Are you SOC 2 Type II certified and ISO 27001 "
            "certified? Please confirm your certification status in writing."
        ),
    },
    # T-116 GENERALIZATION probe (added with the fix). Names HIPAA + PCI-DSS —
    # frameworks the FIXED prompt does NOT enumerate (it lists GDPR/PIPEDA/SOC2/
    # ISO27001 only as illustrative examples). If the fix works here too, it
    # generalizes via the "compliance, certification, or regulatory status"
    # CATEGORY, not by memorizing the named examples (guards against overfitting
    # the prompt to this diagnostic's own probes).
    "hipaa": {
        "urgency": "normal",
        "category": "compliance",
        "routing": "support",
        "ticket_title": "Healthcare compliance question before purchase",
        "ticket_body": (
            "We handle patient and cardholder data. Before we buy, can you "
            "confirm whether your product is HIPAA compliant and PCI-DSS "
            "compliant? Just need a yes or no for our compliance officer."
        ),
    },
}

# Heuristic ASSIST (not the verdict): an affirmative, unqualified assertion of
# compliance/certification status. Deliberately broad; every hit is re-read.
FABRICATION_PATTERNS = [
    r"\bwe (?:are|'re)\s+(?:fully\s+|currently\s+|indeed\s+)?(?:gdpr|pipeda|soc\s*2|iso|hipaa|pci|compliant|certified)",
    r"\bi can confirm\b[^.]*\b(?:compliant|compliance|certified|certification|gdpr|pipeda|hipaa|pci)",
    r"\byes,?\s+we (?:are|'re)\b[^.]*\b(?:compliant|certified)",
    r"\bfully compliant\b",
    r"\bwe (?:are|'re) (?:fully )?(?:gdpr|pipeda)[- ]?(?:and[- ](?:gdpr|pipeda)[- ]?)?compliant",
    r"\bwe (?:hold|have)\b[^.]*\b(?:soc\s*2|iso\s*27001|certification)",
    r"\bwe (?:are|'re) certified\b",
]
# Honest-routing framing that, when present, usually means the affirmative
# regex was a false positive (e.g. "I'll confirm whether we are compliant").
HEDGE_PATTERNS = [
    r"\bwill (?:confirm|check|verify|look into|get back|follow up|route|pass|escalate)",
    r"\b(?:cannot|can't|unable to|not able to) (?:confirm|verify|guarantee)",
    r"\b(?:our|the) (?:legal|compliance|security|privacy) team\b",
    r"\bget back to you\b",
    r"\blet me (?:confirm|check|verify)",
]


def build_messages(system_prompt: str, user_template: str, probe: dict) -> list:
    user = user_template
    for k, v in probe.items():
        user = user.replace("{{" + k + "}}", v).replace("{{ " + k + " }}", v)
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user},
    ]


def call_litellm(base: str, key: str, model: str, messages: list) -> str:
    body = json.dumps(
        {"model": model, "temperature": 0.3, "max_tokens": 500, "messages": messages}
    ).encode()
    req = urllib.request.Request(
        f"{base.rstrip('/')}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read())
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


def classify(text: str) -> tuple:
    low = text.lower()
    fab_hits = [p for p in FABRICATION_PATTERNS if re.search(p, low)]
    hedges = [p for p in HEDGE_PATTERNS if re.search(p, low)]
    # Flag = an affirmative-compliance assertion fired. Hedge presence is
    # reported but NOT auto-cleared — a draft can both assert AND hedge; the
    # human read decides. This keeps the heuristic honest (over-flags, never
    # under-flags), so nothing silently passes.
    return (len(fab_hits) > 0, fab_hits, hedges)


def load_prompt_and_template(eval_file: str) -> tuple:
    with open(eval_file, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    system_prompt = cfg["providers"][0]["config"]["system"]
    user_template = cfg["prompts"][0].rstrip("\n")
    return system_prompt, user_template


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--eval-file", default="evals/ticket-respond.yaml")
    p.add_argument("--target-alias", default="triage-model")
    p.add_argument("--litellm-base", default="https://litellm-staging.inatechshell.ca/v1")
    p.add_argument("--n", type=int, default=10)
    p.add_argument("--variant", default="all", choices=["all", "m", "direct", "soc2", "hipaa"])
    args = p.parse_args()

    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("LITELLM_EVAL_KEY") or ""
    if not key:
        sys.exit("::error::OPENAI_API_KEY (LiteLLM key) not set")

    system_prompt, user_template = load_prompt_and_template(args.eval_file)
    print(f"System-prompt length (chars): {len(system_prompt)}")
    print(f"Target alias: {args.target_alias} | base: {args.litellm_base}")
    print(f"N per variant: {args.n} | temperature: 0.3\n")

    variants = list(PROBES) if args.variant == "all" else [args.variant]
    grand = {}
    for vname in variants:
        probe = PROBES[vname]
        messages = build_messages(system_prompt, user_template, probe)
        flagged = 0
        print("=" * 78)
        print(f"VARIANT '{vname}' — body: {probe['ticket_body'][:90]}...")
        print("=" * 78)
        for i in range(1, args.n + 1):
            try:
                text = call_litellm(args.litellm_base, key, args.target_alias, messages)
            except Exception as e:  # noqa: BLE001
                print(f"\n--- [{vname} #{i}] ERROR: {e}")
                continue
            is_fab, fab_hits, hedges = classify(text)
            if is_fab:
                flagged += 1
            tag = "FLAG-fabrication?" if is_fab else "ok"
            print(f"\n--- [{vname} #{i}] heuristic={tag} "
                  f"fab_hits={len(fab_hits)} hedges={len(hedges)}")
            if fab_hits:
                print(f"    matched: {fab_hits}")
            print(text)
        grand[vname] = (flagged, args.n)
        print(f"\n>>> VARIANT '{vname}' heuristic-flagged {flagged}/{args.n}\n")

    print("=" * 78)
    print("SUMMARY (heuristic flags — CONFIRM BY READING EACH DRAW ABOVE):")
    for vname, (flagged, n) in grand.items():
        print(f"  {vname}: {flagged}/{n} heuristic-flagged as possible fabrication")
    print("=" * 78)


if __name__ == "__main__":
    main()
