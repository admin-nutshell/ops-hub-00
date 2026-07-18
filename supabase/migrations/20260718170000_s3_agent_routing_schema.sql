-- Migration: 20260718170000_s3_agent_routing_schema
-- Ops Hub product-domain reboot — Sprint S3: model-per-agent routing (product-scoped)
-- Author: Tech Lead  Date: 2026-07-18
-- Forward-only, additive only. Does not touch tickets/tenants/projects/
-- agent_model_routing or any existing table's data.
--
-- WHY A NEW TABLE, NOT A ROW IN THE EXISTING `agent_model_routing`: that table
-- (T-72, 20260708000000) is scoped by `project_id -> projects(id)` and its RLS
-- gates on `current_project_id()` — the OLD ticket-domain axis. A reboot
-- product (a `products` row, e.g. the pilot `web-app-tns-06`) has no
-- corresponding `projects` row, so a `fix_author` entry could never carry a
-- valid `project_id`. Every reboot table is product-scoped via
-- `current_product_id()` (see the S1/S2 precedent) — this one is no
-- exception. The reboot plan's own "KEEP-AND-ADAPT" note for
-- resolveModelRouting()/agent_model_routing/model-allowlist.ts means: reuse
-- the RESOLVER PATTERN (precedence ladder, allowlist gating, fail-closed
-- degrade), adapted to the product axis — not literally write reboot rows
-- into a project-scoped table.
--
-- fix_author is the FIRST reboot agent role to route a model (S2's
-- detect-vulnerabilities.ts calls no LLM at all — it only reads GitHub's own
-- alert APIs). agent_role is intentionally scoped to just 'fix_author' for
-- now (S3 is the only agent that routes a model so far) — widen the check
-- constraint in a follow-up migration when detection/security/review
-- actually start routing models (S7+), same discipline signal_sources used
-- for its `kind` column (don't pre-guess the taxonomy further than what
-- ships this sprint).
--
-- RLS policies land in the companion migration
-- 20260718170100_s3_agent_routing_rls_policies.sql, reviewed together
-- (*** SECURITY LEAD REVIEW REQUIRED *** — same precedent as every prior
-- S1/S2/S3 schema+RLS pair).

create table agent_routing (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  agent_role     text not null check (agent_role in ('fix_author')),
  primary_model  text not null,                 -- registered LiteLLM alias string (never a raw provider id)
  fallback_model text,                          -- nullable; no reboot agent role uses a fallback slot yet
  updated_at     timestamptz not null default now(),
  updated_by     text,                          -- audit convenience; authoritative record is audit_log
  unique (product_id, agent_role)
);

create trigger agent_routing_set_updated_at
  before update on agent_routing
  for each row execute function set_updated_at();

comment on table agent_routing is
  'Per-agent-role LiteLLM alias selection (product-scoped analogue of agent_model_routing, '
  'which stays project-scoped for the ticket domain — see file header for why this is a '
  'separate table, not a row in that one). Values are LiteLLM alias strings only. '
  'Dashboard-editable override; backend falls back to a per-role env default then the '
  'alias literal (same precedence ladder as resolveModelRouting, T-73).';

-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   select relname from pg_class where relname = 'agent_routing';
