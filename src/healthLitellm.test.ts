import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "http";
import { handleLitellmHealth } from "./healthLitellm";

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

describe("handleLitellmHealth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_BASE_URL", "https://litellm-staging.inatechshell.ca");
    vi.stubEnv("LITELLM_MASTER_KEY", "sk-test-master");
  });

  it("returns 503 when LITELLM_BASE_URL is missing", async () => {
    vi.stubEnv("LITELLM_BASE_URL", "");
    const [res, done] = makeRes();
    void handleLitellmHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body).litellm).toBe("not configured");
  });

  it("returns 503 when LITELLM_MASTER_KEY is missing", async () => {
    vi.stubEnv("LITELLM_MASTER_KEY", "");
    const [res, done] = makeRes();
    void handleLitellmHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body).litellm).toBe("not configured");
  });

  it("returns 200 when LiteLLM responds with 401 (auth required — but reachable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
    const [res, done] = makeRes();
    void handleLitellmHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: "ok", litellm: "reachable" });
  });

  it("passes Authorization header with master key", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);
    const [res, done] = makeRes();
    void handleLitellmHealth({} as http.IncomingMessage, res);
    await done;
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://litellm-staging.inatechshell.ca/health");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-master");
  });

  it("returns 503 when LiteLLM is unreachable (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const [res, done] = makeRes();
    void handleLitellmHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "degraded", litellm: "unreachable" });
  });

  it("returns 503 when LiteLLM times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("signal timed out", "TimeoutError")));
    const [res, done] = makeRes();
    void handleLitellmHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body).litellm).toBe("unreachable");
  });
});
