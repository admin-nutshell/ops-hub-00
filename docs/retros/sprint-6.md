# Sprint 6 Retrospective — Ops Dashboard MVP + Reliability Debt Closure

**Sprint window:** July 6–20, 2026 (effective: all tasks delivered ahead of window, by 2026-07-08)
**Author:** PM
**Date:** 2026-07-09
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`, founder escalations in `FOUNDER_QUEUE.md`, the dashboard-prod 404 incident record in `docs/deploys/2026-07-07-t70-dashboard-prod-404-incident.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Ship the founder-facing Ops Dashboard as a **read-only MVP** (the 4 charter daily pillars — SLA attainment, open tickets, agent cost, eval health — plus deflection, queue, pipeline stage counts, system health, and the platform-incidents feed), RLS-scoped and behind a real auth boundary. In parallel, two smaller tracks: restore the LiteLLM DB-isolation wall regression (FQ-57) and clear Sprint 5's process/CI debt.

**Outcome: All three tracks delivered. The read-only dashboard is live, gated, and founder-confirmed working on both staging and production. No milestone declared — capability-building, not a milestone-closing sprint (see §6).**

| Task | Owner | Result |
|---|---|---|
| T-57: Dashboard auth mechanism | Tech Lead | ✅ Done — Traefik/Coolify HTTP Basic Auth chosen over app-level session auth (DECISIONS.md 2026-07-04) |
| T-58: Dashboard data feeds — eval-health + agent-cost | Data Engineer | ✅ Done (PR #259) — migration applied 2026-07-06; live-verified against real LangFuse data. Real $0-cost finding flagged (see §3) |
| T-59: Ops Dashboard read-only build | Frontend Engineer | ✅ Done — `web/` Next.js app, query-centralized in `src/metrics/dashboard.ts`; unblocked only after T-67 applied T-58's migration |
| T-60: RLS/tenant-scoping verification | QA Manager + Security Lead | ✅ Done — 21/21 live checks pass after T-67; surfaced the T-66 audit_log dead-feed CONCERN and the T-67 missing-migration blocker |
| T-66: Fix `audit_log_select` platform-incident (NULL-tenant) rows | Security Lead | ✅ Done (PR #265) — widened policy, founder-applied (FQ-62), re-verified 21/21 |
| T-67: Apply the T-58 migration to the live DB | Production Manager | ✅ Done — founder-applied via SQL Editor (FQ-61); cost-sync cron enabled |
| T-68: Stand up the dashboard on Coolify staging + apply Basic Auth gate | Production Manager | ✅ Done — HOSTNAME bind bug + docker-image-app FQDN limitation both found and worked around (see §3, §4.2) |
| T-69: Redeploy staging dashboard with theme-v2 (PR #277) | Production Manager | ✅ Done — confirmed the Basic Auth gate survives a full image redeploy, not just a stop/start |
| T-70: Provision dashboard on production (founder-authorized go-live) | Production Manager | ✅ Done — but only after a real 404 incident, root-caused to a Traefik middleware-name collision (see §4.1) |
| T-71: Production ticket-triage outage — `LITELLM_URL` pointed at staging | Production Manager | ✅ Found live and fixed same-day — 100% triage failure; env-var drift, mechanism unestablished (see §3) |
| T-61: Restore LiteLLM DB-isolation wall — Phase 1 (staging) | Production Manager | ✅ Done — blocked on FQ-58 (password reset) first; full canary executed after |
| T-62: Restore LiteLLM DB-isolation wall — Phase 2 (prod) | Production Manager | 🟡 apply-wall done; freeze-schema held for 24h monitoring window — **carries to Sprint 8** (see §7) |
| T-63: Env var presence health check (`/health/env`) | Production Manager | ✅ Done (PR #289) — live on both environments. Row left stale at "in progress" after the deploy landed (see §3) |
| T-64: Fix `main-deploy.yml` `paths-ignore` to exclude root docs | Tech Lead | ✅ Done — closes the gap that let docs-only merges exercise the T-54(A) collision |
| T-65: Re-enable the Inngest sync step in `main-deploy.yml` | Tech Lead | ✅ Done (PR #303) — safe now that `INNGEST_APP_ID` splits staging/prod; live-verified green |

---

## 2. What worked

- **The read-only MVP scoping held — the settings/write area was deferred to Sprint 7 and it was the right call.** Sprint 6 explicitly refused to build the write surface, on the grounds that it needed a backend change (splitting `LITELLM_TRIAGE_MODEL` so Respond/KB Learn stop sharing Triage's config) plus a heavier RLS-write security review than a two-week window comfortably holds alongside a dashboard build, a DB-wall restoration, and CI debt. That deferral is exactly what let Sprint 7 land the write surface cleanly. Deferring to avoid the Sprint 5 overcommit pattern is a repeatable win, not a one-off.

- **Query centralization (T-59) gave T-60 a single audit surface.** `web/` holds zero SQL of its own — every dashboard query lives in `src/metrics/dashboard.ts` and `web/lib/queries.ts` imports them. When RLS verification came, Security Lead + QA had **one** place to audit, not two. This design choice paid off again in Sprint 7 when the same discipline was extended to the write path.

- **T-60's live RLS harness found real problems that code review alone would have missed.** The INSERT-then-ROLLBACK-on-the-login-role harness (no `service_role` in CI, nothing committed, prod rows untouched) proved fail-closed behavior against the *actual* runtime path. It caught two things a static read never would: the T-58 migration was never applied to the live DB (T-67), and the `audit_log_select` policy silently made the platform-incidents feed dead-code (T-66). Both were deny-direction (no leak), but both were live defects.

- **`/health/env` (T-63) turns the Sprint 5 env-var-drift lesson into an automated check.** Sprint 5's headline lesson was that a "done ✅" on env vars went silently wrong within 24 hours (T-47 → T-51). T-63 is the automated version: each instance checks its own 14 required vars and returns 503/`missing:[...]` (key names only, never values). Self-scoped by design — it catches drift exactly the way the original incident manifested.

- **The DB-isolation wall restoration (T-61) stopped at the first failed pre-check instead of guessing.** The read-only precheck returned a genuine `FATAL: password authentication failed for user "litellm_db_user"` — a real credential rejection, not a DSN-format error — and execution stopped there (FQ-58) rather than resetting the password blind. This is the deploy-plan discipline working as designed.

---

## 3. What didn't work (or cost more than it should have)

- **Stale WORK.md status rows — "in progress" left standing after the work actually landed — happened repeatedly this sprint.** T-63's row sat at "in progress" after PR #289 had already merged and deployed to both environments; it was corrected only when someone re-read it. This is the *same pattern* as T-55 (closed as stale in PR #300 — status superseded by later work but never marked) and the T-54(B) completion that "DECISIONS.md never got an entry for" (backfilled 2026-07-04). The failure mode is consistent: the work lands, the bookkeeping doesn't follow, and the board misrepresents live state until someone notices. A WORK.md that lags reality is the exact hazard Sprint 5's retro warned about — "does the live system actually match what WORK.md claims" — pointed inward at our own status discipline rather than at Coolify.

- **The Coolify docker-image-app FQDN API limitation resurfaced — a known constraint we'd already paid for once.** T-68 could not set an explicit custom `fqdn` on the dashboard's docker-image app via the Coolify API — the same FQ-24/T-10 limitation from the FreeScout setup back in Sprint 1. It worked out (Coolify auto-assigned a reachable sslip.io preview domain, so FQ-59's gate could be applied and verified the same session), but the constraint was rediscovered rather than recalled. A known-limitations note would have saved the rediscovery cost. Carried into this retro's process changes so it stops being relearned.

- **T-58's agent-cost feed reports $0 per ticket — a real data-lineage gap, flagged not fixed.** Every sampled LangFuse trace across `ticket-triage` and `ticket-respond` returned `totalCost = 0.000000`. The sync faithfully mirrors whatever LangFuse reports, so `agent_cost_events` will read $0 until the LiteLLM-routed model names are registered in LangFuse Cloud's cost-calculation catalog. The dashboard tile labels this honestly rather than implying zero usage, but the COGS pillar is not trustworthy for reporting until the Data Engineer closes the LangFuse pricing-catalog gap. This is charter-relevant (`< $2 CAD/ticket` is a headline goal) and should not be allowed to drift out of view.

- **T-71: production ticket-triage was failing at 100% and nobody knew until the founder sent a test email.** `ops-hub-prod`'s `LITELLM_URL` had drifted to litellm-*staging*'s internal container address; triage was throwing `getaddrinfo EAI_AGAIN` on every run (831 runs/24h, all failed). T-51 confirmed the correct value was in place on 2026-07-03; **how it changed between then and now was never established.** It was not caused by any of that session's T-62 workflow dispatches (none write to `ops-hub-prod`'s env vars), but the mechanism is an open question. The uncomfortable fact: a live production capability was fully broken and the first signal was a human manually testing it — no monitor caught it. `/health` was green throughout because the app was healthy; it was the *downstream LiteLLM call* that was broken, which `/health` doesn't exercise.

- **The dashboard-prod go-live (T-70) took three tries and briefly exposed the dashboard unauthenticated.** The path to a gated prod dashboard ran through a 404 incident (see §4.1) and then, on the actual go-live, a code-vs-comment drift: `provision-ops-dashboard-prod.yml` had its own copy of the gate-application logic that was never actually updated to `dashauth-prod` despite PR #281's header comments claiming it was. The production dashboard was reachable HTTP 200 with no credentials for several minutes — caught by independent `curl` (not the workflow's self-report), root-caused, fixed for real in PR #287. Documentation drifting apart from the code it describes is a recurring theme this sprint (see also T-63's stale row, T-62's phantom `LITELLM_MASTER_KEY_PROD` secret).

---

## 4. Incidents, blockers, and resolutions

### 4.1 Dashboard-prod 404 incident — Traefik middleware-name collision (T-70)

**What happened:** The first production dashboard deploy returned HTTP **404** to every unauthenticated request instead of the required **401**. The workflow correctly failed closed and did not declare the app live. QA confirmed a bare 404 (18-byte body) — zero data exposure, just an offline app. Worse: the *staging* dashboard, verified working at 401 earlier the same day (T-69), was independently found to have started returning the identical 404 with **zero staging-side actions by anyone**.

**Misdiagnosis, then correction (same day):** The first theory was a shared-Traefik-proxy fault, and FQ-64 was filed recommending a `coolify-proxy` restart. That theory was **wrong** and was corrected in place before the founder acted: a proxy-wide fault would have broken *all* apps on the server, but every real-domain app (`ops-hub-staging`, `freescout-staging`, `litellm-staging`, `coolify` itself) kept routing normally — only the two dashboards broke. The real root cause: both dashboard apps named their Basic Auth Traefik middleware identically (`dashauth`) with different per-environment password hashes. Traefik treats the name as one global identity, sees the conflict, and drops it — taking down both dashboards' routers symmetrically the instant T-70 created the second, conflicting definition. This fit every observed fact and the exact timing.

**Resolution:**
1. Phase 1 (founder-authorized) — deleted the broken `ops-hub-dashboard-prod` app (the one carrying the colliding definition) and stop/started staging so Traefik re-read labels without the collision. Staging restored to **401 unauth / 200 authed**, verified by workflow and by hand ([run 28890818621](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28890818621)). This was the first live test of the collision theory and it passed cleanly.
2. Phase 2 — permanent fix: rename prod's middleware to `dashauth-prod` (PR #281), plus two hardening changes (refuse `/start` until a real TLS domain is attached; create the app with `instant_deploy=false` so it stays unreachable until the domain precondition is met).
3. Go-live — after the founder attached the domain and merged PR #281, the code-vs-comment drift in the provisioning workflow (see §3) was found and fixed (PR #287); redeployed, independently re-verified 401 unauth / 200 authed on both `http://` and `https://`. Founder logged in and confirmed the live production dashboard works.

**Lesson:** Traefik middleware names are a **global namespace** across every app on the shared proxy. Any per-app middleware must carry an environment-unique name (`dashauth-staging` / `dashauth-prod`), never a shared bare name. Root-caused and fixed same-day; full record in `docs/deploys/2026-07-07-t70-dashboard-prod-404-incident.md`.

### 4.2 Dashboard staging 502 — Next.js standalone HOSTNAME bind (T-68)

**What happened:** The first staging dashboard deploy returned HTTP **502** from Traefik despite the container's own logs showing the Next.js server "Ready." Root cause, confirmed via a read-only diagnostic that decoded Coolify's `custom_labels` (all correct — right network, host rule, port): Next.js standalone's `server.js` binds to `process.env.HOSTNAME`, and Docker auto-sets `HOSTNAME=<container-id>` in every container, so the server listened on the container-ID interface instead of `0.0.0.0` — connection-refused from Traefik's perspective, not a routing bug.

**Resolution:** Added `ENV HOSTNAME=0.0.0.0` to `web/Dockerfile`'s runtime stage (matching Next.js's own official `with-docker` example). Re-ran provisioning, confirmed HTTP 200 with real rendered content. Also fixed en route: the `$$`-escaped Basic Auth label variant returns 401 even with the correct password when set via the Coolify API's `custom_labels` field — the **unescaped single-`$`** `user:hash` line is what works on that call path (confirmed empirically, 401 with `$$`, 200 with `$`). Recorded so no future session re-applies the escaped form.

### 4.3 LiteLLM DB-isolation wall restoration — a live triage-degradation window (T-62)

**What happened:** Switching `litellm-prod` to the genuinely isolated `litellm_prod` schema meant the 3 previously-registered model aliases (which lived wherever the old superuser connection resolved to) were no longer visible — `GET /model/info` → 500, live completion → HTTP 400 "Invalid model name." **Production ticket triage was degraded** for a window.

**Resolution:** Root-caused via a real completion attempt, re-registered all 3 aliases via `configure-litellm-openai-only.yml (environment=prod)`, confirmed restored via a real completion (HTTP 200). Separately found along the way: `LITELLM_MASTER_KEY_PROD` was never actually created as a GitHub secret despite T-48's WORK.md entry and two workflow files' header comments claiming it was — fixed by fetching the key fresh from litellm-prod's own Coolify env vars each run (masked, never stored) instead of depending on the nonexistent secret. **`freeze-schema` deliberately held for a 24h monitoring window and does not close in this sprint** — carried to Sprint 8 (T-85), not a slip.

---

## 5. Process changes for Sprint 7 (and standing, going forward)

1. **Update the WORK.md status row in the same action that lands the work — not "later."** T-63, T-55, and the T-54(B) DECISIONS.md gap all show the same failure: work lands, bookkeeping lags, the board misrepresents live state. The rule: a task's row is not "done" bookkeeping-wise until its status is edited to match reality *in the same commit or session* that completes it. A stale "in progress" on completed work is a defect, not a cosmetic lag.

2. **Traefik middleware names are a global namespace on the shared proxy — always environment-unique.** Any per-app Traefik middleware must be named `<purpose>-<env>` (e.g. `dashauth-staging` / `dashauth-prod`), never a bare shared name. A name collision silently drops the middleware and takes down every app that references it, symmetrically. (T-70.)

3. **Keep a running "Coolify known limitations" note so constraints aren't rediscovered.** The docker-image-app FQDN API limitation (FQ-24/T-10) cost time again at T-68. Known Coolify quirks — append-not-upsert env rows, shared `ops-hub-app (localhost)` app names, docker-image FQDN rejection, `$$` vs `$` label escaping — belong in one referenced place (CLAUDE.md already anchors the first two; extend as needed).

4. **A green `/health` does not mean a downstream dependency works.** T-71's 100%-failing triage sat behind a healthy `/health`. Health checks that matter must exercise the *actual downstream call* (the LiteLLM completion path), not just the app's own liveness. Consider a synthetic end-to-end triage probe as a monitor, since the first signal here was a human sending a test email.

5. **Verify the deployed artifact independently — do not trust the deploy workflow's own self-report.** T-70's unauthenticated-200 exposure and T-62's phantom secret were both caught by independent `curl`/`gh secret list`, not by the workflow claiming success. Code and its own header comments drifted apart more than once this sprint. Independent post-deploy verification is load-bearing, not belt-and-suspenders.

---

## 6. Sprint goal / exit-criteria status

**No milestone was targeted this sprint** — this was capability-building work in the gap between the team's M6 ("TTS Live in Production," declared 2026-07-03) and whichever milestone the founder next signals. Per the standing **Milestone numbering note** (`WORK.md`), this work is deliberately **not** labeled M7: charter-M7 is gated on an exogenous tenant-onboarding event (A-Mart pilot conversion or equivalent) that has not happened, and DNC/second-tenant onboarding remains deferred indefinitely per FQ-43. Numbering is revisited only on a founder decision that reopens tenant onboarding.

| Sprint anchor / track | Exit criterion | Status |
|---|---|---|
| Track A — read-only dashboard MVP | 4 charter pillars + queue + system health, RLS-scoped, behind auth, live | ✅ Live + founder-confirmed on staging **and** prod (T-57–T-70) |
| Track A — RLS/tenant-scoping | One fail-closed live check per widget, no cross-tenant leak | ✅ 21/21 live checks pass (T-60, after T-66 + T-67) |
| Track B — LiteLLM DB-isolation wall | Restricted role live on staging + prod, aliases functional | 🟡 Staging done (T-61); prod apply-wall done, **freeze-schema carries to Sprint 8** (T-62 → T-85) |
| Track C — Sprint 5 CI/process debt | `paths-ignore` fix + Inngest sync re-enable + env health check | ✅ Done (T-63, T-64, T-65) |

---

## 7. Open risks going into Sprint 7 (as they stood at Sprint 6 close)

| Risk | Severity | Note / mitigation | Owner |
|---|---|---|---|
| **T-62 freeze-schema not yet dispatched** — prod LiteLLM is on the restricted role (apply-wall) but `DISABLE_SCHEMA_UPDATE` was briefly unfrozen; the freeze-schema step + QA E2E were held for a 24h monitoring window. | Medium | Not a slip — staged by design after two real live issues surfaced on this exact restoration. Dispatch freeze-schema + QA E2E to close. Carried to Sprint 8 (T-85). | Production Manager |
| **Agent-cost feed reads $0 per ticket** — LiteLLM-routed model names aren't in LangFuse's cost-calc catalog. The COGS charter pillar is not report-trustworthy until closed. | Medium | Data Engineer to add custom pricing entries in LangFuse project → Settings → Models matching the resolved model names. Dashboard tile labels it honestly meanwhile. | Data Engineer |
| **Production env-var drift can silently break a live capability with no code change and no monitor** — T-71's `LITELLM_URL` drifted to staging's address; triage failed 100% until a human tested it. Mechanism never established. | High | `/health/env` (T-63) now catches *presence* drift, but not *wrong-value* drift (the var was present, just wrong). Consider a synthetic downstream-triage probe. | Production Manager |
| **Docs / code / comments drift apart** — T-70 (workflow comment claimed a fix the code didn't have), T-62 (phantom `LITELLM_MASTER_KEY_PROD` secret), T-63/T-55 (stale WORK.md rows). | Medium | §5 process changes 1 and 5. Treat independent verification as standard, and update bookkeeping in the same action as the work. | All |
| **Traefik middleware-name collisions** on the shared proxy remain possible for any future per-app middleware. | Low | §5 process change 2 — environment-unique names. Both dashboards now use distinct names. | Production Manager |

---

*Sprint 6 shipped the read-only dashboard to production and closed the Sprint 5 CI debt, but its real lesson is about drift: env vars drifting from their correct values (T-71), workflow comments drifting from the code they describe (T-70), WORK.md rows drifting from live state (T-63/T-55), and a migration file's intent drifting from what the live DB actually carries (foreshadowed here, and hit head-on in Sprint 7). Almost every incident this sprint was a gap between what a record claimed and what was actually true — caught, in every case, only by someone checking the live thing directly. Sprint 7 (and the reconciliation work scoped into Sprint 8) should treat "prove the live state matches the record" as a first-class task, not an assumption.*
