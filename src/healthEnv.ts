import http from "http";

/**
 * Env vars required for ops-hub-staging / ops-hub-prod to function correctly,
 * per T-47/T-51's exit criteria (Sprint 5 §3/§4.1, WORK.md). This is the set
 * whose silent drift caused the T-47 incident: 9 vars vanished from
 * ops-hub-prod's Coolify config two days after being recorded as "done," and
 * were only caught because a live production test (T-51) happened to run.
 *
 * T-63 (Sprint 6) builds this endpoint so that drift is caught by monitoring
 * instead of by luck.
 *
 * Presence-only check by design: this only confirms a key exists in
 * `process.env` for THIS process. It cannot and does not validate the value
 * (e.g. a stale or wrong key still counts as "present") — same limitation as
 * any other black-box liveness check. It also cannot check another
 * environment's Coolify config; each deployed instance can only see its own
 * env, which is what actually failed in the T-47 incident.
 *
 * Scope note (intentionally NOT included, see WORK.md T-63):
 * - `POLLING_ENABLED` — a T-54 var, outside the T-47/T-51 set this task
 *   scopes to. It also isn't a simple presence check: it must be `true` on
 *   prod but is correctly ABSENT on staging (fail-closed default), so a
 *   uniform "present" check would be wrong on staging and a uniform "true"
 *   check would need per-environment branching this list intentionally
 *   avoids (one list, same names, every environment).
 * - `INNGEST_APP_ID` — staging-only (T-54); same reasoning.
 * - `FREESCOUT_DB_URL` / `FREESCOUT_BOT_USER_ID` (T-50) and
 *   `AGENT_COST_SYNC_ENABLED` (T-58) — real vars, but outside this task's
 *   explicit T-47/T-51 scope. Add them here if T-63's scope is ever
 *   expanded; the list below is otherwise a single source of truth.
 */
export const REQUIRED_ENV_VARS = [
  "OPS_HUB_APP_LOGIN_URL",
  "POLLING_PROJECT_ID",
  "POLLING_TENANT_ID",
  "LITELLM_TRIAGE_MODEL",
  "LITELLM_FALLBACK_MODEL",
  "LITELLM_URL",
  "LITELLM_MASTER_KEY",
  "LITELLM_EXTERNAL_URL",
  "INNGEST_SIGNING_KEY",
  "INNGEST_EVENT_KEY",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "SENTRY_DSN",
  "NVIDIA_API_KEY",
] as const;

/**
 * Optional env vars — reported for visibility (drift detection) but their
 * ABSENCE does NOT degrade /health/env. These are the T-73 per-function model
 * routing defaults (`LITELLM_RESPOND_MODEL`, `LITELLM_KBLEARN_MODEL`).
 *
 * They are deliberately NOT in REQUIRED_ENV_VARS: `resolveModelRouting`
 * (src/inngest/modelRouting.ts) falls through to the registered alias literal
 * when they are unset, so the app boots and processes tickets correctly without
 * them — unlike the mandatory set above, whose absence is a real outage. They
 * stay unset until T-81 provisions them on ops-hub-staging then -prod; reporting
 * them here lets that rollout be verified from the health endpoint without
 * making the endpoint 503 during the window before they are set.
 *
 * NOTE for Production Manager (T-81): once these are provisioned everywhere and
 * expected-present, promote them into REQUIRED_ENV_VARS so their later drift is
 * caught as a hard failure (same reasoning as the T-47 incident this file
 * exists for).
 */
export const OPTIONAL_ENV_VARS = ["LITELLM_RESPOND_MODEL", "LITELLM_KBLEARN_MODEL"] as const;

/**
 * GET/HEAD /health/env — reports which of REQUIRED_ENV_VARS are present vs
 * missing on the running process. Returns 200 when all are present, 503 when
 * any are missing (mirrors handleLitellmHealth's ok/degraded convention so
 * UptimeRobot's "alert on non-200" rule works unchanged).
 *
 * Security: only KEY NAMES are ever read for presence and returned — the
 * actual value of any env var is never accessed beyond an emptiness check,
 * never logged, and never included in the response body. Key names are not
 * secrets (they already appear in WORK.md/DECISIONS.md/provisioning
 * scripts) — see docs/deploys entry for T-63 for the explicit call on why
 * naming the missing keys in the body is safe and intentional.
 */
export async function handleEnvHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const isMissing = (key: string): boolean => {
    const value = process.env[key];
    return value === undefined || value === "";
  };

  const missing = REQUIRED_ENV_VARS.filter(isMissing);

  // Optional vars are reported for visibility only — their absence never changes
  // status/HTTP code (see OPTIONAL_ENV_VARS). Status is driven solely by the
  // required set, preserving /health/env's existing 200/503 contract.
  const optionalMissing = OPTIONAL_ENV_VARS.filter(isMissing);

  const body = {
    status: missing.length === 0 ? "ok" : "degraded",
    checked: REQUIRED_ENV_VARS.length,
    missing,
    optionalMissing,
  };

  res.writeHead(missing.length === 0 ? 200 : 503, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
