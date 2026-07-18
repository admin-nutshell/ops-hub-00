# Target Operating Model — Gap Analysis & Implementation Plan

**Status:** ✅ **CLOSED (2026-07-17).** All six gaps (G1–G6) and all three Phase 2
build tracks are merged; every `AUTONOMY.md` `pending-gate` category this plan
targeted is now `approved`. Kept as a historical record and as the standing
reference for `AUTONOMY.md`'s gate definitions (§3) — not actively tracked as
in-progress work anymore. First written 2026-07-16 (reconstructed and formalized —
the plan itself was executed via commits earlier the same day but never persisted as
a durable doc; this page closed that meta-gap).

---

## 1. Origin

Decided directly with the founder on 2026-07-16, after a live end-to-end pipeline
test surfaced a real triage-classification gap. Full framing: memory
`project_ops_hub_target_operating_model`. Three decisions locked in:

1. **Full formal review for every change** — every code change routes through the
   right specialist agents (`.claude/agents/` roster) before being considered done,
   not one generalist doing most work with occasional single-specialist dispatch.
2. **TTS first.** The platform is already app-agnostic (config-driven
   `project_id`/`tenant_id`), but only TTS is connected/tested. Harden TTS's coverage
   before onboarding a second product.
3. **Broad standing autonomy for routine/verified work.** Reserve founder check-ins
   for genuinely new capability classes, pricing/SLA, or the standing FOUNDER.md
   triggers — not routine execution. This is now codified in
   `.claude/team/AUTONOMY.md` (v2, 2026-07-16).

These three are the framing constraints for everything below. Do not re-ask the
founder to re-confirm them per-task.

---

## 2. Gap analysis

An org-chart/document-map review the same day found six concrete gaps between the
`.claude/agents/`+`.claude/team/` roster as *documented* and as *actually operating*.
Numbering (G1–G6) is this doc's own, assigned in the order the gaps were closed —
each is independently identifiable from its landing PR's own description.

| # | Gap | Fix | Status |
|---|---|---|---|
| G1 | `CONSTITUTION.md`'s roster table listed 5 of 11 agents; the review-flow diagram omitted Security Lead and Evals Lead despite both owning merge-blocking concerns | PR #499 | ✅ Merged 2026-07-16 |
| G2 | 7 of 11 agent roles had identity (`.claude/agents/`) but no operating playbook (`.claude/team/`); no per-category SOP for how tickets/bugs actually get handled; no single canonical autonomy policy (four scattered documents instead) | PR #500 — adds `TECH_LEAD/SECURITY/EVALS/KNOWLEDGE/FRONTEND/DATA/SOLUTIONS.md`, `docs/workflows/*.md` (7 SOPs), `.claude/team/AUTONOMY.md` | ✅ Merged 2026-07-16 |
| G3 | No dependency/CVE scanning existed at all | PR #502 — Dependabot (root + `web/` + Actions pins) + `pnpm audit` CI step (advisory on first run) | ✅ Merged 2026-07-16 |
| G4 | No durable, checkable per-PR sign-off record — `CONSTITUTION.md`'s review flow existed in prose only | PR #507 — `.github/pull_request_template.md` | ✅ Merged 2026-07-16 |
| G5 | CodeRabbit was documented as running but never actually configured; no visible routing of founder-only paths to anyone | PR #501 (superseded) → PR #531 — CODEOWNERS (advisory routing of `AUTONOMY.md` founder-only paths to `@admin-nutshell`; not GitHub-blocking today, see §4) + `.coderabbit.yaml` | ✅ **Resolved 2026-07-17 — see §4 for the real complication that happened along the way** |
| G6 | No durable audit trail for the three autonomous functions (`ticket-triage`, `ticket-respond`, `kb-learn`) — decisions were not recorded anywhere queryable | PR #512 — same-transaction `audit_log` row per run (actor + decision metadata only, never raw ticket/reply content); tests assert the row is written | ✅ Merged 2026-07-16 |

G1–G5 = **Phase 0** (governance/process scaffolding, mostly docs+CI, low risk).
G6 = start of **Phase 1** (real safety-net infrastructure for the autonomy gates
below).

---

## 3. Phase map (ties directly to `AUTONOMY.md`'s `pending-gate` categories)

`AUTONOMY.md` names its own unlock conditions. This section is the authoritative
cross-reference — do not let the two documents drift.

**A second drift risk, named by Tech Lead review (PR #501, 2026-07-16):**
`.github/CODEOWNERS` routes `AUTONOMY.md`'s `founder-only` file-shaped paths
(`AUTONOMY.md`, `CONSTITUTION.md`, `.coderabbit.yaml`, `/CLAUDE.md`,
`CODEOWNERS` itself) to the founder's account — but nothing keeps the two
files in sync automatically. If a future `AUTONOMY.md` edit adds a new
`founder-only` file-shaped category, `CODEOWNERS` needs a matching entry, or
the routing quietly falls behind what the policy actually says. Low severity
in practice (any `AUTONOMY.md` edit is itself `meta-governance-edit` —
founder + Security Lead + Tech Lead gated — which is a natural place to also
check CODEOWNERS), but worth checking explicitly whenever `AUTONOMY.md`'s
`founder-only` list changes.

| AUTONOMY.md category | Gate (verbatim from AUTONOMY.md) | Phase | Status |
|---|---|---|---|
| `dependency-bump-ci-green` | Dependabot + pnpm audit CI step exists and is green (Phase 0) | 0 | ✅ **Gate exists → category auto-transitioned to `approved`** (G3/PR #502 merged). No AUTONOMY.md edit needed — the transition is automatic per the file's own §"Machine-readable policy block" rule. |
| `redeploy-already-authorized` | Coolify duplicate-env-row guard + real deploy-health gate (Phase 2) | 2 | ✅ **APPROVED — both gates merged and live.** Track A (PR #515, T-122) and Track B (PR #517, T-123). Real bugs caught and fixed by independent review before merge: T-122 shipped an invalid `continue-on-error` on a reusable-workflow caller (would have broken both deploy pipelines); T-123's docs undersold real end-to-end verification that had actually happened. T-122 also had a real false-positive detection bug found *after* merge (see `DECISIONS.md` 2026-07-17) — fixed and re-verified; both `main-deploy.yml`/`prod-deploy.yml` now run in `mode: block`, genuinely blocking (PR #529). |
| `production-promotion-new-change` | Durable audit trail (Phase 1) + T-98 synthetic-ticket monitor wired into deploy gating (Phase 2) | 1 + 2 | ✅ **APPROVED — both halves merged and live.** Audit trail (G6, PR #512). Track C (PR #524, T-124 — recreated after GitHub auto-closed the original #521 when its stacked base branch was deleted on merge). Review caught and fixed a no-bypass hard block that would have frozen the sole prod-promotion path (rollback included) plus a latent false-pass bug — a human-operator-only break-glass was added. |
| `prompt-or-capability-change` | Same as above | 1 + 2 | ✅ **APPROVED** — same as above |

### Phase 2 — three build tracks

1. **Track A — Coolify duplicate-env-row guard.** Standing footgun (memory:
   `feedback_coolify_env_vars` — Coolify's UI Save appends env-var rows instead of
   upserting; last row wins; today this is caught only by manual `coolify-db` audits
   before touching a critical var). Build an automated pre-deploy check that fails
   loudly on a duplicate key instead of relying on manual discipline.
2. **Track B — real deploy-health gate.** An automated post-deploy check that can
   actually block/flag a bad redeploy (today's "health check" is manual verification
   after the fact per deploy runbooks).
3. **Track C — wire T-98 into deploy gating.** T-98 (the synthetic-ticket monitor,
   live since FQ-75) currently alerts; it does not gate. Make a new prompt/capability
   promotion to production check T-98's recent signal before (or immediately after,
   with an auto-rollback path) going live.

None of these three are `founder-only` categories in `AUTONOMY.md` — they proceed
under the project's normal specialist-review flow (decision #1 above), not founder
chat approval, unless a track turns out to touch a `meta-governance-edit` or
`vendor-spend` surface once scoped.

---

## 4. Founder-gated item — ✅ RESOLVED (2026-07-17), with a real governance incident along the way

**G5 / PR #501** was the one Phase-0 item that does not self-merge: it edits
`CODEOWNERS` (governs who can approve founder-only paths) and adds
`.coderabbit.yaml` (CodeRabbit's own config) — both fall under `AUTONOMY.md`'s
`meta-governance-edit` category, always founder-only regardless of how routine the
change looks. Filed as **FQ-78** in `FOUNDER_QUEUE.md`. Both required specialist
reviews completed (Security Lead + Tech Lead, both APPROVE WITH FOLLOW-UPS — see
`FOUNDER_QUEUE.md`'s FQ-78 entry for the details), and the founder said **yes**
directly.

**The complication, disclosed in full rather than quietly worked around:** acting on
that "yes" surfaced that PR #501's actual content had already shipped to `main`
**six hours before FQ-78 was even filed** — bundled by accident into PR #512 (the
G6 audit-trail work), which had been legitimately self-merged as "application code,
not meta-governance." PR #512 turned out to be a squash-merge combining two
unrelated commits; the CODEOWNERS/CodeRabbit commit rode along silently. This means
a founder-only category shipped without the founder's sign-off — the exact failure
class `AUTONOMY.md`'s "no self-invented exemptions" rule exists to prevent — and it
was live for the entire session before being caught, undetected by the gap-analysis
review, the Security Lead review, and the Tech Lead review, none of which checked
whether PR #501's target content already existed on `main`.

**Resolution:** PR #501 could not be merged normally (its base had diverged) — closed
as superseded. The corrected content (identical to what both specialist reviews
approved) was applied directly to `main` via PR #531, itself routed through the same
founder-only gate it was fixing (not self-merged, on the reasoning that a fix to the
rule shouldn't skip the rule). Full incident record: `DECISIONS.md` 2026-07-17.

---

## 5. Execution log

Tracked in `WORK.md` as **Sprint 22**. This doc records the *plan*; `WORK.md` and
`DECISIONS.md` record what actually happened, per this project's standing
convention (plan documents drift, the live status board doesn't).

---

## 6. Standing carries

**Resolved by this plan's follow-through, no longer carries:** T-90 O1–O3 (a CI
credential's budget-alert readback and expiry, fixed 2026-07-17 — PR #533); the
general Coolify env-var duplicate-row footgun (Track A above now covers all four
Coolify apps: `ops-hub-staging`/`-prod`, `litellm-staging`/`-prod`); a real,
previously-undiscovered `litellm-staging` database schema issue (fixed 2026-07-17
via the project's own pre-existing ADR-0004 recovery runbook — see `DECISIONS.md`).

**Still open, unchanged, out of this plan's scope:** provider-credential divergence
trigger (still hasn't fired), `enforce_admins` branch-protection policy, per-user
session auth (deferred until a second dashboard user or a SOC-2 need), FQ-63 (a
2-minute Coolify domain click, founder-only) — all founder-gated or not-yet-a-task.
