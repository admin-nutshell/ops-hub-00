# FOUNDER_QUEUE.md

> Items here require founder action. Each item has: what is blocked, the minimum action required, and who to notify when done.

---

## FQ-62 — T-66: apply audit_log platform-select RLS migration via Supabase SQL Editor (service_role)

**Filed:** 2026-07-06
**Filed by:** Security Lead (T-66)
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, T-11 runbook, ADR-0005 risk #2: "SQL Editor access is restricted to the founder; agents never hold service_role")
**Deadline:** Non-blocking for the dashboard MVP go-live (the platform-incidents feed has no writer yet, so nothing user-visible changes today) — but required before T-60's Check 2 can go green and T-66 can close. Convenient to run in the same SQL Editor sitting as FQ-61.

**Context:** T-60's live verification (Check 2, DECISIONS.md 2026-07-06) proved that platform-incident
rows in `audit_log` (`tenant_id IS NULL`) are unreadable through RLS: the original `audit_log_select`
policy is `USING (tenant_id = current_tenant_id())`, and `NULL = current_tenant_id()` is never true, so
`getPlatformIncidents` (the dashboard's platform-incidents feed) was permanently empty — dead code in
the deny direction, **not a leak**. T-66's fix is a new migration,
`supabase/migrations/20260706000000_t66_widen_audit_log_select_platform.sql`, which adds a second,
`ops_hub_app`-only permissive SELECT policy (`audit_log_select_platform`) exposing NULL-tenant rows only
when the caller's project GUC matches the row's `project_id`. The original `audit_log_select` policy is
untouched; the `authenticated` role gains nothing (split-policy decision + fail-closed derivation
recorded in DECISIONS.md 2026-07-06 T-66 — that entry is the security review for this widening).

**Independent of FQ-61/T-67 — no ordering dependency:** `audit_log` predates T-58's tables (it ships in
the initial schema), so this migration applies cleanly whether or not FQ-61's T-58 migration has landed.
Run them in either order, or in the same sitting.

**What's needed (founder, via Supabase Dashboard → SQL Editor, as the project owner/`service_role`):**
1. Open the SQL Editor for project `yocoljutbiizdbfraapx` and run the full contents of
   `supabase/migrations/20260706000000_t66_widen_audit_log_select_platform.sql` (forward-only,
   idempotent — `drop policy if exists` then `create policy`; no table/data changes, no destructive
   statements). Expected output: `DROP POLICY` (no-op notice on first apply) then `CREATE POLICY`.
2. **Verify** with: `SELECT polname FROM pg_policy WHERE polrelid = 'audit_log'::regclass;`
   — expect `audit_log_select_platform` in the list (alongside the existing `audit_log_insert` and
   `audit_log_select`).
3. Reply here or in WORK.md once done — QA Manager then re-dispatches `t60-dashboard-rls-verify.yml`
   to confirm Check 2 goes green (the harness now asserts the NULL-tenant row IS visible with the
   correct project scope and hidden without one).

**Single-project note:** per ADR-0005 (`docs/adr/0005-prod-db-same-project.md`), staging and prod are
the same physical Supabase project (`yocoljutbiizdbfraapx`) — **one apply covers both environments.**

**Recommendation:** Apply as written — the policy widening was deliberately scoped to the narrowest
read path that fixes the bug (ops_hub_app only, project-matched, NULL-tenant rows only) and security
review is already recorded; this is routine migration application, same pattern as every prior
migration in this repo.

---

## FQ-61 — T-67: apply T-58 migration via Supabase SQL Editor (service_role) — blocks Sprint 6 dashboard MVP

**Filed:** 2026-07-06
**Filed by:** Production Manager (T-67, escalating a live blocker QA proved in T-60)
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, T-11 runbook, ADR-0005 risk #2: "SQL Editor access is restricted to the founder; agents never hold service_role")
**Deadline:** Blocking — this is the Sprint 6 dashboard-MVP critical path (T-58 → T-59 → T-60). QA cannot close T-60 or clear T-59 until this lands.

**Context:** QA's live T-60 verification ([run 28807345913](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28807345913)) proved via `pg_class` (world-readable) that the T-58 migration —
`supabase/migrations/20260704010000_t58_agent_cost_eval_health.sql` — was **never applied** to the live
Supabase project (`yocoljutbiizdbfraapx`). `agent_cost_daily`, `agent_cost_events`, and `eval_gate_runs`
are **absent** while `tenants`/`projects`/`tickets`/`audit_log` are present. This is exactly the
"founder/ops action still required" step T-58's own WORK.md row flagged on 2026-07-04 and it was never
actioned. Consequence: the agent-cost and eval-health dashboard tiles (2 of the 4 charter daily pillars)
render "failed to load" against the live DB — graceful (each tile has its own try/catch, page still
HTTP 200), **not a crash and not an RLS defect** (RLS/tenant-scoping was separately verified clean, no
cross-tenant leak, by the same T-60 run).

I (Production Manager) checked whether I could apply this myself before filing: no Coolify/Supabase MCP
tool exists in my toolset, no `service_role`/`SUPABASE_DB_URL`-equivalent credential is present in my
local environment, and the one CI-held Supabase credential this repo does use
(`SUPABASE_STAGING_DB_URL`, a GitHub Actions secret) is — by this team's own established convention —
reserved for read-only checks (`precheck-litellm-db-wall.yml`, `verify-litellm-db-isolation.yml`), never
DDL. The clearest precedent: `restart-freescout-regrant.yml` deliberately *prints* a GRANT command "for
founder" rather than executing it, even though that workflow already holds an equivalent owner-level
connection. Writing a new CI workflow to auto-apply this migration would defeat a mitigation ADR-0005
names explicitly, so I did not build one.

**What's needed (founder, via Supabase Dashboard → SQL Editor, as the project owner/`service_role`):**
1. Open the SQL Editor for project `yocoljutbiizdbfraapx` and run the full contents of
   `supabase/migrations/20260704010000_t58_agent_cost_eval_health.sql` (forward-only, idempotent-safe —
   creates 2 tables, 1 view, RLS policies, and grants; no destructive statements). Expected output:
   `CREATE TABLE` (x2), `CREATE INDEX` (x4), `CREATE VIEW`, `ALTER TABLE`/`CREATE POLICY` (RLS), `GRANT` —
   no errors, since QA already confirmed all three objects are absent (clean first apply, not a re-run).
2. **Verify** with: `SELECT relname FROM pg_class WHERE relname IN ('agent_cost_events','agent_cost_daily','eval_gate_runs');`
   — expect all 3 names back.
3. Reply here or in WORK.md once done — Production Manager will then dispatch the already-prepared
   `provision-agent-cost-sync-env.yml` workflow (sets `AGENT_COST_SYNC_ENABLED=true` on ops-hub-prod,
   UUID `sbke5gqru1n54rj7gssgca2y`, and redeploys) and hand back to QA Manager to re-run
   `t60-dashboard-rls-verify.yml` so Checks 1 & 3 go green and T-60/T-59 can close.

**Single-project note (documentary, not live-probed — no DSN was read or printed to avoid any secret
exposure):** ADR-0005 (`docs/adr/0005-prod-db-same-project.md`) records that staging and prod are the
**same physical Supabase project** (`yocoljutbiizdbfraapx`), with environment separation done entirely
via RLS-scoped rows (`tts`/`tts-prod` projects, distinct tenant UUIDs), not a separate schema or project.
A schema-level migration like this one is therefore project-wide — **one apply covers both environments.**
This is consistent with T-47's prod seed migration having applied cleanly against the same project with
no separate "prod migration" step.

**Recommendation:** Apply as written — no design decision needed, this is routine migration application
(same pattern as every prior migration in this repo, all "applied via SQL Editor, not tracked by Supabase
CLI" per CLAUDE.md). Recommend prioritizing given it's the sole blocker on the Sprint 6 dashboard-MVP
anchor.

---

## FQ-60 — T-59 Ops Dashboard needs a Coolify deploy target (doesn't exist yet)

**Filed:** 2026-07-05
**Filed by:** Frontend Engineer (T-59)
**Needs:** Authorization + infrastructure setup (Production Manager executes; founder authorizes + places one env value)
**Deadline:** Non-blocking for code review — the app is built, tested, and verified locally (see DECISIONS.md 2026-07-05 T-59). This is what's left to make it reachable.

**Context:** T-59 built the read-only Ops Dashboard as a new Next.js app at `web/` in this repo (new
pnpm workspace member). It runs, builds, and has been verified against a local Postgres seeded with
the real schema (see DECISIONS.md entry for exact steps and numbers). It does **not** have anywhere
to run in Coolify yet — unlike ops-hub's backend (`ops-hub-staging`/`ops-hub-prod`, already
provisioned), this is a genuinely new deploy target.

**What's needed:**
1. **A new Coolify application** (staging first; prod once T-60's RLS audit signs off) built from
   `web/Dockerfile` — note the build context is the **repo root**, not `web/`, because the app
   imports `src/metrics/*` directly (`docker build -f web/Dockerfile .`). Production Manager owns
   this per the team's infra-config handoff protocol.
2. **`OPS_HUB_APP_LOGIN_URL`** set on that new app — the same `ops_hub_app_login` DSN pattern
   already used by `ops-hub-staging`/`ops-hub-prod` (see `docs/engineering/t12-vault-runbook.md`).
   Not a new credential to generate — reuse the existing one for whichever environment (staging/prod)
   this points at.
3. **`POLLING_PROJECT_ID` / `POLLING_TENANT_ID`** — same values already set on the corresponding
   ops-hub environment (staging: `00000000-0000-0000-0000-000000000001` / `...0010`; prod:
   `00000000-0000-0000-0000-000000000003` / `...0030`), so the dashboard reads the same
   project/tenant scope as the backend it's reporting on.
4. **Optional health-check overrides** — `OPS_HUB_HEALTH_URL`, `LITELLM_HEALTH_URL`,
   `FREESCOUT_HEALTH_URL` — default to the staging FQDNs from CLAUDE.md if unset, so only prod
   needs these explicitly set.
5. **FQ-59's Traefik Basic Auth label + 401 verification** — this is FQ-59's existing content, not
   duplicated here. Once this app has a domain, FQ-59's Action 2/3 apply to it directly.

**Recommendation:** Stand up staging first, confirm T-60's RLS/tenant-scoping audit passes against
it, then promote to prod the same way ops-hub's backend was promoted (T-49). No new decision
needed — this is routine provisioning of an already-decided pattern, surfaced here only because the
deploy target itself doesn't exist yet.

---

## FQ-59 — T-57 Ops Dashboard auth: apply Traefik basic-auth label at T-59 deploy (credential ready in scratchpad)

**Filed:** 2026-07-04
**Filed by:** Tech Lead (T-57)
**Needs:** Authorization + place one secret; Production Manager applies the Traefik label
**Deadline:** Non-blocking now — but is a HARD GATE on T-59: the dashboard must not be pointed at a public FQDN until this is applied and verified.

**Decision recorded:** DECISIONS.md 2026-07-04 (T-57). The Ops Dashboard (T-59) is gated by
Traefik/Coolify **HTTP Basic Auth** on its FQDN over the existing Let's Encrypt TLS — chosen over
app-level session auth because the dashboard is greenfield Next.js that doesn't exist yet, the
ops-hub runtime has no web-auth pattern to be consistent with, and basic auth is a reverse-proxy
boundary that needs zero app code and is trivially swapped for session auth when the Sprint-7
write area lands. Full threat model in DECISIONS.md.

**The credential is already generated** and waiting in a LOCAL scratchpad file (never committed,
never in chat, this FQ contains no secret material):

```
C:\Users\SACIT~1\AppData\Local\Temp\claude\C--projects-ops-hub\d4df90e8-0d7d-4dcc-9fc6-de5763b44131\scratchpad\T-57-dashboard-basic-auth-CREDENTIAL.txt
```

That file contains: the browser username+password, the `user:hash` line for Coolify (apr1/MD5,
Traefik-compatible), a `$`->`$$` label-escaped variant, and a regeneration command.

### Action 1 — DO THIS NOW (survives temp-file loss; T-59 deploy is ~a week out)
Open the scratchpad file above and copy **both** the plaintext username+password (for browser
login) **and** the `user:hash` line (for Coolify) into your password manager. The scratchpad is
session-temporary and will very likely be gone by the T-59 deploy. If it's already lost, regenerate
with the command in the file (`openssl passwd -apr1`) — any fresh value is fine, it just has to
match between browser and Coolify.

### Action 2 — AT T-59 DEPLOY TIME (Production Manager applies; founder places the secret)
When the dashboard Coolify app/route is created (T-59), before pointing it at a public FQDN:
- If Coolify exposes a dedicated **Basic Authentication** field for the app: paste the
  `user:hash` line AS-IS (no `$` doubling).
- If applying via a raw **Traefik label**: use the `$`->`$$`-escaped variant from the scratchpad
  file (docker-compose label escaping). Standard label shape:
  `traefik.http.middlewares.dashauth.basicauth.users=<user:hash>` +
  `traefik.http.routers.<router>.middlewares=dashauth` — exact router name per the T-59 app config;
  Production Manager confirms against the live Coolify/Traefik version, then tests (Action 3).

### Action 3 — BLOCKING VERIFICATION before go-live (do not skip — this is T-57's entire purpose)
From any machine, confirm the dashboard FQDN rejects unauthenticated requests:
```
curl -sS -o /dev/null -w '%{http_code}\n' https://<dashboard-fqdn>/
```
Expected: **401**. Then confirm the credential works (200 with `-u opsadmin:<password>`).
A 200 without credentials, or a login that never accepts the password, means the label/hash is
mis-applied (commonly the `$`->`$$` escaping) — fix before exposing the domain.

**Notify:** Tech Lead + Production Manager once the 401 check passes — T-59 is then cleared to go
live behind the gate. Security Lead already has substantive involvement scheduled at T-60
(RLS/tenant-scoping), so no separate sign-off is needed to land this perimeter gate.

---

## FQ-58 — T-61 Phase 1 blocked: litellm_db_user password no longer authenticates

**Filed:** 2026-07-04
**Filed by:** Production Manager (T-61, Phase 1 canary pre-check)
**Needs:** Information / Authorization
**Deadline:** Non-blocking overall (no live change was made; `DISABLE_SCHEMA_UPDATE=true` still holds the latent risk documented in FQ-57) — but blocks T-61 Phase 1 from proceeding.

**What happened:** Per the pre-deploy checklist in `docs/deploys/2026-07-04-litellm-db-wall-restoration.md` ("Canary rollout plan," Phase 1, step 1), a new read-only precheck workflow (`precheck-litellm-db-wall.yml`, added this session via PR #255/#256) was dispatched before touching anything live. It attempts `SELECT current_user;` against Supabase as `litellm_db_user`, using the `LITELLM_DB_USER_URL` GitHub secret (set 2026-06-26/27 per ADR-0004/FQ-45, unchanged since).

Result: **`FATAL: password authentication failed for user "litellm_db_user"`** (run [28722827915](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28722827915), 2026-07-04 23:18 UTC). This is a genuine auth rejection, not the `ENOIDENTIFIER`/"tenant not found" error that would indicate a DSN-format problem (missing project-ref suffix) — the connection reached the password-check stage cleanly. The most likely explanation is the same class of drift flagged as a risk in the deploy plan itself: the role's password may have been changed on the Supabase side (directly or via some other rotation event) without the `LITELLM_DB_USER_URL` GitHub secret being updated to match. DECISIONS.md's only confirmed rotation on record (2026-06-29, FQ-49) was the `postgres` superuser role's password, not `litellm_db_user`'s — so if that's the cause, it was an unlogged side effect, not the documented event. Root mechanism is not confirmed; only the symptom (auth rejected) is.

**No live change was attempted or made.** The workflow is read-only by design (GET/psql-SELECT only) and is written to halt immediately on this exact failure rather than guess or retry with a different value. All later steps in the same job (baseline row-count capture, rollback-DSN stash) did not run — confirmed directly in the run log, they're gated behind the auth check succeeding.

**What's needed (pick one):**
- **Option A (if the password was intentionally rotated or is otherwise unknown/lost):** Run, as superuser in Supabase SQL Editor — same shape as the original `docs/engineering/litellm-db-isolation-runbook.md` Step 1 —
  ```sql
  ALTER ROLE litellm_db_user WITH PASSWORD '<new password>';
  ```
  Then update the GitHub secret `LITELLM_DB_USER_URL` with the matching new password (host/port/db/schema unchanged — only the password segment differs). Do NOT paste the password in chat or commit it anywhere; set it directly via `gh secret set LITELLM_DB_USER_URL` or the GitHub UI.
- **Option B (if the password was never actually changed and the secret is simply stale/wrong from setup):** Confirm the value that was originally set on 2026-06-26/27 and re-enter it into the `LITELLM_DB_USER_URL` secret if it differs from what's stored today.
- Either way, notify Production Manager once done — the precheck workflow will be re-run before anything further proceeds (per the deploy plan, nothing progresses to `fix-litellm-schema-isolation.yml apply-wall` until this passes clean).

**Impact if left open:** None beyond what FQ-57 already describes — `DISABLE_SCHEMA_UPDATE=true` is confirmed still set on both `litellm-staging` and `litellm-prod`, so the latent (not active) DB-isolation-wall gap continues exactly as before. This FQ only blocks the *restoration* work (T-61), not current service health.

**Notify:** Production Manager "FQ-58 done" — Phase 1 precheck will be re-dispatched immediately.

---

## ✅ FQ-53 — LiteLLM /model/new broken: fix Prisma migration before T-48

**Filed:** 2026-07-01 | **Closed:** 2026-07-04
**Filed by:** Tech Lead (T-46)
**Status:** RESOLVED (functionally) — root cause corrected below; **do not read this as "Prisma bug fixed"**

**What was actually wrong (confirmed via `diagnose-litellm-prisma.yml`, 2026-07-04):** the 500 was real, but by the time this was investigated the write path was already working again — `POST /model/new` returned HTTP 200 live, and a restart-then-recheck (`restart-verify-litellm-staging.yml`) confirmed all 3 aliases (`triage-model`, `fallback-model`, `meta/llama-3.3-70b-instruct`) persist across a restart, plus a live `triage-model` completion succeeded.

**The uncomfortable part — root cause identified precisely, and it was already sitting in DECISIONS.md:** the 2026-06-29 FQ-49 fix (LiteLLM crash-loop, `ENOIDENTIFIER`) deleted the duplicate `DATABASE_URL` rows and "re-entered `DATABASE_URL` once via Coolify UI with `postgres.yocoljutbiizdbfraapx` as username" — two days after FQ-45 had put `litellm_db_user.yocoljutbiizdbfraapx` in place. That FQ-49 fix was correct for the crash-loop (the missing Supavisor project-ref suffix) but used the **wrong username** — the plain superuser instead of the restricted role — which silently undid the ADR-0004 wall. It was never flagged at the time because the operator was focused on the crash-loop, not on preserving role identity, and the DECISIONS.md entry for FQ-49 doesn't call out the role downgrade. `DISABLE_SCHEMA_UPDATE=true` (from FQ-45's freeze step) then blocked Prisma from syncing whatever schema change the later `ANTHROPIC_API_KEY` addition needed — that's what actually produced the FQ-53 500, independent of which role was connecting. Whatever cleared that 500 between filing (07-01) and today (07-04) is not in DECISIONS.md either — but the role has been `postgres`, undetected, since 2026-06-29, through T-47/48/49/50/51/52/M6/T-56. **`litellm-prod` (T-48) has the identical posture** — also connects as `postgres`, also un-walled, confirmed via `verify-litellm-db-isolation.yml`. Current risk is latent, not active: `DISABLE_SCHEMA_UPDATE=true` is confirmed set on both, so no Prisma DDL is running today. Public tables confirmed intact via indirect evidence (T-51 e2e ticket + T-56 kb_articles write both succeeded today, 2026-07-04).

**Follow-up filed as FQ-57** (below) for the actual wall restoration, staged as a proper canary rollout per `docs/deploys/2026-07-04-litellm-db-wall-restoration.md` — not fixed live in this session on purpose (flipping `DISABLE_SCHEMA_UPDATE` back on to test the restricted role could take a live service down; prod additionally needs a **new**, prod-only restricted role that doesn't exist yet).

**Notify:** Tech Lead — T-48 is unaffected functionally (prod's aliases work today), but is now known to share the same isolation gap as staging.

---

## FQ-57 — Restore LiteLLM DB isolation wall on staging + prod (new prod-only role needed)

**Filed:** 2026-07-04
**Filed by:** Production Manager
**Needs:** One-time superuser SQL (new prod-only restricted role) + authorization for a staged canary rollout
**Deadline:** Non-blocking (latent risk, `DISABLE_SCHEMA_UPDATE=true` holds today) — but should not sit for long; the whole point of ADR-0004 was to make this impossible-by-construction, and right now it is possible again on both environments.

See `docs/deploys/2026-07-04-litellm-db-wall-restoration.md` for the full plan. Short version:

1. **Founder action (superuser SQL, ~5 min, same shape as the original `docs/engineering/litellm-db-isolation-runbook.md` Step 1):** create a **new**, prod-only restricted role `litellm_db_user_prod` owning a **new** schema `litellm_prod`, with zero rights on `public` and zero rights on the existing `litellm` schema (staging's). Reusing the existing `litellm_db_user` role for prod would NOT isolate prod from staging — that role's `search_path` is pinned to `litellm`, so prod's registrations would land in staging's schema.
2. **Founder action:** store the new DSN as GitHub secret `LITELLM_PROD_DB_USER_URL` (same masking/never-in-chat discipline as `LITELLM_DB_USER_URL`).
3. **Founder action (staging only, if needed):** confirm the existing `litellm_db_user` password (set 2026-06-27) still works — DECISIONS.md shows at least one unrelated Supabase password rotation in this project's history; Production Manager will pre-check this read-only before touching anything live.
4. Production Manager then runs the two-phase canary in the deploy plan (staging first, verify clean, then prod under a 24-hour monitoring window) and reports back here.

**Notify:** Production Manager once the SQL is run and the secret is set — Phase 1 (staging) can start immediately with what already exists; Phase 2 (prod) is gated on this.

---

## ✅ FQ-51 — T-46 Second LLM provider: add ANTHROPIC_API_KEY to LiteLLM staging

**Filed:** 2026-06-29 | **Closed:** 2026-07-01
**Filed by:** Tech Lead (T-46)
**Status:** RESOLVED

`ANTHROPIC_API_KEY` added to litellm-staging and container redeployed. T-45 suffix workflow updated LITELLM_URL after the redeploy (run #28495829624). LiteLLM `/health/readiness` confirmed healthy.

**New issue discovered post-redeploy:** LiteLLM `/model/new` API returning HTTP 500 "Failed to add model to db" — DB write broken. See FQ-53 for the workaround that completes T-46 without needing the alias API.

---

## ✅ FQ-50 — T-45 LiteLLM suffix automation: add SSH_PRIVATE_KEY + VPS_HOST GitHub secrets

**Filed:** 2026-06-29 | **Closed:** 2026-07-01
**Filed by:** Tech Lead (T-45)
**Status:** RESOLVED

T-45 builds a `workflow_dispatch` workflow that SSHs to the Coolify VPS, detects the current LiteLLM container suffix, and updates `LITELLM_URL` in ops-hub-app automatically. This eliminates the manual suffix-tracking step after every LiteLLM redeploy.

**Action (10 min):**

1. **Generate an SSH key pair** (if you don't already have one for CI):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-ops-hub" -f ~/.ssh/ops_hub_ci -N ""
   ```

2. **Add the public key to the VPS** (authorized_keys for the user that runs Docker commands — likely `root` or `coolify`):
   ```bash
   cat ~/.ssh/ops_hub_ci.pub >> ~/.ssh/authorized_keys
   ```
   Or paste it via your VPS provider's SSH key management UI.

3. **Add GitHub secrets** (repo Settings → Secrets and variables → Actions):
   - Name: `SSH_PRIVATE_KEY` — Value: contents of `~/.ssh/ops_hub_ci` (the private key)
   - Name: `VPS_HOST` — Value: `187.124.76.235` (Coolify VPS IP)

**Notify:** Tech Lead "FQ-50 complete" — T-45 workflow can be built and tested.

---

## ✅ FQ-48 — T-40 Backup verification: add SUPABASE_ACCESS_TOKEN secret — RESOLVED 2026-07-04

**Filed:** 2026-06-28 | **Resolved:** 2026-07-04
**Filed by:** Tech Lead (T-40)

`SUPABASE_ACCESS_TOKEN` GitHub secret added by founder. The workflow (renamed `verify-backup.yml` → `backup-verification.yml`, see T-40 in WORK.md) is correctly configured and will run automatically on its monthly schedule (1st of every month, 06:00 UTC — first real run 2026-08-01).

**Known unresolved side issue (not blocking):** the workflow's manual `workflow_dispatch` trigger cannot actually be invoked due to an apparent GitHub-side parsing quirk — tried a content nudge and a full rename (new workflow ID), neither fixed it. Full detail in WORK.md T-40. Doesn't affect the real monthly automated run.

**Notify:** PM "FQ-48 complete" — T-40 declared done once a manual run returns ✅.

---

## FQ-49 — T-41 DR drill: LiteLLM external URL unreachable

**Filed:** 2026-06-28 | **Closed:** 2026-06-29
**Filed by:** Production Manager (T-41 DR drill)
**Status:** RESOLVED

**Root cause (not a proxy issue):** LiteLLM was crash-looping with `FATAL: (ENOIDENTIFIER) no tenant identifier provided` from Supavisor. The `DATABASE_URL` username was `postgres` — missing the required project ref suffix. Supavisor requires `postgres.yocoljutbiizdbfraapx`. The bad value persisted because Coolify had accumulated 3 duplicate `DATABASE_URL` rows in its internal `environment_variables` table; the last row (with no project ref) always won on deploy.

**Resolution (2026-06-29):**
1. Connected to `coolify-db` Docker container: `docker exec -it coolify-db psql -U coolify -d coolify`
2. Deleted all 3 duplicate rows: `DELETE FROM environment_variables WHERE resourceable_id=4 AND key='DATABASE_URL'`
3. Re-entered `DATABASE_URL` once via Coolify UI with `postgres.yocoljutbiizdbfraapx` as username
4. Fixed P1000 auth failure (postgres password had been rotated): updated `DATABASE_URL`, `DB_PASSWORD`, and Supabase database password
5. LiteLLM reached `Application startup complete`

**Verification:** `https://litellm-staging.inatechshell.ca/health` returns HTTP 401 (correct — API key enforcement active). `https://ops-hub-staging.inatechshell.ca/health` returns `{"status":"ok"}`.

**Container suffix updated:** Full redeploy changed suffix to `170111887056`. `LITELLM_URL` in Coolify ops-hub-app and CLAUDE.md updated (PR #205).

---

## FQ-47 — T-38 Cstate status page: 4 founder actions to go live

**Filed:** 2026-06-28
**Filed by:** Production Manager (T-38)
**Needs:** Authorization + 4 one-time setup actions
**Deadline:** July 7, 2026 (T-38 target)

Code is merged and the Hugo site is built and deployed by CI. Four actions are needed before `status.inatechshell.ca` is reachable and UptimeRobot alerts are automated:

**Action 1 — Enable GitHub Pages on the repo (2 min)**
Repo Settings → Pages → Source → "GitHub Actions". This is blocked on GitHub Team plan (already active). Without this, `deploy-status.yml` will fail.

**Action 2 — Add DNS CNAME record (5 min)**
In your DNS provider (for `inatechshell.ca`), add:
```
CNAME  status  admin-nutshell.github.io
```
After Pages is enabled, GitHub will also verify the custom domain. If prompted, confirm HTTPS enforcement.

**Action 3 — Create a GitHub fine-grained PAT for dispatch (5 min)**
Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
- Repository: `admin-nutshell/ops-hub-00`
- Permissions: **Actions → Read and Write** (only this — do NOT grant repo contents write)
- Set as Coolify env var `GITHUB_STATUS_DISPATCH_TOKEN` in the `ops-hub-staging` project

**Action 4 — Set secret + configure UptimeRobot webhook (10 min)**
a) Add a random secret string as Coolify env var `STATUS_WEBHOOK_SECRET` (e.g. 32-char random hex — `openssl rand -hex 16`)
b) In UptimeRobot, for each monitored URL (Ops Hub, LiteLLM, FreeScout), add an Alert Contact:
- Type: Webhook
- URL: `https://ops-hub-staging.inatechshell.ca/api/status/webhook?secret=<STATUS_WEBHOOK_SECRET>`
- POST Value (JSON): `{"monitorFriendlyName":"*friendlyname*","monitorURL":"*url*","alertType":*alerttype*}`

Note on secret-in-query-string: UptimeRobot free tier does not support custom HTTP request headers, so the shared secret rides in the URL query parameter rather than an Authorization header. The endpoint is HTTPS-only (TLS in transit), which prevents interception. This is a known limitation of the free tier; upgrading to UptimeRobot Pro would allow header-based auth.

**Notify:** PM "FQ-47 complete" — T-38 will be declared done once status page is confirmed live at `status.inatechshell.ca`.

---

## FQ-46 — Monthly Briefing #1: read and acknowledge

**Filed:** 2026-06-27
**Filed by:** PM (T-29)
**Needs:** Read only — no action required
**Deadline:** July 31, 2026

Monthly briefing #1 is ready: `docs/briefings/2026-07-31-m1-briefing.md`

Covers: M1 complete confirmation, what the platform does today, M2 status, key decisions made, open risks, and next 30 days.

**No founder action needed** — this is an informational briefing. Reading it closes M1 criterion #13 and unblocks T-34 (M2 close).

After reading: notify PM "T-29 read" and M1 #13 will be marked ✅.

---

## FQ-45 — ADR-0004 LiteLLM DB isolation: run Step 1 SQL + set GitHub secret

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** RESOLVED

- `litellm_db_user` role exists, owns `litellm` schema, zero access to `public.*` tables (verified)
- `LITELLM_DB_USER_URL` GitHub secret set
- `fix-litellm-schema-isolation.yml apply-wall` ran (run 28221261717 — DB swap succeeded; health-check timed out during LiteLLM restart but swap applied)
- `fix-litellm-schema-isolation.yml freeze-schema` ran and passed (run 28221681598)

ADR-0004 is fully in force. LiteLLM cannot wipe ops-hub tables on redeploy.

---

## FQ-44 — FREESCOUT_DB_URL: provision env var to activate draft delivery + SLA breach notes

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** RESOLVED

`FREESCOUT_DB_URL` confirmed present in Coolify ops-hub-app env vars. Ticket-respond draft delivery and SLA breach notes are active after PR #192 deploy.

---

## FQ-43 — M3 production go-live: two decisions needed before August infrastructure work begins

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** DEFERRED — founder decision

**Decision:** DNC production go-live is deferred indefinitely. Build the platform to full capability first; tenant production onboarding (DNC or any other) comes after. M3 scope is on hold until the platform is mature and the founder re-opens it.

**Impact:** T-33 scoping doc (`docs/planning/m3-dnc-production.md`) remains valid as a reference — no work needed on it now. Solutions Architect will revisit when founder signals readiness to onboard a tenant to production.

---

## ✅ FQ-42 — DNC onboarding: apply migration + update 2 Coolify env vars (T-27 / M1 #12) — RESOLVED 2026-06-27

**Filed:** 2026-06-27
**Resolved:** 2026-06-27 — Founder completed all 3 steps:
  - Migration applied in Supabase SQL Editor (TTS project + DNC tenant seeded)
  - `POLLING_PROJECT_ID` + `POLLING_TENANT_ID` set in Coolify ops-hub-app → redeployed
  - DNC test email sent → confirmed end-to-end: FreeScout → triage → respond → `state=responded`, `tenant_id=00…0020` in Supabase
**Filed by:** Tech Lead
**Was blocking:** T-27 (M1 criterion #12 — DNC tickets flowing through ops-hub)
**Priority:** HIGH — last step to close M1

### What was built

- Migration `supabase/migrations/20260627000000_t27_dnc_onboarding.sql` seeds TTS project + DNC tenant
- `projects/tts/config.json` + `projects/tts/tenants/dnc.json` — Project Context instance for DNC
- `freescout-poller.ts` now reads project/tenant IDs from `POLLING_PROJECT_ID` / `POLLING_TENANT_ID` env vars (with fallback to dev placeholders) — proves app-agnostic design

### Required founder actions (3 steps)

#### Step 1 — Apply migration in Supabase SQL Editor

Copy-paste this SQL into Supabase SQL Editor (project `yocoljutbiizdbfraapx`), run as postgres/service_role:

```sql
-- TTS project
INSERT INTO projects (id, name, context_schema)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'tts',
  '{"product":"Ticket Triage System","slug":"tts","support_email":"support@inatechshell.ca"}'
)
ON CONFLICT (name) DO NOTHING;

-- DNC tenant
INSERT INTO tenants (id, project_id, name, tier, sla_config)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000002',
  'Daily Needs Canada',
  'growth',
  '{"response_target_minutes":60,"escalation_threshold":"high","timezone":"America/Toronto"}'
)
ON CONFLICT (id) DO NOTHING;
```

Expected: `INSERT 0 1` for each statement (or `INSERT 0 0` if already applied — both are OK).

#### Step 2 — Update 2 env vars in Coolify

Go to: Coolify → `ops-hub-app` → Environment Variables

Add (or update) these two:

| Key | Value |
|---|---|
| `POLLING_PROJECT_ID` | `00000000-0000-0000-0000-000000000002` |
| `POLLING_TENANT_ID` | `00000000-0000-0000-0000-000000000020` |

Then click **Deploy** (not Restart — full redeploy to inject env vars).

#### Step 3 — Send a DNC test email + confirm

Send an email to **support@inatechshell.ca** with any DNC-relevant subject (e.g. "DNC: order not delivered" or "DNC: payment failed"). Within 5 minutes:

1. FreeScout: email appears in ITS Support inbox
2. Inngest: `ticket-triage` run shows `tenant_id = 00000000-0000-0000-0000-000000000020`
3. Supabase SQL Editor: verify

```sql
SELECT title, urgency, category, routing, state, tenant_id
FROM tickets
WHERE tenant_id = '00000000-0000-0000-0000-000000000020'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: a row with `state = 'responded'`, `tenant_id = '00000000-0000-0000-0000-000000000020'`

### After resolution

Notify Tech Lead: "FQ-42 done — DNC tenant_id confirmed in Supabase"

Tech Lead will close T-27 and mark M1 criterion #12 ✅.

---

## ✅ FQ-41 — FreeScout second DB reset recovery: GRANT + Gmail OAuth — RESOLVED 2026-06-27

**Filed:** 2026-06-26
**Resolved:** 2026-06-27 — `diagnose-freescout-imap.yml` run #28274619900 confirmed:
  - `ops_hub_app` SELECT GRANT: ✅ 2 rows (conversations + threads)
  - FreeScout conversations: 3 rows, threads: 8 rows — email fetch active
  - ops-hub `/health`: HTTP 200
  - **T-26 pre-flight: all items green — drill can proceed**
**Filed by:** Production Manager
**Was blocking:** T-22 (ticket-triage live validation), full Inngest pipeline, M1 criterion #10 re-verification

### What happened

The Supabase public schema was reset a second time. FreeScout detected an empty DB at startup (02:45 UTC 2026-06-26) and re-ran all migrations, recreating the admin user as `info@inatechshell.ca`. This wiped the `ops_hub_app` GRANT on `conversations` and `threads`.

Confirmed via three workflow runs:
- `diagnose-freescout-imap.yml` run #28215344117 (03:32 UTC): conversations = 0, GRANT = 0, cron IS running, no failed_jobs
- `check-freescout-mailboxes.yml` run #28215633753 (03:41 UTC): GRANT still 0, no OAuth table (tokens stored in mailboxes.meta)
- `check-freescout-mailboxes.yml` run #28215745025 (03:44 UTC): **mailbox IS configured** (1 row, id=1 "ITS Support", imap.gmail.com:993 SSL, created_at=02:48, updated_at=03:03 UTC). GRANT still 0.

The mailbox was re-configured by the founder at 02:48 UTC and updated again at 03:03 UTC (likely OAuth re-authorization). The mailbox OAuth may already be connected.

The only confirmed remaining blocker is the GRANT.

### Required founder actions (two steps — must both be done)

#### Step 1: Re-issue the GRANT + make it permanent (via SSH to Coolify VPS)

Run **both commands** on the VPS hosting the Coolify FreeScout container.

> **Why via SSH/artisan tinker:** The Supabase SQL Editor runs as `postgres`, which cannot
> alter default privileges for another role. `artisan tinker` connects as `freescout_user`
> (FreeScout's own DB user, who owns `conversations` and `threads`). Only the owner can set
> default privileges for that role. Running from Supabase SQL Editor will return
> `permission denied to change default privileges`.

**Command A — permanent fix (runs as freescout_user, sets default privileges):**
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan tinker \
  --execute="DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app');"
```

Expected output: `=> true`

This makes any future table FreeScout creates (via Laravel migrations on next restart) automatically grant SELECT to `ops_hub_app`. This is the permanent fix — once set, it survives all future FreeScout schema resets.

**Command B — apply grant to current tables:**
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan tinker \
  --execute="DB::statement('GRANT SELECT ON conversations, threads TO ops_hub_app');"
```

Expected output: `=> true`

If the container name lookup fails (`docker ps -qf` returns empty), find the container ID directly:
```bash
docker ps | grep sgnpza1r8jlq19f0dboqpzq6
# Then substitute <CONTAINER_ID> below:
docker exec <CONTAINER_ID> php artisan tinker --execute="DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app');"
docker exec <CONTAINER_ID> php artisan tinker --execute="DB::statement('GRANT SELECT ON conversations, threads TO ops_hub_app');"
```

**Verify the grant took effect** (run in Supabase SQL Editor):
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('conversations', 'threads')
  AND grantee = 'ops_hub_app';
```
Expect 2 rows (one SELECT grant per table).

#### Step 2: Verify Gmail OAuth connection in FreeScout UI

The mailbox row IS in the DB (confirmed from DB query, updated_at=03:03 UTC). The OAuth connection may already be active.

1. Go to: `https://freescout-staging.inatechshell.ca/mailboxes`
2. Find "ITS Support" mailbox and click Edit
3. Go to "Incoming Email" tab
4. Click "Test Connection" — confirm it says "Connection is successful"
5. If the test fails: click "Connect Google Account" and re-authorize the OAuth
6. Save the mailbox settings if any changes were made

#### Step 3 (optional — after steps 1+2): Manually trigger an email fetch

To verify emails start appearing without waiting for the cron:
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan freescout:fetch-emails
```

Note: the artisan binary is at `/www/html/artisan` inside the container (not `/var/www/html/artisan`). If `php artisan` doesn't resolve, use `php /www/html/artisan freescout:fetch-emails`.

### After resolution

Notify Production Manager: "GRANT re-issued + ALTER DEFAULT PRIVILEGES applied + Gmail OAuth reconnected in FreeScout"

Production Manager will:
1. Run `discover-freescout-schema.yml` to confirm conversations rows are appearing
2. Verify `pollFreeScout` is dispatching `ticket.triage` events in Inngest
3. Close FQ-41 and update T-22 status
4. Trigger `sweepNewTickets` sweep if conversations exist but are missed by the cron window

### Note on recurrence

This has happened twice. Root cause: GRANTs on FreeScout-owned tables are lost when FreeScout re-runs Laravel migrations (e.g. on DB reset). The permanent fix is `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app` — run once as `freescout_user` via artisan tinker (Step 1 above). After that, every table FreeScout creates will automatically carry the grant. **This fix must be run via artisan tinker, not Supabase SQL Editor** (Supabase SQL Editor connects as `postgres`, which returns `permission denied to change default privileges` for another role's defaults).

---

## ✅ FQ-40 — NVIDIA_API_KEY value rejected by NVIDIA NIM (401 Unauthorized) — RESOLVED 2026-06-27

**Filed:** 2026-06-26
**Resolved:** 2026-06-27 — bypassed NVIDIA entirely; gpt-4o-mini is now the sole triage-model provider
**Filed by:** Production Manager
**Was blocking:** T-22 (ticket-triage live validation), LiteLLM triage-model smoke test

**Resolution:** Created and merged PR #176 (`configure-litellm-openai-only.yml`), then triggered
`configure-litellm-openai-only` workflow (run #28274212266). All 9 steps passed:
- Purged all existing model registrations (NVIDIA aliases removed)
- Registered `gpt-4o-mini` as `triage-model` alias → HTTP 200 smoke test ✅
- Registered `gpt-4o-mini` as `meta/llama-3.3-70b-instruct` alias → HTTP 200 smoke test ✅
NVIDIA not used. OPENAI_API_KEY confirmed working. No founder action required.

**Original issue (archived for reference):**

### Current symptom (runs #28210294811 and #28210675694)

`configure-litellm-triage-model.yml` run #28210675694 failed at smoke test.
The user confirmed NVIDIA_API_KEY was "corrected" in Coolify and litellm-staging was fully redeployed
before this run. The 401 persists:
```
POST /chat/completions (model=triage-model) -> HTTP 401
litellm.AuthenticationError: OpenAIException - Error code: 401
{'status': 401, 'title': 'Unauthorized', 'detail': 'Authentication failed'}
Received Model Group=triage-model
Available Model Group Fallbacks=None
```

This is the third workflow run showing HTTP 401 from NVIDIA NIM (runs #28209902312,
#28210294811, #28210675694).

### What is confirmed working

- litellm-staging container is up and reachable (health check passed)
- Both `NVIDIA_API_KEY` and `OPENAI_API_KEY` key names are present in Coolify env config
- Container was fully redeployed (env injection confirmed)
- `OPENAI_API_KEY` is valid and injected: OpenAI probe (native gpt-4o-mini, no api_key field) → HTTP 200
- LiteLLM model registration for `triage-model` alias → HTTP 200 (registration itself succeeds)

### Root cause (updated)

The `NVIDIA_API_KEY` value stored in Coolify is being **rejected by the NVIDIA NIM API** with
HTTP 401. The previous hypothesis (restart vs redeploy) no longer applies — the full redeploy
confirmed that OPENAI_API_KEY is injected and working.

The NVIDIA_API_KEY is present in the running container (key name confirmed by Coolify API, and
the redeploy would have injected it), but when LiteLLM sends it to
`https://integrate.api.nvidia.com/v1` using `os.environ/NVIDIA_API_KEY`, NVIDIA returns 401.

Possible causes (founder to verify):
1. The key value was entered incorrectly in Coolify (truncated, extra whitespace, wrong copy)
2. The key is valid but not activated for `meta/llama-3.3-70b-instruct` model access in NVIDIA NIM
3. The key belongs to a different NVIDIA service (e.g., NIM Microservices vs integrate.api.nvidia.com)
4. The key was revoked or expired at NVIDIA's side after being generated

### Required action (founder)

1. Go to https://build.nvidia.com → API Keys and verify the key value character-for-character
2. Confirm the key has access to the NIM catalog model `meta/llama-3.3-70b-instruct` at
   `https://integrate.api.nvidia.com/v1`
3. If the key is wrong: update `NVIDIA_API_KEY` in Coolify UI → litellm-staging → Environment
   Variables, then click Deploy (full redeploy)
4. If the key is correct but still fails: generate a fresh key at https://build.nvidia.com,
   update Coolify, and redeploy
5. Notify Production Manager: "NVIDIA key updated and litellm-staging redeployed"

### What NOT to do

Do NOT click Restart after updating the key — only Deploy (full redeploy) injects updated env vars.

### Additional confirmed data point (run #28210675694)

The OpenAI probe in step 7 passed (HTTP 200) in both run #28210294811 and #28210675694.
This confirms `OPENAI_API_KEY` is live and valid in the running container. If NVIDIA cannot
be resolved, OpenAI can serve as the sole provider temporarily.

A ready-to-trigger workflow has been committed to unblock once NVIDIA is fixed:
`.github/workflows/register-litellm-openai-fallback.yml`

### After resolution

Production Manager action on receipt of notification:
1. Run: `gh workflow run configure-litellm-triage-model.yml --repo admin-nutshell/ops-hub-00`
2. Verify NVIDIA smoke test passes (HTTP 200)
3. On NVIDIA pass: `gh workflow run register-litellm-openai-fallback.yml --repo admin-nutshell/ops-hub-00`
4. Verify both NVIDIA and OpenAI final tests pass (HTTP 200 each)
5. Close FQ-40, update WORK.md T-22 status

---
