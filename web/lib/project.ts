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
