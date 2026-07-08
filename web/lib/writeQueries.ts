import "server-only";
import type { Pool } from "pg";
// Cross-package import, same convention as web/lib/queries.ts (T-59): all
// write SQL and all payload validation lives in src/, never here. This file
// only binds the shared write functions to a request's origin headers +
// server-pinned scope, and re-exports the error type routes need for status
// mapping — route.ts files should import ONLY from this module, never reach
// across the package boundary themselves.
import { createLazyPool } from "../../src/inngest/utils";
import {
  isTrustedOrigin,
  parseAllowedOrigins,
  resolveWriteScope,
  type OriginCheckInput,
} from "../../src/http/dashboardWriteGuards";
import {
  updateSlaConfig,
  validateSlaPatch,
  upsertModelRouting,
  validateModelRoutingInput,
  toggleFeatureFlag,
  validateFeatureFlagInput,
  SettingsWriteError,
  ValidationError,
} from "../../src/metrics/settingsWrite";

export { SettingsWriteError, ValidationError };

const _pool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
function pool(): Pool {
  return _pool.get();
}

// CSRF/Origin defense — 403 as a SettingsWriteError so route handlers use one
// error-mapping code path for every failure mode (origin, scope, validation,
// not-found, schema-not-ready all funnel through SettingsWriteError).
class OriginRejectedError extends SettingsWriteError {
  constructor() {
    super("request origin is not trusted", 403);
    this.name = "OriginRejectedError";
  }
}

class ScopeUnavailableError extends SettingsWriteError {
  constructor() {
    super(
      "dashboard write scope is not configured (POLLING_PROJECT_ID / POLLING_TENANT_ID unset)",
      503
    );
    this.name = "ScopeUnavailableError";
  }
}

export type RequestOriginInfo = Pick<OriginCheckInput, "originHeader" | "refererHeader" | "requestHost">;

function assertTrustedOrigin(origin: RequestOriginInfo): void {
  const allowed = isTrustedOrigin({
    ...origin,
    allowedOrigins: parseAllowedOrigins(process.env.DASHBOARD_ALLOWED_ORIGINS),
  });
  if (!allowed) {
    throw new OriginRejectedError();
  }
}

function requireScope() {
  const scope = resolveWriteScope();
  if (!scope) {
    throw new ScopeUnavailableError();
  }
  return scope;
}

export async function writeSlaConfig(rawPayload: unknown, origin: RequestOriginInfo) {
  assertTrustedOrigin(origin);
  const scope = requireScope();
  const patch = validateSlaPatch(rawPayload);
  return updateSlaConfig(pool(), scope, patch);
}

export async function writeModelRouting(rawPayload: unknown, origin: RequestOriginInfo) {
  assertTrustedOrigin(origin);
  const scope = requireScope();
  const input = validateModelRoutingInput(rawPayload);
  return upsertModelRouting(pool(), { projectId: scope.projectId }, input);
}

export async function writeFeatureFlagToggle(rawPayload: unknown, origin: RequestOriginInfo) {
  assertTrustedOrigin(origin);
  const scope = requireScope();
  const input = validateFeatureFlagInput(rawPayload);
  return toggleFeatureFlag(pool(), { projectId: scope.projectId }, input);
}
