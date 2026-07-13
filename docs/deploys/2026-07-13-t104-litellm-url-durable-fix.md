# Deploy record — Durable `LITELLM_URL` redeploy-orphan fix (T-104, ADR-0008 build)

**Status:** DONE. Option 1 (persistent Coolify network alias) landed on both
litellm-staging (proof) and litellm-prod (production cutover). Verified live:
`/health/litellm-internal` → 200 (`reachable_and_authenticated`) and a clean
T-97 monitor `mode=live` confirmation run (`success`), post-cutover. Written
same-day, mostly in real time as the work happened (the live-key-divergence
detour below happened mid-execution, not after the fact).

**Risk class:** High (production LiteLLM redeploy + production env var
cutover + production app restart — TTS is live). Executed under the user's
explicit, session-specific authorization for this exact sequence
("staging spike + prod change").

**Option landed:** **Option 1** (persistent network alias). The staging spike
succeeded outright — Option 2 (post-redeploy re-sync hook) was never needed
and the Sprint 9 §5.1 Security Lead review it would have triggered did not
fire.

---

## What changed

1. **litellm-staging** (`h12xz8887fxvbvjts2hac8if`): `custom_network_aliases`
   set to `litellm-staging`. Feasibility spike only — no app (`ops-hub-staging`)
   re-pin performed; see Residuals.
2. **litellm-prod** (`hlik1d96uvkkjzpbxa3azhcv`): `custom_network_aliases` set
   to `litellm-prod`. Applied via a real `/start` redeploy (not `/restart`).
3. **ops-hub-prod** (`sbke5gqru1n54rj7gssgca2y`): `LITELLM_URL` re-pinned from
   the (now-gone) `http://hlik1d96uvkkjzpbxa3azhcv-140935289661:4000` to
   `http://litellm-prod:4000` (delete-all-dup-rows-then-post pattern), then
   restarted.
4. **`.github/workflows/fix-ops-hub-prod-litellm-url.yml`** and
   **`.github/workflows/update-litellm-suffix.yml`**: corrected the verify
   step from generic `/health` → `/health/litellm-internal` (ADR-0008 §3's
   flagged latent bug — both break-glass workflows now verify the real path).
5. **`CLAUDE.md`** tech-stack table: updated the "suffix changes on every
   LiteLLM redeploy" note to reflect the durable fix for prod, and to be
   honest that staging's own `LITELLM_URL` pin was not part of this change.
6. Six new workflow files added as the mechanism was proven and executed
   (kept as documentation/history, matching this repo's existing convention
   of retaining one-shot/diagnostic workflows):
   `t104-spike-litellm-staging-alias-feasibility.yml`,
   `t104-apply-verify-litellm-staging-alias.yml`,
   `t104-diagnose-staging-alias-resolution.yml`,
   `t104-apply-verify-litellm-prod-alias.yml`,
   `t104-finish-prod-cutover.yml`,
   `t104-dedupe-and-restart-opshub-prod.yml`,
   `t104-diagnose-key-divergence.yml`.

## Mechanism (why this is durable, not another band-aid)

`custom_network_aliases` is a genuine, persisted Coolify `applications` table
column (confirmed by reading `coollabsio/coolify`'s own source — a public
repo — rather than guessing): `ApplicationDeploymentJob.php` merges it into
the generated docker-compose `networks.<net>.aliases` on **every** deployment
job run (`array_merge([container_name], custom_network_aliases)`). Unlike a
manual `docker network connect --alias` command, this is re-applied by
Coolify itself on every future redeploy — the failure class (suffix rotates,
pointer doesn't follow) cannot recur for `LITELLM_URL` because the app no
longer points at the suffixed name at all.

Also confirmed from Coolify's `routes/api.php`: `/applications/{uuid}/start`
maps to `action_deploy` (a real redeploy via `queue_application_deployment`),
while `/restart` maps to `action_restart` (`restart_only: true`, deliberately
lighter). The staging and prod cutovers both used `/start` specifically so
the "survives a redeploy" claim was tested against the actual historical
trigger (T-71/FQ-69/FQ-76 were all `/start`-class redeploys), not the lighter
`/restart`.

## Live evidence

- **Staging spike** (run `29214692340` + `29214888465`): litellm-staging
  container rotated `h12xz8887fxvbvjts2hac8if-021121385843` →
  `-000816715467` via a real `/start` redeploy; `litellm-staging` alias
  confirmed present via `docker inspect ... NetworkSettings.Networks.coolify.Aliases`;
  `nslookup litellm-staging` resolved to the same IP as the suffixed name;
  `curl http://litellm-staging:4000/health/readiness` → `HTTP 200` (first
  probe hit `HTTP 000` ~1s post-redeploy — a boot-timing artifact, confirmed
  via the container's own logs mid-Prisma-init at probe time, not a mechanism
  failure).
- **Prod cutover** (runs `29215316106`, `29216346731`): litellm-prod container
  rotated `hlik1d96uvkkjzpbxa3azhcv-140935289661` → `-002550568858` via a real
  `/start` redeploy; `litellm-prod` alias confirmed present on the new
  container. `ops-hub-prod`'s `LITELLM_URL` re-pinned and the app restarted.
- **Final verification:** `GET https://ops-hub-prod.inatechshell.ca/health/litellm-internal`
  → `HTTP 200 {"status":"ok","litellm_internal":"reachable_and_authenticated"}`
  (confirmed 3× by direct curl post-cutover). T-97 monitor manual
  `mode=live` dispatch (run `29216438660`) → `success`.

## Honest account of what went sideways mid-execution (all resolved, none left open)

This deploy was not a single clean run — three real problems surfaced and
were resolved in sequence, each documented so a future reader isn't confused
by the run history:

1. **Two transient GitHub Actions runner network timeouts** (curl exit 28,
   `HTTP 000`) hit unrelated read-only/idempotent steps (a Coolify `GET /envs`
   call, and later the finish-cutover GATE's first curl). Neither mutated
   anything before failing; both were simply re-dispatched. The GATE step's
   error handling was also hardened (`set +e` around the retry loop — the
   original `bash -e` default killed the loop on the very first timeout
   before it could retry).
2. **litellm-prod's own real-completion smoke test (using the GH Actions
   `secrets.LITELLM_MASTER_KEY`) returned `HTTP 502` immediately post-redeploy**
   — a boot-timing artifact (same class as the staging `HTTP 000`), confirmed
   healthy via `/health/readiness` (no auth) moments later.
3. **A follow-up retry of that same smoke test then got a *consistent*
   `HTTP 401 token_not_found_in_db`** — not a timing issue, a real
   authentication rejection. This looked, briefly, like the separate,
   explicitly out-of-scope provider-credential-divergence class (FQ-69's 401
   master-key signature) re-firing. **It was not.** A read-only diagnostic
   (`t104-diagnose-key-divergence.yml`, key values never printed/echoed)
   showed ops-hub-prod's own two configured `LITELLM_MASTER_KEY` rows are
   BOTH accepted by litellm-prod (`HTTP 200` each). The GH Actions repo
   secret `LITELLM_MASTER_KEY` is simply a different/stale value than what
   ops-hub-prod actually runs with — a flaw in this deploy's own gate design
   (testing against the wrong credential), not a production incident. The
   gate was corrected to use the unauthenticated `/health/readiness` endpoint
   instead, which needs no key at all.
4. **A single `POST /envs` call created two identical duplicate `LITELLM_URL`
   rows** on ops-hub-prod (both correct value) — the known Coolify
   append-not-upsert footgun, now confirmed to happen from a single API call,
   not only from repeated UI Saves. Not a functional risk (both rows held the
   same correct value; Coolify's documented last-row-wins behavior would have
   resolved correctly either way), but converged to exactly one row before
   restarting, for cleanliness. The finish-cutover workflow now self-heals
   this case (deletes extras only when all existing values already match the
   intended target — refuses to auto-delete on any mismatch).

None of these required a rollback; each was caught by an explicit gate before
it could compound into a real incident, and the fixes are captured in the
workflow files themselves (not just this doc).

## Rollback (as designed, not exercised)

- **If litellm-prod itself had come up unhealthy post-redeploy:** pin
  `docker_registry_image_tag` back to the captured BEFORE image ref and
  redeploy again. Not needed — the gate passed.
- **If the ops-hub-prod cutover had failed:** re-run the (now-corrected)
  break-glass `fix-ops-hub-prod-litellm-url.yml` with litellm-prod's current
  suffixed container name. Not needed — verification passed on the first
  post-restart attempt.
- **Mean rollback time target < 15 min:** both paths are 2-3 minute break-glass
  dispatches; neither was exercised.

## Monitoring window

24-72h passive watch per PRODUCTION.md (High-risk class): confirm the T-97
monitor's standing 15-minute schedule stays green (or self-clears any
transient sub-threshold blip per T-102, as already observed once during this
same deploy — see point 1 above, itself a live proof of T-102 working
correctly under real conditions) and that no ticket got stuck during the
brief internal-hop gap between litellm-prod's redeploy finishing and
ops-hub-prod's restart completing (well under T-97's 3-poll/45-min page
threshold).

## Residuals (honest, not overclaimed)

- **ops-hub-staging's own `LITELLM_URL` was NOT re-pinned to the
  `litellm-staging` alias.** The staging half of this task was scoped to
  proving feasibility (ADR-0008 build-task #1), not to fixing staging's own
  pointer. Staging therefore still carries the URL-suffix-rotation exposure
  today — a cheap, low-risk follow-up (same mechanism, already proven) worth
  scheduling, not done here to stay inside the explicitly authorized scope
  (prod alias + re-pin + redeploy).
- **The `LITELLM_MASTER_KEY` duplicate-row situation on ops-hub-prod** (2
  identical rows, both correct, found while diagnosing the false-positive
  401) is a pre-existing, out-of-scope instance of the same Coolify dup-row
  footgun — not touched, not this task's scope, flagged here for whoever
  next touches that env var.
- **Six T-104-prefixed workflow files remain in `.github/workflows/`** as
  historical/diagnostic artifacts (matching this repo's existing convention
  for one-shot and diagnostic workflows). None are scheduled; all require
  `workflow_dispatch` with an explicit confirmation input where they mutate
  production.
- **Provider-credential-divergence class (FQ-69, still separate from this
  task):** its trigger still has not genuinely fired. The 401 encountered
  mid-deploy was conclusively a test-tooling mismatch (see point 3 above),
  not the real class re-occurring — but flagging explicitly since it's the
  kind of signal that's easy to over- or under-read.

## Feature Adaptation / Knowledge Lead handoff

Not triggered. This is an internal infra/reliability fix with no product
surface change (matches T-97/T-102's own precedent for infra-only changes).

## CI / PRs

Seven PRs, all self-merged once CI (Eval Gate, Lint, Unit Tests, Security
Scan, CodeRabbit, live-eval-gate) was green, per the standing self-merge
authorization: #430 (staging spike), #432 (staging apply+verify), #433
(staging disambiguation diagnostic), #434 (prod apply+verify), #436 (finish
cutover, first version), #437 (key-divergence diagnostic), #438 (dedupe +
complete cutover, the version that actually finished the job — #436's
initial version is superseded by #438's self-healing logic, left in place
as history since it is still functionally correct, just less robust to the
dup-row case).
