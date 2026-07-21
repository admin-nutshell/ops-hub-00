-- Migration: 20260718170100_s3_agent_routing_rls_policies
-- Ops Hub product-domain reboot — Sprint S3: product-scoped RLS for agent_routing
-- Author: Tech Lead  Date: 2026-07-18
-- *** SECURITY LEAD REVIEW REQUIRED (matches every prior S1/S2/S3 precedent) ***
-- Forward-only. Companion to 20260718170000_s3_agent_routing_schema.sql.
-- Requires that migration applied first.
--
-- Same enforcement model as every prior product-scoped table: fail-closed
-- `using (product_id = current_product_id())`, non-superuser `ops_hub_app`
-- role, transaction-local pooler-safe GUC.
--
-- WRITE-SURFACE DECISION: ops_hub_app only — no direct `authenticated` path.
-- (Contrast with agent_model_routing's amr_select, which also grants
-- `authenticated`; that reflects the OLDER ticket-domain convention. Every
-- reboot table so far — findings, autonomy_policies, signal_sources,
-- fix_attempts, pull_requests — uses the ops_hub_app-only convention, so
-- agent_routing follows the NEWER, current convention for this domain.)
--
-- NO DELETE POLICY (combined with REVOKE DELETE below): a routing row is
-- edited, not deleted — same as agent_model_routing and every reboot
-- config-like table.

alter table agent_routing enable row level security;

grant select, insert, update on agent_routing to ops_hub_app;
revoke delete on agent_routing from ops_hub_app;

create policy agent_routing_select on agent_routing
  for select to ops_hub_app
  using (product_id = current_product_id());

create policy agent_routing_insert on agent_routing
  for insert to ops_hub_app
  with check (product_id = current_product_id());

create policy agent_routing_update on agent_routing
  for update to ops_hub_app
  using (product_id = current_product_id())
  with check (product_id = current_product_id());

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   select relrowsecurity from pg_class where relname = 'agent_routing';  -- true
--   select polname from pg_policy where polrelid = 'agent_routing'::regclass
--     order by 1;  -- agent_routing_select/insert/update
--   select privilege_type from information_schema.role_table_grants
--     where table_name = 'agent_routing' and grantee = 'ops_hub_app'
--       and privilege_type = 'DELETE';  -- must return 0 rows
-- ===========================================================================
