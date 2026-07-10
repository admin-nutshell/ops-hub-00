# Deploy record — internal LiteLLM auth-path monitor (T-97)

**Status:** DONE. Code merged, deployed to ops-hub-staging (automatic) and
ops-hub-prod (manual `prod-deploy.yml` dispatch), and the full exit-criteria
proof executed live against the real deployed endpoint and the real
alerting pipeline. This record is written retrospectively, after the fact,
covering what shipped and what verification actually observed — not a
plan written before the work (this task's exit criteria require live
proof, so verification happened inline as part of getting to "done").

**Risk class:** Low. New additive read-only GET/HEAD route (no existing
route, schema, or env var touched) plus a new scheduled CI workflow that
only reads a public endpoint and dispatches an existing, already-used
`workflow_dispatch` action (`status-incident.yml`). No write path to the
app's data, no new production secret, no change to `ticket-triage.ts`'s
or `ticket-respond.ts`'s actual behavior.

---

## What changed

1. **`resolveLitellmTarget()`** extracted from `classifyTicket`
   (`src/inngest/ticket-triage.ts`) — the one place that resolves
   `LITELLM_URL` / `LITELLM_MASTER_KEY` / `LITELLM_TRIAGE_MODEL`. Both
   `classifyTicket` and the new health check now call this same function,
   so the health probe cannot silently use a different credential than the
   real triage/respond call path.
2. **New `GET/HEAD /health/litellm-internal`** (`src/healthLitellmInternal.ts`,
   wired into `src/index.ts`). Makes a real, minimal completion call
   (`max_tokens: 5`, prompt "Reply with the single word OK") over the
   **internal** `LITELLM_URL` with the app's own key against the
   `triage-model` alias — the exact hop `ticket-triage.ts`/`ticket-respond.ts`
   use. Maps `401`/`403` → `503 auth_rejected`, other non-2xx → `503 error`,
   network/timeout → `503 unreachable`, `2xx` → `200`.
3. **New scheduled workflow** `.github/workflows/monitor-litellm-internal-auth.yml`
   (every 15 min + `workflow_dispatch` with a `mode: live | simulate-failure`
   input). Curls the deployed endpoint on ops-hub-prod — holds **zero** copy
   of `LITELLM_MASTER_KEY` in CI. On non-200 it calls
   `gh workflow run status-incident.yml -f action=open` (reusing the
   already-existing manual open/resolve action, since UptimeRobot's webhook
   alert path needs a paid tier the founder declined per FQ-47 4b) and fails
   the run. On 200 it resolves any open incident the same way.
4. **New one-off verification workflow**
   `.github/workflows/verify-litellm-internal-health-handler.yml`
   (`workflow_dispatch`-only) — sets `T97_LIVE_PROBE=1` +
   `LITELLM_MASTER_KEY` and runs the live integration test
   (`src/integration/litellm-internal-health.integration.test.ts`) that
   proves the real handler code, against the real litellm-staging instance,
   maps a genuine 401 (deliberately-wrong key, no real secret needed for
   that half) to `503 auth_rejected`, and the real key to `200`.

## Why this exists

FQ-69 (Sprint 8): 70% of production tickets sat stuck in `state='new'` for
3.6 days because ops-hub-prod's real `LITELLM_MASTER_KEY` was rejected by
litellm-prod — while `/health/litellm` reported `ok` the entire time. That
endpoint probes `LITELLM_EXTERNAL_URL` and never sends the app's own key
(any HTTP response, including a bare 401 with no Authorization header at
all, counts as "reachable"), so it structurally cannot see the app's own
credential being rejected. This is the **second** incident from this exact
blind-spot class (T-71 was the internal-URL-staleness layer; FQ-69 was the
master-key layer) — committed as T-97, not left as a flagged risk.

## Bugs found and fixed during live verification

Live-dispatching the actual workflows against real infrastructure (rather
than trusting the design on paper) surfaced three real bugs, each fixed in
its own PR:

1. **PR #371** — an early version of the live-network integration test
   needed no secret for its bad-key case, so it ran unconditionally under
   plain `vitest run`, which is also what `main-deploy.yml`'s "Unit tests"
   step runs before every staging deploy. A transient network hiccup
   against litellm-staging turned it into a flaky deploy-blocking
   dependency the first time it ran there — observed directly on the
   `main-deploy.yml` run immediately after the feature PR (#369) merged
   (`expected 'unreachable' to be 'auth_rejected'`). Fixed by gating the
   whole test file behind an explicit opt-in env var (`T97_LIVE_PROBE=1`),
   set only by the new one-off verification workflow.
2. **PR #373** — live-dispatching `monitor-litellm-internal-auth.yml` with
   `mode=simulate-failure` against real ops-hub-prod caught that the probe
   job's `gh workflow run status-incident.yml` call failed with
   `fatal: not a git repository` (the job has no `actions/checkout` step,
   so `gh` had no local git remote to infer the target repo from). The job
   still failed correctly (exit 1), but the incident-open side effect
   silently never fired. Fixed with an explicit `--repo` flag.
3. **PR #374** — a live `mode=live` run against the real, healthy prod
   endpoint genuinely timed out at `--max-time 15` (a manual recheck
   seconds later returned 200 in ~2s), and the failure fallback
   (`$(curl ... || echo "000")`) let curl's own `-w` output and the echo
   fallback both land in the substitution, producing `HTTP 000000`. Fixed
   by widening the timeout to 25s and capturing curl's real exit code
   separately.

## Full exit-criteria proof (every link live-verified)

Per T-97's exit criteria verbatim: *"monitor live on ops-hub-prod, verified
it fires on a simulated/known auth-reject and clears on a good path."*

1. **Real handler vs. real litellm-staging, bad key → 401 → `auth_rejected`.**
   `src/integration/litellm-internal-health.integration.test.ts` runs the
   actual `handleLitellmInternalHealth` code against
   `https://litellm-staging.inatechshell.ca` with a deliberately-wrong,
   hardcoded (not real) bearer token. Observed directly in PR #369's CI
   before the opt-in gate landed (real 401 → `503 auth_rejected`,
   `httpStatus: 401`), and reproducible on demand via
   `verify-litellm-internal-health-handler.yml`.
2. **Deployed + real credential → clean 200.** `prod-deploy.yml` run
   `29070242860` promoted the code to ops-hub-prod. Live:
   ```
   curl https://ops-hub-prod.inatechshell.ca/health/litellm-internal
   → 200 {"status":"ok","litellm_internal":"reachable_and_authenticated"}
   ```
3. **Alert OPENS on failure.** Dispatched
   `monitor-litellm-internal-auth.yml mode=simulate-failure` (forces a 404
   against a nonexistent path — never touches prod's real credential or
   state) → `status-incident.yml` run `29070612022` → a real incident file
   (`status/content/2026-07-10-litellm-internal-auth-probe-failing-on-ops-hub-pro.md`)
   created on the `status-content` branch.
4. **Alert RESOLVES on recovery.** Dispatched `mode=live` against the
   healthy endpoint → `status-incident.yml` run `29070815778` → the same
   incident file flipped to `resolved: true`.

## Incidental finding (staging, out of scope, not fixed here)

`https://ops-hub-staging.inatechshell.ca/health/litellm-internal` currently
reports `503 unreachable` (a network error, not `auth_rejected`), even
though `/health/litellm` (external) and `/health/env` both report healthy
on staging. This is consistent with the known "LiteLLM internal container
suffix changes on every redeploy" footgun (CLAUDE.md) — this time on
staging, not prod. It is itself a small live demonstration of the
monitor's value (a real problem `/health/litellm` cannot see), but fixing
staging's `LITELLM_URL` is out of T-97's prod-scoped exit criteria and not
actioned here — flagged as a follow-up.

## Rollback path (defined before dispatch, per team quality bar)

- Purely additive: new route, new scheduled workflow, no existing
  route/behavior modified, no schema/env-var change.
- App rollback: redeploy the prior image tag via `prod-deploy.yml`'s
  existing promotion mechanics (`docker_registry_image_tag` back to the
  previous commit SHA, `/start`).
- Monitor rollback: disable `monitor-litellm-internal-auth.yml`'s
  `schedule:` trigger (or delete the file) if it ever produces persistent
  false positives — the app itself is unaffected either way, since the
  endpoint is inert until curled.
- Mean rollback time target < 15 minutes; this change carries very low
  rollback risk (a new 404-free route cannot regress `/health`,
  `/health/env`, or `/health/litellm`, all of which are untouched files).

## Canary / monitoring window

Deployed straight to prod after a green staging deploy (per this class of
low-risk, additive, read-only change — same posture as T-63's
`/health/env`). The live verification above (curl + 2 full monitor
dispatch cycles) is itself the smoke test; ongoing monitoring is the
15-minute schedule this task exists to add.

## What's left

- Nothing blocking. The scheduled `*/15 * * * *` trigger is live and will
  run unattended going forward.
- Optional follow-up (not scheduled): fix staging's stale internal
  `LITELLM_URL` (the incidental finding above).
- Optional follow-up (not scheduled): the root-cause-of-the-root-cause of
  why litellm-prod's/staging's internal container suffix drifts without
  updating the dependent app's `LITELLM_URL` (flagged since Sprint 8,
  partially mitigated by this monitor now catching the symptom faster).
