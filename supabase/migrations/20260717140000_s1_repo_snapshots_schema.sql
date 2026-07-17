-- Migration: 20260717140000_s1_repo_snapshots_schema
-- Ops Hub product-domain reboot — Sprint S1: read-only repo-inspection storage
-- Author: Tech Lead  Date: 2026-07-17
-- Companion to 20260717120000_s1_product_domain_schema.sql /
-- 20260717120100_s1_product_domain_rls_policies.sql (products / repo_connections
-- / findings / autonomy_policies + product-scoped RLS). Forward-only, additive
-- only — does not touch any existing table.
--
-- WHY THIS TABLE EXISTS: S1's repo-inspection Inngest function
-- (src/inngest/repo-inspect.ts) fetches a pilot repo's file tree + last 10
-- commits through the GitHub App on every run. That data has to land
-- somewhere the dashboard (a separate follow-up task) can read it through the
-- SAME path every other dashboard read uses in this codebase: `web/lib/*` ->
-- a `pg` Pool authenticated as `ops_hub_app` -> a transaction-local
-- `set_config('app.current_product', ...)` GUC -> a product-scoped SELECT
-- (see web/lib/queries.ts). `audit_log` cannot serve this role even for a
-- summary: repo-inspection audit rows are stamped with `project_id`/
-- `tenant_id` both NULL (this domain has no project/tenant), and NEITHER
-- existing audit_log SELECT policy (`audit_log_select`:
-- `tenant_id = current_tenant_id()`, or `audit_log_select_platform`:
-- `tenant_id is null and project_id = current_product_id()`) can ever match a
-- NULL tenant_id + NULL project_id row — those rows are readable by
-- `service_role` only until audit_log itself is re-pivoted to `product_id` in
-- a later sprint (out of S1 scope). So `repo_snapshots` is the genuinely
-- necessary new table, not a nice-to-have; audit_log stays what it already
-- is here — a write-only compliance trail for this domain, not a read path.
--
-- SCOPE: one row per repo_connection (the LATEST snapshot only — this is a
-- cache/read-model for the dashboard, not a history table). Re-running the
-- inspection UPSERTs (on conflict (repo_connection_id) do update) rather than
-- appending. A history-of-snapshots table is explicitly out of S1 scope; add
-- one later only if a real need shows up (findings/detection in S2 already
-- covers "what changed" via fingerprint dedupe, which is the more likely
-- long-term answer to that need, not raw snapshot history).
--
-- *** SECURITY LEAD REVIEW REQUIRED before this migration is applied ***
-- (same discipline as 20260717120100 — RLS policies land in the companion
-- 20260717140100_s1_repo_snapshots_rls_policies.sql, reviewed together).
-- Requires 20260717120000_s1_product_domain_schema.sql applied first
-- (references products, repo_connections).
--
-- NOT YET APPLIED to the live Supabase project as of this commit — same
-- founder-runs-SQL-Editor workflow as every migration in this repo. The
-- Inngest function this table backs (src/inngest/repo-inspect.ts) will fail
-- its write step until this migration (+ its RLS companion) is applied live.

create table repo_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id) on delete cascade,
  -- One snapshot per connection; re-inspection UPSERTs this row rather than
  -- appending (see SCOPE note above). ON DELETE CASCADE: a snapshot has no
  -- meaning once its connection is gone.
  --
  -- No inline FK on repo_connection_id here — the COMPOSITE foreign key
  -- below (on repo_connection_id + product_id together) replaces it. A
  -- simple FK on repo_connection_id alone only guarantees the connection
  -- exists; it says nothing about whether THIS row's product_id actually
  -- matches that connection's real product_id. Before this change that
  -- match was enforced only by application code (repo-inspect.ts passes the
  -- same productId used to fetch the connection) — a real gap for a table
  -- that exists specifically to serve product-scoped reads. Added per
  -- CodeRabbit review on PR #537.
  repo_connection_id  uuid not null,
  repo_full_name      text not null,
  default_branch      text not null,
  -- Capped, filtered list of { path, type, size } entries — never the raw
  -- unbounded GitHub response. See repo-inspect.ts TREE_ENTRY_CAP and the
  -- node_modules/.git noise filter. tree_entry_count is the count AFTER
  -- filtering, BEFORE the cap, so a follow-up consumer can tell "how big is
  -- this repo really" apart from "how much did we store."
  --
  -- UNTRUSTED CONTENT: file paths and commit messages originate from the
  -- connected repo, not from ops-hub itself. No prompt reads this jsonb in
  -- S1 (pure storage/display), but the FIRST future caller that feeds it
  -- into an LLM prompt (e.g. a detection-agent in S2) MUST treat every path/
  -- message string as DATA to analyze, never as instructions — the same
  -- delimited-untrusted-input discipline already load-bearing in
  -- ticket-triage.ts (T-103) and documented on findings.detail.
  tree                jsonb not null,
  tree_entry_count    integer not null,
  tree_truncated      boolean not null default false,
  -- Last 10 commits: [{ sha, message, author, date }]. Same untrusted-content
  -- note as `tree` above.
  commits             jsonb not null,
  fetched_at          timestamptz not null default now(),
  unique (repo_connection_id),
  -- Composite FK: guarantees at the DATABASE level (not just application
  -- code) that this row's product_id can never drift from the real
  -- product_id of the repo_connections row it points to. Requires the
  -- unique(id, product_id) constraint added to repo_connections in the
  -- companion 20260717120000 migration.
  foreign key (repo_connection_id, product_id)
    references repo_connections (id, product_id) on delete cascade
);

-- RLS scoping lookups filter by product_id directly (the unique index above
-- is keyed on repo_connection_id, not product_id-prefixed, so this is not
-- redundant — contrast with findings' unique(product_id, fingerprint), which
-- already covers product_id lookups and deliberately skips a second index).
create index repo_snapshots_product_id_idx on repo_snapshots (product_id);

comment on table repo_snapshots is
  'Latest read-only repo-inspection result per repo_connection (file tree + last 10 '
  'commits, capped/filtered) — the read path a dashboard follow-up task queries directly '
  'via the ops_hub_app pool + app.current_product GUC (mirrors every other web/lib/queries.ts '
  'read). One row per repo_connection, upserted on each inspection run — not a history '
  'table. tree/commits are UNTRUSTED external content from the connected repo; see the '
  'column comment on `tree` before any future prompt use.';
