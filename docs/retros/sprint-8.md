# Sprint 8 Retrospective — Drift Reconciliation + Eval Coverage

**Sprint window:** July 9–23, 2026 (effective: all tasks delivered same-day, 2026-07-09)
**Author:** PM
**Date:** 2026-07-09
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`, founder escalations in `FOUNDER_QUEUE.md`, design of record in `docs/adr/0007-real-eval-gate.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Close the class of live-vs-record **drift** that both Sprint 6 and Sprint 7 kept surfacing the hard way — starting with a one-shot reconciliation of every live `pg_policy` row against what the migration files *should* have created (T-83, the sprint anchor). In parallel, close two eval-coverage gaps flagged repeatedly but never scheduled: write the missing **KB Learn prompt eval** (T-84, the only agent function with zero eval coverage) and produce the **design-of-record ADR for the "real" LLM-rubric eval gate** (T-87, build deferred to Sprint 9). Finish the genuine Sprint 6 carry (T-62 freeze-schema + QA E2E, via T-85). Deliberately a hardening sprint, not a feature sprint — it directly executes both prior retros' #1 process change.

**Outcome: The drift class is closed proactively (T-83: zero gaps, the first time this team got ahead of it instead of finding a break in production). The eval-coverage gaps are closed — KB Learn now has a working eval passing 100% against a hardened prompt (T-84/T-88), and ADR-0007 is Accepted with the Tech Lead's CI/architecture review appended, sizing the Sprint 9 build as medium. But the sprint's defining event was unplanned: T-85's pre-flight surfaced FQ-69 — 70% of production tickets (14/20) stuck un-triaged for up to 3.6 days — as a *side effect* of a routine verification, not proactively. It had two stacked root causes and exposed a real monitoring blind spot. It is fully resolved, the entire backlog drained on real data, but how it was found is the honest lesson of this sprint. No milestone declared — capability/hardening work (see §6).**

| Task | Owner | Result |
|---|---|---|
| T-83: One-shot live `pg_policy`-vs-migrations reconciliation (sprint anchor) | Tech Lead + Security Lead (review gate) + Founder (apply) | ✅ Done — **zero drift.** 20 policies across 9 tables enumerated from all 14 migrations, live dump matched 1:1; no fix migration needed. `audit_log_insert` (named target) confirmed. T-76 Advisory C1 resolved as a non-issue en route |
| T-84: Author `evals/kb-learn.yaml` — close the KB Learn eval gap | Evals Lead | ✅ Done (PR #337) — 4 `llm-rubric` tests @0.8. First live run read 25% but that was a **harness bug**, not a vulnerability (see §4.2); superseded by T-88's corrected 100% |
| T-88: Harden KB Learn's system prompt + code-level PII guard | Tech Lead | ✅ Done (PR #344) — **100% (4/4), twice.** Injection-resistance framing, PII generalization, defense-in-depth `generateKbArticle()` guard, +10 unit tests. Fixed the T-84 harness bug itself |
| T-85: Close T-62 — LiteLLM-prod `freeze-schema` + QA E2E verification | Production Manager + QA Manager | ✅ Done — freeze-schema live+verified; **surfaced and resolved FQ-69** (two stacked root causes); full 14-ticket backlog drained end-to-end on real data — a stronger proof than a synthetic E2E injection |
| T-86: CLAUDE.md stale-facts fix (migration count + eval-gate caveat) | Tech Lead (PM landed at planning) | ✅ Done (PR #333) — migrations `5 → 14`; eval-gate constraint now honestly flags schema-only-until-ADR-0007; Active-sprint pointer `6 → 8` |
| T-87: Author ADR-0007 — design-of-record for the real LLM-rubric eval gate | Evals Lead (author) + Tech Lead (CI/architecture review) | ✅ Done — **Accepted** (PR #354, merged to `main`). All 8 required contents; Tech Lead ratified the trigger/secret posture and sized the build **medium** with four build conditions (C1–C4) |

---

## 2. What worked

- **T-83 got ahead of the drift class instead of finding instance #3 in production — exactly what both prior retros asked for.** Sprint 5 lost `kb_articles_write` and Sprint 7 lost `feature_flags_write` to the same botched 2026-06-22 hand-apply, each found only when a write silently broke. T-83's one-shot read-only dump-and-diff (self-listing all 20 policies from the 14 migration files, then dumping the live catalog via `ops_hub_app` — never `service_role`) returned **exactly 20 rows, matching 1:1** — every migration-defined policy present, no unexpected extras, `audit_log_insert` (the explicitly-named third suspect) confirmed correctly scoped. Zero gaps means no fix migration and no founder apply were needed. This is the first time the team closed a foreseeable-risk class *before* it broke rather than *because* it broke. It also cleared T-76 Advisory C1 as a non-issue on live evidence (zero `authenticated`/`anon` write grants on `agent_model_routing` exist — nothing to revoke), retiring a carried item rather than carrying it again.

- **The disciplined ADR-not-build call held, and the ADR earned its keep.** Sprint 8 deliberately produced ADR-0007 as a *design spike* rather than pairing the full eval-gate build with reconciliation + KB Learn eval + T-62 closeout — precisely to avoid repeating the Sprint 5 overcommit pattern. The payoff is visible: the ADR arrived complete (all 8 required contents), the Tech Lead's review ratified the load-bearing trigger/secret decision and surfaced four concrete build conditions (C1–C4) that would otherwise have been discovered mid-build, and Sprint 9 now scopes a *medium* build from a settled design instead of a research spike. Deferral that is scheduled, scoped, and named is not a punt.

- **The calibration guards in ADR-0007 §5 turn a painful bug into a permanent structural defense.** The T-84 harness bug (below) is not just logged — it is designed against. The ADR bakes in a mandatory per-run token-count sanity assertion, per-eval must-pass/must-fail canaries, and a grader≠target rule, so the *next* silent-measurement failure (in either direction — under- or over-reporting) becomes a loud hard error instead of a confident wrong number. The team converted a "how did our tooling mislead us" story into a control.

- **FQ-69 was resolved with real-data proof, not a synthetic green light.** Rather than declaring the pipeline healthy off a test injection, the fix was validated by watching all 14 previously-stuck real production tickets drain to `state='responded'` within ~13 minutes of the master-key alignment (full distribution 14 `responded` + 6 `resolved` = 20/20, zero remaining in `new`). That is a stronger end-to-end signal than the originally-planned QA E2E ticket would have given — the backlog *was* the test.

- **Read-only-first discipline was maintained throughout a live incident.** Every diagnostic in the FQ-69 chain (`diagnose-litellm-prod-container.yml`, `diagnose-ops-hub-prod-litellm-url.yml`, `verify-agent-cost-feed.yml`, `diagnose-stuck-triage-tickets.yml`, `diagnose-ops-hub-prod-triage-blocked.yml`) was read-only and RLS-scoped via `ops_hub_app`; the superuser `SUPABASE_STAGING_DB_URL` credential was deliberately *not* used to read prod ticket content, staying inside the CLAUDE.md #3 service-role-at-runtime posture even under incident pressure. Every mutating fix (`fix-ops-hub-prod-litellm-url.yml`, `fix-ops-hub-prod-litellm-master-key.yml`) carried a typed confirmation gate and a self-aborting pre-flight, and none ran without explicit user authorization.

---

## 3. What didn't work (or cost more than it should have)

- **FQ-69 was found reactively, as a side effect of T-85's pre-flight — not proactively.** This is the honest headline. A customer-impacting incident — 70% of live production tickets stuck un-triaged for up to 3 days 14 hours — was surfaced only because QA re-ran read-only diagnostics before a routine E2E injection, per the T-71 precedent. Nothing was *watching* for it. The 3.6-day-old rows prove it had been failing silently that entire time with no alert. The whole sprint was about closing the gap between "the record says X" and "the live thing is Y," and this incident is the most expensive instance of exactly that gap — the pipeline's own health signals said green while 70% of real tickets went nowhere. Finding it was good luck riding on good discipline; it should not have depended on either.

- **Our own eval tooling produced a misleading 25% pass rate that read like a security finding but wasn't.** T-84's first live run reported 1/4 (25%) and was initially written up as a confirmed production prompt-injection + PII-leak vulnerability. It was a harness bug (§4.2). The tooling manufactured false alarm rather than false confidence this time — but the symmetric danger (a harness that silently *over*-reports and passes a genuinely broken prompt) is the more dangerous one, and the same bug class enables both. A gate you can't trust to measure what it claims to measure is worse than no gate.

- **`/health/litellm` is structurally incapable of detecting the failure mode that caused FQ-69.** The probe hits `LITELLM_EXTERNAL_URL` (the public HTTPS path via Traefik) using LiteLLM's *own* key — not the internal `LITELLM_URL` that `ticket-triage.ts`/`ticket-respond.ts` actually call, and not the app's *own* `LITELLM_MASTER_KEY` that was being rejected. So the monitor returned a reassuring 200 (`litellm:"reachable"`) throughout an incident where every real triage call was 401-ing. This is a monitoring blind spot, not a flaky check: the health probe and the production code path exercise different URLs *and* different credentials, so the probe can be green while the real path is 100% broken. It is the same shape as Sprint 6's observation that a green `/health` didn't catch T-71's 100%-failing triage — now confirmed a second time on a different root cause.

- **This is the second time `LITELLM_URL` drift after a LiteLLM container restart has caused an incident (T-71, then this).** The freeze-schema restart in T-85 moved litellm-prod's internal Docker container suffix, ops-hub-prod's `LITELLM_URL` still pointed at the pre-restart container, and nothing in the T-62/T-85 workflow chain re-synced it — the identical mechanism as the T-71 outage. It was a predictable, known failure mode that recurred because no checklist step or monitor closed it after the first occurrence. (Notably, it was *not* the deeper cause here — see §4.1 — but it was a real, second-instance regression on its own.)

---

## 4. Incidents, blockers, and resolutions

### 4.1 FQ-69 — 70% of production tickets stuck un-triaged; two stacked root causes (T-85)

**How it was found:** During T-85's QA E2E pre-flight, following the T-71 precedent, the team re-ran read-only diagnostics *before* injecting a test ticket. That pre-flight — not any monitor or alert — surfaced the incident.

**Root cause is two distinct faults stacked on top of each other, discovered in the order they were peeled back:**

1. **Stale `LITELLM_URL` (the recent, shallower layer).** T-85's freeze-schema restart moved litellm-prod's container suffix; ops-hub-prod's `LITELLM_URL` still pointed at the dead pre-restart container (plus a Coolify duplicate-row footgun — 2 `LITELLM_URL` entries). Same class as T-71. **Fixed** (user-authorized) via `fix-ops-hub-prod-litellm-url.yml` ([run 29039193854](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29039193854)): stale rows deleted, correct value set, restart healthy. *But fixing it did not clear the backlog* — the newest stuck ticket was still stuck ~24 minutes and several `sweepNewTickets` cycles later. Something else was also broken.

2. **`LITELLM_MASTER_KEY` mismatch (the older, 3.6-day root cause).** A consolidated read-only diagnostic (`diagnose-ops-hub-prod-triage-blocked.yml`, PRs #349/#350) proved via a **live 401**, not merely a hash diff, that ops-hub-prod's `LITELLM_MASTER_KEY` (sha256[0:16] `6d8b57842c40a030`) was outright rejected by litellm-prod (`90b285b2d96353e1`): a probe with the app's own key returned **HTTP 401 `token_not_found_in_db`** — LiteLLM's error for a token that is neither the master key nor a registered virtual key. So every `classifyTicket` 401'd on both primary and fallback → `triageOneTicket` threw before `UPDATE … SET state='triaged'` → the ticket never left `new`. This matched the DB signature exactly (`owner_agent` NULL + `since_last_update`==`age` on all 14 stuck rows) and *predated today entirely* — it is the real cause of the 3.6-day backlog; the `LITELLM_URL` staleness was a second, more recent fault layered on top of an already-broken pipeline.

**Two false leads, both correctly retired on evidence:** (a) the "seeded/test data" hypothesis (four tickets sharing a microsecond-identical timestamp) was **disproven** — all 20 tickets carry distinct non-null FreeScout conversation ids, and the identical timestamps are the poller inserting a whole poll batch in one transaction (Postgres freezes `now()` per transaction). The tickets are real. (b) The external smoke test that "passed" throughout was a genuine blind spot — it used litellm-prod's own key, never the app's.

**Resolution:** `fix-ops-hub-prod-litellm-master-key.yml` ([run 29043946687](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29043946687), user-authorized) — self-abort pre-flight reconfirmed the key was still rejected immediately before mutating (diagnosis held, not stale), deleted the duplicate rows, set the correct value, restarted, and a post-fix probe confirmed the aligned key authenticates (200). ~13 minutes and 2+ `sweepNewTickets` cycles later, the full backlog had drained to 14 `responded` + 6 `resolved` = 20/20 on real data. T-62/T-85/FQ-57/FQ-69 all closed together.

**Follow-up flagged (→ §5):** *how* the keys diverged is not root-caused (likely a litellm-prod key rotation on a redeploy that never propagated to ops-hub-prod). And `/health/litellm` structurally cannot catch this class. Both point at a monitor that exercises the app's *real internal auth path*.

### 4.2 T-84 eval-harness bug — a misleading 25% that read like a vulnerability (T-84 → T-88)

**What happened:** T-84's first live run against `triage-model` scored **1/4 (25%)** and was initially written up (in DECISIONS.md, since corrected) as a confirmed production prompt-injection + PII-leak vulnerability — the run output literally "PWNED" and echoed seeded PII verbatim. It read like a real, alarming security finding.

**It was a harness bug, not a vulnerability.** The run harness copied KB Learn's system prompt into the swapped-in `openai:chat:triage-model` provider's `config.system` field — but **the openai-compatible provider silently ignores `config.system`** (only the anthropic reference provider honors it). Token-count forensics were dispositive: that run's 4 calls totaled 497 prompt tokens (~124/call), versus the ~853/call the correct harness produces — the ~850-token system prompt reached *zero* of the calls. The 25% measured a model running with **no instructions at all**, not KB Learn's configured behavior. Production's real path (`generateKbArticle`) sends the system message correctly via the messages array, so the original prompt was never confirmed exploitable under a correct measurement.

**Resolution:** T-88 fixed the harness bug itself (system prompt now delivered as a real system-role message via a generated prompt function), hardened the prompt on prompt-engineering merit anyway (explicit injection-resistance framing, PII-generalization, stricter JSON contract + two few-shot examples), and added a defense-in-depth code guard that re-scans parsed `title`/`body` for PII patterns after JSON parse but before INSERT (fail-closed, independent of prompt quality). Verified **100% (4/4), twice** ([run 28997680312](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28997680312), [run 28997984109](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28997984109)), both ~853 prompt tokens/call confirming the system prompt genuinely reaches the model.

**Root-cause pattern:** our own eval tooling produced a confident, specific, wrong number that survived until token-count forensics unmasked it. "Be careful next time" is not a control. The generalizing lesson is captured *structurally* in ADR-0007 §5 (calibration plan — token-count sanity assertion, per-eval canaries, grader≠target) — cross-referenced here rather than duplicated, and a Sprint 9 build obligation. T-88 also flagged that the same `config.system`-on-openai-provider bug class could bite any *future* live-run override written for the other two evals — which is exactly why ADR-0007 §6 step 1 fixes it once in the shared runner.

---

## 5. Process changes for Sprint 9 (and standing, going forward)

The three FQ-69 changes below address **different layers** of a stacked failure — they are complementary, not redundant. (b) closes the URL-drift layer only; it would **not** have caught the master-key mismatch that was the actual 3.6-day root cause — that is what (a) exists for. Do not read any one of them as "the fix for FQ-69."

1. **(a) Build a monitor that exercises the app's actual internal LiteLLM auth path — not just external reachability.** `/health/litellm` probes `LITELLM_EXTERNAL_URL` with LiteLLM's own key and is structurally blind to the app's own key being rejected on the internal hop (§3, §4.1). A monitor that makes a real, minimal completion call over the internal `LITELLM_URL` using the app's *own* configured `LITELLM_MASTER_KEY` (or a scoped key) would have caught FQ-69's master-key mismatch on day one instead of day 3.6. → **Sprint 9 committed task** (internal-auth-path probe). The broader "synthetic ticket → assert it triages end-to-end" downstream monitor (Sprint 6 §7) partially rides on this but is larger; it stays a **flagged carry**, not committed this sprint (see §7 and the DECISIONS.md scoping call).

2. **(b) Standing checklist step: re-verify `LITELLM_URL` after ANY litellm-prod (or litellm-staging) container restart.** This is now the **second** time `LITELLM_URL` drift after a LiteLLM container restart has caused an incident (T-71, then FQ-69's shallow layer). The internal Docker suffix changes on every restart/redeploy of that container (CLAUDE.md says so explicitly), and no workflow re-syncs the consumer. Any task that restarts or redeploys a LiteLLM container must, as a checklist step, re-run `diagnose-ops-hub-prod-litellm-url.yml` (and the staging equivalent) and confirm exactly one correct `LITELLM_URL` row before declaring done. Scope note: this addresses the URL layer only — it is necessary but not sufficient; pair it with (a).

3. **(c) Harness-correctness is a standing eval-authoring requirement — captured in ADR-0007 §5, enforced in the Sprint 9 build.** The generalizing lesson from §4.2: any live eval run must prove it measured what it claims to (token-count sanity band per eval, must-pass/must-fail canaries, grader≠target). This is already designed in ADR-0007 §5 (calibration plan) and §6 step 1 (fix the `config.system` class once in the shared runner) — cross-referenced rather than duplicated here. The build obligation is to encode these as hard guards so a broken harness errors loudly instead of reporting a confident wrong number, in either direction.

4. **Standing (carried from Sprint 7, reaffirmed): deploy-verify must assert deployed image SHA == `main` HEAD, and a crashed delegation's work is *unverified* until independently re-checked.** Both held up this sprint and remain in force.

---

## 6. Sprint goal / exit-criteria status

**No milestone was targeted this sprint** — same posture as Sprints 6–7: capability/hardening work in the gap between the team's M6 ("TTS Live in Production," 2026-07-03) and whichever milestone the founder next signals. Per the standing **Milestone numbering note** (`WORK.md`), this work is deliberately **not** labeled M7: charter-M7 is gated on an exogenous tenant-onboarding event that has not happened (FQ-43, DNC deferred indefinitely). Numbering is revisited only on a founder decision that reopens tenant onboarding.

| Exit criterion | Status |
|---|---|
| One-shot live `pg_policy`-vs-migrations reconciliation; close the drift class (`audit_log_insert` a named verify-target) | ✅ T-83 — zero gaps, no fix migration needed, class closed proactively |
| KB Learn prompt eval authored and passing >95% | ✅ T-84 (authored) + T-88 (hardened) — 100% (4/4), twice, against the real production model via a corrected harness |
| Design-of-record ADR for the real LLM-rubric eval gate (design only; build deferred) | ✅ T-87 — ADR-0007 **Accepted**, Tech Lead review appended, build sized **medium** |
| CLAUDE.md stale-facts corrected (migration count + eval-gate honesty caveat) | ✅ T-86 — `5 → 14`, eval-gate caveat, Active-sprint pointer `6 → 8` |
| Close the T-62 carry (LiteLLM-prod freeze-schema + verified pipeline health) | ✅ T-85 — freeze-schema live+verified; pipeline health proven by real-data backlog drain (stronger than a synthetic E2E) |
| Unplanned: FQ-69 production incident found mid-sprint | ✅ Resolved — both stacked root causes fixed, full backlog drained 20/20 on real data |

---

## 7. Open risks / carried-forward going into Sprint 9

| Item | Type | Note | Owner |
|---|---|---|---|
| **The "real" LLM-rubric eval gate does not exist** — CLAUDE.md asserts a live >95% gate; CI is still schema-validation-only. ADR-0007 is the Accepted design. | Gap → **build scheduled** | Sprint 9 anchor. Medium build per ADR §7; C1–C4 (Tech Lead review) fold into the build tasks. | Sprint 9 (Evals Lead + Tech Lead; Production Manager + Security Lead on the scoped key) |
| **No monitor exercises the app's real internal LiteLLM auth path** — `/health/litellm` is structurally blind to it (FQ-69, and T-71 before it). | Risk → **committed** | Internal-auth-path probe. Second incident from this blind spot; strong justification to commit now. | Sprint 9 (Production Manager, monitor/alert) |
| **No synthetic downstream-triage E2E monitor** — a green `/health` didn't catch T-71's or FQ-69's 100%-failing triage. | Risk → **flagged carry** | Larger than the internal-auth probe and partly subsumed by it + the real-data drain evidence. Judged not-yet-ready to commit; revisit once the auth probe lands. | Carried (flagged) |
| **KB Learn model allowlist is pinned to one model** — mechanically unblocked now that T-84/T-88 pass 100%. | Unblocked → **scheduled** | Widen `kb_learn`'s allowlist to a vetted second alias. Preferred vetting path: through the new eval gate (ADR §8) once live; explicit exit criteria in WORK.md. | Sprint 9 (Evals Lead) |
| **Root cause of the master-key divergence itself** (how litellm-prod's key rotated without propagating to ops-hub-prod). | Risk (non-blocking) | Root-cause-of-the-root-cause; likely a redeploy key rotation. Worth a hardening pass; partly mitigated by the internal-auth monitor. | Carried (flagged) |
| **`LITELLM_URL` Coolify duplicate-row footgun** — 2 rows currently hold the identical correct value (cosmetic). | Risk (non-blocking) | Dedup opportunistically (re-run `fix-ops-hub-prod-litellm-url.yml`); not a cause today. | Carried (flagged) |
| **Per-user session auth (T-77 Option A)** — write surface accepts a single shared Basic Auth credential. | Carry (founder-gated) | Documented upgrade path; revisit on a second dashboard user or a SOC-2 per-human-attribution need. | Carried |
| **FQ-63** (staging dashboard real-TLS domain) | Carry (founder action) | Non-blocking cosmetic upgrade. | Carried |
| **FQ-47 action 4b** (UptimeRobot paid-tier auto-incident posting) | Carry (founder / free-tier) | Deferred per free-tier-first; status page live and manually updatable. | Carried |
| **DNC / second-tenant onboarding** | Carry (founder decision) | Deferred indefinitely per FQ-43; revisit only on founder signal. | Carried |

> Note: **T-76 Advisory C1 does not carry forward** — T-83 confirmed on live evidence that zero `authenticated`/`anon` write grants exist on `agent_model_routing`, so there is nothing to revoke. Resolved, not carried.

---

*Sprint 8 did what it set out to do: it closed the `pg_policy` drift class proactively (T-83), the first time this team got ahead of that class instead of finding it broken in production. But the sprint's most important lesson came from the thing it did not plan for. FQ-69 — 70% of real production tickets stuck for 3.6 days behind a rejected master key, under a health check that reported green the whole time — is the same shape as every drift this sprint targeted: a signal that claimed something true while the live thing was not. It was found by discipline (a read-only pre-flight) rather than by design (a monitor watching the real path). And the T-84 harness bug showed the failure can come from our own tooling too — a confident 25% that measured nothing. Sprint 9 turns both lessons into controls: a real eval gate whose calibration guards make a broken harness fail loud, and a monitor that exercises the app's actual internal auth path instead of a reassuring external proxy.*
