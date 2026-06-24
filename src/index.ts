import "./instrument";
import * as Sentry from "@sentry/node";
import http from "http";
import { serve } from "inngest/node";
import { inngest } from "./inngest/client";
import { helloWorld } from "./inngest/functions";
import { pollFreeScout } from "./inngest/freescout-poller";
import { emitTrace } from "./langfuse";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const inngestHandler = serve({ client: inngest, functions: [helloWorld, pollFreeScout] });

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
  res.writeHead(404);
  res.end();
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ops-hub listening on port ${PORT}`);
  });
}
