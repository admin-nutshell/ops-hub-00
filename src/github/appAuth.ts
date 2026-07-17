import { createSign } from "crypto";

// GitHub App authentication (S1 of the ops-hub reboot — see
// docs/integrations/github-app-setup-tts-pilot.md for the App itself and
// C:\Users\sac it\.claude\plans\deep-hatching-iverson.md's "Load-bearing
// security separations" for the threat model this module is part of:
// "Token minting + PR creation happen in a separate trusted Inngest step,
// never inside code execution. Installation tokens are minted per-operation
// and discarded — never persisted." This module mints; nothing here caches,
// writes to a table, or writes to disk. Callers must not persist the
// returned token either.
//
// Reads GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY from env (never accepts them
// as parameters — same convention as resolveLitellmTarget in
// src/inngest/ticket-triage.ts). The installation id is the one thing NEVER
// read from env by this module: it is always a caller-supplied parameter,
// resolved per-product from the repo_connections row being processed. Do not
// add a default/fallback installation id here (GITHUB_APP_INSTALLATION_ID in
// Coolify is a convenience default for other tooling, not this module — see
// the S1 task note it must not be hardcoded).

const GITHUB_API_BASE = "https://api.github.com";

// Never widen this beyond what GitHub allows: exp - iat must be <= 600s.
// iat is backdated 60s for clock drift per GitHub's own documented App-auth
// guidance; JWT_TTL_SECONDS is kept a few seconds under the 600s ceiling so a
// tick of drift on GitHub's side can never bounce a request that this
// process considered valid.
const JWT_CLOCK_DRIFT_BACKDATE_SECONDS = 60;
const JWT_TTL_SECONDS = 570;

export type InstallationToken = {
  token: string;
  expiresAt: string;
};

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function readAppCredentials(): { appId: string; privateKeyPem: string } {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyB64) {
    throw new Error("GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY not configured");
  }
  // Decode once per call, never cached module-level — keeps the decoded PEM
  // out of long-lived process memory beyond the single JWT signature it's
  // used for. Never log privateKeyPem: not here, not in any caller.
  const privateKeyPem = Buffer.from(privateKeyB64, "base64").toString("utf8");
  return { appId, privateKeyPem };
}

// Standard GitHub App JWT: header {alg: RS256, typ: JWT}, payload
// {iat, exp, iss=appId}, RS256-signed with the App's private key. No
// external JWT library — RS256 is a direct fit for Node's built-in `crypto`
// (createSign + base64url), and this repo's dependency list
// (package.json) stays free-tier/dependency-minimal by design.
function buildAppJwt(appId: string, privateKeyPem: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowSeconds - JWT_CLOCK_DRIFT_BACKDATE_SECONDS,
    exp: nowSeconds - JWT_CLOCK_DRIFT_BACKDATE_SECONDS + JWT_TTL_SECONDS,
    iss: appId,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  // Never log signingInput or signature — the JWT itself is a bearer
  // credential for the App's identity (10-minute blast radius, but still).
  return `${signingInput}.${base64url(signature)}`;
}

// Exported so callers making OTHER GitHub REST calls with a minted
// installation token (e.g. repo-inspect.ts's tree/commits fetches) build
// identical, correct headers rather than re-deriving them — one place that
// knows GitHub's Accept/API-version/User-Agent requirements.
export function githubHeaders(bearer: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearer}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub rejects unauthenticated-looking requests with no User-Agent.
    "User-Agent": "ops-hub-repo-inspect",
  };
}

// Exchange the App JWT for a short-lived (1-hour) installation access token.
// `installationId` MUST come from the repo_connections row for the product
// being processed — never hardcode a specific installation. Returns the raw
// token; caller is responsible for using it immediately and never persisting
// it (no DB write, no file write — see module header).
export async function mintInstallationToken(
  installationId: string | number
): Promise<InstallationToken> {
  const { appId, privateKeyPem } = readAppCredentials();
  const jwt = buildAppJwt(appId, privateKeyPem);

  const resp = await fetch(
    `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: githubHeaders(jwt),
    }
  );

  if (!resp.ok) {
    // GitHub's error body for this endpoint is {"message": "...", ...} — it
    // never echoes back the JWT or a token, so this is safe to include
    // (truncated defensively regardless, matching the LiteLLM error-handling
    // convention elsewhere in this repo).
    const text = await resp.text();
    throw new Error(`GitHub installation token exchange ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = (await resp.json()) as { token?: string; expires_at?: string };
  if (!json.token || !json.expires_at) {
    throw new Error("GitHub installation token response missing token/expires_at");
  }
  // Never log json.token.
  return { token: json.token, expiresAt: json.expires_at };
}
