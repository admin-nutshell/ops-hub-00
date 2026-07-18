-- Migration: 20260717150000_s1_repo_connections_composite_unique
-- Ops Hub product-domain reboot — Sprint S1: composite unique constraint on repo_connections
-- Author: Tech Lead (via Coordinator correction) — Date: 2026-07-17
-- Forward-only, additive only. Does not touch any existing row's data.
--
-- WHY THIS IS A SEPARATE MIGRATION, NOT AN EDIT TO 20260717120000:
-- that file was already committed to `main` (PR #536) AND already applied to
-- the live Supabase project by the founder via SQL Editor earlier in this
-- session. Editing an already-applied migration file in place would leave
-- the repo's schema history describing a constraint the live database
-- doesn't actually have — exactly the "docs vs. reality" drift class this
-- project has hit before (see the T-58/FQ-61 "migration never applied"
-- incident). An initial version of this fix mistakenly edited that file
-- directly (caught and reverted before this migration was applied anywhere,
-- no live drift ever occurred) — this is the corrected, forward-only form.
--
-- WHY THE CONSTRAINT ITSELF: CodeRabbit's review of PR #537 (S1 repo-inspect)
-- pointed out that repo_snapshots.repo_connection_id having only a simple FK
-- to repo_connections(id) means nothing at the DATABASE level guarantees a
-- snapshot's product_id actually matches its connection's real product_id —
-- only application code (repo-inspect.ts passing the same productId used to
-- fetch the connection) enforced that. Postgres requires an independent
-- UNIQUE (or PK) constraint on (id, product_id) to exist on the referenced
-- side before a composite foreign key can reference that pair — `id` being
-- the primary key alone does not satisfy this. repo_snapshots' own migration
-- (20260717140000, NOT yet applied) already declares
-- `foreign key (repo_connection_id, product_id) references
-- repo_connections (id, product_id)` in anticipation of this constraint
-- existing first.
--
-- SAFE TO APPLY: `id` is already the primary key (globally unique on its
-- own), so `unique (id, product_id)` can never conflict with existing data —
-- it is strictly implied by the existing PK. This ALTER is a pure guarantee-
-- strengthening addition, not a behavior change for any existing row.
--
-- ORDERING: apply after 20260717120000/20260717120100 (already applied) and
-- BEFORE 20260717140000/20260717140100 (repo_snapshots — still pending,
-- requires this constraint to exist first or its composite FK will fail to
-- create).

alter table repo_connections
  add constraint repo_connections_id_product_id_key unique (id, product_id);

comment on constraint repo_connections_id_product_id_key on repo_connections is
  'Enables a composite FK from repo_snapshots (product_id, repo_connection_id) so a '
  'snapshot''s product_id is guaranteed by Postgres to match its connection''s real '
  'product_id — not just by application code. Strictly implied by the existing primary '
  'key; adds a guarantee, changes no existing data.';

-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   select conname from pg_constraint
--     where conrelid = 'repo_connections'::regclass
--       and conname = 'repo_connections_id_product_id_key';
--   -- expect exactly 1 row
