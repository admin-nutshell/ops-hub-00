// src/http/dashboardWriteGuards.ts
//
// T-74 — cross-cutting guards for the Ops Dashboard's settings write routes
// (ADR-0006 Decision B "Other write-layer controls"). Deliberately pure,
// framework-agnostic functions (no Next.js types, no DB access) so they live
// under root vitest and are unit-testable — `web/` has no test runner of its
// own (T-59's centralization discipline extends to this: `web/app/api/**`
// route handlers stay thin adapters that call into `src/`, same as
// `web/lib/queries.ts` holds zero SQL).
//
// Two independent guards, both fail-closed:
//   1. isTrustedOrigin  — CSRF/Origin defense (Security Lead review, ADR-0006
//      §"Other write-layer controls": Basic Auth is auto-attached by the
//      browser to same-origin requests, so a state-changing route needs its
//      own defense independent of the auth perimeter).
//   2. resolveWriteScope — server-pinned project/tenant scope, read from raw
//      env (POLLING_PROJECT_ID / POLLING_TENANT_ID — the same vars T-68
//      already sets per environment). Returns null (not a guessed default)
//      when either is unset, so a write never lands unscoped.

// ---------------------------------------------------------------------------
// Guard 1 — CSRF / Origin defense
// ---------------------------------------------------------------------------

/**
 * Parse the `DASHBOARD_ALLOWED_ORIGINS` env var (comma-separated absolute
 * origins, e.g. "https://ops-dashboard-staging.inatechshell.ca,https://ops-dashboard-prod.inatechshell.ca")
 * into a clean list. Empty/unset returns `[]`, which signals the caller to
 * fall back to the same-origin check (see `isTrustedOrigin`) instead of a
 * hardcoded FQDN — staging is still running on a plain-HTTP sslip.io preview
 * pending FQ-63 (the real-TLS-domain founder action), so hardcoding today's
 * staging FQDN here would reject every legitimate staging write. T-81
 * (go-live) is expected to set this var explicitly per environment once real
 * domains are stable; until then the same-origin fallback keeps both
 * environments working with zero code change (app-agnostic by construction —
 * also correct unmodified for Project #2).
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type OriginCheckInput = {
  /** The `Origin` request header, if present. */
  originHeader: string | null;
  /** The `Referer` request header, used only when `Origin` is absent. */
  refererHeader: string | null;
  /** The `Host` header the app itself received (for the same-origin fallback). */
  requestHost: string | null;
  /** Parsed `DASHBOARD_ALLOWED_ORIGINS` (see `parseAllowedOrigins`); `[]` = not configured. */
  allowedOrigins: string[];
};

/**
 * True iff the request's Origin (or, failing that, Referer's origin) is
 * trusted. Fail-closed in every ambiguous case:
 *   - Neither `Origin` nor `Referer` present  → false (could be a non-browser
 *     client hitting the API directly; Basic Auth alone does not defend
 *     against CSRF per the Security Lead review).
 *   - `DASHBOARD_ALLOWED_ORIGINS` configured  → candidate origin must be an
 *     exact member of that list.
 *   - Not configured                          → candidate origin's host must
 *     equal the `Host` header the app itself received (same-origin check;
 *     domain-agnostic, survives the sslip.io → real-TLS-domain migration).
 */
export function isTrustedOrigin(input: OriginCheckInput): boolean {
  const { originHeader, refererHeader, requestHost, allowedOrigins } = input;

  const candidate = originHeader ?? (refererHeader ? safeOrigin(refererHeader) : null);
  if (!candidate) return false;

  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(candidate);
  }

  if (!requestHost) return false;
  try {
    return new URL(candidate).host === requestHost;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Guard 2 — server-pinned write scope (never client-supplied)
// ---------------------------------------------------------------------------

export type WriteScope = { projectId: string; tenantId: string };

// Deliberately the RAW env vars, not `web/lib/project.ts`'s
// DASHBOARD_PROJECT_ID / DASHBOARD_TENANT_ID constants. Those constants fall
// back to fixed placeholder UUIDs when unset — a reasonable default for
// READS (T-59's single-project/single-tenant convention), but WRONG for a
// WRITE: a misconfigured deploy must refuse to write, not silently mutate
// whatever tenant/project the placeholder UUID happens to resolve to. Same
// underlying vars T-68 already sets per environment (POLLING_PROJECT_ID /
// POLLING_TENANT_ID) — no new config surface, just no fallback on this path.
const PROJECT_ENV_VAR = "POLLING_PROJECT_ID";
const TENANT_ENV_VAR = "POLLING_TENANT_ID";

/**
 * Resolve the dashboard's write scope directly from env, with NO fallback
 * default. Returns `null` (fail-closed) if either var is unset or blank —
 * the caller must refuse the write outright, never guess a scope.
 *
 * Requires BOTH vars even for project-only writes (model-routing,
 * feature-flags): this dashboard is deliberately single-project/
 * single-tenant (see `web/lib/project.ts`), so an incomplete pair signals a
 * genuinely misconfigured deploy — safer to block all writes than to accept
 * a project id whose paired tenant config is missing.
 */
export function resolveWriteScope(): WriteScope | null {
  const projectId = process.env[PROJECT_ENV_VAR];
  const tenantId = process.env[TENANT_ENV_VAR];
  if (!projectId || projectId.trim() === "" || !tenantId || tenantId.trim() === "") {
    return null;
  }
  return { projectId, tenantId };
}

// ---------------------------------------------------------------------------
// Guard 2b — server-pinned PRODUCT write scope (product-domain reboot, S1)
// ---------------------------------------------------------------------------
// Same fail-closed shape as resolveWriteScope above, for the new product
// domain (products/repo_connections/repo_snapshots — see
// src/metrics/repoInspect.ts). Deliberately a SEPARATE var/function, not a
// third field bolted onto WriteScope: the product axis and the
// project/tenant axis are two independent domains running side by side
// during the reboot's strangler period (see docs/planning's S1 plan) and
// have no relationship to each other — a route that only needs product scope
// must not be forced to also configure/resolve an unrelated tenant id, and
// vice versa.
const PRODUCT_ENV_VAR = "DASHBOARD_PRODUCT_ID";

export type ProductWriteScope = { productId: string };

/**
 * Resolve the dashboard's PRODUCT write scope directly from env, with NO
 * fallback default — same fail-closed contract as resolveWriteScope. Reads
 * are allowed a placeholder fallback (see web/lib/project.ts's
 * DASHBOARD_PRODUCT_ID, which defaults to the real S1 pilot product id since
 * there is exactly one product this sprint); a write must still refuse to
 * proceed on a misconfigured deploy rather than trust that default.
 */
export function resolveProductWriteScope(): ProductWriteScope | null {
  const productId = process.env[PRODUCT_ENV_VAR];
  if (!productId || productId.trim() === "") {
    return null;
  }
  return { productId };
}
