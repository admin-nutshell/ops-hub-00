# Deploy plan — Restore ADR-0004 restricted-role wall on litellm-staging + litellm-prod

**Status:** PLANNED — not yet executed. Written per the pre-deploy checklist in
`.claude/team/PRODUCTION.md` ("rollback path defined BEFORE deploy starts").
No live change has been made to either environment's `DATABASE_URL` in this
session — see `DECISIONS.md` (2026-07-04) and `FOUNDER_QUEUE.md` (FQ-57) for
why this was deliberately not executed live.

---

## What's wrong

`diagnose-litellm-prisma.yml` and `verify-litellm-db-isolation.yml` (both run
2026-07-04) show **both** `litellm-staging` and `litellm-prod` currently
connect to Supabase as `postgres.yocoljutbiizdbfraapx` — the shared-project
superuser — **not** the ADR-0004 `litellm_db_user` restricted role that FQ-45
put in place on 2026-06-27. The permission wall that stops a LiteLLM Prisma
DDL from wiping `public.tenants`/`public.tickets`/FreeScout `conversations`/
`threads` is currently **not in effect** on either environment.

Root cause, pinned precisely via DECISIONS.md's own history: the FQ-49 fix
(2026-06-29, LiteLLM `ENOIDENTIFIER` crash-loop) deleted the duplicate
`DATABASE_URL` rows and "re-entered `DATABASE_URL` once via Coolify UI with
`postgres.yocoljutbiizdbfraapx` as username" — **two days after** FQ-45
(2026-06-27) had put `litellm_db_user.yocoljutbiizdbfraapx` in place. The
FQ-49 fix correctly added the missing Supavisor project-ref suffix (that was
the actual crash-loop cause) but used the plain superuser username instead of
the restricted role, silently undoing the ADR-0004 wall. This wasn't flagged
at the time (attention was on the crash-loop) and DECISIONS.md's FQ-49 entry
doesn't call out the role downgrade. `DISABLE_SCHEMA_UPDATE=true` (in force
since FQ-45's freeze step) then blocked Prisma from syncing whatever schema
change the later `ANTHROPIC_API_KEY` addition needed (T-46, ~06-29–07-01) —
that produced the FQ-53 500, independent of which role was connecting;
removing the wall did not cause that 500 and restoring the wall will not
reintroduce it, since Prisma is not attempting DDL either way while frozen.
Whatever cleared the 500 between filing (07-01) and this diagnostic (07-04)
is not documented. The role has been `postgres`, undetected, since
2026-06-29, through T-47/48/49/50/51/52/M6/T-56. `litellm-prod` (T-48, PR
#231) appears to have inherited the same posture from the start — WORK.md's
"isolated from staging" claim for T-48 refers only to the
`?schema=litellm_prod` routing hint, not a role boundary; connecting as
`postgres` means that hint is not backed by any actual permission restriction
(superuser bypasses schema ownership entirely).

**Current risk level: latent, not active.** `DISABLE_SCHEMA_UPDATE=true` is
confirmed set on both environments (verified 2026-07-04), so Prisma is not
attempting any DDL on boot today — there is no live wipe trigger. The wall
being off only becomes dangerous the moment schema-update is ever turned back
on (e.g. for a legitimate future LiteLLM upgrade) while `DATABASE_URL` is
still `postgres`.

## What "done" looks like

- `litellm-staging` and `litellm-prod` `DATABASE_URL` both connect as their
  respective restricted roles (`litellm_db_user` / a **new**, prod-only
  restricted role — see Open Question below), never `postgres`.
- `DISABLE_SCHEMA_UPDATE=true` restored on both after the one-time sync.
- `POST /model/new` succeeds under the restricted role on both, and the
  registered aliases (`triage-model`, `fallback-model`,
  `meta/llama-3.3-70b-instruct` on staging; the 3 prod aliases per T-48) are
  re-registered and confirmed to persist across a restart.
- Canary proves `public.tenants`/`tickets`/`projects`/`kb_articles`/
  `conversations`/`threads` (and their row counts) survive the switch on both
  passes.

## Open question — prod needs its own schema, not a shared one

`litellm_db_user` currently owns schema `litellm` (staging's data). If prod's
`DATABASE_URL` reuses the **same role**, the role's `search_path` is pinned to
`litellm` (`ALTER ROLE litellm_db_user SET search_path = litellm` from the
ADR-0004 runbook) — pointing prod at `?schema=litellm_prod` would not actually
route prod's unqualified DDL there; it would land in `litellm`, colliding with
staging's model registrations. **Prod needs a second restricted role**
(`litellm_db_user_prod`, owning `litellm_prod`, zero rights on `public` *and*
zero rights on `litellm`) — the same founder-run superuser SQL pattern as
`docs/engineering/litellm-db-isolation-runbook.md` Step 1, parameterized for
prod. This is a **new founder action**, not a rerun of the existing one. See
FQ-57.

## Canary rollout plan (once the founder has completed the prod role SQL)

**Phase 1 — staging (lower risk, already has a working restricted role):**
1. Pre-check: confirm `litellm_db_user` still authenticates (its password may
   have rotated since 2026-06-27 — DECISIONS.md shows at least one Supabase
   password rotation in this project's history) and still owns a healthy
   `litellm` schema, via a read-only probe, before changing anything live.
2. Dispatch `fix-litellm-schema-isolation.yml` `mode=apply-wall` (already
   built, already tested 2026-06-27) — points `DATABASE_URL` back at
   `litellm_db_user`, turns `DISABLE_SCHEMA_UPDATE` off for one boot, restarts,
   verifies health.
3. Re-register `triage-model`, `fallback-model`, `meta/llama-3.3-70b-instruct`
   via `/model/new` under the restricted role; confirm HTTP 200.
4. Restart again; confirm the 3 aliases persist and a live completion works
   (same pattern as `restart-verify-litellm-staging.yml`, 2026-07-04).
5. Manual canary in Supabase SQL Editor (Step 4 of the runbook) — confirm
   `public.*` tables intact, row counts unchanged.
6. Dispatch `mode=freeze-schema` to re-freeze.
7. Monitoring window: 30 minutes, watch Sentry + UptimeRobot + a live ticket
   triage.

**Phase 2 — prod (after Phase 1 succeeds cleanly, after founder creates the
prod-only role):**
1. Same sequence as Phase 1, targeting `litellm-prod` (UUID
   `hlik1d96uvkkjzpbxa3azhcv`) and the new `litellm_db_user_prod` role /
   `litellm_prod` schema.
2. **24-hour monitoring window** (prod, live ticket traffic) per the
   Production Manager critical-path monitoring rule, not the standard 30
   minutes.
3. QA Manager invoked for post-deploy verification (a live ticket end-to-end,
   same shape as T-51).

## Rollback path (defined before either phase starts)

- **If `apply-wall` fails to bring LiteLLM up healthy:** re-point
  `DATABASE_URL` back to the current-working `postgres` DSN (kept as the
  literal fallback value, not deleted) and restart. This is the exact
  regressed-but-working state today — safe, if unwanted, landing spot.
  Estimated rollback time: under 5 minutes (one env-var swap + restart,
  identical mechanics to `update-litellm-suffix.yml`).
- **If canary shows any `public` table missing or row count dropped:** STOP
  immediately, do not proceed to `freeze-schema`, escalate to
  `FOUNDER_QUEUE.md` as a security incident per CLAUDE.md, do not attempt
  further live changes.
- **Never** revert to a `public`-capable superuser as a *standing* config to
  work around a future `/model/new` failure — that is the exact mistake this
  plan is undoing. If a future LiteLLM image needs a real schema change under
  the restricted role, the sanctioned path is: temporarily flip
  `DISABLE_SCHEMA_UPDATE` off, redeploy once, verify `public` survived,
  re-freeze (ADR-0004's own documented rollback), logged in DECISIONS.md every
  time.

## Owners

- **Production Manager:** owns dispatching both phases, the canary checks,
  and the monitoring windows.
- **Security Lead:** sign-off requested on the new prod-only role SQL (same
  scope as their original ADR-0004 review) before Phase 2.
- **Founder:** one-time superuser SQL to create `litellm_db_user_prod` +
  `litellm_prod` schema (FQ-57); optionally rotate/reconfirm
  `litellm_db_user`'s password for staging if Phase 1's pre-check finds it
  stale.
