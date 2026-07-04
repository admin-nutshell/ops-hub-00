-- Migration: 20260704000000_fix_kb_articles_write_policy
-- Fix: kb_articles is missing its write policy in production/staging.
-- Author: Tech Lead  Date: 2026-07-04
-- Forward-only. Requires 20260618120100_enable_rls_policies.sql applied first.
--
-- WHY: 20260618120100_enable_rls_policies.sql already defines both
-- kb_articles_select AND kb_articles_write, and both were reviewed/signed off
-- as part of that migration (see docs/engineering/t11-migration-runbook.md).
-- Only kb_articles_select was found live on the database — kb_articles_write
-- was apparently missed when that migration was applied by hand. With RLS
-- enabled and no write policy, every INSERT from ops_hub_app fails closed
-- with "new row violates row-level security policy for table kb_articles"
-- (confirmed live: kb-learn's 2 historical runs, 100% failure).
--
-- This migration only re-applies the policy that should already exist — no
-- new design, no new review needed. Idempotent (drop-if-exists then create).
-- Run via Supabase SQL Editor as service_role, same as other schema changes
-- (see docs/engineering/t11-migration-runbook.md — agents never hold
-- service_role at runtime, this is a founder-run migration).

drop policy if exists kb_articles_write on kb_articles;

create policy kb_articles_write on kb_articles
  for all to ops_hub_app
  using (project_id = current_project_id())
  with check (project_id = current_project_id());
