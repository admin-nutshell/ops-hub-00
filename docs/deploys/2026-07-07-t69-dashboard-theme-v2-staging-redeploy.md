# Deploy plan — Ops Dashboard staging redeploy with theme-v2 (T-69, STAGING ONLY)

**Status:** DONE (2026-07-07). Founder authorized "deploy to staging" this
session for the merged Slate/Indigo dark theme (PR #277, human-reviewed and
merged to `main` at `7da28d1`). Redeployed the existing T-68 staging
dashboard app from that HEAD; verified the Basic Auth gate survives a full
image redeploy (not just a stop/start); confirmed the new theme is serving.
See WORK.md T-69 and DECISIONS.md 2026-07-07 T-69 for the full write-up.

**Scope guardrail:** staging only. Does NOT touch `ops-hub-prod` (UUID
`sbke5gqru1n54rj7gssgca2y`) — no prod dashboard app exists. Prod promotion
is a separate, not-yet-started follow-up requiring its own founder
authorization.

---

## What changed

PR #277 restyled the Ops Dashboard (`web/`) to the founder-approved
Slate/Indigo dark theme — CSS tokens, spacing, and component markup only;
no query logic in `src/metrics/*` touched, no env var or infra changes.

## What "done" looks like

- `ops-hub-dashboard-staging` (UUID `r14c3p7jzwo4wxyprd4yxyev`) is running
  the image built from `main` HEAD `7da28d1`, not the pre-theme image.
- Unauthenticated `curl` to the dashboard FQDN still returns **401** (the
  FQ-59 Basic Auth gate must survive the redeploy).
- Authenticated `curl` returns **200** with the new theme's markup present
  and all pillars rendering (no "failed to load" cards).
- Coolify reports the app healthy, no crash-loop.

## Canary target

Single staging app, no fleet to canary across, read-only app with no write
path — same low-risk profile as T-68's original deploy. No 24–72h
monitoring window warranted; this is a UI-only restyle of an unauthenticated
(behind Basic Auth)/no-write app already isolated from prod. Standard
UptimeRobot/Sentry observation is out of scope until FQ-63's real domain
lands.

## Rollback path (defined BEFORE dispatch, per team quality bar)

- Re-run `provision-ops-dashboard-staging.yml` on `--ref` pointed at the
  prior `main` commit (`7742d1d`, pre-theme HEAD) — rebuilds and redeploys
  that image the same way.
- Or: `PATCH https://coolify.inatechshell.ca/api/v1/applications/r14c3p7jzwo4wxyprd4yxyev`
  with `{"docker_registry_image_tag": "7742d1d..."}` (the prior commit sha)
  followed by `POST .../start`.
- Both paths are the same idempotent mechanics as the forward deploy — no
  manual container surgery. Mean rollback time target < 15 minutes.
- Not exercised this session — the deploy succeeded clean on the first
  attempt.

## Steps (in order, matches what was actually run)

1. Confirmed PR #277 was merged to `main` (`7da28d1`) by the founder review
   process (not an agent self-merge) before treating this as authorized.
2. Captured a pre-deploy baseline: unauthenticated curl -> 401; authenticated
   curl -> 200, saved response body, confirmed the OLD theme marker
   (`max-w-[1280px]`, from the pre-#277 `page.tsx`) was present.
3. Dispatched `.github/workflows/provision-ops-dashboard-staging.yml` on
   `--ref main` ([run 28838676819](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28838676819)).
   This rebuilt `web/Dockerfile` from the repo root at `7da28d1`, pushed
   `ghcr.io/admin-nutshell/ops-hub-00-dashboard:7da28d10ea067988f29dc8f6f17009252547a475`,
   patched the existing app's image tag (idempotent re-run path — app
   already existed from T-68), re-set the 3 env vars (delete-then-set,
   no duplicate rows), and triggered + polled a real Coolify deployment to
   `finished`.
4. **Verified the gate FIRST, before any reapply** — unauthenticated curl
   immediately after the deploy finished returned **401** on the first
   attempt. This is the load-bearing check for this task: it proves the
   Basic Auth gate (Traefik `custom_labels`, applied by a separate
   workflow in T-68) is untouched by an image-tag-only redeploy. Had it
   NOT been 401, the next step would have been re-dispatching
   `apply-dashboard-basic-auth.yml` to restore it before treating the app
   as reachable.
5. Verified authenticated curl -> 200, 44,575-byte body (up from 41,283).
   Grepped the server-rendered HTML for JSX-level class markers taken
   directly from PR #277's `page.tsx` diff (`max-w-[1320px]`, `gap-[30px]`)
   — both present; the old marker (`max-w-[1280px]`) gone. Confirmed all
   7 pillar/widget labels render and zero "failed to load" cards.
6. Confirmed Coolify health via the existing read-only
   `diagnose-dashboard-staging.yml`
   ([run 28838765351](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28838765351)):
   `restart_count: 0`, clean `Next.js ... Ready in 0ms` boot log.

## What's left

Nothing blocking. FQ-63 (real TLS domain for the dashboard, replacing the
sslip.io preview) remains open and non-blocking, unrelated to this task.
Prod dashboard promotion remains a separate, not-yet-started follow-up.
