import "server-only";

// System-health checks against the THREE existing `/health`-style endpoints
// named in T-59's scope — ops-hub, LiteLLM, FreeScout — no new health
// endpoints are invented here. ops-hub's own /health/litellm already proxies
// the LiteLLM reachability check (src/healthLitellm.ts), so this dashboard
// reuses that instead of needing the internal Docker LiteLLM URL.
//
// URLs default to the staging FQDNs published in CLAUDE.md (public hostnames,
// not secrets) and are overridable per-environment via env vars so the same
// build works against prod without a code change.

export type ServiceHealth = {
  name: string;
  status: "ok" | "degraded" | "unknown";
  detail: string;
  checkedAt: string;
};

async function probe(name: string, url: string | undefined, timeoutMs = 5000): Promise<ServiceHealth> {
  const checkedAt = new Date().toISOString();
  if (!url) {
    return { name, status: "unknown", detail: "no health-check URL configured", checkedAt };
  }
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const ms = Date.now() - start;
    // Any HTTP response (even 401/404) means the service is reachable — only
    // a network-level failure (timeout, DNS, connection refused) means it's
    // actually down. Mirrors src/healthLitellm.ts's own reasoning.
    return { name, status: "ok", detail: `HTTP ${res.status} · ${ms}ms`, checkedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, status: "degraded", detail: `unreachable — ${message.slice(0, 60)}`, checkedAt };
  }
}

export async function getSystemHealth(): Promise<ServiceHealth[]> {
  const opsHubUrl = process.env.OPS_HUB_HEALTH_URL ?? "https://ops-hub-staging.inatechshell.ca/health";
  const litellmUrl =
    process.env.LITELLM_HEALTH_URL ?? "https://ops-hub-staging.inatechshell.ca/health/litellm";
  const freescoutUrl = process.env.FREESCOUT_HEALTH_URL ?? "https://freescout-staging.inatechshell.ca/";

  const [opsHub, litellm, freescout] = await Promise.all([
    probe("ops-hub", opsHubUrl),
    probe("LiteLLM", litellmUrl),
    probe("FreeScout", freescoutUrl),
  ]);
  return [opsHub, litellm, freescout];
}
