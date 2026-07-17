# Target Operating Model — Gap Analysis & Implementation Plan

**Status:** Living document. First written 2026-07-16 (reconstructed and formalized —
the plan itself was executed via commits earlier the same day but never persisted as
a durable doc; this page closes that meta-gap and becomes the source of truth going
forward).

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
| G5 | CodeRabbit was documented as running but never actually configured; no visible routing of founder-only paths to anyone | PR #501 — CODEOWNERS (advisory routing of `AUTONOMY.md` founder-only paths to `@admin-nutshell`; not GitHub-blocking today, see §4) + `.coderabbit.yaml` | 🟡 **Both specialist reviews done, open, blocked on founder sign-off** — see §4 |
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
| `redeploy-already-authorized` | Coolify duplicate-env-row guard + real deploy-health gate (Phase 2) | 2 | 🟡 **Built + independently reviewed, awaiting merge** — Track A (PR #515, T-122) and Track B (PR #517, T-123), Sprint 22. Real bugs caught and fixed by review before merge: T-122 shipped an invalid `continue-on-error` on a reusable-workflow caller (would have broken both deploy pipelines); T-123's docs undersold real end-to-end verification that had actually happened. Category transitions to `approved` once both merge. |
| `production-promotion-new-change` | Durable audit trail (Phase 1) + T-98 synthetic-ticket monitor wired into deploy gating (Phase 2) | 1 + 2 | 🟡 **Audit trail (G6) merged; Track C (PR #521, T-124) built + independently reviewed, stacked on #517, awaiting #517 merge + rebase.** Review caught and fixed a no-bypass hard block that would have frozen the sole prod-promotion path (rollback included) plus a latent false-pass bug — a human-operator-only break-glass was added. Category transitions to `approved` once #521 merges. |
| `prompt-or-capability-change` | Same as above | 1 + 2 | Same as above |

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

## 4. Founder-gated item

**G5 / PR #501** is the one Phase-0 item that does NOT self-merge: it edits
`CODEOWNERS` (governs who can approve founder-only paths) and adds
`.coderabbit.yaml` (CodeRabbit's own config) — both fall under `AUTONOMY.md`'s
`meta-governance-edit` category, always founder-only regardless of how routine the
change looks. Filed as **FQ-78** in `FOUNDER_QUEUE.md`. Per `AUTONOMY.md`'s own
text, Security Lead + Tech Lead review of the diff is **additive to** the founder's
sign-off, never replaced by it — both are required before merge, not either/or.
**Both now complete** (2026-07-16): Security Lead — APPROVE WITH FOLLOW-UPS (found
and fixed a real overclaim: the PR originally described CODEOWNERS as a "real
GitHub-enforced gate," which is false while `require_code_owner_reviews` is off in
branch protection — corrected in the file and PR description); Tech Lead — APPROVE
WITH FOLLOW-UPS (confirmed `.coderabbit.yaml` schema-valid; flagged the
CODEOWNERS/AUTONOMY.md drift risk noted above). Still awaiting the founder's own
sign-off — the reviews above do not substitute for it.

---

## 5. Execution log

Tracked in `WORK.md` as **Sprint 22**. This doc records the *plan*; `WORK.md` and
`DECISIONS.md` record what actually happened, per this project's standing
convention (plan documents drift, the live status board doesn't).

---

## 6. Standing carries (unchanged by this plan)

Provider-credential divergence trigger (still hasn't fired), `enforce_admins`
branch-protection policy, `LITELLM_URL` Coolify dup-row footgun *for LiteLLM itself*
(narrower than Track A above, which is the general Coolify env-var mechanism),
T-90 O1–O3, per-user session auth, FQ-63/FQ-47 4b/FQ-43 — all founder-gated or
not-yet-a-task, all predate this plan and are out of its scope.
