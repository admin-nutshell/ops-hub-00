import http from "http";

export async function handleLitellmHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = process.env.LITELLM_EXTERNAL_URL;

  if (!url) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "degraded", litellm: "not configured" }));
    return;
  }

  try {
    await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    // Any HTTP response (including 401) means LiteLLM is reachable — only a
    // network error means it's down.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", litellm: "reachable" }));
  } catch {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "degraded", litellm: "unreachable" }));
  }
}
