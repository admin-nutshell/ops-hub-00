-- Migration: 20260627000000_t27_dnc_onboarding
-- T-27: DNC (Daily Needs Canada) project onboarding — M1 criterion #12 (Sprint 2)
-- Author: Tech Lead  Date: 2026-06-27
-- Forward-only. Requires all prior migrations applied (initial_schema, rls, kb_seed,
--   t21_freescout_intake, t22_ticket_triage_columns, t23_responded_state).
-- Run via Supabase SQL Editor as service_role (same pattern as T-11 runbook).
--
-- Purpose: seed TTS as a proper project and DNC as its first real tenant.
-- The existing 'ops-hub' project (00…0001) and 'staging-support' tenant (00…0010)
-- remain for dev/placeholder use. TTS + DNC use new UUIDs and are the production records.

-- ---------------------------------------------------------------------------
-- TTS — Ticket Triage System (first ITS product on ops-hub)
-- ---------------------------------------------------------------------------
-- project_id 00000000-0000-0000-0000-000000000002 is the canonical TTS staging UUID.
-- Set POLLING_PROJECT_ID=00000000-0000-0000-0000-000000000002 in Coolify ops-hub-app
-- to point the poller at TTS (see FQ-42).
insert into projects (id, name, context_schema)
values (
  '00000000-0000-0000-0000-000000000002',
  'tts',
  '{
    "product": "Ticket Triage System",
    "slug": "tts",
    "description": "ITS customer support ticket intake, AI triage, and auto-response system.",
    "support_email": "support@inatechshell.ca",
    "freescout_url": "https://freescout-staging.inatechshell.ca"
  }'
)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- DNC — Daily Needs Canada (first TTS tenant)
-- ---------------------------------------------------------------------------
-- tenant_id 00000000-0000-0000-0000-000000000020 is the canonical DNC staging UUID.
-- Set POLLING_TENANT_ID=00000000-0000-0000-0000-000000000020 in Coolify ops-hub-app
-- to point the poller at DNC (see FQ-42).
insert into tenants (id, project_id, name, tier, sla_config)
values (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000002',  -- tts project
  'Daily Needs Canada',
  'growth',
  '{
    "response_target_minutes": 60,
    "escalation_threshold": "high",
    "business_hours": "09:00-17:00 ET Mon-Fri",
    "timezone": "America/Toronto",
    "escalation_contact": "support@inatechshell.ca"
  }'
)
on conflict (id) do nothing;
