-- Migration: 20260618120000_initial_schema
-- Ops Hub platform schema — M1 / Sprint 1 (T-03)
-- Author: Tech Lead  Date: 2026-06-18
-- Forward-only. RLS policies are applied in the companion migration
--   20260618120100_enable_rls_policies.sql (reviewed separately by Security Lead).
-- See docs/engineering/database-schema.md for design rationale.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- pgvector for KB embeddings. pgcrypto provides gen_random_uuid() (preferred
-- over uuid-ossp / uuid_generate_v4() on modern Supabase; it is built in).
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helper: maintain updated_at on UPDATE
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- projects  (platform registry / Module A runtime mirror)
-- ---------------------------------------------------------------------------
create table projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  context_schema  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table projects is
  'Platform registry. One row per ITS project (tts, etc.). context_schema mirrors projects/<name>/config.json for runtime queries.';

-- ---------------------------------------------------------------------------
-- tenants  (customers of a project) — tenant-scoped
-- ---------------------------------------------------------------------------
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete restrict,
  name        text not null,
  tier        text not null check (tier in ('starter', 'growth', 'scale')),
  sla_config  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index tenants_project_id_idx on tenants (project_id);

comment on table tenants is
  'Customers of a project (e.g. DNC under tts). Premium SLA add-on tracked inside sla_config.';

-- ---------------------------------------------------------------------------
-- tickets  (system of record; FreeScout is intake only) — tenant-scoped
-- ---------------------------------------------------------------------------
create table tickets (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete restrict,
  tenant_id    uuid not null references tenants(id) on delete restrict,
  title        text not null,
  body         text,                       -- UNTRUSTED tenant input (prompt-injection surface)
  severity     text not null check (severity in ('P1', 'P2', 'P3')),
  state        text not null default 'new'
                 check (state in (
                   'new','triaged','investigating','in_progress','blocked',
                   'in_review','staged','deploying','verifying','resolved',
                   'closed','reopened','wont_fix','duplicate')),
  owner_agent  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index tickets_project_tenant_idx on tickets (project_id, tenant_id);
create index tickets_state_idx          on tickets (state);
create index tickets_severity_idx       on tickets (severity);

create trigger tickets_set_updated_at
  before update on tickets
  for each row execute function set_updated_at();

comment on table tickets is
  'System of record for tickets. body is untrusted tenant input — sanitize/delimit before any prompt injection.';

-- ---------------------------------------------------------------------------
-- audit_log  (append-only; tenant-stamped) — tenant-scoped
-- tenant_id/project_id nullable to allow platform-level events.
-- ---------------------------------------------------------------------------
create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references projects(id) on delete set null,
  tenant_id      uuid references tenants(id)  on delete set null,
  timestamp      timestamptz not null default now(),
  actor          text not null,
  action         text not null,
  resource_type  text not null,
  resource_id    uuid,
  payload        jsonb not null default '{}'::jsonb
);

create index audit_log_project_tenant_ts_idx on audit_log (project_id, tenant_id, timestamp);
create index audit_log_resource_idx          on audit_log (resource_type, resource_id);

comment on table audit_log is
  'Append-only audit trail (INSERT only via RLS). Tenant/project stamped. SOC 2 evidence + post-mortem material.';

-- ---------------------------------------------------------------------------
-- feature_flags  (richer schema per docs/engineering/feature-flags.md;
-- project text -> project_id uuid FK) — project-scoped
-- ---------------------------------------------------------------------------
create table feature_flags (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  environment         text not null check (environment in ('dev', 'staging', 'prod')),
  flag_key            text not null,
  enabled             boolean not null default false,
  rollout_percentage  int not null default 0 check (rollout_percentage between 0 and 100),
  description         text,
  sunset_date         date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, environment, flag_key)
);

create trigger feature_flags_set_updated_at
  before update on feature_flags
  for each row execute function set_updated_at();

comment on table feature_flags is
  'Simple flag table (v1). Discipline (description, sunset_date) enforced by policy in feature-flags.md.';

-- ---------------------------------------------------------------------------
-- kb_articles  (KB / pgvector store; per-project namespace) — project-scoped
-- ---------------------------------------------------------------------------
create table kb_articles (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  title       text not null,
  body        text not null,
  embedding   vector(1536),   -- dims are embedding-model-specific; revisit if default embed model changes
  created_at  timestamptz not null default now()
);

create index kb_articles_project_id_idx on kb_articles (project_id);
-- ANN index (ivfflat/hnsw) on embedding is added by Data Engineer during T-20,
-- once rows exist; an ANN index on an empty table is useless.

comment on table kb_articles is
  'KB / shared-memory vector store. project_id is the per-project namespace; filter by it BEFORE the vector query.';
