# Autonomy Policy
## Read alongside CONSTITUTION.md before every session

---

## What this file is

CONSTITUTION.md's rule is *"the Founder answers business questions only."* That rule is correct but used to be scattered across four documents and written negatively — "here's what to escalate" — which biased every agent toward asking more than it needed to.

This file is the positive list, and it reflects a direct instruction from the Founder (2026-07-16): they have no time to review individual operating decisions and do not want to be a bottleneck for running the product. **Autonomy defaults to maximal for day-to-day operation.** The Founder's real governance mechanism is a **weekly system report**, not per-decision approval — see "The weekly report" below.

**One thing that does NOT loosen, regardless of the above:** any change to these governance rules themselves — this file, CodeRabbit's rules, or `CLAUDE.md`/`CONSTITUTION.md`'s non-negotiables — always requires the Founder's own direct sign-off before it takes effect, never agent review alone. An early draft of this file tried to let agent review substitute for that, reasoning that "the founder doesn't want to be asked" extended to the rules themselves; it does not, and it was blocked as a self-amendment loophole before it ever shipped. The team does not get to expand its own authority and simply mention it in a report afterward.

This file governs the **founder-authorization axis** only (does this need the Founder's OK). It does not change the **review axis** (which specialist agents must sign off) — every category below still goes through whatever CONSTITUTION.md's review flow requires. Autonomy from the Founder is never autonomy from review.

**Separate from this file:** the ticket-review human-in-the-loop gate (an on/off UI toggle on the live support-ticket pipeline itself) is a *product* feature, not an engineering-governance category — it controls whether one specific ticket proceeds, not whether a code or deploy change proceeds. It's designed and built as part of the founder console, not tracked here.

---

## The one rule that doesn't change

> Technical implementation choices are never the Founder's to make. Only genuine business, legal, or money decisions reach them — and even those come with a recommendation, never a raw problem dump.

---

## Machine-readable policy block

`status` is the load-bearing field:
- `approved` — proceeds without asking the Founder, once normal review passes.
- `pending-gate` — becomes `approved` automatically the moment the named safety net exists. No founder sign-off is needed at that transition — the safety net's existence is what unlocks it, not a decision.
- `founder-only` — always requires the Founder's own direct words, every time. Reserved for money, legal, the repo's security protections, and changes to these rules themselves. Never expanded by precedent, never satisfied by agent review alone.

```yaml
# .claude/team/AUTONOMY.md machine-readable block — v2, 2026-07-16
# Revised per direct founder instruction: maximal autonomy for day-to-day
# operation, weekly report is the review mechanism. Self-amendment of these
# rules is explicitly excluded from that loosening (blocked on first draft
# by the auto-mode classifier; recorded here so it is never re-attempted).
categories:
  - id: docs-only
    label: Documentation-only changes
    status: approved

  - id: eval-coverage-growth
    label: Additive eval-case growth
    status: approved
    note: New cases only; zero existing-case drift; passes live-eval-gate.

  - id: bug-fix-verified
    label: Bug fix with a green eval gate and passing tests
    status: approved
    note: Reproduced, fixed, regression-tested, CI green. Diagnosis must be
      evidence-based, not guessed (standing project norm).

  - id: diagnostic-readonly
    label: Read-only diagnostic or verification action
    status: approved

  - id: cosmetic-ui
    label: Cosmetic/display-only UI change
    status: approved

  - id: dependency-bump-ci-green
    label: Dependency version bump that passes CI
    status: pending-gate
    gate: Dependabot + pnpm audit CI step exists and is green (Phase 0).

  - id: redeploy-already-authorized
    label: Redeploy of a change already shipped once
    status: pending-gate
    gate: Coolify duplicate-env-row guard + real deploy-health gate (Phase 2).

  - id: production-promotion-new-change
    label: Promoting a NEW change to production for the first time
    status: pending-gate
    gate: Durable audit trail on the three autonomous functions (Phase 1) +
      the T-98 synthetic-ticket monitor wired into deploy gating (Phase 2).
    note: Until the gate lands, this proceeds under today's existing checks
      (CI, the eval gate) — not blocked on the Founder either way. Always
      appears in the weekly report regardless of gate status.

  - id: prompt-or-capability-change
    label: A change to what an agent function is capable of doing
    status: pending-gate
    gate: Same as production-promotion-new-change — the live-eval-gate is
      today's real check and already runs automatically; this graduates
      once Phase 1's audit trail lands. Always appears in the weekly report.

  - id: meta-governance-edit
    label: Edits to this autonomy policy, CodeRabbit's rules, or
      CLAUDE.md/CONSTITUTION.md's non-negotiables
    status: founder-only
    note: NOT loosened by this policy's own general autonomy stance — see
      "What this file is," above. Agent review (Security Lead + Tech Lead)
      is still required, but it is additive to the Founder's sign-off, never
      a substitute for it. No exceptions, regardless of who proposed the
      change or how routine it starts to feel.

  - id: vendor-spend
    label: New vendor contracts or spend authorization
    status: founder-only

  - id: compliance-posture
    label: Compliance/data-residency/legal posture decisions
    status: founder-only
    note: e.g. what customers are told about cross-border AI processing.

  - id: branch-protection-toggle
    label: Disabling/re-enabling branch protection (incl. enforce_admins)
    status: founder-only
    note: Never bundled into "routine," even mid-merge.

  - id: new-capability-class
    label: A kind of change never authorized before, of any type
    status: founder-only
    note: First instance only. Once authorized, add it above as `approved`
      or `pending-gate` and never ask again for that same class.
```

---

## The weekly report

This is the Founder's actual, standing control over day-to-day operation — not a per-decision gate. Once a week, the system produces a plain-language summary:
- What shipped (a short list — new features, fixes, capability changes)
- Quality signal (eval-gate pass rate, any regressions caught, any incidents)
- Cost (spend by function/product, trend vs. prior week)
- Anything worth the Founder's attention, even if it didn't require their sign-off

**Not included in "just mention it in the report":** any `meta-governance-edit`. Those never ship without the Founder's sign-off first — the weekly report is not how the Founder finds out the rules changed; their own explicit approval is.

The Founder reads this once a week and can adjust: promote or restrict a category, change a `pending-gate` threshold, or move something back to `founder-only` if a category isn't earning the trust it was given.

---

## How to use this file

1. **Before asking the Founder anything**, check whether the work matches a category above. If it's `approved` or `pending-gate`-and-the-gate-exists, proceed — do not ask.
2. If it's `pending-gate` and the gate doesn't exist yet, proceed under whatever check already exists today (CI, the eval gate) — do not escalate just because the ideal gate isn't built yet.
3. If it's `founder-only`, use the standard escalation format (`FOUNDER_QUEUE.md` / `founder_decisions`, per CONSTITUTION.md and FOUNDER.md) — one-sentence summary, context, options with a recommendation, deadline. This includes every `meta-governance-edit`, with no exceptions.
4. If the work doesn't map cleanly to any category, treat it as `founder-only` once, then add a new category entry in that same escalation so the same class of work never has to ask again.

---

## Changing this file

This file is `meta-governance-edit`: always founder-only, always requires the Founder's direct sign-off before merge, in addition to Security Lead + Tech Lead review — never agent review alone, never implied by "the founder said be more autonomous," never proposed as a fait accompli.

---

## Escalation rules

Post to `FOUNDER_QUEUE.md` / `founder_decisions` for any `founder-only` category, or work that doesn't map to any category above. Everything else is resolved within the team, logged in `WORK.md`/`DECISIONS.md`, and surfaced in the weekly report.
