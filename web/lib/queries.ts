import "server-only";
import type { Pool } from "pg";
// Intentional cross-package import: the dashboard has NO query logic of its
// own. Every SQL statement this app runs lives in src/metrics/ (the same
// package agentCost.ts / evalHealth.ts / T-58 live in), so there is exactly
// one place for T-60 to audit RLS/tenant scoping.
import { createLazyPool } from "../../src/inngest/utils";
import { getDailyCostForTenant, getTotalCostForTenant } from "../../src/metrics/agentCost";
import { getEvalHealth } from "../../src/metrics/evalHealth";
import {
  getOpenTicketCounts,
  getSlaAttainment,
  getDeflectionRate,
  getPipelineStageCounts,
  getTicketQueue,
  getPlatformIncidents,
  getScopeLabel,
  getModelRoutingOverrides,
  getCurrentSlaConfig,
  getFeatureFlags,
} from "../../src/metrics/dashboard";
import { getRepoSnapshotView } from "../../src/metrics/repoInspect";
import { getVulnFindingsView } from "../../src/metrics/vulnDetect";
import { DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID, DASHBOARD_PRODUCT_ID } from "./project";

// Same connection convention as every Inngest function in this codebase:
// createLazyPool(envVar) — lazily constructs a `pg` Pool the first time it's
// used, reading the connection string from OPS_HUB_APP_LOGIN_URL. That DSN
// authenticates as `ops_hub_app` (non-superuser, RLS-bound) — never
// service_role. See CLAUDE.md non-negotiable #3.
const _pool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
function pool(): Pool {
  return _pool.get();
}

// Thin, single-project/single-tenant bound wrappers. No SQL here — just
// binding the shared query functions to this dashboard's configured scope
// (DASHBOARD_PROJECT_ID / DASHBOARD_TENANT_ID) so page/components stay
// simple. If this dashboard ever needs to serve more than one tenant, this
// is the one file that changes — not the SQL.
export const loadOpenTicketCounts = () =>
  getOpenTicketCounts(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID);

export const loadSlaAttainment = (windowDays = 30) =>
  getSlaAttainment(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID, windowDays);

export const loadDeflectionRate = (windowDays = 30) =>
  getDeflectionRate(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID, windowDays);

export const loadPipelineStageCounts = () =>
  getPipelineStageCounts(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID);

export const loadTicketQueue = (limit = 50) =>
  getTicketQueue(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID, limit);

export const loadPlatformIncidents = (limit = 20) =>
  getPlatformIncidents(pool(), DASHBOARD_PROJECT_ID, limit);

export const loadAgentCostTotal = (windowDays = 30) =>
  getTotalCostForTenant(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID, windowDays);

export const loadAgentCostDaily = (windowDays = 30) =>
  getDailyCostForTenant(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID, windowDays);

export const loadEvalHealth = () => getEvalHealth(pool());

export const loadScopeLabel = () =>
  getScopeLabel(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID);

// T-75 — settings-area reads (ADR-0006). Writes do NOT go through this file;
// they go through web/lib/writeQueries.ts (T-74), which resolves its own
// server-pinned scope independently (see dashboardWriteGuards.ts — deliberately
// NOT these same DASHBOARD_PROJECT_ID/DASHBOARD_TENANT_ID convenience
// constants, which fall back to placeholder UUIDs; a write must fail closed
// instead of guessing a scope).
export const loadModelRoutingOverrides = () => getModelRoutingOverrides(pool(), DASHBOARD_PROJECT_ID);

export const loadCurrentSlaConfig = () =>
  getCurrentSlaConfig(pool(), DASHBOARD_PROJECT_ID, DASHBOARD_TENANT_ID);

export const loadFeatureFlags = () => getFeatureFlags(pool(), DASHBOARD_PROJECT_ID);

// Product-domain reboot (S1) — repo-inspection panel read. Bound to
// DASHBOARD_PRODUCT_ID (a separate axis from DASHBOARD_PROJECT_ID/
// DASHBOARD_TENANT_ID above; see web/lib/project.ts's doc comment).
export const loadRepoSnapshotView = () => getRepoSnapshotView(pool(), DASHBOARD_PRODUCT_ID);

// Product-domain reboot (S2) — vulnerability findings panel read. Same
// DASHBOARD_PRODUCT_ID axis as loadRepoSnapshotView above.
export const loadVulnFindingsView = () => getVulnFindingsView(pool(), DASHBOARD_PRODUCT_ID);
