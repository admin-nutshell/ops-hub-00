-- Migration: 20260718120000_s3_findings_composite_unique_constraint
-- Ops Hub product-domain reboot — Sprint S3: composite unique constraint on findings (step 2/2)
-- Author: Tech Lead  Date: 2026-07-18
-- Forward-only, additive only. Does not touch any existing row's data.
--
-- Step 2/2 — companion to 20260718115900 (which builds the backing index
-- CONCURRENTLY, outside a transaction, in its own execution). Requires that
-- migration applied first.
--
-- ADD CONSTRAINT ... UNIQUE USING INDEX attaches to the already-built index
-- instead of building a new one — this takes only a brief ACCESS EXCLUSIVE
-- lock to update the catalog (near-instant), not one held for an index
-- build's full duration. Safe to run as a normal, transaction-wrapped
-- migration like every other file in this repo.
--
-- ORDERING: apply after 20260718115900. Must apply BEFORE 20260718120100
-- (fix_attempts' composite FK references this constraint).

alter table findings
  add constraint findings_product_id_id_key unique using index findings_product_id_id_idx;

comment on constraint findings_product_id_id_key on findings is
  'Enables a composite FK from fix_attempts (product_id, finding_id) so a fix attempt''s '
  'product_id is guaranteed by Postgres to match its finding''s real product_id — not just '
  'by application code. Backed by findings_product_id_id_idx, built CONCURRENTLY in '
  '20260718115900 to avoid an ACCESS EXCLUSIVE lock on this live table. Strictly implied by '
  'the existing primary key; adds a guarantee, changes no existing data.';

-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   select conname from pg_constraint
--     where conrelid = 'findings'::regclass
--       and conname = 'findings_product_id_id_key';
--   -- expect exactly 1 row
