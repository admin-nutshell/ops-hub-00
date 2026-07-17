// Single-project/single-tenant scope for this dashboard, deliberately NOT a
// project/tenant switcher. Mirrors the exact default convention already used
// by src/inngest/freescout-poller.ts (STAGING_PROJECT_ID / STAGING_TENANT_ID):
// same env vars, same fallback UUIDs, so staging vs. prod picks the right
// scope purely from Coolify env config, with zero code branching.
//
// projects_select RLS is fail-closed (`id = current_project_id()`), so even
// if a second tenant/project existed, this dashboard would still only ever
// be able to read the one it's configured for — there is no "enumerate all
// projects" code path here to accidentally build wrong.
export const DASHBOARD_PROJECT_ID =
  process.env.POLLING_PROJECT_ID ?? "00000000-0000-0000-0000-000000000001";
export const DASHBOARD_TENANT_ID =
  process.env.POLLING_TENANT_ID ?? "00000000-0000-0000-0000-000000000010";

// Product-domain reboot (S1) — a SEPARATE axis from the project/tenant pair
// above (see src/http/dashboardWriteGuards.ts's resolveProductWriteScope doc
// comment for why these are deliberately not merged). Unlike the
// project/tenant placeholders, this fallback is not a synthetic
// all-zeros UUID — it's the real S1 pilot product id (products.slug='tts'),
// because there genuinely is exactly one product this sprint and
// products_select's RLS (`id = current_product_id()`) requires already
// knowing a product id to read the products table at all — there is no
// "enumerate all products" path an agent-role connection can use instead
// (only service_role can, and no agent ever holds that key). Same
// env-var-with-fallback convention as DASHBOARD_PROJECT_ID/DASHBOARD_TENANT_ID:
// correct for READS. The write path (repo-inspect trigger route) does NOT
// use this constant — see resolveProductWriteScope, which requires
// DASHBOARD_PRODUCT_ID set with no fallback, same fail-closed-on-write
// reasoning as resolveWriteScope.
export const DASHBOARD_PRODUCT_ID =
  process.env.DASHBOARD_PRODUCT_ID ?? "8bafa6a6-4d80-4983-89bc-e536d3dba672";
