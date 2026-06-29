# Sprint 4 Retrospective — Phase 2 Hardening

**Sprint window:** June 28 – July 11, 2026 (effective: June 28, 2026 — all tasks delivered in one session)
**Author:** PM
**Date:** 2026-06-29
**Audience:** PM + build agents. Internal learning document — not founder-facing. Factual and action-oriented.

> Companion docs: full task history in `WORK.md`, decisions in `DECISIONS.md`, founder escalations in `FOUNDER_QUEUE.md`, DR drill findings in `docs/retros/sprint-4-dr-drill.md`. This retro synthesizes; it does not replace the source logs.

---

## 1. Sprint summary

**Goal:** Declare M4 (Phase 1 Complete); deploy Cstate status page; configure Premium SLA tier; build backup verification; run mini DR drill; declare M5 (Premium SLA tier launched).

**Outcome: All Sprint 4 tasks delivered in a single session on 2026-06-28. M5 declared. Three founder-blocking FQs remain open for go-live (FQ-47, FQ-48, FQ-49 — the last resolved 2026-06-29).**

| Task | Owner | Result |
|---|---|---|
| T-36: M4 declaration + Sprint 3 retro | PM | ✅ Done (2026-06-28) |
| T-38: Cstate status page | Prod Mgr | ✅ Code done (PR #197 merged). FQ-47 blocks go-live. |
| T-39: Premium SLA tier | Prod Mgr + Tech Lead | ✅ Done (PR #198 merged) |
| T-40: Backup verification | Tech Lead | ✅ Code done (PR #199 merged). FQ-48 blocks first run. |
| T-41: Mini DR drill | Prod Mgr + Tech Lead | ✅ Done (PRs #200–#203). FQ-49 filed; resolved 2026-06-29. |
| T-42: M5 close | PM | ✅ Done (2026-06-28) |
| T-43: Sprint 4 retro | PM | ✅ This document |

**Sprint 4 was again compressed into a single calendar day** — the same pattern as Sprint 3. All planned capability work shipped cleanly. The headline risk at sprint close was LiteLLM's external URL being unreachable from GitHub Actions runners (FQ-49); this turned into a full LiteLLM crash-loop incident resolved in the following session.

**M5 declared: 2026-06-29.** Technical criteria all satisfied. Three FQs remain open for public go-live: FQ-47 (Cstate DNS + GitHub Pages), FQ-48 (backup verify secret), FQ-49 resolved (LiteLLM external URL — fixed).

---

## 2. What worked

- **Sprint 4 critical path shipped cleanly in one session.** T-38 through T-42 — five hardening tasks spanning a status page, SLA tier configuration, backup automation, and a DR drill — were all delivered and merged without blocking each other. Each task had tight scope and a single clear exit criterion. Sprint 4 is proof that well-scoped hardening work moves as fast as feature work when prerequisites are in place.

- **DR drill (T-41) surfaced a real problem before it hit production.** The `dr-drill.yml` workflow exposed that `https://litellm-staging.inatechshell.ca/health` was unreachable from GitHub Actions runners after a container restart. Filed as FQ-49. This was ultimately traced to a deeper issue (LiteLLM crash-looping on Supavisor ENOIDENTIFIER), not just a CI networking quirk. The drill did exactly what it was supposed to: reveal infrastructure gaps in a controlled environment before a real incident.

- **`continue-on-error: true` on the LiteLLM DR step was the right call.** When the LiteLLM restart step began timing out (because the external health endpoint was unreachable), adding `continue-on-error: true` allowed the drill to document the failure without aborting the entire run. The ops-hub step still ran, demonstrating that a single component failure doesn't block recovery verification for the other components. This mirrors real incident response: a failing component doesn't mean you stop checking the others.

- **T-39 premium SLA tier used a CTE-based CASE approach.** The `sla-monitor.ts` change used a Postgres CTE with CASE to deliver per-urgency SLA targets for premium tenants (critical 30 min / high 60 / normal 240 / low 480) while falling back to the global `sla_config.response_target_minutes` for standard tenants. The app-agnostic constraint held: the tier logic reads from the `tenants` table, not hardcoded TTS config.

- **Backup verification (T-40) calls the Supabase Management API — not a database query.** This means it doesn't require staging DB credentials in CI, only the `SUPABASE_ACCESS_TOKEN` secret. The 25-hour freshness threshold is conservative enough to catch a missed backup before the next backup window. The workflow writes a formatted step summary, making it human-readable on each run.

---

## 3. What didn't work (or cost more than it should have)

- **LiteLLM Supavisor ENOIDENTIFIER: a crash-loop that persisted for an unknown duration before discovery.** The root cause was a missing project ref suffix in `DATABASE_URL`. Supavisor requires `postgres.yocoljutbiizdbfraapx`, not `postgres`. The bad value was present because Coolify had duplicate `DATABASE_URL` rows in its internal `environment_variables` table — accumulated from multiple UI save operations — and the last row (with the bad username) always won on deploy. LiteLLM had been crash-looping silently; the DR drill's health check timeout was the first signal that surfaced this.

  **Root cause chain:**
  1. During the original LiteLLM setup, `DATABASE_URL` was set multiple times in Coolify UI (each save creates a new row — Coolify does not upsert)
  2. Three rows existed (IDs 119, 759, 760); the last row written to `.env` had `postgres` without the project ref
  3. Supavisor rejected the connection: `FATAL: (ENOIDENTIFIER) no tenant identifier provided`
  4. Editing `.env` on disk was futile — Coolify regenerates it from its internal DB on every deploy
  5. The fix required: (a) connecting to `coolify-db` (Postgres 15, in Docker on the VPS), (b) `DELETE FROM environment_variables WHERE resourceable_id=4 AND key='DATABASE_URL'`, (c) re-entering the correct value once via Coolify UI

  **Net result:** LiteLLM was unhealthy for an indeterminate period while ops-hub was routing calls to it. Ticket triage likely silently failed during this window.

- **Coolify's DATABASE_URL duplicate row behavior is undocumented and counterintuitive.** The root cause of the ENOIDENTIFIER crash was not a misconfiguration — it was Coolify's internal behavior of appending rows on every save rather than upserting. There is no visible duplicate warning in the Coolify UI. The symptom (crash-loop on startup) pointed at Prisma / Supavisor, not at Coolify's env var storage, which delayed diagnosis.

- **Disk edits to `/data/coolify/applications/<id>/.env` are wasted on redeploy.** Multiple diagnostic sessions edited the `.env` file directly on the VPS, including a working `DATABASE_URL`. Every redeploy overwrote it from Coolify's internal DB. This is expected Coolify behavior but was not known ahead of time, costing diagnostic time.

- **P1000 authentication failure followed ENOIDENTIFIER fix.** After the project ref format was accepted by Supavisor, the password in `DATABASE_URL` didn't match the current Supabase postgres password (it had been rotated). The fix required updating `DATABASE_URL`, `DB_PASSWORD`, and the Supabase database password in sync. Without all three updated, the error persisted.

- **FQ-49 was filed as "LiteLLM external URL unreachable" when the actual cause was a crash-loop.** The DR drill correctly identified that `https://litellm-staging.inatechshell.ca/health` was returning 000, but the FQ framed it as a potential networking or proxy configuration issue. The real cause — LiteLLM crash-looping before it could accept connections — required a deeper session to diagnose. This means the DR drill found a real problem but the initial framing understated its severity.

---

## 4. Incidents, blockers, and resolutions

### 4.1 LiteLLM ENOIDENTIFIER crash-loop (post-sprint)

**What happened:** After the T-41 DR drill, `https://litellm-staging.inatechshell.ca/health` returned 000 from GitHub Actions runners. Initial diagnosis (FQ-49): suspected proxy/networking issue. Actual cause (resolved 2026-06-29): LiteLLM had been crash-looping with `FATAL: (ENOIDENTIFIER) no tenant identifier provided` from Supavisor — the Prisma DATABASE_URL had `postgres` as the username, missing the project ref suffix `yocoljutbiizdbfraapx`.

**Resolution steps:**
1. Connected to `coolify-db` Docker container on the VPS: `docker exec -it coolify-db psql -U coolify -d coolify`
2. Found 3 duplicate `DATABASE_URL` rows for `resourceable_id=4` (LiteLLM); the last had `postgresql://postgres:****@...` (no project ref)
3. Deleted all rows: `DELETE FROM environment_variables WHERE resourceable_id=4 AND key='DATABASE_URL'`
4. Re-entered `DATABASE_URL` once via Coolify UI with `postgres.yocoljutbiizdbfraapx` as username
5. After fixing username: P1000 authentication failure — postgres password had been rotated; updated `DATABASE_URL`, `DB_PASSWORD`, and Supabase database password
6. LiteLLM reached `Application startup complete`; `https://litellm-staging.inatechshell.ca/health` returns 401 (correct — API key enforcement)

**FQ-49 resolved:** External URL was not unreachable due to networking — it was unreachable because LiteLLM was crash-looping. Once the crash-loop was fixed, external access was restored.

**Diagnosis duration:** ~1 session (2026-06-29). Multiple diagnostic steps were required because: disk edits to `.env` didn't persist through redeploys, the duplicate row behavior was unknown, and the P1000 failure appeared only after the ENOIDENTIFIER was fixed.

### 4.2 LiteLLM container suffix changed after full redeploy

**What happened:** During the ENOIDENTIFIER incident fix, LiteLLM was fully redeployed. The Docker container suffix changed from `074411057216` to `170111887056`. The internal URL in CLAUDE.md became stale.

**Resolution:** CLAUDE.md updated in PR #205 (branch `feat/t42-m5-close`). The internal URL suffix in `LITELLM_URL` (ops-hub-app Coolify env var) must also be updated whenever LiteLLM is fully redeployed. This is a standing constraint.

---

## 5. Process changes for Sprint 5

1. **When setting any DATABASE_URL in Coolify: check for duplicate rows first.** Before or after updating a DB connection string via Coolify UI, connect to `coolify-db` and verify only one row exists per key per resource: `SELECT id, key, value FROM environment_variables WHERE resourceable_id=<N> AND key='DATABASE_URL'`. If multiple rows exist, delete all and re-enter once. Coolify UI `Save` creates new rows, not upserts.

2. **Never edit `.env` files on disk in Coolify application directories.** `/data/coolify/applications/<uuid>/.env` is regenerated from Coolify's internal DB on every deploy. Disk edits are overwritten. All env var changes must go through Coolify UI or the Coolify API — never direct file edits. If a change appears to apply but reverts after redeploy, the Coolify DB has the wrong value.

3. **Supavisor username format is `<role>.<project_ref>`.** When setting any Supabase Supavisor connection string, the username must include the project ref: `postgres.yocoljutbiizdbfraapx` (not `postgres`). This applies to `DATABASE_URL` for LiteLLM and any other service connecting through Supavisor. Direct connection (`db.yocoljutbiizdbfraapx.supabase.co`) is IPv6-only and unreachable from the Coolify VPS.

4. **After fixing a crash-loop password error, update all three locations.** A Supabase password rotation requires changes in: (a) `DATABASE_URL` env var in the app, (b) `DB_PASSWORD` env var in the app, and (c) Supabase Settings → Database → database password. Missing any one will result in a persistent P1000 authentication failure even after the password is set correctly in the others.

5. **After any full LiteLLM redeploy, update the internal URL suffix.** The Docker container name suffix changes on every full redeploy (image pull + new container). After any LiteLLM full redeploy: run `docker ps --format '{{.Names}}' | grep h12xz8887fxvbvjts2hac8if` on the VPS, note the new suffix, update `LITELLM_URL` in Coolify ops-hub-app env vars, and update `CLAUDE.md`'s LLM internal URL row. Failure to do so will cause ops-hub to call a non-existent container, silently breaking triage.

6. **FQ severity should reflect the actual symptom, not the assumed cause.** FQ-49 was filed as "external URL unreachable" when the real issue was a crash-loop. A more accurate filing ("LiteLLM not accepting connections — possible crash-loop, check container logs") would have guided the founder to the right diagnostic action immediately. When filing a service-unreachable FQ, always include the container log excerpt if available.

---

## 6. M5 criteria status

| # | Criterion | Status |
|---|---|---|
| T-38 | Cstate status page code shipped | ✅ PR #197 merged |
| T-39 | Premium SLA tier configured | ✅ PR #198 merged; `sla_tier` column live |
| T-40 | Backup verification automation | ✅ PR #199 merged; pending FQ-48 (founder secret) |
| T-41 | DR drill executed + post-mortem | ✅ PRs #200–203 merged; FQ-49 resolved 2026-06-29 |
| T-42 | M5 close verification | ✅ Done (2026-06-28) |

**M5 declared COMPLETE: 2026-06-29** (LiteLLM restored; FQ-49 closed).

Three go-live items remain founder-owned:
- **FQ-47** (Jul 7): GitHub Pages enable + DNS CNAME + fine-grained PAT + UptimeRobot webhook for Cstate
- **FQ-48** (Jul 9): Add `SUPABASE_ACCESS_TOKEN` GitHub secret for backup verification

---

## 7. Open risks going into Sprint 5

| Risk | Severity | Note / mitigation | Owner |
|---|---|---|---|
| **LiteLLM internal URL suffix must be manually tracked after full redeploys.** The suffix in CLAUDE.md and Coolify ops-hub-app env var `LITELLM_URL` becomes stale on every full redeploy. No automated discovery path exists from CI. | Medium | CLAUDE.md standing warning in place. Added to Sprint 5 process changes: always check suffix after LiteLLM redeploy. | Prod Mgr |
| **Coolify duplicate env var rows: a silent footgun.** If any service accumulates duplicate rows for a critical env var, the last-written value wins silently. No UI warning. | Medium | Sprint 5 process change: before updating any `DATABASE_URL` or critical env var in Coolify, audit for duplicates via `coolify-db`. | Tech Lead |
| **LiteLLM ticket processing gap during crash-loop.** For the duration of the ENOIDENTIFIER crash-loop, inbound triage calls from ops-hub were silently failing. The exact duration is unknown (no LiteLLM health monitor in UptimeRobot). Any tickets that arrived during this window were not triaged. | Low–Medium | Add LiteLLM to UptimeRobot monitoring (currently only ops-hub is monitored). Verify no stuck `new` tickets in Supabase. | Prod Mgr |
| **Cstate status page requires 4 founder actions before it's live.** FQ-47 has a July 7 deadline. If GitHub Pages / DNS / PAT aren't set up in time, the status page is code that does nothing. | Medium | FQ-47 filed with step-by-step instructions. Escalate at Jun 30 daily stand-down if not acknowledged. | PM |
| **Backup verification secret (FQ-48) blocks the first backup check.** Without `SUPABASE_ACCESS_TOKEN` in GitHub secrets, the `verify-backup.yml` workflow will fail on its first monthly run. | Low | FQ-48 filed. Non-critical until first scheduled run (July 1). | Tech Lead |
| **Single LLM provider (OpenAI gpt-4o-mini).** A sustained OpenAI outage means zero triage. No fallback provider. | Low–Medium | Acceptable for staging. Register a second provider before M6 / production go-live. | Tech Lead |

---

*Sprint 4 delivered all planned hardening work cleanly and on time. The only significant unplanned event was the LiteLLM crash-loop — a Coolify env var management issue that revealed itself through the DR drill and was resolved in one focused session. The drill paid for itself immediately. Sprint 5 scope: TBD pending M5 go-live FQ resolutions and founder direction.*
