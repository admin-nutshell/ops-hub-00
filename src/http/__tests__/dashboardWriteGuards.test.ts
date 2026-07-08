import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedOrigin, parseAllowedOrigins, resolveWriteScope } from "../dashboardWriteGuards";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseAllowedOrigins", () => {
  it("returns [] for undefined/blank input", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
    expect(parseAllowedOrigins("   ")).toEqual([]);
  });

  it("splits, trims, and drops empty entries from a comma-separated list", () => {
    expect(parseAllowedOrigins("https://a.example, https://b.example ,, ")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});

describe("isTrustedOrigin", () => {
  it("FAIL-CLOSED — rejects when neither Origin nor Referer is present, even with a matching Host", () => {
    const allowed = isTrustedOrigin({
      originHeader: null,
      refererHeader: null,
      requestHost: "ops-dashboard-staging.inatechshell.ca",
      allowedOrigins: [],
    });
    expect(allowed).toBe(false);
  });

  it("ALLOWLIST — accepts an Origin that is an exact member of DASHBOARD_ALLOWED_ORIGINS", () => {
    const allowed = isTrustedOrigin({
      originHeader: "https://ops-dashboard-prod.inatechshell.ca",
      refererHeader: null,
      requestHost: "ops-dashboard-prod.inatechshell.ca",
      allowedOrigins: [
        "https://ops-dashboard-staging.inatechshell.ca",
        "https://ops-dashboard-prod.inatechshell.ca",
      ],
    });
    expect(allowed).toBe(true);
  });

  it("ALLOWLIST — rejects an Origin not in the configured list, even if Host matches", () => {
    const allowed = isTrustedOrigin({
      originHeader: "https://evil.example",
      refererHeader: null,
      requestHost: "ops-dashboard-prod.inatechshell.ca",
      allowedOrigins: ["https://ops-dashboard-prod.inatechshell.ca"],
    });
    expect(allowed).toBe(false);
  });

  it("SAME-ORIGIN FALLBACK — when no allowlist is configured, accepts an Origin whose host matches the request Host", () => {
    // Models today's staging reality (FQ-63 still open): a plain-HTTP
    // sslip.io preview with no DASHBOARD_ALLOWED_ORIGINS set yet.
    const allowed = isTrustedOrigin({
      originHeader: "http://r14c3p7jzwo4wxyprd4yxyev.187.124.76.235.sslip.io",
      refererHeader: null,
      requestHost: "r14c3p7jzwo4wxyprd4yxyev.187.124.76.235.sslip.io",
      allowedOrigins: [],
    });
    expect(allowed).toBe(true);
  });

  it("SAME-ORIGIN FALLBACK — rejects a cross-origin request when no allowlist is configured", () => {
    const allowed = isTrustedOrigin({
      originHeader: "https://evil.example",
      refererHeader: null,
      requestHost: "ops-dashboard-staging.inatechshell.ca",
      allowedOrigins: [],
    });
    expect(allowed).toBe(false);
  });

  it("SAME-ORIGIN FALLBACK — rejects when Host is missing (cannot establish same-origin)", () => {
    const allowed = isTrustedOrigin({
      originHeader: "https://ops-dashboard-staging.inatechshell.ca",
      refererHeader: null,
      requestHost: null,
      allowedOrigins: [],
    });
    expect(allowed).toBe(false);
  });

  it("REFERER FALLBACK — derives the origin from Referer when Origin is absent", () => {
    const allowed = isTrustedOrigin({
      originHeader: null,
      refererHeader: "https://ops-dashboard-prod.inatechshell.ca/settings?tab=sla",
      requestHost: "ops-dashboard-prod.inatechshell.ca",
      allowedOrigins: [],
    });
    expect(allowed).toBe(true);
  });

  it("rejects a malformed Origin header rather than throwing", () => {
    const allowed = isTrustedOrigin({
      originHeader: "not-a-url",
      refererHeader: null,
      requestHost: "ops-dashboard-staging.inatechshell.ca",
      allowedOrigins: [],
    });
    expect(allowed).toBe(false);
  });
});

describe("resolveWriteScope", () => {
  it("FAIL-CLOSED — returns null when both POLLING_PROJECT_ID and POLLING_TENANT_ID are unset", () => {
    vi.stubEnv("POLLING_PROJECT_ID", "");
    vi.stubEnv("POLLING_TENANT_ID", "");
    expect(resolveWriteScope()).toBeNull();
  });

  it("FAIL-CLOSED — returns null when only the project id is set", () => {
    vi.stubEnv("POLLING_PROJECT_ID", "proj-1");
    vi.stubEnv("POLLING_TENANT_ID", "");
    expect(resolveWriteScope()).toBeNull();
  });

  it("FAIL-CLOSED — returns null when only the tenant id is set", () => {
    vi.stubEnv("POLLING_PROJECT_ID", "");
    vi.stubEnv("POLLING_TENANT_ID", "tenant-1");
    expect(resolveWriteScope()).toBeNull();
  });

  it("does NOT fall back to a placeholder default the way web/lib/project.ts's read-side constants do", () => {
    vi.stubEnv("POLLING_PROJECT_ID", "");
    vi.stubEnv("POLLING_TENANT_ID", "");
    const scope = resolveWriteScope();
    expect(scope).not.toEqual({
      projectId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000010",
    });
    expect(scope).toBeNull();
  });

  it("returns the real scope when both vars are set", () => {
    vi.stubEnv("POLLING_PROJECT_ID", "proj-1");
    vi.stubEnv("POLLING_TENANT_ID", "tenant-1");
    expect(resolveWriteScope()).toEqual({ projectId: "proj-1", tenantId: "tenant-1" });
  });
});
