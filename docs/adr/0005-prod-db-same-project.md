# ADR-0005 — Production DB Isolation: Separate RLS Tenant Scope in Same Supabase Project

- **Status:** Accepted
- **Date:** 2026-07-01
- **Author:** Tech Lead
- **Deciders:** Tech Lead (schema approach); Production Manager (Coolify env var config, T-49 deploy)
- **Supersedes:** none
- **Related:** ADR-0002 (Supabase as shared DB), `supabase/migrations/20260701000000_t47_prod_seed.sql`, `WORK.md` (T-47)

---

## Context

Sprint 5 (T-47) requires production data to be seeded in Supabase before ops-hub-prod can be deployed. The Supabase project `yocoljutbiizdbfraapx` (Canada Central) already holds all staging data. The exit criteria explicitly constrains us to the same project and offers two isolation options: a dedicated `prod` schema, or separate RLS tenant scope (new rows in the existing `public` schema).

Existing UUID space in the `public` schema:
- `00…0001` — ops-hub dev project
- `00…0002` — TTS staging project (`'tts'`)
- `00…0010` — staging-support tenant
- `00…0020` — DNC staging tenant

---

## Decision

**Separate RLS tenant scope.** New rows inserted into `public.projects` and `public.tenants` with distinct prod UUIDs. The prod TTS project is named `'tts-prod'` (required — `projects.name` is unique; `'tts'` is taken by staging).

New prod UUIDs:
- TTS prod project: `00000000-0000-0000-0000-000000000003` / name `'tts-prod'`
- DNC prod tenant: `00000000-0000-0000-0000-000000000030`

Each environment is routed to its own rows via `POLLING_PROJECT_ID` and `POLLING_TENANT_ID` Coolify env vars.

---

## Alternatives considered

### `prod` schema (separate schema in same project)
Re-run all 8 migrations under `SET search_path TO prod`. Offers true namespace isolation.

Rejected because:
- All 8 migrations use unqualified `CREATE FUNCTION`, `CREATE POLICY`, and `GRANT` statements. Wrapping them in a different search_path would create `prod.current_tenant_id()` etc., requiring schema-qualified references in every policy and every GRANT — non-trivial rewriting of stable, tested migrations.
- The isolation benefit is marginal: the real risk (a rogue `service_role` query) is equally present in both options since `service_role` bypasses RLS regardless of schema.
- Rejected by standing constraint: "no abstractions beyond what the task requires."

### Separate Supabase project
Clean environment boundary; requires managing two connection strings, two sets of Vault secrets, two Prisma/migration workflows.

Rejected because:
- Exit criteria explicitly requires same project `yocoljutbiizdbfraapx`.
- Violates free-tier-first constraint (second project adds cost and complexity).

---

## Consequences

### Accepted risks

1. **`service_role` bypasses RLS.** A migration running as `service_role` can touch both staging and prod rows in the same `UPDATE` if it lacks a `WHERE tenant_id = ...` clause. Mitigation: all T-47+ migrations are reviewed before applying; none use unbounded DML.

2. **Shared physical tables.** A catastrophic SQL Editor mistake (e.g. `TRUNCATE tickets`) would affect both staging and prod. Mitigation: SQL Editor access is restricted to the founder; agents never hold `service_role`.

3. **`projects.name` uniqueness ties `'tts'` to staging forever.** The prod project is `'tts-prod'` — name encodes environment. This is deliberate and honest; if project identity ever needs to be environment-neutral, a rename migration is the correct fix.

### Benefits

- Zero migration rewrites — all 8 existing migrations apply unchanged.
- `ops_hub_app` role and Vault secrets are reused without change.
- Consistent with the T-27 pattern: both staging and prod use the established UUID/row model.
- `POLLING_PROJECT_ID` / `POLLING_TENANT_ID` env vars already provide clean environment routing.
