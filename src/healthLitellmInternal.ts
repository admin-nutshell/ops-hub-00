import http from "http";
import { resolveLitellmTarget } from "./inngest/ticket-triage";

/**
 * GET/HEAD /health/litellm-internal — T-97 (FQ-69 follow-up).
 *
 * Closes the monitoring blind spot the FQ-69 incident exposed: `/health/litellm`
 * (healthLitellm.ts) probes `LITELLM_EXTERNAL_URL` using LiteLLM's OWN master
 * key (implicit — it never sends an Authorization header at all, so a 401 from
 * LiteLLM still counts as "reachable"). That check is structurally incapable
 * of detecting the actual FQ-69 failure mode: ops-hub-prod's OWN configured
 * `LITELLM_MASTER_KEY` being rejected by LiteLLM. A green `/health/litellm`
 * gave zero signal while real production tickets sat stuck in `state='new'`
 * for 3.6 days (WORK.md T-85, FOUNDER_QUEUE.md FQ-69).
 *
 * This endpoint instead:
 *   1. Resolves LITELLM_URL / LITELLM_MASTER_KEY / model via
 *      `resolveLitellmTarget()` — the SAME function `classifyTicket` calls
 *      (src/inngest/ticket-triage.ts). No separate/duplicated credential that
 *      could itself drift from what the real ticket-triage/ticket-respond
 *      path actually uses.
 *   2. Makes a real, minimal completion call (max_tokens=5, a trivial prompt)
 *      against the app's real target alias, over the INTERNAL LITELLM_URL —
 *      the exact hop `classifyTicket` makes. Since this handler runs inside
 *      the ops-hub app process itself (on the Docker network LITELLM_URL
 *      resolves on), the internal hop is real, not simulated.
 *   3. Maps the result to a 200/503 contract UptimeRobot-style checks already
 *      use in this codebase (see healthLitellm.ts, healthEnv.ts): 200 only on
 *      a genuine authenticated completion; 503 on auth rejection (401/403),
 *      any other non-2xx, or a network/timeout failure — each labeled
 *      distinctly in the body so a human (or the T-97 monitor workflow) can
 *      tell "the app's key is rejected" apart from "LiteLLM is unreachable."
 *
 * Deliberately unauthenticated (matches every other /health* route) — it does
 * incur one small real completion call per hit (max_tokens=5, ~10 input
 * tokens), which is an intentionally accepted trade-off given the endpoint is
 * only hit by the scheduled T-97 monitor plus occasional manual checks, not
 * public traffic. See DECISIONS.md T-97 entry.
 */
export async function handleLitellmInternalHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let litellmUrl: string, litellmKey: string, modelName: string;
  try {
    ({ litellmUrl, litellmKey, modelName } = resolveLitellmTarget());
  } catch (err) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "degraded",
        litellm_internal: "not_configured",
        detail: err instanceof Error ? err.message : String(err),
      })
    );
    return;
  }

  try {
    const resp = await fetch(`${litellmUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${litellmKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        max_tokens: 5,
        messages: [{ role: "user", content: "Reply with the single word OK." }],
      }),
    });

    if (resp.status === 401 || resp.status === 403) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "degraded",
          litellm_internal: "auth_rejected",
          httpStatus: resp.status,
        })
      );
      return;
    }

    if (!resp.ok) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "degraded", litellm_internal: "error", httpStatus: resp.status })
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", litellm_internal: "reachable_and_authenticated" }));
  } catch {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "degraded", litellm_internal: "unreachable" }));
  }
}
