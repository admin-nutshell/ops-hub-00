import "./instrument";
import * as Sentry from "@sentry/node";
import http from "http";
import { serve } from "inngest/node";
import { inngest } from "./inngest/client";
import { helloWorld } from "./inngest/functions";
import { pollFreeScout } from "./inngest/freescout-poller";
import { triageTicket, sweepNewTickets } from "./inngest/ticket-triage";
import { respondTicket } from "./inngest/ticket-respond";
import { emitTrace } from "./langfuse";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const inngestHandler = serve({
  client: inngest,
  functions: [helloWorld, pollFreeScout, triageTicket, sweepNewTickets, respondTicket],
});

export const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/inngest")) {
    return inngestHandler(req, res);
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    void emitTrace("health-check");
    return;
  }
  if (req.method === "GET" && req.url === "/debug-sentry") {
    const err = new Error("Sentry test error from ops-hub-staging");
    Sentry.captureException(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Test error captured by Sentry" }));
    return;
  }
  if (req.method === "GET" && req.url === "/debug/litellm-connectivity") {
    // T-22 diagnosis: tests LiteLLM reachability from inside this container.
    // Deliberately kept unauthenticated for operator use; remove after T-22 confirmed green.
    void (async () => {
      const litellmUrl = process.env.LITELLM_URL ?? "not-set";
      // Coolify container-name candidates: Coolify v4 uses the app UUID as the container name.
      // Test three internal forms so the workflow result identifies the exact resolvable name.
      const candidates = [
        { label: "configured", url: `${litellmUrl}/health` },
        { label: "internal-bare", url: "http://litellm-staging:4000/health" },
        {
          label: "internal-name-uuid",
          url: "http://litellm-staging-h12xz8887fxvbvjts2hac8if:4000/health",
        },
        {
          label: "internal-uuid",
          url: "http://h12xz8887fxvbvjts2hac8if:4000/health",
        },
        {
          label: "sslip-http",
          url: "http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io/health",
        },
      ];
      const results = await Promise.all(
        candidates.map(async ({ label, url }) => {
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
            return { label, url, result: `HTTP ${r.status}` };
          } catch (err) {
            const cause = (err as { cause?: { code?: string } }).cause;
            const code = cause?.code ?? "unknown";
            const msg = err instanceof Error ? err.message : String(err);
            return { label, url, result: `ERROR ${code}: ${msg}` };
          }
        })
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ configured_url: litellmUrl, results }));
    })().catch((err) => {
      Sentry.captureException(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: "probe failed" }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ops-hub listening on port ${PORT}`);
  });
}
