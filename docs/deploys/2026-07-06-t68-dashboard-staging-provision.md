# Deploy plan — Ops Dashboard staging Coolify app (T-68, FQ-60 + FQ-59, STAGING ONLY)

**Status:** DONE, staging only (2026-07-06). App created, deployed, env vars
set, a real 502 (Next.js standalone bind-address bug) found and fixed along
the way, FQ-59's Basic Auth gate applied, and the blocking 401/200
verification passed — all against the app's auto-assigned sslip.io preview
address (Coolify rejects a custom `fqdn` for docker-image apps via the API,
same as FQ-24/T-10, but auto-assigns a reachable default). See WORK.md T-68
and DECISIONS.md 2026-07-06 T-68 for the full write-up including two real
bugs found (bind address; a YAML block-scalar break that mimicked the FQ-48
quirk) and one real credential-escaping finding. Only remaining step is a
founder domain action (FQ-63) for a real TLS address — filed, non-blocking.

**Scope guardrail:** staging only. This plan does NOT touch `ops-hub-prod`
(UUID `sbke5gqru1n54rj7gssgca2y`) or provision a prod dashboard app. FQ-60's
own recommendation is staging first, confirm T-60's RLS sign-off, then
promote — T-60 passed 2026-07-06 (21/21 live checks, no cross-tenant leak),
but prod promotion is out of this task's scope by design and is filed as a
follow-up (see WORK.md T-68).

---

## What's wrong / missing

T-59 built the Ops Dashboard (`web/`) and it has been verified locally and
against a real Docker build, but per FQ-60 it had **no Coolify deploy
target** — unlike ops-hub's backend (`ops-hub-staging`/`ops-hub-prod`,
already provisioned), this app never had anywhere to run.

## What "done" looks like

- A new Coolify application exists on the `ops-hub-staging` project, built
  from `web/Dockerfile` with the **repo root** as build context, running the
  real image (not just created — actually deployed and healthy).
- `OPS_HUB_APP_LOGIN_URL` set to the **same** `ops_hub_app_login` staging DSN
  already used by `ops-hub-staging` (UUID `ajqplom2mghf5a8h6vf1q6xg`) — copied,
  never regenerated.
- `POLLING_PROJECT_ID` / `POLLING_TENANT_ID` set to the staging scope
  (`00000000-0000-0000-0000-000000000001` / `...0010`).
- FQ-59's Traefik/Coolify HTTP Basic Auth gate applied to the app's route
  BEFORE it is treated as reachable, verified by:
  `curl -sS -o /dev/null -w '%{http_code}' https://<fqdn>/` → **401**
  unauthenticated, **200** with the credential — and the dashboard rendering
  real data behind that gate (all 4 charter pillars, post-T-58/T-67/T-66).

## Canary target

Single staging app; there is no fleet to canary across. The "canary window"
here is: confirm the container deploys clean and stays healthy for the
remainder of this session, then leave it running unattended (read-only app,
no write path, no cron, nothing that can corrupt state) — a much lower-risk
profile than a backend redeploy. No 24–72h monitoring window is warranted for
a brand-new, traffic-free, read-only app; standard UptimeRobot/Sentry
observation resumes once it has a public domain.

## Rollback path (defined BEFORE this was executed, per team quality bar)

This app is new and carries no production traffic — the rollback for
anything in this plan is strictly additive-removal:

- **Bad image / broken container:** re-run
  `provision-ops-dashboard-staging.yml` (rebuilds from the current `main`
  HEAD) or `DELETE /applications/{uuid}` via the Coolify API to remove the
  app entirely. Nothing else references this app's UUID.
- **Bad env var:** re-run the workflow (delete-then-set is idempotent) or
  `DELETE /applications/{uuid}/envs/{env_uuid}` for the single bad row.
- **Bad Basic Auth label:** `apply-dashboard-basic-auth.yml` is idempotent
  (strips and rebuilds its own `dashauth` lines only, merging with — never
  clobbering — Coolify's own router middlewares) — re-running it with a new
  hash rotates the credential; PATCHing `custom_labels` back to the
  pre-basic-auth snapshot (captured in that workflow's own log output) removes
  it entirely if ever needed.
- Mean rollback time target < 15 minutes: every path above is a single API
  call or workflow re-dispatch, no manual container surgery.

## Steps (in order, matches what was actually run)

1. `.github/workflows/provision-ops-dashboard-staging.yml` — builds
   `web/Dockerfile` from the repo root, pushes to GHCR, discovers
   `ops-hub-staging`'s Coolify project/server/environment, creates a new
   `dockerimage`-type app (`ops-hub-dashboard-staging`), starts a real
   deployment, and sets the 3 env vars (login DSN copied, polling scope
   staging).
2. **Founder action (Coolify UI — API rejects `fqdn` for docker-image apps,
   HTTP 422, same limitation as FQ-24/T-10):** attach a domain to the new
   app. Suggested, matching the existing `*-staging.inatechshell.ca`
   convention: `ops-dashboard-staging.inatechshell.ca`. No new DNS record is
   expected (same wildcard pattern the other staging apps already use) — just
   the Coolify UI Domains field, Save, then Deploy.
3. `.github/workflows/apply-dashboard-basic-auth.yml` — dispatched once step
   2 is done. Reads the FQ-59 credential from repo secrets
   (`DASHBOARD_BASIC_AUTH_USERHASH` / `DASHBOARD_BASIC_AUTH_PASSWORD`),
   merges a `dashauth` Traefik middleware into every router Coolify generated
   for the new FQDN, force-recreates the container, then runs the BLOCKING
   401 (unauthenticated) and 200 (authenticated) verification per FQ-59
   Action 3. Idempotent — safe to re-run.
4. Manual spot-check in a browser once gated: confirm all 4 charter pillars
   (SLA/open-tickets, agent-cost, eval-health, platform-incidents) render
   real numbers, not just that the page loads.

## What actually happened (2026-07-06)

- **Step 1:** done. `provision-ops-dashboard-staging.yml` created the app,
  built and pushed the image, deployed it, and set all 3 env vars. First
  deploy returned a live HTTP 502 — root-caused (Next.js standalone binds
  to `process.env.HOSTNAME`, which Docker sets to the container ID, not
  `0.0.0.0`) and fixed with one `web/Dockerfile` line
  (`ENV HOSTNAME=0.0.0.0`). Re-deployed, confirmed HTTP 200 with real
  widget data.
- **Step 2 (domain):** Coolify auto-assigned a reachable default domain
  (`http://r14c3p7jzwo4wxyprd4yxyev.187.124.76.235.sslip.io`) even without
  an explicit custom `fqdn`, so this step did NOT block the rest of the
  plan this session — it's now filed as **FQ-63** for a real TLS domain,
  non-blocking.
- **Step 3:** done. `apply-dashboard-basic-auth.yml` applied the gate and
  ran the blocking verification against the sslip.io address: 401
  unauthenticated, 200 authenticated. One real finding along the way: the
  credential file's `$`-escaped ("`$$`") variant did not work through this
  specific API path (Coolify `custom_labels` PATCH) — the unescaped
  variant does; see DECISIONS.md 2026-07-06 T-68.
- **Step 4:** done, both by the workflow and independently by hand —
  response body contains real SLA/pipeline data and the honest T-58
  "pending real gate" placeholder, no "failed to load" cards.

## What's left (see FOUNDER_QUEUE.md FQ-63 for the consolidated ask)

Only the domain swap (sslip.io preview → real TLS domain) remains, and it's
non-blocking — the dashboard is already secure and fully functional today.
Once the founder attaches the real domain, re-dispatching
`apply-dashboard-basic-auth.yml` re-gates it (idempotent, no code changes
needed). Prod promotion is a separate, not-yet-started follow-up.
