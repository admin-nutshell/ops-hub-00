-- Migration: 20260628000000_t39_sla_tier
-- Sprint 4 / T-39: Premium SLA tier
-- Adds sla_tier column to tenants — orthogonal to the billing tier column.
-- Applied via Supabase SQL Editor (not tracked by Supabase CLI).
-- See docs/governance/premium-sla-tier.md for threshold definitions.

ALTER TABLE tenants
  ADD COLUMN sla_tier text NOT NULL DEFAULT 'standard'
    CHECK (sla_tier IN ('standard', 'premium'));

COMMENT ON COLUMN tenants.sla_tier IS
  'SLA add-on tier. standard = sla_config response_target_minutes (flat); '
  'premium = per-urgency targets (critical 30 min / high 60 / normal 240 / low 480). '
  'Independent of the billing tier column.';
