-- Migration: 20260718120000_s3_findings_composite_unique
-- Ops Hub product-domain reboot — Sprint S3: composite unique constraint on findings
-- Author: Tech Lead  Date: 2026-07-18
-- Forward-only, additive only. Does not touch any existing row's data.
--
-- WHY: S3's fix_attempts table (companion migration 20260718120100) needs a
-- composite FK to findings(product_id, id) — the same "guarantee at the
-- database level, not just in application code, that a child row's
-- product_id matches its parent's real product_id" pattern already applied
-- to repo_connections (20260717150000) and signal_sources (20260717160000).
-- Postgres requires an independent UNIQUE (or PK) constraint on (id,
-- product_id) — or (product_id, id) — to exist on the referenced side before
-- a composite FK can reference that pair; `id` being the primary key alone
-- does not satisfy this.
--
-- SAFE TO APPLY: `id` is already the primary key (globally unique on its
-- own), so `unique (product_id, id)` can never conflict with existing data —
-- it is strictly implied by the existing PK. Pure guarantee-strengthening
-- addition, changes no existing row.
--
-- ORDERING: apply after all S1/S2 migrations (findings must already exist).
-- Must apply BEFORE 20260718120100 (fix_attempts references this constraint).

alter table findings
  add constraint findings_product_id_id_key unique (product_id, id);

comment on constraint findings_product_id_id_key on findings is
  'Enables a composite FK from fix_attempts (product_id, finding_id) so a fix attempt''s '
  'product_id is guaranteed by Postgres to match its finding''s real product_id — not just '
  'by application code. Strictly implied by the existing primary key; adds a guarantee, '
  'changes no existing data.';

-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   select conname from pg_constraint
--     where conrelid = 'findings'::regclass
--       and conname = 'findings_product_id_id_key';
--   -- expect exactly 1 row
