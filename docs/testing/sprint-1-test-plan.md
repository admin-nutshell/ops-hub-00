# Sprint 1 Test Plan — Infrastructure Verification

> **Owner:** QA Manager
> **Sprint:** Sprint 1 — Workspace + Foundation (June 23 – July 4, 2026)
> **Milestone:** M1 — "Workspace + Foundation"
> **Status:** Active
> **Related:** `docs/engineering/ci-cd-pipeline.md`, `docs/engineering/database-schema.md`, `docs/engineering/t11-migration-runbook.md`, `WORK.md`, `FOUNDER_QUEUE.md`, ADR-0001, ADR-0002

---

## 1. Scope

Sprint 1 stands up the foundational infrastructure for the Ops Hub. This plan verifies that those infrastructure components are **deployed, reachable, and configured correctly** — it is an *infrastructure verification* plan, not a functional/behavioral one.

### In scope (this plan verifies)

- **Infrastructure health** — `/health` endpoints for ops-hub-app, LiteLLM, FreeScout; Supabase connectivity.
- **CI/CD pipeline mechanics** — lint, test, security scan, Docker build, GHCR push, Coolify staging deploy, post-deploy health check.
- **Branch protection** — direct push to `main` rejected; PR without passing checks cannot merge.
- **Sentry** — SDK initialized in the deployed app; first error reaches the Sentry dashboard.
- **UptimeRobot** — monitors active; alert fires on simulated downtime.
- **Inngest** — test event `test/hello.world` is processed and visible in the Inngest Cloud dashboard.
- **Supabase schema** — 6 tables exist, RLS *enabled* on all 6, `ops_hub_app` role exists, basic fail-closed smoke passes.

### Explicitly out of scope (deferred to Sprint 2 / later tasks)

- **End-to-end ticket flows** (FreeScout → triage → fix → deploy → resolved) — Sprint 2 / M1 #10; first integration test is **T-19**.
- **Agent logic / LLM behavior / prompt evals** — owned by Evals Lead (T-16, T-17). This plan does **not** assert agent correctness.
- **The eval gate (>95% pass)** as a *behavioral* gate — T-17. This plan only verifies the CI *job slot* exists and is wired as a required check (auto-pass "n/a" path for docs/infra PRs).
- **Exhaustive cross-tenant RLS isolation** (tenant A cannot read tenant B's rows via the `ops_hub_app` path) — that is **T-18** (Sprint 2). Sprint 1 verifies only that RLS is *enabled* and a no-tenant-context query returns zero rows (fail-closed smoke). See §2.7 for the explicit boundary.
- **Supabase Vault secrets migration** (T-12) and **KB initialization** (T-20).
- **Production environment** verification. Sprint 1 targets **staging only**; prod promotion is `workflow_dispatch`-gated and not exercised here.

---

## 2. Test categories & cases

**Conventions.** Each case has an ID (`TC-S1-<area>-<n>`), description, preconditions, steps, expected result, pass/fail criteria, owner, and blocking dependency. "Owner" is who *executes* the check during Sprint 1. Staging URLs (current as of 2026-06-21):

| Service | Staging URL |
|---|---|
| ops-hub-app | `http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io` |
| LiteLLM | `http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io` |
| FreeScout | `http://y4b8nibdtizby6ys3el2gad4.187.124.76.235.sslip.io` |

---

### 2.1 Infrastructure health checks (manual smoke tests)

#### TC-S1-HEALTH-1 — ops-hub-app `/health` returns 200

| | |
|---|---|
| **Description** | The deployed ops-hub-app responds healthy on its `/health` endpoint. |
| **Preconditions** | T-07 ops-hub-app deployed to Coolify staging (✅ done, run #27921007847). |
| **Steps** | 1. `curl -i http://ajqplom2mghf5a8h6vf1q6xg.187.124.76.235.sslip.io/health` |
| **Expected result** | HTTP `200`; body indicates healthy (e.g. `{"status":"ok"}`). |
| **Pass/fail criteria** | **Pass:** HTTP 200 within 5s. **Fail:** non-200, timeout, or connection refused. |
| **Owner** | QA Manager |
| **Blocking dependency** | None (live). |

#### TC-S1-HEALTH-2 — LiteLLM endpoint reachable

| | |
|---|---|
| **Description** | The self-hosted LiteLLM service is reachable on staging. |
| **Preconditions** | T-08 LiteLLM deployed (✅ done, run #27887445367). |
| **Steps** | 1. `curl -i http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io/health` (fall back to `/` or `/health/liveliness` if the image exposes a different health path). |
| **Expected result** | HTTP 200 (or LiteLLM's documented health response). |
| **Pass/fail criteria** | **Pass:** service responds with a 2xx health status. **Fail:** non-2xx, timeout, refused. |
| **Owner** | Production Manager (verified by QA) |
| **Blocking dependency** | None (live). |

#### TC-S1-HEALTH-3 — FreeScout reachable

| | |
|---|---|
| **Description** | FreeScout staging serves its web UI / login page. |
| **Preconditions** | T-10 FreeScout deployed (✅ done, run #27916949231). |
| **Steps** | 1. `curl -I http://y4b8nibdtizby6ys3el2gad4.187.124.76.235.sslip.io` 2. Optionally load the URL in a browser and confirm the login page renders. |
| **Expected result** | HTTP 200 (or a 302 redirect to the login route); login page renders. |
| **Pass/fail criteria** | **Pass:** UI loads, no 5xx. **Fail:** 5xx, timeout, or blank/error page. |
| **Owner** | Production Manager + Frontend Engineer (UI render) |
| **Blocking dependency** | None (live). |

#### TC-S1-HEALTH-4 — Supabase connectivity (post-migration)

| | |
|---|---|
| **Description** | The Ops Hub Supabase project is reachable and the `ops_hub_app` role can connect to the staging DB. |
| **Preconditions** | T-11 migrations applied (founder execution of the runbook + Security Lead RLS sign-off). **BLOCKED — see "FQ-15" / T-11 in §3.** |
| **Steps** | 1. From CI or a maintenance host, connect using the staging connection string. 2. Run `select 1;`. 3. Confirm `select current_user;` reflects the expected role for the app connection. |
| **Expected result** | Connection succeeds; `select 1` returns `1`. |
| **Pass/fail criteria** | **Pass:** connection + query succeed. **Fail:** auth failure, network failure, or migrations not yet applied. |
| **Owner** | Tech Lead (verified by QA) |
| **Blocking dependency** | **"FQ-15" (Supabase migrations / T-11)** — see §3. |

---

### 2.2 CI/CD pipeline verification

Reference: `docs/engineering/ci-cd-pipeline.md` §§2–8. Workflows: `pr-checks.yml` (required checks), `main-deploy.yml` (staging auto-deploy).

#### TC-S1-CICD-1 — Lint + type-check job passes on a clean PR

| | |
|---|---|
| **Description** | The `lint` job (ESLint 9 + Prettier + `tsc --noEmit`) passes on the current `main` state. |
| **Preconditions** | T-15 CI scaffold merged (✅ PR #2). |
| **Steps** | 1. Open any PR (e.g. this test-plan PR). 2. Observe the **Lint & Type Check** required check. |
| **Expected result** | Job concludes **success**. |
| **Pass/fail criteria** | **Pass:** green. **Fail:** any ESLint error, Prettier diff, or type error. |
| **Owner** | Tech Lead (verified by QA) |
| **Blocking dependency** | None. |

#### TC-S1-CICD-2 — Unit test job passes

| | |
|---|---|
| **Description** | The `test` job (Vitest) runs and passes the existing unit suite (e.g. `src/health.test.ts`). |
| **Preconditions** | T-15 scaffold merged. |
| **Steps** | 1. On an open PR, observe the **Unit Tests** required check. |
| **Expected result** | All unit tests green; coverage report posted/collected. |
| **Pass/fail criteria** | **Pass:** all tests pass. **Fail:** any test failure or runner error. |
| **Owner** | QA Manager |
| **Blocking dependency** | None. |

#### TC-S1-CICD-3 — Security scan job passes

| | |
|---|---|
| **Description** | The `security` job (gitleaks secret detection, `pnpm audit`, semgrep SAST) runs with no critical findings on a clean PR. |
| **Preconditions** | T-15 + gitleaks fix merged (✅ PR #3). |
| **Steps** | 1. On an open PR, observe the **Security Scan** required check. |
| **Expected result** | Job **success**; no critical CVE, no committed secret, no critical SAST finding. |
| **Pass/fail criteria** | **Pass:** green. **Fail:** any critical finding (these block merge per pipeline §8). |
| **Owner** | Security Lead (verified by QA) |
| **Blocking dependency** | None. |

#### TC-S1-CICD-4 — Docker build succeeds (build smoke)

| | |
|---|---|
| **Description** | The multi-stage Dockerfile builds a runnable production image in CI. |
| **Preconditions** | `Dockerfile` present (✅ T-15). |
| **Steps** | 1. On a PR / on merge, observe the build smoke step. 2. Confirm the image builds without error. |
| **Expected result** | Image builds; non-root runtime; build step exits 0. |
| **Pass/fail criteria** | **Pass:** build succeeds. **Fail:** any build error. |
| **Owner** | Production Manager (verified by QA) |
| **Blocking dependency** | None. |

#### TC-S1-CICD-5 — Merge to `main` triggers staging deploy + GHCR push

| | |
|---|---|
| **Description** | Merging a PR to `main` runs `main-deploy.yml`: rebuild → push image to GHCR → trigger Coolify staging deploy. |
| **Preconditions** | `main-deploy.yml` active; GHCR auth on VPS (✅ FQ-12 resolved); Coolify deploy hook secret set. |
| **Steps** | 1. Merge a PR to `main`. 2. Watch the `main-deploy.yml` run. 3. Confirm GHCR shows a new image tag. 4. Confirm Coolify reports a new deployment. |
| **Expected result** | Workflow green through deploy; new image in GHCR; Coolify deployment recorded. |
| **Pass/fail criteria** | **Pass:** all deploy steps succeed. **Fail:** build/push/deploy failure (Coolify auto-rolls back to prior image). |
| **Owner** | Production Manager (verified by QA) |
| **Blocking dependency** | None (proven by T-07 run #27921007847). |

#### TC-S1-CICD-6 — Post-deploy health check gates the deploy

| | |
|---|---|
| **Description** | After a staging deploy, the pipeline polls `/health` until 200 (with timeout) before declaring success. |
| **Preconditions** | TC-S1-CICD-5 path active. |
| **Steps** | 1. On a `main-deploy.yml` run, observe the health-check step. 2. Confirm it polls the app `/health` and only passes on 200. |
| **Expected result** | Health check step turns green only after `/health` returns 200. |
| **Pass/fail criteria** | **Pass:** deploy gated on a real 200. **Fail:** step passes without a successful health probe, or never reaches 200 within timeout. |
| **Owner** | Production Manager (verified by QA) |
| **Blocking dependency** | None. |

---

### 2.3 Branch protection

Reference: `WORK.md` (branch protection fully active) + pipeline §7. Settings: 3 required checks (Lint & Type Check, Unit Tests, Security Scan), strict (up-to-date branches), `enforce_admins=true`, dismiss stale reviews, no force-push, no deletion.

#### TC-S1-BP-1 — Direct push to `main` is rejected

| | |
|---|---|
| **Description** | A direct push to `main` (even by an admin) is refused by branch protection. |
| **Preconditions** | Branch protection active with `enforce_admins=true`. |
| **Steps** | 1. On a throwaway clone/branch, attempt `git push origin <local>:main` with a trivial commit. |
| **Expected result** | Push **rejected** by GitHub (`protected branch hook declined` / required-checks error). |
| **Pass/fail criteria** | **Pass:** push refused. **Fail:** push accepted (would be a critical config gap — escalate to `FOUNDER_QUEUE.md`). |
| **Owner** | QA Manager |
| **Blocking dependency** | None. *(Execute against a no-op commit; do not actually land anything on `main`.)* |

#### TC-S1-BP-2 — PR with failing/missing checks cannot merge

| | |
|---|---|
| **Description** | The merge button is disabled until all 3 required checks pass. |
| **Preconditions** | Branch protection requires the 3 checks; strict mode on. |
| **Steps** | 1. Open a PR that deliberately fails one check (e.g. a lint error). 2. Confirm the merge control is blocked while that check is red. 3. Fix the check; confirm merge unblocks. |
| **Expected result** | Merge blocked while any required check is failing or pending. |
| **Pass/fail criteria** | **Pass:** cannot merge until all 3 green. **Fail:** merge available with a red/missing required check. |
| **Owner** | QA Manager |
| **Blocking dependency** | None. |

---

### 2.4 Sentry

Reference: T-13 (SDK init, PR #60). `SENTRY_DSN` set in Coolify env; `@sentry/node@10.59.0`.

#### TC-S1-SENTRY-1 — SDK initialized in the deployed app

| | |
|---|---|
| **Description** | The deployed ops-hub-app initializes the Sentry SDK on boot (DSN read from env). |
| **Preconditions** | T-13 SDK init deployed; `SENTRY_DSN` present in Coolify env. |
| **Steps** | 1. Inspect deploy/boot logs for Sentry init (no "DSN not configured" warning). 2. Confirm the SDK is initialized **before** request handling (init-order). |
| **Expected result** | Sentry initializes cleanly at startup with a valid DSN. |
| **Pass/fail criteria** | **Pass:** init logged, no DSN/init warnings. **Fail:** SDK not initialized, DSN missing, or init occurs after handlers load. |
| **Owner** | Production Manager (verified by QA) |
| **Blocking dependency** | None. |

#### TC-S1-SENTRY-2 — First error captured in the Sentry dashboard

| | |
|---|---|
| **Description** | A deliberately triggered error surfaces as an event in the Sentry project. |
| **Preconditions** | TC-S1-SENTRY-1 passing. A test-only route/handler (or a one-off `Sentry.captureException`) that throws on demand. |
| **Steps** | 1. Trigger the test throw (e.g. hit a guarded `/debug/sentry-test` route, or invoke a one-shot capture). 2. Open the Sentry project dashboard. 3. Locate the captured event. |
| **Expected result** | The error event appears in Sentry with stack trace + environment tag (`staging`). |
| **Pass/fail criteria** | **Pass:** event visible in Sentry within a few minutes, correctly tagged. **Fail:** no event appears. |
| **Owner** | Production Manager (verified by QA) |
| **Blocking dependency** | None. *(Remove/guard the test-throw route before it ships beyond verification.)* |

---

### 2.5 UptimeRobot — **BLOCKED on FQ-14**

Reference: FQ-14 (UptimeRobot API key needed). Monitors planned for all 3 staging URLs, 5-min interval, alert to `mai@leelaecospa.com`.

#### TC-S1-UPTIME-1 — Monitors active for all 3 staging services

| | |
|---|---|
| **Description** | UptimeRobot has active HTTP monitors for ops-hub-app, LiteLLM, and FreeScout. |
| **Preconditions** | **FQ-14 resolved** — `UPTIMEROBOT_API_KEY` in GitHub secrets (Option A) or monitors created manually (Option B). |
| **Steps (run once unblocked)** | 1. Confirm 3 monitors exist (the 3 staging URLs). 2. Confirm each is `Up` and interval = 5 min. 3. Confirm alert contact = `mai@leelaecospa.com`. |
| **Expected result** | 3 monitors, all `Up`, correct interval + alert contact. |
| **Pass/fail criteria** | **Pass:** all 3 present and `Up`. **Fail:** any missing or misconfigured. |
| **Owner** | Production Manager |
| **Blocking dependency** | **FQ-14.** |

#### TC-S1-UPTIME-2 — Alert fires on simulated downtime

| | |
|---|---|
| **Description** | When a monitored service goes down, UptimeRobot detects it and sends an alert. |
| **Preconditions** | TC-S1-UPTIME-1 passing. A way to take one service down briefly (Coolify stop, or point a throwaway monitor at a known-bad URL). |
| **Steps (run once unblocked)** | 1. Stop a non-critical service (or use a throwaway monitor → bad URL). 2. Wait past one check interval. 3. Confirm monitor flips to `Down`. 4. Confirm alert email received. 5. Restore the service; confirm it returns to `Up`. |
| **Expected result** | Monitor detects down state; alert email delivered; recovery detected. |
| **Pass/fail criteria** | **Pass:** down detected + alert received + recovery detected. **Fail:** no state change or no alert. |
| **Owner** | Production Manager |
| **Blocking dependency** | **FQ-14.** |

---

### 2.6 Inngest — **BLOCKED on FQ-13**

Reference: FQ-13 (Inngest Cloud signing key + event key). App `/api/inngest` live (`inngest@4.7.0`, `helloWorld` function).

#### TC-S1-INNGEST-1 — App syncs to Inngest Cloud

| | |
|---|---|
| **Description** | After credentials are set, the app's `/api/inngest` endpoint successfully syncs to Inngest Cloud and the app appears in the dashboard. |
| **Preconditions** | **FQ-13 resolved** — `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` set in Coolify env; app restarted; app synced from the Inngest Cloud dashboard. |
| **Steps (run once unblocked)** | 1. In Inngest Cloud → Apps, confirm the `ops-hub` app shows as synced. 2. Confirm the `helloWorld` function is listed. |
| **Expected result** | App synced; functions discovered. |
| **Pass/fail criteria** | **Pass:** app + function visible. **Fail:** sync error or app absent. |
| **Owner** | Production Manager |
| **Blocking dependency** | **FQ-13.** |

#### TC-S1-INNGEST-2 — Test event `test/hello.world` is processed

| | |
|---|---|
| **Description** | Sending the `test/hello.world` event triggers the `helloWorld` function and a successful run is recorded. |
| **Preconditions** | TC-S1-INNGEST-1 passing. |
| **Steps (run once unblocked)** | 1. Send a `test/hello.world` event (Inngest dashboard "Send test event" or the event API with the event key). 2. In the dashboard → Runs, locate the resulting run. |
| **Expected result** | A run for `helloWorld` completes **successfully** from the `test/hello.world` event. |
| **Pass/fail criteria** | **Pass:** run present and succeeded. **Fail:** no run, or run errored. |
| **Owner** | Production Manager (verified by QA) |
| **Blocking dependency** | **FQ-13.** |

---

### 2.7 Supabase schema — **BLOCKED on "FQ-15" (T-11 migrations)**

Reference: `docs/engineering/database-schema.md`, `supabase/migrations/`, `docs/engineering/t11-migration-runbook.md`. The 6 tables: **`projects`, `tenants`, `tickets`, `audit_log`, `feature_flags`, `kb_articles`**.

> **RLS scope boundary (read before running):** Sprint 1 verifies RLS is **enabled** on all 6 tables and that a query with **no tenant context returns zero rows** (fail-closed smoke). Sprint 1 does **not** verify exhaustive cross-tenant isolation (tenant A cannot read tenant B's rows via the `ops_hub_app` path) — that is **T-18** in Sprint 2.

#### TC-S1-DB-1 — All 6 tables exist

| | |
|---|---|
| **Description** | The initial schema migration created the 6 Ops Hub tables. |
| **Preconditions** | **Migrations applied (see §3).** Migration `20260618120000_initial_schema.sql` run. |
| **Steps (run once unblocked)** | 1. Connect to staging DB. 2. `select tablename from pg_tables where schemaname='public' order by 1;` |
| **Expected result** | The result includes `projects`, `tenants`, `tickets`, `audit_log`, `feature_flags`, `kb_articles`. |
| **Pass/fail criteria** | **Pass:** all 6 present. **Fail:** any missing. |
| **Owner** | Tech Lead (verified by QA) |
| **Blocking dependency** | **"FQ-15" / T-11.** |

#### TC-S1-DB-2 — RLS enabled on all 6 tables

| | |
|---|---|
| **Description** | Row-level security is enabled on every Ops Hub table (migration `20260618120100_enable_rls_policies.sql`). |
| **Preconditions** | Both migrations applied; Security Lead RLS sign-off recorded. |
| **Steps (run once unblocked)** | 1. `select relname, relrowsecurity from pg_class where relname in ('projects','tenants','tickets','audit_log','feature_flags','kb_articles');` |
| **Expected result** | `relrowsecurity = true` for all 6. |
| **Pass/fail criteria** | **Pass:** RLS on for all 6. **Fail:** RLS off on any one. |
| **Owner** | Security Lead (verified by QA) |
| **Blocking dependency** | **"FQ-15" / T-11.** |

#### TC-S1-DB-3 — `ops_hub_app` role exists with correct grants

| | |
|---|---|
| **Description** | The non-superuser `ops_hub_app` role exists and does **not** bypass RLS; it holds CRUD grants on the public schema. |
| **Preconditions** | Migration 2 applied (creates the role + grants). |
| **Steps (run once unblocked)** | 1. `select rolname, rolbypassrls, rolsuper from pg_roles where rolname='ops_hub_app';` 2. Spot-check a table grant via `information_schema.role_table_grants`. |
| **Expected result** | Role exists; `rolbypassrls = false`; `rolsuper = false`; has select/insert/update/delete on public tables. |
| **Pass/fail criteria** | **Pass:** role present, does not bypass RLS, grants present. **Fail:** role missing, or `rolbypassrls = true` (critical — escalate). |
| **Owner** | Security Lead (verified by QA) |
| **Blocking dependency** | **"FQ-15" / T-11.** |

#### TC-S1-DB-4 — Fail-closed smoke (no tenant context → zero rows)

| | |
|---|---|
| **Description** | Connected as `ops_hub_app` with **no** tenant GUC set, a select against a tenant-scoped table returns **zero rows** (RLS denies by default rather than leaking). |
| **Preconditions** | TC-S1-DB-1..3 passing; at least one seed row exists in a tenant-scoped table (e.g. `tickets`) under a known tenant. |
| **Steps (run once unblocked)** | 1. Connect as `ops_hub_app` (no `set` of the tenant GUC). 2. `select count(*) from tickets;` |
| **Expected result** | `count = 0` (RLS denies because no tenant context is present). |
| **Pass/fail criteria** | **Pass:** zero rows returned with no tenant context. **Fail:** any rows returned (data leak — **critical**, escalate to `FOUNDER_QUEUE.md` and Security Lead). |
| **Owner** | Security Lead (verified by QA) |
| **Blocking dependency** | **"FQ-15" / T-11.** |

> **Boundary note:** TC-S1-DB-4 is a *single-direction* fail-closed smoke. The *positive-and-isolated* test — set tenant A's context, confirm only A's rows are visible and none of tenant B's — is **T-18** (Sprint 2) and is intentionally out of scope here.

---

## 3. Blocked tests

> **Discrepancy note (QA):** the Sprint 1 Supabase-schema blocker is labeled **"FQ-15"** in the T-06 task brief, but `FOUNDER_QUEUE.md` currently has **only FQ-13 and FQ-14** open. The real Supabase-migration blocker is **T-11** — runbook at `docs/engineering/t11-migration-runbook.md`, awaiting **(a)** Security Lead RLS sign-off (gates migration 2) and **(b)** founder execution of the runbook. This plan keeps the "FQ-15" label for traceability with the brief but treats it as the **T-11 migration-execution blocker**. If a distinct FQ-15 is opened later, reconcile this table to it.

| Test case(s) | Blocked on | Real-world unblock action | Owner of unblock |
|---|---|---|---|
| TC-S1-INNGEST-1, TC-S1-INNGEST-2 | **FQ-13** | Founder provisions Inngest Cloud app; sets `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` in Coolify; restarts app; syncs `/api/inngest`. | Founder → Production Manager |
| TC-S1-UPTIME-1, TC-S1-UPTIME-2 | **FQ-14** | Founder provides UptimeRobot API key (Option A) or creates 3 monitors manually (Option B). | Founder → Production Manager |
| TC-S1-HEALTH-4, TC-S1-DB-1..4 | **"FQ-15" / T-11** | Security Lead signs off RLS (migration 2); founder executes the T-11 migration runbook against staging Supabase. | Security Lead + Founder → Tech Lead |

All other cases (HEALTH-1..3, all CICD, all BP, both SENTRY) are **executable now** — none are blocked.

---

## 4. Exit criteria for Sprint 1 (M1)

M1 is declared complete only when the "green now" set is verified **and** the "blocked" set has been verified after its dependency resolves. This mirrors the M1 checklist in `WORK.md` (#4 and #9 currently partial).

### Group A — must be green now (no external dependency)

- [ ] **TC-S1-HEALTH-1..3** — ops-hub-app, LiteLLM, FreeScout all reachable/healthy on staging.
- [ ] **TC-S1-CICD-1..6** — lint, test, security scan, Docker build, staging deploy + GHCR push, post-deploy health gate all pass.
- [ ] **TC-S1-BP-1..2** — direct push to `main` rejected; PR cannot merge without 3 green checks.
- [ ] **TC-S1-SENTRY-1..2** — SDK initialized in the deployed app; first error captured in the Sentry dashboard.

### Group B — required for M1 but currently blocked (verify on unblock)

- [ ] **TC-S1-INNGEST-1..2** *(FQ-13)* — app synced to Inngest Cloud; `test/hello.world` event processed. *(M1 #4)*
- [ ] **TC-S1-UPTIME-1..2** *(FQ-14)* — 3 monitors active; alert fires on simulated downtime. *(M1 #9)*
- [ ] **TC-S1-HEALTH-4 + TC-S1-DB-1..4** *("FQ-15" / T-11)* — Supabase reachable; 6 tables exist; RLS enabled on all 6; `ops_hub_app` role present and non-bypassing; fail-closed smoke returns zero rows.

### Sprint 1 sign-off rule

QA Manager signs off Sprint 1 (infra verification) when **Group A is fully green** and **every Group B item is either verified or has an explicit blocker logged** in `WORK.md` / `FOUNDER_QUEUE.md`. No silent gaps: any failing or skipped check is reported even if non-blocking. End-to-end ticket flow (M1 #10) and the behavioral eval gate (M1 #8) are validated separately in **Sprint 2** via **T-19** and **T-17** respectively, and are **not** part of this plan's exit criteria.

---

*This plan covers infrastructure verification only. Functional and integration testing of the ticket lifecycle begins with T-19 in Sprint 2.*
