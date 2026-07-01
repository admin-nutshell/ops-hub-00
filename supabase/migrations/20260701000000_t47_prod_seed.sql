-- Migration: 20260701000000_t47_prod_seed
-- T-47: Seed production project and tenant rows for TTS go-live (Sprint 5)
-- Author: Tech Lead  Date: 2026-07-01
-- Forward-only. Requires all prior migrations applied (through 20260628000000_t39_sla_tier).
-- Run via Supabase SQL Editor as service_role (same pattern as prior seed migrations).
-- Architecture decision: ADR-0005 — separate RLS tenant scope in same Supabase project.
--
-- After applying:
--   Set POLLING_PROJECT_ID=00000000-0000-0000-0000-000000000003 in ops-hub-prod Coolify
--   Set POLLING_TENANT_ID=00000000-0000-0000-0000-000000000030 in ops-hub-prod Coolify

-- ---------------------------------------------------------------------------
-- TTS Prod — production project row
-- ---------------------------------------------------------------------------
-- project_id 00000000-0000-0000-0000-000000000003 is the canonical TTS prod UUID.
-- Name is 'tts-prod' (not 'tts') because projects.name is unique and staging uses 'tts'.
-- freescout_url placeholder — update to prod FreeScout URL when T-50 is complete.
insert into projects (id, name, context_schema)
values (
  '00000000-0000-0000-0000-000000000003',
  'tts-prod',
  '{
    "product": "Ticket Triage System",
    "slug": "tts-prod",
    "description": "ITS customer support ticket intake, AI triage, and auto-response system — PRODUCTION.",
    "support_email": "support@inatechshell.ca",
    "freescout_url": "https://freescout-staging.inatechshell.ca"
  }'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- DNC Prod — Daily Needs Canada production tenant
-- ---------------------------------------------------------------------------
-- tenant_id 00000000-0000-0000-0000-000000000030 is the canonical DNC prod UUID.
-- sla_tier defaults to 'standard' (added by T-39 migration).
insert into tenants (id, project_id, name, tier, sla_tier, sla_config)
values (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000003',  -- tts-prod project
  'Daily Needs Canada',
  'growth',
  'standard',
  '{
    "response_target_minutes": 60,
    "escalation_threshold": "high",
    "business_hours": "09:00-17:00 ET Mon-Fri",
    "timezone": "America/Toronto",
    "escalation_contact": "support@inatechshell.ca"
  }'
)
on conflict (id) do nothing;
