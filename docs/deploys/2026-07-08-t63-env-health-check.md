# Deploy plan — env var presence health check (T-63)

**Status:** code + tests DONE, PR open. Deploy to staging (automatic on
merge) + prod (manual `prod-deploy.yml` dispatch) still to execute after
merge. UptimeRobot monitor wiring is a **documented founder action**, not
executed by this task — see "UptimeRobot" section below for why.

**Risk class:** Low (per `docs/deploys/checklist.md`). New read-only GET/HEAD
endpoint, additive only — no existing route, schema, or env var touched. No
write path, no new dependency, no auth surface change. 4-hour staging
canary window per the Low-risk table (informal; this class doesn't
realistically fail in a way a canary window would catch beyond the smoke
test below).

---

## What changed

New `GET/HEAD /health/env` endpoint on ops-hub (`src/healthEnv.ts`, wired
into `src/index.ts` next to the existing `/health` and `/health/litellm`
routes). Reports whether the 14 env vars required by T-47/T-51's exit
criteria (WORK.md) are present on the running process:

```
OPS_HUB_APP_LOGIN_URL, POLLING_PROJECT_ID, POLLING_TENANT_ID,
LITELLM_TRIAGE_MODEL, LITELLM_FALLBACK_MODEL, LITELLM_URL,
LITELLM_MASTER_KEY, LITELLM_EXTERNAL_URL, INNGEST_SIGNING_KEY,
INNGEST_EVENT_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY,
SENTRY_DSN, NVIDIA_API_KEY
```

Returns `200 {"status":"ok","checked":14,"missing":[]}` when all present,
`503 {"status":"degraded","checked":14,"missing":[...]}` when any are
missing — same ok/degraded, 200/503 convention as `handleLitellmHealth`
(T-44), so "alert on non-200" wiring is unchanged.

**Why this exists:** Sprint 5 §3/§4.1 — 9 env vars silently disappeared from
`ops-hub-prod`'s Coolify config two days after T-47 recorded them as set
(most likely cause: Coolify's known append-not-upsert env var bug, triggered
by an intermediate save during T-50). Nothing caught it until T-51's live
production test happened to run. The Sprint 5 retro (§5 item, §7 risk table)
asked for a lightweight periodic check instead of relying on that luck again.

**Design choice — self-scoped, no Coolify API token needed:** this endpoint
checks the *running process's own* `process.env`, not another app's Coolify
config via API. That's a real constraint (an instance can only see its own
env, so an ops-hub-staging deploy can never confirm ops-hub-prod's state or
vice versa) but it's also exactly the failure mode that happened: the
running prod process was missing vars it needed. A cross-app Coolify-API
checker would need a token, could read stale/cached config, and wouldn't
prove the *running* process actually has the var. Deploy this endpoint to
BOTH ops-hub-staging and ops-hub-prod and each catches its own drift.

**Security:** presence-only. The handler only ever checks
`process.env[key] === undefined || value === ""` — it never reads a
present var's value beyond that boolean check, never logs a value, and the
JSON body only ever contains the (non-secret) *key names* found missing —
see `src/healthEnv.ts`'s doc comment for the explicit reasoning on why
naming the missing keys (not values) in an unauthenticated response is safe
and intentional, consistent with `/health/litellm` already disclosing
reachability state unauthenticated.

**Explicitly out of scope (see `src/healthEnv.ts` comment for the full
reasoning):** `POLLING_ENABLED` and `INNGEST_APP_ID` (T-54 vars whose
correct state differs per environment — staging is correctly missing/false
where prod must be true/set, so a uniform presence check would be wrong on
one side), `FREESCOUT_DB_URL`/`FREESCOUT_BOT_USER_ID` (T-50), and
`AGENT_COST_SYNC_ENABLED` (T-58) — all real vars but outside this task's
explicit T-47/T-51 scope.

## What "done" looks like

- `pnpm typecheck` / `pnpm lint` / `pnpm test` all green (verified locally
  this session: 93 tests passing, up from 87, 0 failures).
- PR merged to `main`.
- `main-deploy.yml` auto-deploys ops-hub-staging; `curl
  https://ops-hub-staging.inatechshell.ca/health/env` returns 200 with
  `missing: []`.
- `prod-deploy.yml` manually dispatched to promote to ops-hub-prod; `curl
  https://ops-hub-prod.inatechshell.ca/health/env` returns 200 with
  `missing: []`.
- Both results recorded in WORK.md T-63 (this is itself the live proof the
  tool works — a 503 on either host is a genuine finding, not a failure of
  this task).

## Canary target

Both ops-hub-staging and ops-hub-prod are the target (this endpoint's whole
purpose is per-environment self-checking, so there's no single canary
instance to test before a fleet-wide rollout — it's the same additive route
on both, and prod is following its normal manual-promotion gate via
`prod-deploy.yml`, not a fleet push).

## Rollback path (defined BEFORE dispatch, per team quality bar)

- The change is additive-only (new route, no existing route/behavior
  modified) — rollback is simply redeploying the prior image tag via
  Coolify (`prod-deploy.yml`'s own promotion mechanics support this: patch
  `docker_registry_image_tag` back to the previous commit SHA, `/start`).
- No env var, schema, or config change accompanies this deploy, so there is
  no state to unwind beyond the container image itself.
- Mean rollback time target < 15 minutes; this change carries essentially
  zero rollback risk (a new 404-free route can't regress `/health` or
  `/health/litellm`, which are untouched files).

## UptimeRobot — documented founder action, not executed

**Confirmed, not guessed:** this account's UptimeRobot plan is free-tier,
and DECISIONS.md (2026-06-23, T-14) already root-caused that the free plan
returns a permanent `access_denied` on the `newMonitor` API call — "You are
not allowed to use some settings with your current plan." This is not
fixable via script parameters (already tested in PR #91 for T-14) and
requires a paid plan to lift. Re-dispatching `provision-uptimerobot.yml`
(or hand-rolling a similar call) for a new monitor would fail identically —
not attempted, per this task's own instruction to document rather than
guess at access that doesn't exist.

**Exact monitor config for the founder to add manually** (same manual
path used for T-14's original 3 monitors, ~2 minutes each in the UptimeRobot
dashboard, UptimeRobot > Add New Monitor):

| Field | Monitor 1 (staging) | Monitor 2 (prod) |
|---|---|---|
| Monitor Type | HTTP(s) | HTTP(s) |
| Friendly Name | `ops-hub-app env vars (staging)` | `ops-hub-app env vars (prod)` |
| URL | `https://ops-hub-staging.inatechshell.ca/health/env` | `https://ops-hub-prod.inatechshell.ca/health/env` |
| Monitoring Interval | 5 minutes (free-plan default, matches existing 3 monitors) | 5 minutes |
| Alert Contacts | none yet — same open follow-up as T-14's original 3 monitors (email routing to mai@leelaecospa.com needs an Alert Contact created first) | same |

UptimeRobot already alerts on any non-2xx response by default, so no extra
"expected status code" configuration is needed — 503 (degraded) will alert
the same way a connection failure would on the existing 3 monitors.

**Until this is added:** the endpoint exists and is safe to poll manually
(`curl .../health/env`) or spot-check per the Sprint 5 retro's own process
change #1 ("don't trust a WORK.md done checkmark on env vars without a live
check"), but drift will not page anyone automatically. This is the one
piece of T-63 that cannot be closed by this role without either a founder
UI action or a paid UptimeRobot plan (a cost decision, not raised here since
it wasn't asked for and the manual path is free and fast).

## Steps (in order)

1. Read WORK.md T-47/T-51 rows directly to derive the authoritative 14-var
   list (not the task summary's illustrative subset).
2. Read `docs/retros/sprint-5.md` for the incident this task exists to
   prevent.
3. Read `src/index.ts`, `src/healthLitellm.ts`, `src/healthLitellm.test.ts`
   to match existing conventions (bare `http.createServer`, same
   ok/degraded + 200/503 shape, same Vitest `makeRes()` test helper pattern).
4. Confirmed (DECISIONS.md, 2026-06-23) that UptimeRobot API monitor
   creation is permanently blocked on this account's free plan — decided
   not to attempt it, document instead.
5. Built `src/healthEnv.ts` + `src/healthEnv.test.ts` (6 new tests: all-ok,
   single-missing, empty-string-counts-as-missing, no-value-leak,
   multiple-missing, HEAD method).
6. Wired `/health/env` into `src/index.ts`.
7. `pnpm typecheck && pnpm lint && pnpm test` all green locally (93 tests,
   0 failures — prettier flags pre-existing CRLF line-ending noise across
   ~55 unrelated files on this Windows checkout, confirmed present on a
   clean `main` checkout with zero edits; CI runs on `ubuntu-latest` and is
   unaffected).
8. Wrote this deploy plan (rollback path defined before dispatch, per team
   quality bar) and the UptimeRobot monitor config above.
9. PR opened; merge + staging/prod deploy + live smoke test to follow.

## What's left

- Merge PR, confirm CI green.
- Confirm `main-deploy.yml` deploys ops-hub-staging automatically; curl the
  staging endpoint.
- Dispatch `prod-deploy.yml`; curl the prod endpoint.
- Founder adds the 2 UptimeRobot monitors per the table above (non-blocking
  — the endpoint itself is live and useful for manual/scripted checks
  either way).
