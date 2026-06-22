import "./instrument";
import http from "http";
import { serve } from "inngest/node";
import { inngest } from "./inngest/client";
import { helloWorld } from "./inngest/functions";
import { emitTrace } from "./langfuse";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const inngestHandler = serve({ client: inngest, functions: [helloWorld] });

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
    throw new Error("Sentry test error from ops-hub-staging");
  }
  res.writeHead(404);
  res.end();
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ops-hub listening on port ${PORT}`);
  });
}
