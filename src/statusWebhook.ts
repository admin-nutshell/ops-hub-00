import http from "http";

const GITHUB_REPO = "admin-nutshell/ops-hub-00";
const DISPATCH_URL = `https://api.github.com/repos/${GITHUB_REPO}/dispatches`;

type UptimeRobotPayload = {
  monitorFriendlyName: string;
  monitorURL: string;
  alertType: number;
  alertDetails?: string;
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384) {
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function handleStatusWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const rawUrl = req.url ?? "/";
  const url = new URL(rawUrl, "http://localhost");

  const expectedSecret = process.env.STATUS_WEBHOOK_SECRET;
  if (!expectedSecret || url.searchParams.get("secret") !== expectedSecret) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  let body: string;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413);
    res.end();
    return;
  }

  let payload: UptimeRobotPayload;
  try {
    payload = JSON.parse(body) as UptimeRobotPayload;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const dispatchToken = process.env.GITHUB_STATUS_DISPATCH_TOKEN;
  if (!dispatchToken) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Dispatch not configured" }));
    return;
  }

  const ghResponse = await fetch(DISPATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dispatchToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "status-alert",
      client_payload: {
        alertType: payload.alertType,
        monitorFriendlyName: payload.monitorFriendlyName,
        monitorURL: payload.monitorURL ?? "",
        alertDetails: payload.alertDetails ?? "",
      },
    }),
  });

  if (ghResponse.status === 204) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const detail = await ghResponse.text().catch(() => "");
  res.writeHead(502, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "GitHub dispatch failed", status: ghResponse.status, detail }));
}
