-- Migration: 20260621130000_kb_seed
-- KB placeholder articles — T-20 / Sprint 1 (Knowledge Lead)
-- Author: Knowledge Lead  Date: 2026-06-21
-- Forward-only. Applies after 20260618120000_initial_schema.sql and
--   20260618120100_enable_rls_policies.sql (projects + kb_articles tables must exist).
-- Run via SQL Editor as Supabase service_role (same pattern as T-11 runbook).
-- See docs/knowledge/kb-structure.md for taxonomy and naming conventions.

-- ---------------------------------------------------------------------------
-- Seed project row (dev/staging only)
-- ---------------------------------------------------------------------------
-- The ops-hub project is seeded with a fixed UUID for dev/staging convenience.
-- This allows the KB articles below to have a deterministic FK without
-- depending on a real project insert. Production uses real UUIDs generated
-- by gen_random_uuid() — never import this seed file into a production database.
--
-- The `on conflict (name) do nothing` guard means:
--   * If no ops-hub row exists yet: row is inserted with the fixed UUID.
--   * If an ops-hub row already exists (e.g. from a prior migration or manual
--     insert): the insert is skipped. If the existing row has a DIFFERENT id
--     the kb_articles inserts below will FK-fail — resolve by checking:
--       select id from projects where name = 'ops-hub';
--     and updating the article inserts accordingly. This situation should not
--     arise on a fresh staging instance.
-- ---------------------------------------------------------------------------
insert into projects (id, name, context_schema)
values (
  '00000000-0000-0000-0000-000000000001',
  'ops-hub',
  '{}'
)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Placeholder KB articles
-- ---------------------------------------------------------------------------
-- embeddings are intentionally null — the Data Engineer pipeline (T-09 follow-up)
-- populates vector(1536) embeddings using text-embedding-ada-002.
-- ANN index (ivfflat/hnsw) is added by the Data Engineer after vectors are
-- populated; an index over null vectors is untrained and useless.
-- ---------------------------------------------------------------------------
insert into kb_articles (project_id, title, body) values
(
  '00000000-0000-0000-0000-000000000001',
  'Ops Hub — Getting Started',
  'Placeholder: overview of the Ops Hub platform, agent roles, and ticket flow. To be expanded in Sprint 2.'
),
(
  '00000000-0000-0000-0000-000000000001',
  'FreeScout → Ops Hub ticket intake runbook',
  'Placeholder: steps for routing a FreeScout ticket through the triage agent. To be expanded after T-19.'
);
