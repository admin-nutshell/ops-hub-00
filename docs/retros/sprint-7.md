# Sprint 7 Retrospective — Ops Dashboard Settings / Write Surface

**Sprint window:** July 8–22, 2026 (effective: all tasks delivered ahead of window, by 2026-07-09)
**Author:** PM
**Date:** 2026-07-09
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`, founder escalations in `FOUNDER_QUEUE.md`, design of record in `docs/adr/0006-dashboard-settings-write-surface.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Ship the deliberately-deferred Ops Dashboard **settings / write area** designed in ADR-0006 — per-function model routing (Triage / Respond / KB Learn), an SLA-target editor, and feature-flag toggles — behind the same RLS-enforced, least-privilege, server-pinned-scope discipline as the Sprint 6 read-only MVP, with an **atomic `audit_log` write on every config change**. Close the backend gap underneath it: split Respond and KB Learn off Triage's single shared model config so each function resolves its own model.

**Outcome: The write surface is built, Security-Lead-reviewed, QA-verified 21/21, and live on both staging and production behind the existing Basic Auth gate. Two gating decisions (evals reconciliation, auth identity) resolved without relaxing any standing constraint. A real live-DB RLS gap, silently broken since 2026-06-22, was found by QA and fixed. No milestone declared — capability-building (see §6).**

| Task | Owner | Result |
|---|---|---|
| T-72: Schema + migration — `agent_model_routing`, SLA least-privilege grant, RLS write policies | Tech Lead | ✅ Done (PR #310) — T-76-reviewed, founder-applied via SQL Editor (FQ-67), live-verified |
| T-73: Backend read-path — `resolveModelRouting()` + per-function env defaults | Tech Lead | ✅ Done (PR #311) — all 3 functions resolve their own model; fail-closed allowlist; pre-migration-safe SAVEPOINT |
| T-74: Write API routes — SLA / model-routing / feature-flag | Frontend Engineer | ✅ Done (PR #315) — POST-only, fail-closed scope, same-txn audit, CSRF/Origin defense; 43 new tests |
| T-75: Dashboard write UI — settings area | Frontend Engineer | ✅ Done — `/settings` screen; dropdown sourced live from the T-79 allowlist. **Landed in a dead branch first (see §4.2)** |
| T-76: RLS write-model + least-privilege security review (**gate**) | Security Lead | ✅ Done — APPROVED, zero changes; appended to ADR-0006. Advisory C1 carried forward (see §7) |
| T-77: Auth-identity decision (T-B2) — resolve FQ-66 | Security Lead + Founder | ✅ Done — Option B: shared-credential audit granularity accepted; `audit_log.actor = "dashboard"` |
| T-78: QA write-path verification | QA Manager | ✅ Done — first run 19/21; **found a real missing RLS policy**; re-run after T-82 fix: **21/21** (see §4.1) |
| T-79: Evals reconciliation (T-B1) — **gate** | Evals Lead | ✅ Done — curated per-function allowlist `src/config/model-allowlist.ts`; enforces the eval gate, doesn't relax it |
| T-80: Correct CLAUDE.md "Database — key facts" phantom tables | Tech Lead | ✅ Done — removed `ticket_events`/`agent_actions` (in no migration) |
| T-81: Staging → prod go-live of the write surface | Production Manager | ✅ Done — both environments live + verified. **First dispatch crashed mid-task (see §4.3)** |
| T-82: Re-create missing `feature_flags_write` RLS policy on live DB | Tech Lead | ✅ Done (PR #323) — Security-Lead-reviewed, founder-applied (FQ-68); fixes the T-78 finding |

---

## 2. What worked

- **The two gating decisions were both resolved without relaxing a standing constraint — and neither wrongly consumed a founder cycle.** T-79 (evals) was resolved team-side per CONSTITUTION's "could a senior engineer answer this?" test: restrict the model dropdown to a **curated set of pre-evaled aliases**, which *enforces* the eval gate by construction rather than relaxing it. The trip-wire (if the only viable path relaxed a CLAUDE.md constraint, escalate) was correctly identified and not hit. T-77 (auth identity) genuinely *was* a business/security-posture call, so it correctly went to the founder (FQ-66) — who chose Option B. The escalation filter worked in both directions: keep what a senior engineer can answer, escalate what needs founder authority.

- **The write threat model was treated as load-bearing, not ceremony.** A write surface can corrupt tenant config, silently change billing posture, or take a prod agent function offline — so least-privilege grants and fail-closed RLS `with check` were built in from the schema up. Concrete examples that paid off: `sla_tier` (the +$200 CAD/mo billing lever) was excluded from the column-scoped `tenants` UPDATE grant *and* rejected again at the app layer (defense in depth); the feature-flag route is physically UPDATE-only (no INSERT/DELETE statement exists on the path, so create/delete is unreachable regardless of payload); write scope is server-pinned and fail-closed with **no** fallback UUID (unlike the read path, a write must refuse rather than guess a scope).

- **Query/write-logic centralization (from Sprint 6) extended cleanly to the write path.** All validation + SQL lives in `src/metrics/settingsWrite.ts` + `src/http/dashboardWriteGuards.ts`, deliberately framework-agnostic so they're unit-testable under the root vitest runner (`web/` has no test runner of its own). The `route.ts` files are ~15-line glue. This is why the write path shipped with **86 new unit tests** across T-73/T-74 and still had one auditable place for review.

- **QA's live write-path run (T-78) did exactly what a live test is supposed to do.** It found a real, pre-existing RLS gap that no amount of code review would have surfaced — because the code (the migration file) was correct; it was the *live database* that was wrong (see §4.1). The team's now-repeated lesson — "prove the live state matches the record" — earned its keep again.

- **Pre-migration defensiveness meant the backend could merge before the schema was applied.** T-73's routing read is wrapped in a SAVEPOINT so a missing `agent_model_routing` table degrades to the env/literal default instead of aborting the ticket hot-path; T-74's routes catch `42P01` and re-throw a clear `SchemaNotReadyError` (503) instead of crashing. Behavior was byte-identical to the prior state until the founder applied T-72. This decoupled code-merge from the founder's SQL-Editor apply — the right pattern given agents never hold `service_role`.

---

## 3. What didn't work (or cost more than it should have)

- **A missing RLS write policy had been silently broken in the live DB since 2026-06-22 — and this was the *second* instance of the exact same root cause.** The live `feature_flags` table carried only `feature_flags_select`; its `feature_flags_write` policy — defined in `20260618120100_enable_rls_policies.sql` — was simply absent from the live database. RLS was enabled and grants were present, so every feature-flag write silently default-denied (fail-closed, no leak, but writes never worked). The root cause is a botched hand-apply of that migration on 2026-06-22: the **first** policy lost the same way was `kb_articles_write` (fixed by `20260704000000` back in Sprint 5). This is the same class of bug, from the same event, found the hard way a second time. Finding a third instance by having it break in production is now a foreseeable risk we have not yet closed — which is precisely why the Sprint 8 opener (T-83) is a one-shot `pg_policy`-vs-migrations reconciliation.

- **A PR-stacking mistake orphaned real work into a dead branch — and it happened *twice* this sprint.** Twice, a PR was squash-merged whose base branch was *another still-open PR's branch* rather than `main`. Squash-merging collapses the branch's commits into a single new commit on the base; when the base is a soon-to-be-deleted feature branch instead of `main`, the merged work lands in a branch that then gets deleted, **silently orphaning it** — the commits never reach `main`. It happened with **PR #316 → #317** and again with **PR #324 → #325**. In the #316/#317 case, T-75's actual settings-UI code landed in a dead branch and was not on `main` until it was caught and re-landed via a fresh PR retargeting the same commits. This cost real rework and, worse, briefly made WORK.md's "done" claim untrue (the code was "merged" but not on `main`). Two occurrences in one sprint makes this a process gap, not a slip of the finger.

- **A background agent crashed mid-task after 31 tool calls with no report — and left a misleadingly reassuring health signal behind it.** T-81's first dispatch died (API error) partway through with no summary back. Investigation found no live *damage* — the staging dashboard was healthy and correctly gated (401). But it also had not finished its actual job: the dashboard was still serving an image built **46 commits behind `main`** (predating T-72–T-82 entirely), while responding with a perfectly reassuring 401. A 401 proves the auth *gate* works; it proves **nothing** about whether the deployed *code* is current. Had no one re-checked the image SHA, a stale dashboard would have looked "verified" indefinitely.

- **Intermittent flaky CI: pushing a new commit to an already-open PR sometimes didn't fire the required-checks workflow.** Several times this sprint, a fresh push to an open PR did not trigger the required checks, leaving the PR un-mergeable with no failing signal to point at. The reliable workaround was to close and reopen the PR, which re-fired the workflow. Cause not root-caused (likely a GitHub Actions event-delivery quirk, same family as the FQ-48-era `workflow_dispatch` oddities). Not scheduled for a fix — captured as a known quirk with a known workaround so a future session doesn't burn time re-diagnosing it.

---

## 4. Incidents, blockers, and resolutions

### 4.1 Missing `feature_flags_write` RLS policy — found live by QA (T-78 → T-82)

**What happened:** T-78's first live write-path run scored **19/21** — the two failures both on the feature-flag surface (Check 1c: in-scope toggle should succeed; Check 2c: cross-scope toggle should be rejected). A read-only `pg_policy` catalog dump (dispatched diagnostic, [run 28984439224](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28984439224)) confirmed the live `feature_flags` table had **only** `feature_flags_select` — the `feature_flags_write` policy from `20260618120100_enable_rls_policies.sql` was absent, despite T-11 claiming that migration was fully applied on 2026-06-22 and T-72 assuming the policy "already exists." Table-level grants were present and RLS was on, so every feature-flag INSERT/UPDATE/DELETE had silently default-denied since that date. Fail-closed (no data leak), but writes never worked.

**Resolution:** T-82 authored a forward-only, policy-only migration (`20260708010000_t82_feature_flags_write_policy.sql`) that idempotently re-creates exactly the policy `20260618120100` already defines (Security Lead confirmed the `create policy` statement is **byte-identical**, md5-matched, to the original — no scope change). It touches no grants and does not touch `feature_flags_select`. Security Lead reviewed and passed it (PR #323); the founder applied it via SQL Editor (FQ-68) — live-verified that `pg_policy` now returns both `feature_flags_select` and `feature_flags_write`. QA re-ran T-78: **21/21 pass** ([run 28985917464](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28985917464)), including both previously-failing checks.

**Root-cause pattern:** This is the *second* write policy lost by the same 2026-06-22 hand-apply of `20260618120100` (first: `kb_articles_write`). The Security Lead review explicitly recommended a follow-up one-shot `pg_policy`-vs-migrations reconciliation, especially checking `audit_log_insert`. → Sprint 8 T-83.

### 4.2 PR-stacking mistake — orphaned work into a dead branch, twice (T-75 and one other)

**What happened:** Twice this sprint a PR was squash-merged against a base branch that was itself another still-open PR's feature branch, not `main`. Squash-merge collapses the source branch's commits into one commit **on the base**; when the base is a feature branch that is then deleted, the work never propagates to `main` and is silently orphaned. Instances: **PR #316 → #317** and **PR #324 → #325**. T-75's actual settings-UI code was one victim — "merged" but not on `main` until caught.

**Resolution:** Each orphaned set of commits was re-landed via a fresh PR retargeted to `main`. No work was permanently lost, but it cost rework and produced a window where WORK.md's "done/merged" claim was untrue.

**Lesson (concrete, see §5):** Before squash-merging any PR, verify its **base branch is `main`**. Never stack a PR on another open PR's branch unless the stack is intentional and merged bottom-up (base merged and retargeted to `main` first). After any merge that was part of a stack, confirm the commits are actually reachable from `main` (`git branch --contains <sha> | grep main`), not just that the PR shows "merged."

### 4.3 T-81 first-dispatch crash + stale-but-gated staging dashboard

**What happened:** T-81's first (background) dispatch crashed after 31 tool calls (API error) with no report. Investigation found the staging dashboard healthy and correctly gated (401) — **but** still serving `docker_registry_image_tag=688345c…`, a build **46 commits behind `main`**, predating the entire T-72–T-82 write surface. The reassuring 401 proved only that the auth gate worked, not that the deployed code was current.

**Resolution:** The go-live was redone directly (rather than re-risking another crashed delegation). Staging was rebuilt from current `main` (verified `docker_registry_image_tag` now matched `main` HEAD exactly, clean boot, `restart_count: 0`), then a new read-only `verify-dashboard-settings-staging.yml` confirmed 401 unauth / 200 authed with all six content markers present. Production was then deployed (founder-authorized) via the same pattern, image tag confirmed to match `main` HEAD, and **independently** re-verified (not just trusting the deploy workflow's self-report) — 401 unauth / 200 authed, all six markers, near-identical byte count to staging as expected for the same code. Rollback path was documented before dispatch; not needed.

**Lesson (concrete, see §5):** A 200/401 health check proves the **gate**, not the **code**. Deploy verification must assert the deployed image SHA/commit matches `main` HEAD — a live auth-status check alone can make a 46-commits-stale deploy look "verified."

---

## 5. Process changes for Sprint 8 (and standing, going forward)

1. **Reconcile live `pg_policy` against every migration file's intended policies — proactively, once.** The same botched 2026-06-22 apply has now cost us `kb_articles_write` (Sprint 5) and `feature_flags_write` (this sprint), each found only when a write broke. Do not wait for the third. A read-only dump-and-diff closes the whole class of risk. → Sprint 8 T-83 (opener), with `audit_log_insert` named as an explicit verify-target.

2. **Verify a PR's base branch is `main` before squash-merge; confirm merged commits reach `main` after.** Concretely: (a) never open a PR stacked on another open PR's branch unless the stack is intentional and merged strictly bottom-up (base merged and retargeted to `main` first); (b) before squash-merge, check the PR's base is `main`; (c) after any merge that was part of a stack, run `git branch --contains <sha> | grep main` to confirm the work is actually on `main`, not just that GitHub says "merged." Two orphaning incidents this sprint (#316→#317, #324→#325) justify making this a checklist item, not a habit.

3. **Deploy verification must assert the deployed image SHA/commit == `main` HEAD — not just the auth status.** A 200/401 check proves the gate works; it does not prove the code is current (T-81 was 46 commits stale behind a perfectly good 401). Every dashboard/app go-live verification must include an image-tag/commit-SHA assertion against `main` HEAD. This is now the standard for all deploy-verify workflows.

4. **Known quirk — flaky required-checks trigger on push-to-open-PR; workaround is close/reopen the PR.** Not scheduled for a fix (likely a GitHub Actions event-delivery quirk). Captured here so a future session recognizes the symptom (a fresh push to an open PR leaves required checks un-fired, PR un-mergeable, no failing signal) and applies the known workaround (close then reopen the PR to re-fire the workflow) instead of re-diagnosing it.

5. **When a background/delegated agent crashes with no report, treat the task as *unverified*, not merely *undamaged*.** T-81's crash left no damage but also left the job unfinished behind a reassuring health signal. A crashed delegation's work must be independently re-verified end-to-end (including artifact currency, per change 3) before it's trusted — "no live damage found" is not "the task completed."

---

## 6. Sprint goal / exit-criteria status

**No milestone was targeted this sprint** — same posture as Sprint 6: capability-building work in the gap between the team's M6 ("TTS Live in Production," 2026-07-03) and whichever milestone the founder next signals. Per the standing **Milestone numbering note** (`WORK.md`), this work is deliberately **not** labeled M7: charter-M7 is gated on an exogenous tenant-onboarding event that has not happened (FQ-43, DNC deferred indefinitely). Numbering is revisited only on a founder decision that reopens tenant onboarding.

| Exit criterion | Status |
|---|---|
| Three write surfaces (model routing / SLA / feature flags) built behind RLS + least-privilege + fail-closed `with check` | ✅ T-72–T-75 |
| Atomic `audit_log` write on every config change (same transaction) | ✅ T-74 — verified atomic by T-78 |
| Respond + KB Learn split off Triage's shared model config (backend gap closed) | ✅ T-73 — each function resolves its own model |
| Security Lead RLS + least-privilege review (gates schema apply + go-live) | ✅ T-76 — APPROVED, zero changes |
| Eval-gate reconciliation without relaxing a standing constraint | ✅ T-79 — curated allowlist enforces, doesn't relax |
| Auth-identity decision resolved (FQ-66) | ✅ T-77 — Option B (founder) |
| QA write-path verification, all checks pass | ✅ T-78 — 21/21 (after T-82) |
| Live on staging + prod, gated + verified | ✅ T-81 — both environments, independently verified |

---

## 7. Open risks / carried-forward going into Sprint 8

| Item | Type | Note | Owner |
|---|---|---|---|
| **`audit_log_insert` (and any other) policy drift** — same root cause found twice (`kb_articles_write`, `feature_flags_write`). A third instance is foreseeable. | Risk → **scheduled** | One-shot read-only `pg_policy`-vs-migrations reconciliation. Sprint 8 opener. | T-83 (Tech Lead + Security Lead + founder apply) |
| **`evals/kb-learn.yaml` does not exist** — KB Learn is the only agent function with zero prompt eval coverage; its allowlist is pinned to a single option specifically because of this gap. | Coverage gap → **scheduled** | Writing this eval is what unblocks giving KB Learn a real model choice. | T-84 (Evals Lead) |
| **T-62 freeze-schema + QA E2E** — carried from Sprint 6; prod LiteLLM apply-wall done, freeze held for a (now-elapsed) 24h window. | Carry → **scheduled** | Dispatch freeze-schema + QA E2E to fully close T-62. | T-85 (Production Manager + QA) |
| **The "real" eval gate does not exist** — CLAUDE.md asserts a >95% Promptfoo gate, but CI's Eval Gate has been schema-validation-only since T-17/T-58. Flagged in T-58 and T-79 without ever being scheduled. | Gap → **ADR spike scheduled, build deferred** | Too large to build alongside the reconciliation + KB Learn eval work without repeating the overcommit pattern. Sprint 8 produces the design-of-record ADR (T-87); build targets Sprint 9. | T-87 (Evals Lead + Tech Lead) |
| **T-76 Advisory C1** — non-blocking hardening: revoke write verbs from `authenticated`/`anon` on `agent_model_routing`. | Carry (non-blocking) | Not itself a scheduled task, but if T-83 yields a fix migration anyway, folding C1's grant-revoke into that same migration is one Security Lead review + one founder apply instead of two. | Carried; opportunistic under T-83 |
| **Per-user session auth (T-77 Option A)** — deferred; the write surface accepts a single shared Basic Auth credential (`audit_log.actor = "dashboard"`, not an individual human). | Carry (founder-gated) | Documented upgrade path; revisit when a second dashboard user is added or a SOC-2 audit needs per-human attribution. Not scheduled. | Carried |
| **FQ-63** (staging dashboard real-TLS domain) | Carry (founder action) | Non-blocking cosmetic upgrade; the dashboard sits on a plain-HTTP sslip.io preview meanwhile. | Carried |
| **FQ-47 action 4b** (UptimeRobot paid-tier auto-incident posting) | Carry (founder / free-tier) | Deferred per free-tier-first; status page is live and manually updatable. | Carried |
| **DNC / second-tenant onboarding** | Carry (founder decision) | Deferred indefinitely per FQ-43; revisit only on founder signal. | Carried |

---

*Sprint 7 shipped the write surface cleanly and resolved both gating decisions the right way — enforcing the eval gate rather than relaxing it, and escalating only the genuine business call. But its most valuable output was diagnostic: QA's live run exposed a policy that had been silently broken for over two weeks, revealing that the same 2026-06-22 apply has now bitten us twice. The sprint's process failures — orphaned PR stacks, a stale-but-gated deploy, a crashed delegation that "looked fine" — all share one shape with that policy gap: a record (a merge, a 401, a status row, a migration file) that claimed something true while the live thing was not. Sprint 8 opens by closing that class of risk deliberately (T-83) instead of waiting to find instance number three in production.*
