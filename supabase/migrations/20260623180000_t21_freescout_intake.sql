-- Migration: 20260623180000_t21_freescout_intake
-- T-21 FreeScout → Supabase direct polling support (Sprint 2)
-- Author: Tech Lead  Date: 2026-06-23
-- Forward-only. Requires 20260618120000 + 20260618120100 + 20260621130000 applied first.
-- Run via Supabase SQL Editor as service_role (same pattern as T-11 runbook).
-- See DECISIONS.md 2026-06-23 for the Supabase-polling design decision.

-- ---------------------------------------------------------------------------
-- Extend tickets for FreeScout intake dedup
-- ---------------------------------------------------------------------------
-- Nullable: only set on FreeScout-sourced tickets.
-- bigint: matches FreeScout's conversations.id (bigserial in PostgreSQL / bigint unsigned in Laravel).
-- UNIQUE: INSERT ... ON CONFLICT (freescout_conversation_id) DO NOTHING is the dedup guard.
alter table tickets add column freescout_conversation_id bigint unique;

-- ---------------------------------------------------------------------------
-- Staging support tenant (dev/staging only)
-- ---------------------------------------------------------------------------
-- Fixed UUID so the Inngest cron function can hard-code it for staging.
-- Production: per-conversation tenant routing is a future sprint concern.
-- The ops-hub project (00…0001) is seeded in 20260621130000_kb_seed.sql.
insert into tenants (id, project_id, name, tier)
values (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'staging-support',
  'starter'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Grant SELECT on FreeScout's tables to the app role
-- ---------------------------------------------------------------------------
-- FreeScout creates its tables as freescout_user (not postgres), so the
-- ALTER DEFAULT PRIVILEGES in the initial RLS migration does not cover them.
-- These GRANTs must be explicit.
-- Table names confirmed against FreeScout v1.x Laravel migrations
-- (nfrastack/freescout:latest, public schema on the same Supabase instance).
grant select on conversations to ops_hub_app;
grant select on threads      to ops_hub_app;
grant select on customers    to ops_hub_app;
grant select on mailboxes    to ops_hub_app;
