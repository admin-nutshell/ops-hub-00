<!--
Structured per-PR sign-off record. Fill in before merge — this is what turns
CONSTITUTION.md's review flow into an auditable record instead of an
asserted "it was reviewed." Delete any row that's genuinely not applicable
and say why in one clause; do not leave a row blank.

Routing reference (CONSTITUTION.md "How work flows" + AUTONOMY.md):
  - CodeRabbit: every PR, automatic.
  - Security Lead: REQUIRED if this diff touches auth, secrets/Vault,
    migrations/RLS, src/config/model-allowlist.ts, or customer/tenant data
    reaching an LLM.
  - Evals Lead: REQUIRED if this diff touches a prompt, an eval file
    (evals/*.yaml), or model-routing config.
  - QA Manager: every PR that changes behavior (skip for pure docs/config).
  - Production Manager: required only if this PR itself triggers or changes
    a deploy path.
-->

## What changed and why

<!-- Not just what the code does — why this change, in plain terms. -->

## Sign-off record

| Reviewer | Required? | Verdict | Notes |
|---|---|---|---|
| CodeRabbit | Always | | |
| Security Lead | Yes / No — | | |
| Evals Lead | Yes / No — | | |
| QA Manager | Yes / No — | | |
| Production Manager | Yes / No — | | |

## AUTONOMY.md category

<!-- Which category (per .claude/team/AUTONOMY.md) does this PR fall under?
     approved / pending-gate / founder-only — and if founder-only, has the
     founder's direct sign-off actually been given (not just requested)? -->

- Category:
- Founder sign-off (if `founder-only`):
