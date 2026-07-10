import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "http";
import { handleLitellmInternalHealth } from "./healthLitellmInternal";

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

describe("handleLitellmInternalHealth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LITELLM_URL", "http://litellm-container-abc123:4000");
    vi.stubEnv("LITELLM_MASTER_KEY", "sk-real-app-key");
    vi.stubEnv("LITELLM_TRIAGE_MODEL", "triage-model");
  });

  it("returns 503 not_configured when LITELLM_URL/LITELLM_MASTER_KEY are missing", async () => {
    vi.stubEnv("LITELLM_URL", "");
    vi.stubEnv("LITELLM_MASTER_KEY", "");
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body).litellm_internal).toBe("not_configured");
  });

  it("returns 503 auth_rejected when LiteLLM 401s the app's own key (FQ-69 failure mode)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false }));
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      status: "degraded",
      litellm_internal: "auth_rejected",
      httpStatus: 401,
    });
  });

  it("returns 503 auth_rejected on a 403 too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 403, ok: false }));
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body).litellm_internal).toBe("auth_rejected");
  });

  it("returns 503 error on any other non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, ok: false }));
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      status: "degraded",
      litellm_internal: "error",
      httpStatus: 500,
    });
  });

  it("returns 200 reachable_and_authenticated on a real 2xx completion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      status: "ok",
      litellm_internal: "reachable_and_authenticated",
    });
  });

  it("returns 503 unreachable on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "degraded", litellm_internal: "unreachable" });
  });

  it("returns 503 unreachable on a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("signal timed out", "TimeoutError"))
    );
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    const { status, body } = await done;
    expect(status).toBe(503);
    expect(JSON.parse(body).litellm_internal).toBe("unreachable");
  });

  it("calls the INTERNAL LITELLM_URL (not LITELLM_EXTERNAL_URL) with the app's own key and target alias", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const [res, done] = makeRes();
    void handleLitellmInternalHealth({} as http.IncomingMessage, res);
    await done;
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://litellm-container-abc123:4000/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-real-app-key");
    const sentBody = JSON.parse(init.body as string) as { model: string; max_tokens: number };
    expect(sentBody.model).toBe("triage-model");
    expect(sentBody.max_tokens).toBe(5);
  });
});
