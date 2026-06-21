import http from "http";
import { serve } from "inngest/node";
import { inngest } from "./inngest/client";
import { helloWorld } from "./inngest/functions";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const inngestHandler = serve({ client: inngest, functions: [helloWorld] });

export const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/inngest")) {
    return inngestHandler(req, res);
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
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
