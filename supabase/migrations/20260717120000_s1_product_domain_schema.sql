-- Migration: 20260717120000_s1_product_domain_schema
-- Ops Hub product-domain reboot — Sprint S1: greenfield foundation
-- Author: Tech Lead  Date: 2026-07-17
-- Founder-approved reboot: keep the platform substrate (Supabase/RLS, Inngest,
-- LiteLLM, eval gate, audit_log) as-is; replace the ticket-shaped domain with a
-- products/repos/findings/fixes domain. Strangler pattern — this migration is
-- ADDITIVE ONLY. It does not touch, modify, or reference `tickets` or any of
-- the other five existing tables (`projects`, `tenants`, `audit_log`,
-- `feature_flags`, `kb_articles`). The ticket pipeline keeps running untouched.
--
-- Scope: S1 only. This migration builds `products`, `repo_connections`,
-- `findings`, `autonomy_policies` — the tables the S1 plan calls out as
-- product-plural from day one. It deliberately does NOT build
-- `signal_sources`, `fix_attempts`, `pull_requests`, `deployments`, or
-- `approval_decisions` — those are later-sprint scope (S2+) per the roadmap.
--
-- Forward-only. RLS policies are applied in the companion migration
-- 20260717120100_s1_product_domain_rls_policies.sql (reviewed separately by
-- Security Lead — required before either file is applied, matching the
-- 20260618120000/20260618120100 precedent this migration re-pivots).
--
-- No seed rows. S1 has no real product data yet; a human/later step inserts
-- the pilot product row once the GitHub App installation exists.
--
-- set_updated_at() is reused as-is from 20260618120000_initial_schema.sql —
-- it is a schema-wide helper, not redefined here.

-- ---------------------------------------------------------------------------
-- products  (the new tenant axis; root entity of the product domain)
-- ---------------------------------------------------------------------------
create table products (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  autonomy_default  text not null default 'off'
                      check (autonomy_default in ('off', 'detect', 'propose', 'gated', 'full_auto')),
  created_at        timestamptz not null default now()
);

comment on table products is
  'Root entity of the product domain (replaces tenant as the multi-tenant axis for the '
  'reboot — see the S1 plan). One row per software product the platform operates on '
  '(multi-product from day one; only one row exists until a pilot product is inserted). '
  'autonomy_default seeds autonomy_policies rows for new change_types on a product; the '
  'runtime-consumed per-(product,change_type) override lives in autonomy_policies.';

-- ---------------------------------------------------------------------------
-- repo_connections  (binds a product to a GitHub repo) — product-scoped
-- ---------------------------------------------------------------------------
-- SECURITY INVARIANT: this table NEVER holds a token/credential column, by
-- design. github_installation_id identifies a GitHub App installation only;
-- short-lived (1-hour) installation tokens are minted per-operation at
-- runtime in a trusted Inngest step and are never persisted anywhere,
-- including here. Do not add a token/secret column to this table in a future
-- migration without an ADR + Security Lead sign-off — it would break the
-- "sandbox and DB both hold zero long-lived repo-write credentials" threat
-- model the reboot plan depends on.
create table repo_connections (
  id                      uuid primary key default gen_random_uuid(),
  product_id              uuid not null references products(id) on delete cascade,
  github_installation_id  bigint not null,
  repo_full_name          text not null,
  default_branch          text not null,
  status                  text not null default 'active'
                            check (status in ('active', 'suspended')),
  connected_at            timestamptz not null default now(),
  -- Added per CodeRabbit review on PR #537 (S1 repo-inspect): (id, product_id)
  -- must be independently unique so a later table can take a COMPOSITE FK on
  -- (fk_col, product_id) referencing this pair — that is what lets Postgres
  -- itself guarantee a child row's product_id can never drift from its
  -- connection's real product_id, instead of relying on application code
  -- alone. repo_snapshots (20260717140000) is the first consumer. `id` being
  -- the primary key does NOT satisfy a reference to the (id, product_id)
  -- pair on its own — Postgres requires this exact composite unique
  -- constraint to exist before such a composite FK can be created.
  unique (id, product_id)
);

create index repo_connections_product_id_idx on repo_connections (product_id);
-- GitHub webhook payloads are keyed by installation id, not repo name or our
-- own product_id — index it for webhook-path lookups (S2+ signal ingestion).
create index repo_connections_installation_id_idx on repo_connections (github_installation_id);

comment on table repo_connections is
  'Binds a product to a GitHub repo via a GitHub App installation (installation id '
  'only — NEVER a token/credential; see column-level security invariant above). '
  'status=suspended is how a connection is disabled without deleting audit-relevant '
  'history (no delete policy — mirrors the tickets convention of state, not deletion).';

-- ---------------------------------------------------------------------------
-- findings  (the unit of work; replaces tickets for the product domain) — product-scoped
-- ---------------------------------------------------------------------------
create table findings (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete restrict,
  source_id     uuid,                       -- FK placeholder: will reference signal_sources(id)
                                             -- once that table lands in S2. Deliberately
                                             -- UNCONSTRAINED (no FK) until then — S1 does not
                                             -- build signal_sources. Do not backfill a FK here
                                             -- without a follow-up migration once S2 lands.
  finding_type  text not null check (finding_type in ('bug', 'vuln', 'tech_debt')),
  severity      text not null check (severity in ('critical', 'high', 'medium', 'low')),
  fingerprint   text not null,
  title         text not null,
  detail        jsonb,                      -- UNTRUSTED external content (prompt-injection
                                             -- surface) — mirrors tickets.body. Sentry/issue/
                                             -- scanner text lands here; treat as DATA to
                                             -- analyze, never as instructions, in every agent
                                             -- prompt that reads it (T-103 injection-incident
                                             -- discipline; regression-locked by an eval case
                                             -- once detection-agent ships in S2).
  state         text not null default 'detected'
                  check (state in (
                    'detected', 'triaged', 'fix_in_progress', 'pr_open',
                    'shipped', 'dismissed', 'reopened')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, fingerprint)
);

-- unique(product_id, fingerprint) above already covers product_id-prefixed
-- lookups; no redundant standalone product_id index added (minimalism).
create index findings_state_idx    on findings (state);
create index findings_severity_idx on findings (severity);

create trigger findings_set_updated_at
  before update on findings
  for each row execute function set_updated_at();

comment on table findings is
  'System of record for detected findings (bug/vuln/tech_debt) — replaces tickets for the '
  'product domain (S1 of the reboot; tickets is untouched and keeps running in parallel). '
  'detail is UNTRUSTED external content (prompt-injection surface) — sanitize/delimit '
  'before any prompt use, never treat as instructions. unique(product_id, fingerprint) is '
  'the dedupe key detection-agent (S2) writes against.';

-- ---------------------------------------------------------------------------
-- autonomy_policies  (RUNTIME-CONSUMED kill-switch/gate) — product-scoped
-- ---------------------------------------------------------------------------
-- Contrast with the existing `feature_flags` table: feature_flags has RLS and
-- a write policy but, as of this migration, still has NO runtime consumer —
-- nothing in the codebase reads it to gate a decision. autonomy_policies is
-- designed from S1 to BE that runtime-consumed gate: every autonomous agent
-- workflow's gate step (wired starting S4 per the reboot roadmap) reads
-- (product_id, change_type) here before it is allowed to write to a repo.
-- change_type is intentionally an open text column (not a closed check
-- constraint) — the set of change types (dep_bump, vuln_patch, etc.) is
-- expected to grow as agent capability grows; `level` is the closed enum.
create table autonomy_policies (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  change_type text not null,
  level       text not null default 'off'
                check (level in ('off', 'detect', 'propose', 'gated', 'full_auto')),
  updated_by  text,                         -- audit convenience; authoritative record is
                                             -- audit_log (mirrors agent_model_routing.updated_by)
  updated_at  timestamptz not null default now(),
  unique (product_id, change_type)
);

create trigger autonomy_policies_set_updated_at
  before update on autonomy_policies
  for each row execute function set_updated_at();

comment on table autonomy_policies is
  'RUNTIME-CONSUMED kill-switch/gate: (product_id, change_type) -> level. Every autonomous '
  'agent write path must check this before writing to a repo (gate step wired starting S4). '
  'Contrast with feature_flags, which today has zero runtime consumers. unique(product_id, '
  'change_type) — one active level per change_type per product.';
