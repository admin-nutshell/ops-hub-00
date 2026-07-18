-- Migration: 20260717160000_s2_signal_sources_schema
-- Ops Hub product-domain reboot — Sprint S2: signal_sources + real FK on findings.source_id
-- Author: Tech Lead  Date: 2026-07-17
-- Forward-only, additive only. Does not touch any existing row's data.
--
-- SCOPE (narrowed per founder decision this sprint): S2 builds vulnerability
-- detection ONLY, via GitHub's own security alert APIs (Dependabot alerts +
-- code-scanning alerts) against the GitHub App connection already established
-- in S1 (security_events: read scope already live, no new credential
-- required). Bug detection via Sentry is deferred — no Sentry credential
-- exists yet. `kind` below is therefore deliberately narrower than the S1
-- plan's full future signal-source taxonomy (which also anticipates a
-- Sentry-backed 'bug' kind and possibly others): only 'security_events'
-- (Dependabot + code-scanning, both surfaced through the same GitHub API
-- family) and 'dep_audit' (reserved for a possible future standalone
-- npm/pnpm-audit runner — NOT built this sprint; see the S2 task note ruling
-- a separate npm-audit runner out as redundant with Dependabot alerts for
-- now). Widen the check constraint in a follow-up migration when a real new
-- kind actually ships — do not pre-guess the taxonomy further than that.
--
-- CONFIG DESIGN: `config jsonb` follows the original plan's rule that
-- secrets are referenced by vault key id, NEVER stored inline. For the one
-- kind this migration actually enables (security_events), no separate
-- credential exists at all — auth flows entirely through the repo's existing
-- repo_connections row / GitHub App installation (see
-- src/github/appAuth.ts), so `config` is expected to stay NULL/empty for
-- this kind in practice. The column exists now so a future kind that DOES
-- need its own config (e.g. a Sentry DSN reference) doesn't require a
-- schema change to add it.
--
-- IDEMPOTENCY DESIGN: unique(product_id, kind) is added (beyond what the S2
-- task literally asked for as a listed column) because detection-agent
-- (src/inngest/detect-vulnerabilities.ts) must "create or reuse" the one
-- security_events source for a product on every run, and a bare
-- SELECT-then-INSERT-if-missing races under Inngest's own retry semantics
-- (two concurrent/retried runs could both see "missing" and both insert).
-- This constraint lets detection-agent use a real
-- `INSERT ... ON CONFLICT (product_id, kind) DO UPDATE ... RETURNING id`
-- upsert instead — the same DB-enforced-idempotency pattern `findings` already
-- uses via unique(product_id, fingerprint). One source per (product, kind)
-- also matches the current one-active-repo-connection-per-product reality
-- (repo-inspect.ts's `LIMIT 1` on active repo_connections); revisit if/when
-- multi-repo-per-product ever lands.
--
-- *** SECURITY LEAD REVIEW REQUIRED (matches the 20260717120100/20260717140100
-- precedent) *** — RLS policies land in the companion migration
-- 20260717160100_s2_signal_sources_rls_policies.sql, reviewed together.
--
-- Requires 20260717120000_s1_product_domain_schema.sql applied first
-- (references products(id), adds a FK onto the existing findings table).
-- Ordered after 20260717150000 (the latest migration applied as of this
-- commit) — this file does not depend on 20260717140000/20260717140100
-- (repo_snapshots), which are still pending apply as of this commit.
--
-- NOT YET APPLIED to the live Supabase project as of this commit — same
-- founder-runs-SQL-Editor workflow as every migration in this repo. The new
-- Inngest function this table backs (src/inngest/detect-vulnerabilities.ts)
-- will fail its write step until this migration (+ its RLS companion) is
-- applied live.
--
-- UPDATE (same review pass, before merge): CodeRabbit's review of this PR
-- (#543) flagged that findings.source_id below (as originally written) was
-- a simple FK on source_id alone — it guarantees the signal_sources row
-- exists, but nothing at the DATABASE level guarantees THIS finding's
-- product_id actually matches that source's real product_id, only
-- application code does (detect-vulnerabilitiesForProduct passing the same
-- productId used to look up the source). Same gap class CodeRabbit found in
-- PR #537 for repo_snapshots -> repo_connections (see
-- 20260717150000_s1_repo_connections_composite_unique.sql for the
-- precedent). Fixed below with a composite FK + supporting
-- unique(product_id, id) on signal_sources. Unlike the 20260717150000
-- precedent, this did NOT require a separate forward-only migration: this
-- file (and its RLS companion) are confirmed NOT YET APPLIED to the live
-- database as of this fix, so editing them in place carries no risk of
-- schema-history/live-database drift.

-- ---------------------------------------------------------------------------
-- signal_sources  (a configured detection input for a product) — product-scoped
-- ---------------------------------------------------------------------------
create table signal_sources (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  kind        text not null check (kind in ('security_events', 'dep_audit')),
  config      jsonb,
  status      text not null default 'active'
                check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now(),
  unique (product_id, kind),
  -- Enables a composite FK from findings(product_id, source_id) so a
  -- finding's product_id is guaranteed by Postgres to match its
  -- signal_source's real product_id — not just by application code.
  -- Strictly implied by the existing primary key (id is already globally
  -- unique); adds a guarantee, changes no existing data. Same pattern as
  -- repo_connections_id_product_id_key (20260717150000) for
  -- repo_snapshots -> repo_connections. Added per CodeRabbit review on PR
  -- #543.
  unique (product_id, id)
);

-- unique(product_id, kind) above already covers product_id-prefixed lookups
-- (findings' own unique(product_id, fingerprint) precedent) — no redundant
-- standalone product_id index added.

comment on table signal_sources is
  'A configured detection input for a product (S2: GitHub security alerts only — '
  'security_events kind, sourced via the existing repo_connections GitHub App '
  'installation, no separate credential). config is NULL/empty for kinds whose auth '
  'flows through an existing connection; for any future kind needing its own credential, '
  'config MUST reference a Supabase Vault key id, never store a secret inline. '
  'unique(product_id, kind) is the idempotency key detect-vulnerabilities.ts upserts '
  'against to create-or-reuse a source without racing under Inngest retries.';

-- ---------------------------------------------------------------------------
-- findings.source_id — land the real FK, replacing the S1 placeholder
-- ---------------------------------------------------------------------------
-- S1's schema migration (20260717120000) left `findings.source_id` an
-- UNCONSTRAINED uuid column with a comment noting this FK would land once
-- signal_sources existed. It now does. ON DELETE SET NULL (not CASCADE): a
-- finding is a system-of-record row with its own audit-relevant lifecycle
-- (state machine: detected -> triaged -> ... -> shipped/dismissed) — it must
-- never disappear just because its source config was later removed/replaced;
-- it should only lose the source link. This mirrors the same reasoning
-- findings.product_id uses ON DELETE RESTRICT for (protect finding history)
-- while repo_connections/signal_sources themselves use ON DELETE CASCADE
-- from products (a whole product being deleted legitimately takes its child
-- config rows with it — that is a different, coarser deletion than "a source
-- was reconfigured").
--
-- Safe to apply: S1's findings table has no seed rows (see its own header:
-- "No seed rows. S1 has no real product data yet"), and any real rows written
-- since would only ever have source_id NULL (nothing before this migration
-- could populate it meaningfully — no signal_sources table existed to point
-- to). This ALTER validates against current data at apply time regardless;
-- it will fail loudly rather than silently if that assumption is ever wrong.
--
-- COMPOSITE, not a simple FK on source_id alone: references
-- signal_sources(product_id, id) — requires the unique(product_id, id)
-- constraint added on signal_sources above — so Postgres itself rejects any
-- row where source_id resolves to a real signal_sources row but that row's
-- product_id differs from this finding's product_id. A simple FK on
-- source_id alone cannot express that; it was only ever enforced by
-- application code (the same productId used to create-or-reuse the source
-- in detect-vulnerabilities.ts). See 20260717150000 for the identical
-- pattern applied to repo_snapshots -> repo_connections.
--
-- ON DELETE SET NULL (source_id) — the PG15+ column-list form, not a bare
-- `ON DELETE SET NULL`. This project's Supabase project is confirmed PG15
-- (see docs/adr/0004-litellm-schema-isolation-restricted-role.md and
-- docs/engineering/litellm-db-isolation-runbook.md, both written against
-- "Supabase's PG15"). The column list matters here: findings.product_id is
-- NOT NULL (it carries its own ON DELETE RESTRICT lifecycle against
-- products, untouched by this migration) — a bare composite
-- `ON DELETE SET NULL` would try to null BOTH referencing columns on
-- delete and fail with a NOT NULL violation. Naming only `source_id`
-- preserves the exact original intent (see the paragraph above this ALTER
-- in the prior revision of this file): a finding must survive its source
-- being removed, losing only the source link, never itself.
alter table findings
  add constraint findings_source_id_fkey
  foreign key (product_id, source_id) references signal_sources (product_id, id)
  on delete set null (source_id);

-- Supports "findings from this source" lookups (detect-vulnerabilities.ts's
-- upsert path does not need this — it always writes by (product_id,
-- fingerprint) — but a future triage/dashboard view filtering by source will).
create index findings_source_id_idx on findings (source_id);

-- Supersede the S1 "FK placeholder" column comment now that the real FK
-- exists — a fresh COMMENT ON statement, not an edit to the already-applied
-- S1 migration file (that file stays exactly as applied; this is how its
-- now-stale comment text gets corrected going forward).
comment on column findings.source_id is
  'Composite FK to signal_sources(product_id, id), ON DELETE SET NULL (source_id) '
  '(added 20260717160000 — see that migration for the ON DELETE SET NULL vs CASCADE '
  'rationale, and for why the FK is composite on (product_id, source_id) rather than '
  'source_id alone). NULL is valid: a finding predating signal_sources, or one whose '
  'source was later removed.';
