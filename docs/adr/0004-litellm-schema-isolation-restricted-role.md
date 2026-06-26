# ADR-0004 — LiteLLM DB Isolation via Restricted Role + Schema Wall

- **Status:** Accepted
- **Date:** 2026-06-25
- **Author:** Tech Lead
- **Deciders:** Tech Lead (proposer); Production Manager (Coolify env-var change, restart); Security Lead (DB privilege model on the shared multi-app database)
- **Supersedes:** none
- **Related:** ADR-0002 (tool stack — Supabase as shared DB), `docs/engineering/litellm-db-isolation-runbook.md`, `.github/workflows/fix-litellm-schema-isolation.yml`, `DECISIONS.md` (2026-06-21 "LiteLLM tables also present in public — expected"; 2026-06-25 model re-registration churn)

---

## Context

LiteLLM (the provider-neutral LLM router) and the Ops Hub share **one** Supabase
PostgreSQL database (project `yocoljutbiizdbfraapx`, Canada Central). This sharing
was an accepted staging trade-off — a second Supabase project is blocked by the org
free-tier limit, and free-tier-first is a standing rule.

On every LiteLLM redeploy, the LiteLLM proxy runs Prisma startup DDL against the
database its `DATABASE_URL` user can reach. Because LiteLLM has been connecting with
a `public`-capable user, that DDL has **wiped the Ops Hub tables** (`tenants`,
`tickets`, `projects`, …) in `public` — three times this session. The Ops Hub data
model is collateral damage of LiteLLM's schema management.

A prior attempt appended `?schema=litellm` to LiteLLM's `DATABASE_URL`. The result
was the worst of both worlds: LiteLLM created a **duplicate** ~65-table set in a new
`litellm` schema **and** left its originals in `public`, and Ops Hub tables kept
getting wiped. The connection-string param alone did not isolate anything, because
the DB user still had full run of `public`.

The decision is narrow: **how do we guarantee that a LiteLLM redeploy can never
again drop or alter Ops Hub tables in `public`, regardless of what Prisma migration
LiteLLM runs, and without a second Supabase project — given that we can only set
environment variables in Coolify for litellm-staging (no container shell, no ability
to edit LiteLLM's `schema.prisma`).**

---

## Decision

**Give LiteLLM a dedicated PostgreSQL login role (`litellm_db_user`) that OWNS a
`litellm` schema and has ZERO privilege to create, drop, or alter anything in
`public`.** The role is a permission wall enforced by PostgreSQL itself — it does
not depend on LiteLLM, Prisma, an env-var name, or a Docker image behaving. Layer
two functional aids on top so LiteLLM's DDL naturally lands where it is allowed:

1. **The role wall (primary, hard guarantee).** `litellm_db_user` is a fresh
   non-superuser, non-`BYPASSRLS` role that owns `schema litellm`. It is **not** the
   owner of any `public` table and (on Supabase's PG15) has no `CREATE` on `public`.
   PostgreSQL refuses `DROP`/`ALTER`/`TRUNCATE` on tables a role neither owns nor
   has privilege on. So even a `prisma migrate reset` / `--force-reset` cannot reach
   `public` — it errors with permission-denied instead. **This is the load-bearing
   control and it is the only one of the three that is immune to LiteLLM/Prisma/image
   changes.**

2. **Schema routing (functional).** `?schema=litellm` in the new `DATABASE_URL`
   tells Prisma to use `litellm` as its default schema, **backed by** a server-side
   `ALTER ROLE litellm_db_user SET search_path = litellm`. The role-level
   `search_path` always applies even if the Supabase pooler ignores URL params, so
   LiteLLM's unqualified DDL (`CREATE TABLE foo …`) lands in `litellm`, not `public`.

3. **Schema freeze (belt-and-suspenders).** After verifying LiteLLM boots cleanly
   under the restricted role, set `DISABLE_SCHEMA_UPDATE=true` so future redeploys
   make **zero** DDL attempts. This reduces churn and avoids 42501 noise; the wall,
   not this flag, is what makes `public` safe.

**Why this split is correct:** the only constraint we can actually enforce from
Coolify env vars is *which DB user LiteLLM connects as*. We make that user
incapable of harm. The schema param and the freeze flag make LiteLLM *comfortable*
in its sandbox; the role makes the sandbox *inescapable*.

The role and schema are created by the **founder** in the Supabase SQL Editor (the
`service_role`/superuser step agents never hold — CLAUDE.md security #3). The only
agent-owned action is the Coolify `DATABASE_URL` change, via the workflow.

---

## Options considered

### Option A — Restricted DB role that owns `litellm`, no rights on `public` (CHOSEN)
- **Pros:** Satisfies the literal requirement — "a redeploy CANNOT destroy Ops Hub
  tables, regardless of what migrations run." It is a PostgreSQL permission boundary,
  not a behavioral hope: independent of LiteLLM version, Prisma flags, env-var names,
  and Docker image updates. Survives image upgrades by construction. No second
  Supabase project. $0. Achievable entirely from Coolify env vars (the role is
  founder-created SQL; the workflow only swaps the connection string).
- **Cons:** Requires a founder SQL step (role creation needs superuser). One-time
  risk that a future LiteLLM image hardcodes `public.` references and 42501-fails to
  boot — mitigated by a staged rollout that verifies LiteLLM health under the role
  before freezing, and by `search_path` routing unqualified DDL to `litellm`.

### Option B — `?schema=litellm` connection param only (the prior attempt)
- **Rejected.** Already tried; it failed. The param routes Prisma's *default* schema
  but does nothing to *restrict* a `public`-capable user. It produced duplicate
  tables in both schemas and did not stop the `public` wipes. Kept here as a
  functional aid **inside** Option A, never as the guarantee.

### Option C — `DISABLE_SCHEMA_UPDATE=true` only (disable auto-migration)
- **Rejected as the primary control; kept as a layer.** Confirmed to exist in
  LiteLLM (prevents Prisma auto-migration on startup). But it is a *behavioral* flag,
  not a *boundary*: if a future image renames it, ignores it on a code path, or it is
  ever unset, `public` is exposed again. It also breaks the **first** boot if the
  `litellm` schema is empty (LiteLLM needs to build its tables once). Used only
  **after** the schema exists and health is verified, as defense-in-depth on top of
  the wall.

### Option D — Do nothing / keep manually recreating Ops Hub tables after each wipe
- **Rejected.** The do-nothing baseline. Three wipes already; unsustainable, and a
  data-integrity hazard for a system whose whole job is reliability. Recorded for
  completeness.

### Option E — Second Supabase project / separate database for LiteLLM
- **Rejected (blocked + against standing rule).** The cleanest separation in the
  abstract, but a new Supabase project is blocked by the org free-tier limit, and
  free-tier-first is a standing rule. Option A delivers the same hard guarantee
  (LiteLLM cannot touch Ops Hub data) on the existing project at $0. **Revisit
  trigger:** if the Ops Hub leaves free tier or onboards a second tenant project with
  its own data-isolation needs, move LiteLLM to its own database and retire the
  shared-DB role wall.

---

## Free-tier-first evaluation

Every option except E is $0 on the existing Supabase project. E (a second project)
is the paid/blocked path and is precisely what this ADR avoids. The chosen path adds
**no** infrastructure and **no** spend — one PostgreSQL role and one schema on the
database we already run. Passes the free-tier-first rule outright.

---

## Consequences

- **New founder-run SQL (one-time):** create `litellm_db_user` + `schema litellm`
  per `docs/engineering/litellm-db-isolation-runbook.md`. Requires the superuser
  connection; agents never hold it.
- **New GitHub Actions secret:** `LITELLM_DB_USER_URL` — the restricted DSN
  (`litellm_db_user.<ref>…?schema=litellm`). Founder-set; never committed, never in
  chat. The workflow refuses to run unless the secret's username starts with
  `litellm_db_user.` and the URL contains `schema=litellm` (guard against pushing a
  privileged URL by mistake).
- **One destructive-looking but safe DB op:** `DROP SCHEMA IF EXISTS litellm
  CASCADE` removes the throwaway duplicate tables from the prior attempt. LiteLLM
  rebuilds its schema on next boot; model registrations are re-registered by
  `fix-litellm-model-registration.yml`. **`REASSIGN OWNED BY postgres …` is
  explicitly forbidden** in the runbook — it would reassign `public.tenants`/`tickets`
  too, i.e. cause the disaster it is meant to prevent.
- **Staged rollout is blocking, not optional:** `apply-wall` (point LiteLLM at the
  role with schema-update **on**, verify LiteLLM healthy **and** `public.tenants`
  survived) **before** `freeze-schema`. The full proof is asserting both an Ops Hub
  table (`public.tenants`) and a FreeScout table (`public.conversations`) survive the
  redeploy — FreeScout's tables share `public` and are protected by the same wall.
- **Secondary benefit:** with the `litellm` schema in external Supabase and
  migrations frozen, LiteLLM's `STORE_MODEL_IN_DB` model registrations should now
  **persist** across redeploys, ending the re-registration churn in DECISIONS.md
  (2026-06-25). To be confirmed post-rollout.
- **Orphan cleanup is deferred and separate:** the 66 pre-existing LiteLLM tables in
  `public` are harmless once LiteLLM points at `litellm`; dropping them is an
  optional later step, never bundled with the role SQL (a mis-scoped drop there is
  the only data-loss risk in the whole procedure).
- **Portability (Project #2):** the pattern — "every co-tenant of a shared Postgres
  gets an owns-its-own-schema, can't-touch-others role" — is the reusable rule for
  any future shared-DB module, and the clean precursor to full per-project databases
  when free tier is outgrown (Option E revisit trigger).

---

## Review

- **Security Lead:** sign-off required on the DB privilege model — specifically that
  `litellm_db_user` is non-superuser / non-`BYPASSRLS`, owns only `litellm`, has no
  `CREATE` on `public` and owns no `public` table; and that the restricted DSN never
  enters git or chat. This change touches the multi-app shared database, so it is in
  Security Lead scope.
- **Production Manager:** owns the Coolify `DATABASE_URL` swap + restart via the
  workflow, and the staged `apply-wall` → verify → `freeze-schema` sequence.
- **Founder:** runs the one-time SQL (superuser) and sets the `LITELLM_DB_USER_URL`
  secret. Not a business decision — no FOUNDER_QUEUE item; this is an agent-owned
  technical fix with a founder-only execution step for the privileged SQL.

---

## Security Lead Review

- **Reviewer:** Security Lead (AppSec)
- **Date:** 2026-06-25
- **Verdict:** **APPROVED WITH CONDITIONS.** The wall is airtight on the load-bearing
  point: in PostgreSQL `DROP`/`ALTER` on a table come only from ownership or
  superuser (never grantable), and `litellm_db_user` is non-superuser, non-BYPASSRLS,
  and owns no `public` table — so even `prisma migrate reset --force-reset` can only
  42501-fail against `public`. The REVOKEs and the `can_create_in_public` check are
  belt; non-ownership + non-superuser is the wall. No secret leaks (placeholders in
  SQL, masked DSN secret in the workflow, structure-only guard with no echo). No
  change to Ops Hub RLS or `ops_hub_app` posture — a slight improvement (LiteLLM data
  now confined to `litellm`). Concurs this is agent-owned, **not** a FOUNDER_QUEUE
  item (3× wipes are a staging integrity event, not a security incident; the founder
  SQL step is an execution constraint, not a business decision).
- **Conditions (folded into the runbook):**
  - **C1 (blocking, gates the founder SQL):** the role-attribute hard-stop gate must
    check (a) — `rolsuper`/`rolcreatedb`/`rolcreaterole`/`rolbypassrls` all `f` —
    before proceeding, and the idempotent path must `ALTER ROLE … NOSUPERUSER
    NOCREATEDB NOCREATEROLE NOBYPASSRLS` so a pre-existing/elevated role is forced
    back to least privilege. *Applied.*
  - **C2 (correctness):** verification (e)'s table list disagreed with CLAUDE.md
    (`audit_log`/`feature_flags` vs `ticket_events`/`agent_actions`); (e) is an
    ownership confirmation, not the survival test — the Step 4 canary is. Reworded to
    the core tables + note. *Applied.*
  - **C3 (advisory):** added a pre-`DROP SCHEMA … CASCADE` dependency check for any
    `public` object depending on a `litellm` object. *Applied.*
- **Handoff:** Production Manager is clear to own `apply-wall` → verify → `freeze-schema`
  once the founder has run/verified the SQL with the C1 gate; hold `freeze-schema`
  until the Step 4 canary passes.
