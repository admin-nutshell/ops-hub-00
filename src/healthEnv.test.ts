import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "http";
import { handleEnvHealth, REQUIRED_ENV_VARS } from "./healthEnv";

function makeRes(): [http.ServerResponse, Promise<{ status: number; body: string }>] {
  let resolve!: (v: { status: number; body: string }) => void;
  const promise = new Promise<{ status: number; body: string }>((r) => {
    resolve = r;
  });
  let status = 200;
  let body = "";
  const res = {
    writeHead: (s: number) => {
      status = s;
    },
    end: (b?: string) => {
      body = b ?? "";
      resolve({ status, body });
    },
  } as unknown as http.ServerResponse;
  return [res, promise];
}

describe("handleEnvHealth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Force every required var present by default — tests must not depend on
    // whatever happens to be set in the machine's real environment.
    for (const key of REQUIRED_ENV_VARS) {
      vi.stubEnv(key, `test-value-${key}`);
    }
  });

  it("returns 200 with status ok when all required env vars are present", async () => {
    const [res, done] = makeRes();
    void handleEnvHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(200);
    const parsed = JSON.parse(body) as { status: string; checked: number; missing: string[] };
    expect(parsed.status).toBe("ok");
    expect(parsed.checked).toBe(REQUIRED_ENV_VARS.length);
    expect(parsed.missing).toEqual([]);
  });

  it("returns 503 with status degraded when one required env var is missing (unset)", async () => {
    delete process.env.SENTRY_DSN;
    const [res, done] = makeRes();
    void handleEnvHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    const parsed = JSON.parse(body) as { status: string; missing: string[] };
    expect(parsed.status).toBe("degraded");
    expect(parsed.missing).toEqual(["SENTRY_DSN"]);
  });

  it("treats an empty-string value as missing (Coolify append-not-upsert can leave a blank row)", async () => {
    vi.stubEnv("LITELLM_MASTER_KEY", "");
    const [res, done] = makeRes();
    void handleEnvHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    const parsed = JSON.parse(body) as { missing: string[] };
    expect(parsed.missing).toContain("LITELLM_MASTER_KEY");
  });

  it("reports all missing var NAMES but never leaks any var VALUE", async () => {
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    const secretValue = "test-value-LANGFUSE_SECRET_KEY";
    const [res, done] = makeRes();
    void handleEnvHealth({} as http.IncomingMessage, res);
    const { body } = await done;
    const parsed = JSON.parse(body) as { missing: string[] };
    expect(parsed.missing.sort()).toEqual(["INNGEST_SIGNING_KEY", "NVIDIA_API_KEY"]);
    // The response body is only ever the small JSON object above — assert the
    // raw string never contains a present var's value anywhere.
    expect(body).not.toContain(secretValue);
  });

  it("returns 503 when multiple required env vars are missing", async () => {
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    const [res, done] = makeRes();
    void handleEnvHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    const parsed = JSON.parse(body) as { missing: string[] };
    expect(parsed.missing.sort()).toEqual(
      ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "LANGFUSE_PUBLIC_KEY"].sort()
    );
  });

  it("returns 200 for HEAD request (UptimeRobot default method)", async () => {
    const [res, done] = makeRes();
    void handleEnvHealth({ method: "HEAD" } as unknown as http.IncomingMessage, res);
    const { status } = await done;
    expect(status).toBe(200);
  });
});
