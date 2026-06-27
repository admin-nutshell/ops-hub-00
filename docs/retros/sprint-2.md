# Sprint 2 Retrospective — AI Triage Pipeline

**Sprint window:** June 27, 2026 (closed 10 days before the planned July 7–18 window)
**Author:** PM
**Date:** 2026-06-27
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`, founder escalations in `FOUNDER_QUEUE.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Wire and validate the full AI ticket pipeline — Supabase polling → Inngest → LiteLLM triage → auto-response → Supabase state change. Close M1 criteria #11 (incident drill + post-mortem) and #12 (DNC tickets flowing).

**Outcome: All 7 active tasks complete. M1 criteria #11 + #12 closed. Pipeline live in staging.**

| Track | Tasks | Result |
|---|---|---|
| A — API Polling Intake | T-21 | ✅ Done 2026-06-23 |
| B — AI Agents | T-22, T-23 | ✅ Done 2026-06-26/2026-06-25 |
| C — Testing + Evals | T-24, T-25 | ✅ Done (PRs #148, #154) |
| D — Delivery + Milestone Close | T-26, T-27 | ✅ Done 2026-06-27 |

T-28 (Sprint 1 retro) and T-29 (monthly briefing, July 31) ran in the milestone tail; T-28 is done, T-29 carries forward to Sprint 3.

**The headline result:** A real test email sent to `support@inatechshell.ca` now flows end-to-end — FreeScout fetches it, Inngest triages it via LiteLLM (gpt-4o-mini), responds with an AI draft as an internal FreeScout note, and writes `state=responded` to Supabase — with the correct `tenant_id` routing the ticket to the right project. The founder confirmed this on 2026-06-27 for both the drill (T-26) and the DNC test (T-27).

**Sprint delivery pace:** Sprint 2 was planned for July 7–18, 2026. It closed June 27 — more than 10 days before its planned start. All 7 tasks were code-complete and founder-confirmed within a single extended working session. The calendar drift is logged in DECISIONS.md and corrected in WORK.md.

---

## 2. What worked

- **Supabase direct polling as the intake strategy (T-21).** The FreeScout REST API path (webhooks module, Api module) was abandoned in Sprint 1 pre-planning after both required paid modules or SSH. Supabase direct polling of the `conversations` table was cleaner, fully testable in CI, and dependency-free. Once GRANT SELECT was issued to `ops_hub_app`, T-21 shipped in one session.
- **LangFuse tracing in both functions.** Wiring `trace("ticket-triage")` and `trace("ticket-respond")` from the start means every production run is observable without adding instrumentation later. The habit of "trace first, optimize later" is the right default.
- **App-agnostic poller design (T-27).** Reading `POLLING_PROJECT_ID` and `POLLING_TENANT_ID` from env instead of hardcoding TTS IDs means switching tenants requires zero code changes — only a Coolify env var update. The DNC onboarding was confirmed by the founder with a single test email after the env vars were set.
- **OpenAI fallback execution when NVIDIA blocked (FQ-40).** When NVIDIA NIM's API key returned persistent 401s despite three retry cycles, the Production Manager pivoted to gpt-4o-mini via OpenAI as the sole triage provider rather than continuing to debug. The decision was made autonomously, logged, and executed (PR #176) without escalating to the founder for a "pick a provider" decision. This is exactly the operating model (technical decisions are agent-owned).
- **Eval gate on pipeline functions (T-25).** PR #154 added 4 eval cases each for `ticket-triage` and `ticket-respond`, tested against the exact prompt and enum values used in production. Catching that the eval had to assert `{critical|high|normal|low}` (the actual LLM enum) rather than P1/P2/P3 (the human severity label) before the PR merged prevented a false-green eval suite.
- **Fail-safe config-gating on T-23.** `respondTicket` was designed to throw if `FREESCOUT_DB_URL` is absent, leaving the ticket at `triaged` rather than corrupting state. The configuration gate meant the function could be deployed before its credential was provisioned — no blocking or partial-state risk.

---

## 3. What didn't work (or cost more than it should have)

- **NVIDIA NIM blocked the critical path for a full incident cycle.** T-22 required a working LiteLLM triage model. NVIDIA's API key returned 401 across three workflow runs (FQ-40) — the key was valid for the service but had an authentication mismatch against `integrate.api.nvidia.com`. Each retry cycle consumed a complete diagnose→escalate→wait→retry loop before the pivot was made. The pivot to OpenAI was the right call, but it should have been a 1-run decision, not a 3-run diagnosis.
- **LiteLLM's Prisma migrations wiped public schema tables twice (ADR-0004).** LiteLLM's internal Prisma engine ran `migrate reset --force-reset` on redeploy and dropped the Ops Hub `tickets`, `tenants`, and `conversations` tables along with its own. This required defining `litellm_db_user` as a non-superuser owner of a separate `litellm` schema with zero rights on `public` — the only permission boundary that Prisma's force-reset cannot cross. The fix is correct and now documented (ADR-0004), but it surfaced a fundamental assumption about `STORE_MODEL_IN_DB=True` that should have been audited at T-08.
- **FreeScout GRANT lost on every FreeScout schema reset.** The `GRANT SELECT ON conversations, threads TO ops_hub_app` was wiped a second time when FreeScout re-ran its Laravel migrations (same root cause as the first wipe). The permanent fix (`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app` via `artisan tinker`) was applied (FQ-41) but required another founder-run artisan tinker cycle. This is the second time we paid for the same gap.
- **FQ-42 required 3 founder steps on the critical path.** The DNC onboarding (T-27) needed: (1) a Supabase migration applied via SQL Editor, (2) two Coolify env vars set and a full redeploy triggered, (3) a test email sent and the Supabase row confirmed. All three are operations agents cannot perform. Staging was blocked until all three were done. The FQ was filed clearly and resolved same-day — this is good — but the dependency on sequential human steps on the critical path is a structural cost.
- **T-23 write-back credential (FREESCOUT_DB_URL) was not pre-provisioned.** The `respondTicket` function was code-complete but dormant until `FREESCOUT_DB_URL` was set in Coolify. This was a known gap filed in FQ-34, but the provisioning was not fully tracked to completion ahead of the T-26 drill. The function worked by the time of the DNC test, which means the env var was set — but the exact timing and FQ closure weren't as tight as they should have been.

---

## 4. Incidents, blockers, and resolutions

### 4.1 NVIDIA NIM API 401 — LiteLLM triage model unavailable (FQ-40)

T-22 (`triageTicket`) calls LiteLLM, which was configured with NVIDIA NIM as the backend for `triage-model`. NVIDIA returned HTTP 401 (`AuthenticationError`) across three workflow runs (#28210294811, #28210675694, and an earlier run). The NVIDIA API key was present in the container (confirmed via Coolify API) and the registration call itself succeeded — but the inference call to `integrate.api.nvidia.com/v1` was rejected.

**Resolution:** Production Manager autonomously pivoted — created `configure-litellm-openai-only.yml` (PR #176), purged all NVIDIA model registrations, registered `gpt-4o-mini` as both `triage-model` and the Llama alias. T-22 validated the same day. NVIDIA is no longer in the path. `OPENAI_API_KEY` confirmed working; `NVIDIA_API_KEY` retained in Coolify in case it's needed elsewhere.

**Lesson:** When a third-party provider returns 401 for 3 consecutive runs with no change in key value, the correct call is to pivot to the fallback — not retry. The decision should be made at run 2, not run 3. Standing rule: after 2 consecutive 401s from the same provider with a confirmed valid key on the other provider, pivot immediately and log the decision.

### 4.2 LiteLLM Prisma force-reset wiping Ops Hub tables (ADR-0004)

LiteLLM uses Prisma internally with `DATABASE_URL` pointing at the Supabase public schema. On at least two redeploys, Prisma's `migrate reset --force-reset` dropped all tables in public — including `tickets`, `tenants`, `conversations`, and the FreeScout tables. This was the root cause of the repeated schema resets that also cleared FreeScout's DB and triggered the second GRANT loss.

**Resolution:** ADR-0004 defines the isolation boundary: create `litellm_db_user` (non-superuser, non-BYPASSRLS, no rights on `public`), a separate `litellm` schema owned by that role, and set `DISABLE_SCHEMA_UPDATE=true` after first boot. Prisma's `--force-reset` can only 42501-fail on public now. The runbook is at `docs/engineering/litellm-db-isolation-runbook.md`. Founder SQL + GitHub secret update still pending (Production Manager tracking).

**Lesson:** Any tool that runs a database migration engine (`prisma migrate`, `alembic`, `flyway`) against a shared schema is a schema-wipe risk. Audit all such tools at deploy time, not after the first incident. Standing rule: if a tool with its own ORM ships `STORE_*_IN_DB=True` or any migration flag, isolate it to a dedicated schema/role before the first prod-equivalent deploy.

### 4.3 FreeScout GRANT lost on second schema reset

Same root cause as the Sprint 1 GRANT loss (§4 of Sprint 1 retro): FreeScout's Laravel migrations on startup reset the public schema, wiping the `ops_hub_app` SELECT GRANT on `conversations` and `threads`. This happened a second time on 2026-06-26.

**Resolution:** FQ-41 filed; founder re-ran the two `artisan tinker` commands (GRANT + ALTER DEFAULT PRIVILEGES). The ALTER DEFAULT PRIVILEGES command is the permanent fix — any table FreeScout creates will carry the grant automatically on future resets.

**Lesson:** This should have been caught the first time. After the first GRANT loss, the permanent fix (`ALTER DEFAULT PRIVILEGES`) should have been applied *at that time*, not deferred. Any stateful GRANT that isn't backed by a default privilege is a ticking re-occurrence. Going forward: any GRANT on a table owned by another role must be paired with `ALTER DEFAULT PRIVILEGES` in the same artisan session.

### 4.4 FQ-42 three-step founder dependency on the critical path (T-27)

T-27 (DNC onboarding) required three sequential founder actions that could not be automated: (1) Supabase SQL Editor migration, (2) Coolify env vars + redeploy, (3) DNC test email confirmation. These are all ops-not-business tasks — but they required human hands on privileged tooling the agents don't hold.

**Resolution:** FQ-42 filed with a clear copy-paste runbook for each step; founder completed all three same-day (2026-06-27). T-27 and M1 #12 closed.

**Lesson:** When a feature's validation requires multiple sequential human-manual steps, those steps should be packaged as a single atomic founder task ("here are 3 sequential actions; do them in order") rather than filed as separate FQ items. The copy-paste runbook format in FQ-42 achieved this and was efficient. Repeat this pattern.

---

## 5. Process changes for Sprint 3

These come directly from Sprint 2 failures.

1. **Pivot on provider 401 at attempt 2, not 3.** If a cloud provider returns 401 for 2 consecutive workflow runs with no change in key value, and the fallback provider is confirmed working, pivot immediately and log the decision in DECISIONS.md. Don't spend a third run diagnosing an external auth issue — the costs (blocked critical path, diagnose/escalate cycle) outweigh the marginal information gained.
2. **Audit all migration-engine tools at first deploy.** Any tool that ships with an ORM/migration engine (`prisma`, `alembic`, `flyway`, etc.) and `DATABASE_URL` pointing at a shared schema must have its schema isolated to a dedicated role + schema before the first staging-equivalent deploy. Apply ADR-0004's pattern (non-superuser, separate schema, zero rights on `public`) by default.
3. **Pair every GRANT with ALTER DEFAULT PRIVILEGES.** When issuing a `GRANT SELECT` on tables owned by another role (e.g., FreeScout's `freescout_user`), always pair it with `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO <role>` in the same session. This is the only way the grant survives a schema reset.
4. **Package multi-step founder actions as a single atomic FQ item.** When a task requires 2–3 sequential manual steps (SQL + env var + test), file them as one FQ with a numbered runbook, not separate items. Include the exact copy-paste commands. Set one "after all 3 done" notification trigger. The FQ-42 format is the template.
5. **Pre-provision credential env vars before the function needs them.** When a new Inngest function requires a new secret credential (`FREESCOUT_DB_URL`, etc.), track that credential provisioning as a named sub-task on the critical path — not as a known gap to "do later." Credential gaps that land on the critical path are preventable delays.

---

## 6. M1 criteria status

| # | Criterion | Status |
|---|---|---|
| 1–10 | Foundation | ✅ Done (Sprint 1, 2026-06-23) |
| 11 | Synthetic incident drill + post-mortem | ✅ Done (2026-06-27) — `docs/retros/sprint-2-incident-drill.md` |
| 12 | DNC tickets flowing through Ops Hub | ✅ Done (2026-06-27) — FQ-42 resolved; DNC test email confirmed `state=responded`, `tenant_id=00…0020` |
| 13 | First monthly founder briefing | 🔗 T-29, due July 31 (Sprint 3 carry-forward) |

M1 is 12/13 complete. The sole remaining item (T-29) is non-blocking and on cadence.

---

## 7. Open risks going into Sprint 3

| Risk | Severity | Note / mitigation | Owner |
|---|---|---|---|
| **LiteLLM DB isolation (ADR-0004) not yet applied.** Founder SQL + `LITELLM_DB_USER_URL` GitHub secret not yet set. Until applied, a LiteLLM redeploy *could* run Prisma force-reset and wipe Ops Hub tables again. | High | Production Manager tracking. No LiteLLM redeploy until ADR-0004 Step 1 (founder SQL) is complete. If a redeploy is forced (e.g., crash loop), notify Tech Lead immediately. | Prod Mgr |
| **Real ticket volume is still zero.** All processed tickets to date are: 2 smoke-test emails (T-21), 1 drill email (T-26), 1 DNC test email (T-27). M2 criterion #1 requires ≥ 5 non-drill tickets. Until real DNC customer emails arrive or more test emails are sent, the pipeline is not proven at volume. | Medium | Sprint 3 should generate 1–2 additional test emails covering different urgency levels. Real DNC volume begins at M3. | PM / Prod Mgr |
| **FreeScout AI notes are unreviewed in production.** `respondTicket` writes an internal note — not a sent email — so no customer receives an unreviewed AI response. But the review workflow (founder sees the note, approves, manually sends) is not documented or practiced. | Medium | T-33 (M3 scoping) should include a review-workflow section. Founder should view at least one AI note before M2 closes. | PM / Solutions Architect |
| **Cost per ticket is not yet instrumented.** LangFuse receives traces but per-ticket cost aggregation is not wired (T-31). The < $1 USD M2 criterion cannot be verified. | Medium | T-31 is Sprint 3 Track A. Unblocked immediately. | Data Engineer |
| **FREESCOUT_BOT_USER_ID not confirmed.** `respondTicket` uses this to author FreeScout notes. If the ID is wrong, notes may appear under the wrong user or fail silently. | Low | Production Manager to verify the ID matches `haytham@inatechshell.ca` (admin, ID=1) in the FreeScout DB. | Prod Mgr |
| **Single active LLM provider (OpenAI only).** NVIDIA was removed; no fallback provider is currently registered in LiteLLM. A sustained OpenAI outage means zero triage capability. | Low–Medium | Acceptable for Sprint 3 staging; revisit for M3 production readiness. Option: register a second OpenAI alias or a local model as the fallback. | Tech Lead |

---

*Sprint 2 delivered its full goal — pipeline live, M1 #11 and #12 closed — in a fraction of the planned calendar time. The cost was concentrated in two recurring patterns: provider auth failures requiring pivot decisions, and Prisma/schema-isolation gaps that should have been caught at T-08. Sprint 3 inherits a working staging pipeline, six process changes, and four open risks that need resolution before M3 production readiness.*
