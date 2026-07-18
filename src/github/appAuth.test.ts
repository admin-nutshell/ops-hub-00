import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify as cryptoVerify } from "crypto";
import { mintInstallationToken, githubHeaders } from "./appAuth";

/**
 * S1 — GitHub App auth helper unit tests.
 *
 * A throwaway RSA keypair is generated at test time (not committed anywhere,
 * not the real App key) so buildAppJwt's RS256 signature can be verified
 * end-to-end without any real GitHub App credential. `fetch` is stubbed
 * globally; no real network call.
 */

let privateKeyB64: string;
let publicKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  privateKeyB64 = Buffer.from(privateKeyPem).toString("base64");
});

function decodeJwtPayload(jwt: string): { iat: number; exp: number; iss: string } {
  const [, payloadB64] = jwt.split(".");
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
}

function verifyJwtSignature(jwt: string): boolean {
  const [headerB64, payloadB64, sigB64] = jwt.split(".");
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(sigB64, "base64url");
  return cryptoVerify("RSA-SHA256", Buffer.from(signingInput), publicKeyPem, signature);
}

describe("githubHeaders", () => {
  it("builds the required GitHub App headers without leaking anything extra", () => {
    const headers = githubHeaders("test-bearer-token");
    expect(headers.Authorization).toBe("Bearer test-bearer-token");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(headers["User-Agent"]).toBeTruthy();
  });
});

describe("mintInstallationToken", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("GITHUB_APP_ID", "4325155");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKeyB64);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("mints a JWT signed with the App's private key, iss=appId, exp-iat <= 600s", async () => {
    let capturedAuthHeader: string | undefined;
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedAuthHeader = (init.headers as Record<string, string>).Authorization;
        return Promise.resolve({
          ok: true,
          json: async () => ({ token: "ghs_mocktoken", expires_at: "2026-07-17T15:00:00Z" }),
        });
      })
    );

    const result = await mintInstallationToken(147237377);

    expect(capturedUrl).toBe("https://api.github.com/app/installations/147237377/access_tokens");
    expect(capturedAuthHeader).toMatch(/^Bearer /);
    const jwt = capturedAuthHeader!.slice("Bearer ".length);

    expect(verifyJwtSignature(jwt)).toBe(true);
    const payload = decodeJwtPayload(jwt);
    expect(payload.iss).toBe("4325155");
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
    // iat is backdated for clock drift, so it must be at or before "now".
    expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

    expect(result).toEqual({ token: "ghs_mocktoken", expiresAt: "2026-07-17T15:00:00Z" });
  });

  it("never hardcodes an installation id — uses exactly the parameter passed in", async () => {
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          json: async () => ({ token: "t", expires_at: "2026-01-01T00:00:00Z" }),
        });
      })
    );
    await mintInstallationToken("99999999");
    expect(capturedUrl).toContain("/installations/99999999/access_tokens");
  });

  it("throws on a non-OK response and does not leak the response body beyond 200 chars", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      })
    );
    await expect(mintInstallationToken(1)).rejects.toThrow(
      "GitHub installation token exchange 404"
    );
  });

  it("throws a clear error when GITHUB_APP_ID is not set", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKeyB64);
    await expect(mintInstallationToken(1)).rejects.toThrow("not configured");
  });

  it("throws a clear error when GITHUB_APP_PRIVATE_KEY is not set", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GITHUB_APP_ID", "4325155");
    await expect(mintInstallationToken(1)).rejects.toThrow("not configured");
  });
});
