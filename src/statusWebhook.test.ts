import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "http";
import { PassThrough } from "stream";
import { handleStatusWebhook } from "./statusWebhook";

function makeReq(url: string, body: string, method = "POST"): http.IncomingMessage {
  const stream = new PassThrough();
  // Push body after current tick so listeners are attached before data arrives
  setImmediate(() => {
    stream.write(Buffer.from(body));
    stream.end();
  });
  return Object.assign(stream, { url, method }) as unknown as http.IncomingMessage;
}

function makeRes(): [http.ServerResponse, Promise<{ status: number; body: string }>] {
  let resolvePromise!: (v: { status: number; body: string }) => void;
  const promise = new Promise<{ status: number; body: string }>((r) => {
    resolvePromise = r;
  });

  let status = 200;
  let responseBody = "";

  const res = {
    writeHead: (s: number) => {
      status = s;
    },
    end: (b?: string) => {
      responseBody = b ?? "";
      resolvePromise({ status, body: responseBody });
    },
  } as unknown as http.ServerResponse;

  return [res, promise];
}

describe("handleStatusWebhook", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("STATUS_WEBHOOK_SECRET", "test-secret");
  });

  it("returns 403 when secret is missing", async () => {
    const [res, done] = makeRes();
    void handleStatusWebhook(makeReq("/api/status/webhook", "{}"), res);
    const { status } = await done;
    expect(status).toBe(403);
  });

  it("returns 403 when secret is wrong", async () => {
    const [res, done] = makeRes();
    void handleStatusWebhook(makeReq("/api/status/webhook?secret=wrong", "{}"), res);
    const { status } = await done;
    expect(status).toBe(403);
  });

  it("returns 400 for malformed JSON", async () => {
    const [res, done] = makeRes();
    void handleStatusWebhook(makeReq("/api/status/webhook?secret=test-secret", "not-json"), res);
    const { status } = await done;
    expect(status).toBe(400);
  });

  it("returns 503 when GITHUB_STATUS_DISPATCH_TOKEN is absent", async () => {
    vi.stubEnv("GITHUB_STATUS_DISPATCH_TOKEN", "");
    const body = JSON.stringify({ monitorFriendlyName: "Ops Hub", alertType: 1 });
    const [res, done] = makeRes();
    void handleStatusWebhook(makeReq("/api/status/webhook?secret=test-secret", body), res);
    const { status } = await done;
    expect(status).toBe(503);
  });

  it("dispatches to GitHub and returns 200 on success", async () => {
    vi.stubEnv("GITHUB_STATUS_DISPATCH_TOKEN", "ghp_fake");
    const mockFetch = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal("fetch", mockFetch);

    const body = JSON.stringify({
      monitorFriendlyName: "Ops Hub Staging",
      monitorURL: "https://ops-hub-staging.inatechshell.ca/health",
      alertType: 1,
    });
    const [res, done] = makeRes();
    void handleStatusWebhook(makeReq("/api/status/webhook?secret=test-secret", body), res);
    const { status } = await done;

    expect(status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/dispatches");
    const dispatched = JSON.parse(init.body as string);
    expect(dispatched.event_type).toBe("status-alert");
    expect(dispatched.client_payload.alertType).toBe(1);
  });
});
