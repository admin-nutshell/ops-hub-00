# Deploy incident — Ops Dashboard PRODUCTION provision (T-70): blocked at 404, root-caused, escalated

**⚠️ CORRECTION (2026-07-07, same day):** the root cause and "What's left"
sections below (as originally written) concluded this was a shared,
proxy-global fault requiring a `coolify-proxy` restart. **That conclusion
was wrong and has been superseded** — see the "CORRECTED root cause"
section right after this banner, and `FOUNDER_QUEUE.md` FQ-64 (amended in
place) for the current, better-supported theory and the actual recommended
fix. The original investigation steps (1–5 below) are accurate and
unchanged; only step 6's conclusion and the "What's left" section are
superseded. Nothing here has been deleted — the original text is kept,
struck through where superseded, for the record.

**Status:** BLOCKED — deploy mechanics correct and completed; external
verification failed closed (404, not the required 401); root cause
corrected to a Traefik middleware-name collision (see below), fix prepared
in PR #281, **not yet founder-reviewed/merged, not yet live-verified.**
See WORK.md T-70 and DECISIONS.md 2026-07-07 T-70 (+ same-day follow-up)
for the full write-up; this file is the deploy-plan/incident record
required by the Production Manager quality bar (rollback path defined
before dispatch, canary target, monitoring).

## CORRECTED root cause (read this instead of the original step 6/"What's left")

Both `provision-ops-dashboard-prod.yml` and `apply-dashboard-basic-auth.yml`
(staging) name their Basic Auth Traefik middleware identically —
`dashauth` — with different per-environment password hashes. Traefik
treats a middleware name as one global identity across every container it
watches; two conflicting definitions makes it drop the middleware
entirely, and every router referencing it (only these two apps' routers
do) 404s — symmetric on both apps, exactly matching what was observed,
and exactly timed to when the T-70 workflow created the second,
conflicting definition. This fits the evidence better than a proxy-global
fault: if the shared proxy's docker-label provider were actually broken,
every label-discovered app on the server would be affected, not just the
two that happen to share this one middleware name — and every other app
on the server (`ops-hub-staging`, `freescout-staging`, `litellm-staging`,
`coolify` itself) was confirmed routing normally throughout.

**Fix, not yet live-verified:** PR #281 (`fix/t70-dashauth-name-collision`)
renames prod's middleware to `dashauth-prod`, a per-environment-unique
name that can never collide with staging's `dashauth` again. It is
gated on founder review/merge (prod-infra change, no self-merge) —
see `FOUNDER_QUEUE.md` FQ-64 for the immediate code-free alternative (a
~1-minute manual Coolify UI relabel, which doubles as the live test of
this theory).

**Scope guardrail:** prod dashboard app ONLY. Did NOT touch `ops-hub-prod`
(the backend), did NOT alter prod data, `service_role` never held. The one
action identified as necessary but out of scope (restarting the shared
`coolify-proxy` Traefik container) was NOT executed — filed to the founder
instead (FQ-64).

---

## What changed / what was attempted

Founder authorized "deploy the dashboard to production" this session (see
DECISIONS.md 2026-07-07 T-70 for exact wording). New workflow
`.github/workflows/provision-ops-dashboard-prod.yml` (PR #279, merged)
mirrors the proven staging path (T-68/T-69 + the FQ-59 Basic Auth gate),
deliberately collapsed into one single-pass job (no reachable-before-gated
window) since prod carries real tenant/ticket data:

1. Build `web/Dockerfile` from repo root, push to GHCR.
2. Discover `ops-hub-prod` project/server/environment.
3. Create `ops-hub-dashboard-prod` (Coolify `dockerimage` app),
   UUID `om6qsemx9upajj9yemid1ti3`.
4. Copy `OPS_HUB_APP_LOGIN_URL` from `ops-hub-prod` byte-for-byte (never
   regenerated); set prod-scoped `POLLING_PROJECT_ID`/`POLLING_TENANT_ID`
   and prod health-check URL overrides.
5. Deploy for real (Coolify deployment tracked to `finished`).
6. Merge a `dashauth` Basic Auth Traefik middleware into every router
   Coolify generated for the auto-assigned sslip.io fqdn, force-recreate.
7. BLOCKING verification: unauthenticated request must be 401.

Step 7 failed: 10/10 attempts returned HTTP 404
([run 28875816358](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28875816358)).
The workflow correctly refused to declare the app live and exited non-zero.

## Rollback path (defined BEFORE dispatch, per team quality bar)

This app carries no write path and no cron of its own — rollback is
`DELETE /applications/om6qsemx9upajj9yemid1ti3` via the Coolify API or UI,
or re-running `provision-ops-dashboard-prod.yml` (idempotent: reuses the
existing app, patches the image tag, re-applies the gate). Mean rollback
time target < 15 minutes. **Not needed** — nothing was ever reachable
ungated; the safe fallback (leave it 404/offline) required no rollback
action at all.

## Canary target

Single prod app, no fleet to canary across. N/A — the deploy never reached
a verified-live state to canary.

## Incident timeline and diagnosis

1. **404 confirmed, not 401** — workflow's own blocking gate caught this;
   QA independently confirmed the URL serves an 18-byte "404 page not
   found" body, zero dashboard content, **zero data exposure**.
2. **Ruled out crash-looping container** (task's first suggested lead):
   read-only diagnostic (branch `diag/t70-404-investigation`, dispatched
   via `--ref` against the already-catalogued `diagnose-dashboard-staging.yml`
   extended with prod-app checks — no merge to main required for read-only
   API calls) showed `restart_count: 0` and a clean
   `Next.js 16.2.10 ... Ready in 0ms` boot log.
3. **Ruled out malformed label rewrite** (task's second suggested lead):
   decoded `custom_labels` showed the `dashauth` middleware cleanly merged
   into the router's `middlewares=` line (`gzip,dashauth`), with
   `rule=`/`service=`/`entryPoints=` all intact — not clobbered.
4. **Found the same failure on staging**, independently, with zero staging
   actions by anyone: `ops-hub-dashboard-staging` (`r14c3p7jzwo4wxyprd4yxyev`),
   verified 401-gated and working via T-69 earlier the same day, was ALSO
   returning bare 404. Every real-domain app on the same server/IP
   (`ops-hub-staging.inatechshell.ca`, `freescout-staging.inatechshell.ca`,
   `litellm-staging.inatechshell.ca`, `coolify.inatechshell.ca` itself)
   continued routing normally the entire time (confirmed by direct curl;
   DNS resolution checked and consistent across all hosts, ruling out an
   IP/DNS-drift theory).
5. **Tried the two safest, already-precedented, in-scope remedies on
   staging** (staging chosen deliberately — no real data at risk, already
   broken, so no incremental risk from testing there):
   - Container restart via the existing `restart-dashboard-staging.yml`
     (stop+start) — container came back healthy (`status: running`,
     `last_online_at` updated) — **still 404**.
   - Full genuine redeploy via the existing
     `provision-ops-dashboard-staging.yml` — Coolify confirmed a real
     `finished` deployment (a fresh container create event, not just a
     restart) — **still 404**.
6. ~~**Conclusion:** not the app, not the image, not the container, not the
   labels. The shared Traefik proxy's Docker-label discovery (the
   `--providers.docker` half of its dual file+docker provider
   configuration) is not reflecting either dashboard app's routers, while
   its file-provider-routed (real custom domain) apps are completely
   unaffected. The Coolify server record showed `unreachable_count: 5`
   around the T-70 deploy window — consistent with a brief host hiccup
   interrupting Traefik's live container-events watch, which does not
   self-heal without Traefik itself restarting to do a fresh full listing.~~
   **SUPERSEDED — see "CORRECTED root cause" at the top of this file.**
   Steps 1–5 above (the evidence gathered) are accurate and unchanged; only
   this conclusion was wrong. The `unreachable_count: 5` datapoint is real
   but was a red herring, not the cause — the actual mechanism is the
   `dashauth` middleware-name collision between the two dashboard apps.

## What's left — FQ-64 filed (ORIGINAL, SUPERSEDED — see below for current status)

~~The standard remedy (restart the shared `coolify-proxy` Traefik container)
was identified but **deliberately not executed**: it briefly touches every
app on this server — `ops-hub-prod`, FreeScout, LiteLLM, both
dashboards — not just the prod dashboard app this task authorized
Production Manager to touch. Filed to the founder as **FQ-64** with the
full evidence chain and a recommendation (restart `coolify-proxy`).~~

**Current status (corrected):** FQ-64 was amended in place the same day,
before any founder action, to withdraw the proxy-restart recommendation.
The fix now on the table is narrower and lower-risk: rename prod's
`dashauth` middleware to `dashauth-prod` (per-environment-unique name).
Two paths, both pending founder action:
1. Immediate manual Coolify UI relabel on the prod dashboard app only
   (no shared-proxy touch) — see FQ-64 for the exact steps. This doubles
   as the live test of the corrected theory.
2. Merge PR #281 (`fix/t70-dashauth-name-collision`), which makes the
   same change permanent in the workflow and auto-heals the current state
   on its next dispatch — held for founder review, not self-merged.

Once either path is taken and confirmed, re-verification is a 2-minute
check (both apps already have correct containers, images, and otherwise-
correct gate labels — nothing else needs to change): `curl`
unauthenticated -> expect 401 on both
`http://om6qsemx9upajj9yemid1ti3.187.124.76.235.sslip.io/` and
`http://r14c3p7jzwo4wxyprd4yxyev.187.124.76.235.sslip.io/`; authenticated
-> expect 200 with real rendered content on both. **If either dashboard
does NOT flip to 401**, the collision theory is wrong and the
investigation reopens — do not treat PR #281 as safe to merge on theory
alone.

## Current safe state

Both dashboard apps return 404 to unauthenticated requests — no content,
no data exposure — for the entire session, start to finish. Neither app
was ever reachable-and-ungated at any point. `ops-hub-prod` (the backend)
was not touched; no prod data was altered; `service_role` never held; the
`coolify-proxy` restart was identified but not attempted without
authorization.
