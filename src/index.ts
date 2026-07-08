import "./instrument";
import http from "http";
import { serve } from "inngest/node";
import { inngest } from "./inngest/client";
import { pollFreeScout } from "./inngest/freescout-poller";
import { triageTicket, sweepNewTickets } from "./inngest/ticket-triage";
import { respondTicket } from "./inngest/ticket-respond";
import { resolveTicket, sweepRespondedTickets } from "./inngest/ticket-resolve";
import { sweepSlaBreaches } from "./inngest/sla-monitor";
import { learnFromTicket } from "./inngest/kb-learn";
import { syncAgentCosts } from "./inngest/agent-cost-sync";
import { emitTrace } from "./langfuse";
import { handleStatusWebhook } from "./statusWebhook";
import { handleLitellmHealth } from "./healthLitellm";
import { handleEnvHealth } from "./healthEnv";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const inngestHandler = serve({
  client: inngest,
  functions: [
    pollFreeScout,
    triageTicket,
    sweepNewTickets,
    respondTicket,
    resolveTicket,
    sweepRespondedTickets,
    sweepSlaBreaches,
    learnFromTicket,
    syncAgentCosts,
  ],
});

export const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/inngest")) {
    return inngestHandler(req, res);
  }
  if (req.method === "POST" && req.url?.startsWith("/api/status/webhook")) {
    void handleStatusWebhook(req, res);
    return;
  }
  if ((req.method === "GET" || req.method === "HEAD") && req.url === "/health/litellm") {
    void handleLitellmHealth(req, res);
    return;
  }
  if ((req.method === "GET" || req.method === "HEAD") && req.url === "/health/env") {
    void handleEnvHealth(req, res);
    return;
  }
  if ((req.method === "GET" || req.method === "HEAD") && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    void emitTrace("health-check");
    return;
  }
  res.writeHead(404);
  res.end();
});

server.setTimeout(30_000);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ops-hub listening on port ${PORT}`);
  });
}
