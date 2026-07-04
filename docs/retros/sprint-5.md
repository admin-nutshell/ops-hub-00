# Sprint 5 Retrospective — Reliability Hardening + TTS Production Go-Live

**Sprint window:** July 7–18, 2026 (effective: work completed ahead of window open, across sessions through 2026-07-03)
**Author:** PM
**Date:** 2026-07-03
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`, founder escalations in `FOUNDER_QUEUE.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Close three reliability gaps (LiteLLM monitoring, suffix automation, LLM fallback), then deploy the full TTS pipeline to production and declare M6.

**Outcome: All nine tasks on the critical path (T-44 → T-52) delivered. M6 "TTS Live in Production" declared 2026-07-03.**

| Task | Owner | Result |
|---|---|---|
| T-44: UptimeRobot monitor for LiteLLM | Production Manager | ✅ Done (PR #210) |
| T-45: LiteLLM suffix auto-update workflow | Tech Lead | ✅ Done (PRs #217, #219, #220) |
| T-46: Second LLM provider — Anthropic fallback | Tech Lead | ✅ Done (PRs #222–#224) |
| T-47: Production Supabase schema + ops-hub-prod env vars | Tech Lead + Production Manager | ✅ Done (PR #226) — but see §3, env var count drifted after this |
| T-48: LiteLLM production instance | Production Manager | ✅ Done (PR #231) |
| T-49: ops-hub production deployment + CI/CD | Production Manager + Tech Lead | ✅ Done (PR #232) |
| T-50: FreeScout production mailbox | Production Manager | ✅ Done |
| T-51: TTS production E2E validation | QA Manager + Production Manager | ✅ Done (2026-07-03) — blocked mid-task by env var drift, see §4.1 |
| T-52: M6 close verification | PM | ✅ Done (2026-07-03) — M6 declared in DECISIONS.md |
| T-53: Sprint 5 retrospective | PM | ✅ This document |
| T-54: Fix cross-environment deploy/Inngest collisions | Tech Lead | ⚠️ Open — logged, not fixed. See §4.2 and §7. |

---

## 2. What worked

- **The reliability-hardening tasks (T-44–T-46) paid for themselves immediately.** T-44's `/health/litellm` proxy + UptimeRobot monitor meant LiteLLM health was externally visible before go-live, closing exactly the "silent crash-loop" gap identified in the Sprint 4 retro. T-46's Anthropic fallback path meant the single-provider risk flagged at the end of Sprint 4 was closed before production traffic started flowing.

- **T-48 giving prod its own LiteLLM instance (not sharing staging's) was the right call.** A separate `litellm-prod` container with its own `DATABASE_URL` schema (`litellm_prod`, isolated from staging) and its own master key meant a staging LiteLLM experiment or outage can't take production triage down with it. This is the correct pattern; T-54 exists because the *ops-hub* side of the staging/prod split didn't get the same treatment (see §4.2).

- **`prod-deploy.yml`'s hardcoded `OPS_HUB_PROD_UUID` pin is exactly the right design and should be the template going forward.** It's the one place in the deploy tooling that doesn't do a dynamic name-based Coolify lookup — and it's the one place that had zero issues this sprint. Every other app-discovery-by-name pattern in the CI/CD tooling should be considered suspect until proven otherwise (see §4.2).

- **A live production E2E test (T-51) found a real bug that documentation alone would have missed.** Real support email → FreeScout → `pollFreeScout` → `triageTicket` → `respondTicket` → Supabase `state=responded`, end-to-end in ~15 seconds, with the reply visible in FreeScout. Nothing about the missing env vars (§4.1) would have surfaced from a code review or a staging test — it only showed up because someone actually sent an email through prod and watched it fail.

---

## 3. What didn't work (or cost more than it should have)

- **T-47's "all 8 env vars set" claim was wrong within 24 hours of being written, and nobody caught it until T-51.** WORK.md recorded `LITELLM_URL`, `LITELLM_MASTER_KEY`, and `LITELLM_EXTERNAL_URL` as set in ops-hub-prod as of T-47 (2026-07-01). By the time T-51 ran (2026-07-03), those three were gone from Coolify, along with `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `SENTRY_DSN`, and `NVIDIA_API_KEY` — 9 vars missing in total. The leading suspect is the known Coolify append-not-upsert env var bug (documented since Sprint 4), most likely triggered when T-50 added `FREESCOUT_DB_URL`/`FREESCOUT_BOT_USER_ID` and an intermediate save silently dropped or duplicated other rows. **Nothing in WORK.md's own record caught this** — the "done" checkmark was trusted at face value for two days before a live test disproved it.

- **Diagnosing the env var gap took far longer than fixing it, because of Coolify UI navigation confusion.** Over several exchanges, env var listings were pasted from `litellm-staging`, then `ops-hub-staging`, then (accidentally) additions were made to `ops-hub-staging` instead of `ops-hub-prod`, before finally landing on the correct app. Coolify's per-project app naming (`ops-hub-app (localhost)` exists identically under both the `ops-hub-staging` and `ops-hub-prod` projects) makes it easy to be on the wrong page while looking at what appears to be the right one. The eventual fix — anchoring on the app's UUID from WORK.md (`sbke5gqru1n54rj7gssgca2y`) rather than trusting breadcrumb text — should have been the first move, not the last.

- **A routine documentation-only merge to `main` triggered a near-miss production deploy collision.** See §4.2 for full detail — `main-deploy.yml`'s Coolify app lookup matched both ops-hub-prod and a deprecated staging app by name, with no project scoping. It failed safe by accident (a malformed multi-line UUID crashed curl before any request reached Coolify), not by design. This was found only because someone happened to be watching CI output right after a merge — it would not have been noticed otherwise.

- **T-54 could not be fixed in the same session it was found, because the investigation needs live Coolify API access that wasn't available.** Confirming the current (non-deprecated) ops-hub-staging app UUID, and confirming whether Coolify's `/applications` response carries a per-app project field to filter on, both require live API calls with `COOLIFY_API_TOKEN` — a GitHub Actions secret, not available locally. Attempting the fix blind risked pinning the wrong UUID (a new bug wearing the fix's clothes) or shipping an unverified change that could only be tested by merging to `main` — the exact action the fix is supposed to make safe. Correctly deferred; still open.

---

## 4. Incidents, blockers, and resolutions

### 4.1 ops-hub-prod missing 9 env vars, discovered mid-T-51

**What happened:** `GET /api/inngest` on `https://ops-hub-prod.inatechshell.ca` returned `{"code":"internal_server_error"}` instead of the expected signed-request response. Root cause: `INNGEST_SIGNING_KEY` (and 8 other vars) were absent from ops-hub-prod's Coolify "Production Environment Variables," despite WORK.md's T-47 entry claiming all relevant vars were set two days prior.

**Resolution steps:**
1. Compared ops-hub-staging's actual env var list (the working reference) against ops-hub-prod's — found 9 vars missing.
2. Split the missing vars into two categories: vars safe to copy 1:1 from staging (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `SENTRY_DSN`, `NVIDIA_API_KEY` — same Inngest app/environment, same LangFuse project, same Sentry project) vs. vars needing prod-specific values (`LITELLM_URL`, `LITELLM_MASTER_KEY`, `LITELLM_EXTERNAL_URL` — prod has its own dedicated LiteLLM instance since T-48, with its own key and internal Docker URL).
3. Added all 9 to ops-hub-prod, redeployed via `prod-deploy.yml`, re-verified: `/api/inngest` → 401 (correct signed-request rejection), `/health` → 200.
4. Re-ran the Inngest sync (re-triggered `prod-deploy.yml`) since the earlier sync attempt happened against the broken config.

**Verification:** Real test email → FreeScout conversation #13 → ticket `3e9a23c5-c350-477f-a9f7-24556bda803c` → `state=responded` in ~15s → reply confirmed visible in FreeScout UI.

### 4.2 Near-miss: cross-environment deploy collision on merge to main

**What happened:** Merging a docs-only PR (#233 — WORK.md/DECISIONS.md, no code changes) triggered `main-deploy.yml` because its `paths-ignore` only excludes `docs/**`, not root-level `.md` files. That workflow's "Create or deploy ops-hub on Coolify" step does `jq 'select(.name == "ops-hub-app")'` against Coolify's full `/applications` list with no project scoping. Two apps share that name — ops-hub-**prod** (`sbke5gqru1n54rj7gssgca2y`) and ops-hub-**staging** (`ajqplom2mghf5a8h6vf1q6xg`) — so the query matched both, producing a malformed multi-line value that crashed the subsequent PATCH call (curl exit 3) before any request reached Coolify's API.

**Confirmed no impact:** `ops-hub-prod`'s `/health` (200) and `/api/inngest` (401) were unchanged immediately after the run.

**Correction (2026-07-03, later same session):** `ajqplom2mghf5a8h6vf1q6xg` was initially misidentified as a deprecated leftover app, based on a DECISIONS.md reference to a deprecated sslip.io *hostname* containing that string. That was wrong — Coolify derives its auto-generated sslip.io hostnames from the app's own UUID, so the hostname being deprecated (in favor of the custom domain) says nothing about the app itself. Direct confirmation from Coolify's UI showed `ajqplom2mghf5a8h6vf1q6xg` is the current, live ops-hub-staging app. This means the collision is **permanent and deterministic on every run** — not a fragile edge case that only bites if an old app is left lying around.

**Why this is a near-miss, not a non-issue:** the crash only happens *because* two name-matches always exist (both apps are live, permanently named the same thing). If someone "fixes" the crash by taking the first match (`| head -1`) instead of investigating why there were two, the exact same code path silently PATCHes ops-hub-prod's image tag from a routine, unreviewed merge to `main` — completely bypassing the manual-promotion-gate design that `prod-deploy.yml` (T-49) exists to enforce.

**Status: Fixed.** `main-deploy.yml` now pins `OPS_HUB_STAGING_UUID` and deploys directly by UUID, mirroring `prod-deploy.yml`'s existing `OPS_HUB_PROD_UUID` pattern, removing the name-based lookup entirely. Because this fix makes the staging deploy step succeed for the first time since ops-hub-staging was stopped, it also restarts staging on merge — so `freescout-poller.ts` gained a fail-closed `POLLING_ENABLED` env-var guard (default off) to prevent staging from resuming the FreeScout poll-dedup race against prod. `POLLING_ENABLED=true` must be set on ops-hub-**prod** (not staging) before/at merge time.

**Update, same night: T-54(B) confirmed as a real incident, not just a theory.** The moment (A)'s fix merged (PR #237, 17:42 UTC), `main-deploy.yml` ran end-to-end for the first time — including the "Sync Inngest functions" step against staging's URL. A test ticket sent minutes later was never processed: no row appeared in Supabase until `prod-deploy.yml` was manually re-run at 00:53 UTC the next day, re-syncing Inngest against prod, after which the same ticket processed in 8 seconds. Prod was running its pre-#237 image throughout the gap (unconditional polling, no `POLLING_ENABLED` guard yet) — so the ~7 hour silence can only be explained by Inngest's dispatch having been repointed away from prod, confirming the theory. **Interim mitigation:** the Inngest sync step was removed entirely from `main-deploy.yml` (staging still gets picked up by Inngest's own poll cycle, just without the immediacy). The permanent fix — a distinct Inngest app id per environment — remains open, deferred to a fresh session since it's a stateful Inngest-identity change only verifiable via a live merge+promote+ticket-test cycle, same reasoning that correctly deferred (A) earlier in this same retro.

**Do not merge to `main` until T-54(A) is resolved.**

---

## 5. Process changes for Sprint 6

1. **Don't trust a WORK.md "done ✅" on env vars without a live check.** T-47's claim was correct when written and wrong two days later. Any task whose exit criteria include "N env vars set" should have its actual Coolify state spot-checked before a dependent task (like T-51) assumes it's still true — especially given the known Coolify append-not-upsert bug means env var state can silently drift without any corresponding code or WORK.md change.

2. **Anchor on Coolify app UUIDs, not breadcrumb text, when multiple projects share an app name.** `ops-hub-app (localhost)` exists identically under both `ops-hub-staging` and `ops-hub-prod` projects in Coolify's UI. WORK.md's T-49 entry already records the prod UUID (`sbke5gqru1n54rj7gssgca2y`) for exactly this reason — check the browser URL or the app's UUID against that record before trusting which project you're looking at.

3. **Any Coolify API call that looks up an application by name (not UUID) is suspect until it's scoped by project.** `prod-deploy.yml`'s hardcoded `OPS_HUB_PROD_UUID` pin had zero issues this sprint; `main-deploy.yml`'s dynamic name-based lookup caused a near-miss production incident on its very next exercise. Prefer pinned UUIDs (set once as a repo variable, same pattern as `prod-deploy.yml`) over dynamic name lookups for any workflow step that can reach a production resource.

4. **Fix `main-deploy.yml`'s `paths-ignore` to also exclude root-level `WORK.md`/`DECISIONS.md`.** This doesn't fix the underlying app-name collision (T-54(A) still needs its own fix), but it stops routine documentation updates from exercising the collision at all, buying time until the real fix lands.

5. **Don't attempt a deploy-pipeline fix blind, at the end of a long session, when it can't be tested without the exact action it's meant to prevent.** T-54(A)'s fix requires confirming live Coolify API behavior (current staging app UUID, whether `/applications` responses carry a project field) that can't be checked without `COOLIFY_API_TOKEN`, and can't be validated without merging to `main` — the action being guarded against. This is a legitimate reason to hand a fix off rather than force it through; it was correctly deferred here.

---

## 6. M6 criteria status

| # | Criterion | Status |
|---|---|---|
| T-44 | LiteLLM UptimeRobot monitor | ✅ PR #210 merged |
| T-45 | LiteLLM suffix auto-update workflow | ✅ PRs #217/#219/#220 merged |
| T-46 | Anthropic fallback provider | ✅ PRs #222–#224 merged |
| T-47 | Production Supabase schema + env vars | ✅ PR #226 merged (env var drift found + fixed during T-51, see §4.1) |
| T-48 | LiteLLM production instance | ✅ PR #231 merged |
| T-49 | ops-hub production deployment + CI/CD | ✅ PR #232 merged |
| T-50 | FreeScout production mailbox | ✅ Done |
| T-51 | TTS production E2E validation | ✅ Done 2026-07-03 — ticket `3e9a23c5` processed end-to-end |
| T-52 | M6 close verification | ✅ Done 2026-07-03 — declared in DECISIONS.md |

**M6 "TTS Live in Production" declared: 2026-07-03.**

No founder-owned blockers remain for M6 itself. FQ-47 (Cstate go-live) and FQ-48 (backup verification secret) remain open from Sprint 4 but are independent of M6.

---

## 7. Open risks going into Sprint 6

| Risk | Severity | Note / mitigation | Owner |
|---|---|---|---|
| **`main-deploy.yml` Coolify app-name collision (T-54(A)) — fixed.** ops-hub-staging and ops-hub-prod are both live, permanently named `ops-hub-app` in Coolify — the collision was deterministic on every run, not a fluke. Fixed by pinning `OPS_HUB_STAGING_UUID` in `main-deploy.yml`, same pattern as `prod-deploy.yml`'s `OPS_HUB_PROD_UUID`. | Resolved | Requires `POLLING_ENABLED=true` set on ops-hub-prod before/at merge (see §4.2) — the fix restarts staging, and the new poll-guard defaults off everywhere. | Tech Lead |
| **Inngest app-id collision (T-54(B)) — CONFIRMED via a real ~7hr incident.** Same Inngest app id (`"ops-hub"`) shared by both environments in `src/inngest/client.ts`. Staging's Inngest sync (now removed from `main-deploy.yml`) repointed dispatch away from prod on 2026-07-03/04; prod stopped processing tickets until `prod-deploy.yml` was manually re-run. | **High** | Interim: sync step removed from staging deploy. Permanent fix (distinct app id per environment, env-var-driven) still open — deferred to a fresh session, needs live merge+promote+ticket-test to verify. | Tech Lead |
| **ops-hub-staging FreeScout poll-dedup race — fixed.** `freescout-poller.ts` now has a fail-closed `POLLING_ENABLED` env-var guard (defaults off), so restarting ops-hub-staging (as a side effect of the T-54(A) fix) won't resume racing prod for live customer emails via the shared `freescout_conversation_id` dedup. | Resolved | `POLLING_ENABLED=true` must remain set on ops-hub-**prod** only — never on staging. | Tech Lead |
| **Coolify env var drift can silently invalidate a "done" task with no corresponding code change.** T-47's env vars were correct when recorded, then 9 of them were gone two days later with no PR, no commit, and no alert — only caught because T-51 happened to run a live test. | Medium | No monitoring currently exists for "expected env var present" on any Coolify app. Consider a lightweight periodic check (could piggyback on the existing `/health` endpoints) if this recurs. | Production Manager |
| **`ticket-respond.ts`'s known non-atomic note-delivery + state-update (ADR-0003) can produce duplicate customer-facing replies.** Confirmed to have occurred during T-51 testing (two near-identical reply notes posted for one ticket). Documented as an accepted tradeoff, not a regression — but now confirmed to manifest in production, not just theoretically. | Low–Medium | Accepted per ADR-0003 for now. Revisit if duplicate replies become a real customer complaint at scale. | Tech Lead |

---

*Sprint 5 delivered the full TTS production go-live critical path and declared M6. The sprint's real lesson isn't the individual bugs — it's that two of them (env var drift, deploy-pipeline collision) were only caught by a live production test and by someone watching CI output after a routine merge, respectively. Neither would have been caught by documentation review or code review alone. Sprint 6 should treat "does the live system actually match what WORK.md claims" as something to periodically re-verify, not something to assume once recorded.*
