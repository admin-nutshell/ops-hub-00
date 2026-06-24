import { Pool } from "pg";
import { inngest } from "./client";
import { STAGING_PROJECT_ID, STAGING_TENANT_ID } from "./freescout-poller";
import { langfuse } from "../langfuse";

type Urgency = "critical" | "high" | "normal" | "low";

type TriageEventData = {
  ticket_id: string;
  project_id: string;
  tenant_id: string;
};

type TicketRow = {
  id: string;
  title: string;
  body: string | null;
  state: string;
};

type ClassifyResult = {
  urgency: Urgency;
  category: string;
  routing: string;
  reasoning: string;
};

export type TriageResult =
  | { urgency: Urgency; category: string; routing: string; reasoning: string }
  | { skipped: true; reason: string };

type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

const URGENCIES = new Set<string>(["critical", "high", "normal", "low"]);

let _pool: Pool | null = null;
export function getPool(): Pool {
  if (!_pool) {
    const url = process.env.OPS_HUB_APP_LOGIN_URL;
    if (!url) throw new Error("OPS_HUB_APP_LOGIN_URL is not set");
    _pool = new Pool({ connectionString: url, max: 2 });
  }
  return _pool;
}
export function _resetPool(mock?: Pool): void {
  _pool = mock ?? null;
}

// Escape XML-special characters so ticket content cannot break the prompt delimiters.
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Instructions go in the system message; untrusted ticket content goes in the user message.
// This separation prevents ticket bodies from overriding classification instructions.
export async function classifyTicket(title: string, body: string | null): Promise<ClassifyResult> {
  const litellmUrl = process.env.LITELLM_URL;
  const litellmKey = process.env.LITELLM_MASTER_KEY;
  if (!litellmUrl || !litellmKey) {
    throw new Error("LITELLM_URL or LITELLM_MASTER_KEY not configured");
  }

  const resp = await fetch(`${litellmUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${litellmKey}`,
    },
    body: JSON.stringify({
      model: "meta/llama-3.3-70b-instruct",
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: [
            "Classify this support ticket. Respond ONLY with valid JSON — no markdown:",
            '{"urgency":"critical"|"high"|"normal"|"low","category":"<topic>","routing":"<team>","reasoning":"<one sentence>"}',
            "",
            "urgency critical: system down, data loss, security breach",
            "urgency high: major degradation, multiple users blocked, no workaround",
            "urgency normal: limited impact, workaround available",
            "urgency low: minor or cosmetic, single user",
            "If uncertain: urgency=normal, category=support, routing=support",
          ].join("\n"),
        },
        {
          role: "user",
          content: `<ticket_title>${escapeXml(title)}</ticket_title>\n<ticket_body>${escapeXml(body ?? "")}</ticket_body>`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LiteLLM ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";

  try {
    // Strip optional markdown code fence that some models add despite instructions.
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as {
      urgency?: unknown;
      category?: unknown;
      routing?: unknown;
      reasoning?: unknown;
    };
    const urgency = URGENCIES.has(String(parsed.urgency)) ? (parsed.urgency as Urgency) : "normal";
    return {
      urgency,
      category: String(parsed.category ?? "support"),
      routing: String(parsed.routing ?? "support"),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return {
      urgency: "normal",
      category: "support",
      routing: "support",
      reasoning: `parse-failure: ${raw.slice(0, 80)}`,
    };
  }
}

// Fetch + classify + update a single ticket.
// Idempotent: returns { skipped } if the ticket is not in 'new' state.
export async function triageOneTicket(
  pool: Pool,
  ticketId: string,
  projectId: string,
  tenantId: string
): Promise<TriageResult> {
  // 1. Fetch ticket (GUC must be transaction-local for pooler safety).
  const fetchClient = await pool.connect();
  let ticket: TicketRow | null = null;
  try {
    await fetchClient.query("BEGIN");
    await fetchClient.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await fetchClient.query("SELECT set_config('app.current_project', $1, true)", [projectId]);
    const { rows } = await fetchClient.query<TicketRow>(
      "SELECT id, title, body, state FROM tickets WHERE id = $1 LIMIT 1",
      [ticketId]
    );
    await fetchClient.query("COMMIT");
    ticket = rows[0] ?? null;
  } catch (err) {
    await fetchClient.query("ROLLBACK");
    throw err;
  } finally {
    fetchClient.release();
  }

  // Idempotency guard: Inngest may retry; skip tickets already past 'new'.
  if (!ticket || ticket.state !== "new") {
    return { skipped: true, reason: ticket ? ticket.state : "not_found" };
  }

  // 2. Classify via LiteLLM; record a LangFuse generation.
  const trace = langfuse?.trace({
    name: "ticket-triage",
    metadata: { ticket_id: ticketId, project_id: projectId, tenant_id: tenantId },
  });
  const generation = trace?.generation({
    name: "classify-ticket",
    model: "meta/llama-3.3-70b-instruct",
    input: [{ role: "user", content: ticket.title }],
  });

  let classification: ClassifyResult;
  try {
    classification = await classifyTicket(ticket.title, ticket.body);
  } catch (err) {
    generation?.end({ output: String(err) });
    await langfuse?.flushAsync();
    throw err;
  }

  generation?.end({ output: classification });
  await langfuse?.flushAsync();

  // 3. Persist classification.
  const updateClient = await pool.connect();
  try {
    await updateClient.query("BEGIN");
    await updateClient.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await updateClient.query("SELECT set_config('app.current_project', $1, true)", [projectId]);
    await updateClient.query(
      "UPDATE tickets SET state = 'triaged', urgency = $1, category = $2, routing = $3, owner_agent = 'ticket-triage' WHERE id = $4",
      [classification.urgency, classification.category, classification.routing, ticketId]
    );
    await updateClient.query("COMMIT");
  } catch (err) {
    await updateClient.query("ROLLBACK");
    throw err;
  } finally {
    updateClient.release();
  }

  return {
    urgency: classification.urgency,
    category: classification.category,
    routing: classification.routing,
    reasoning: classification.reasoning,
  };
}

// Event-driven: real-time triage when the poller dispatches ops-hub/ticket.triage.
export const triageTicket = inngest.createFunction(
  {
    id: "ticket-triage",
    retries: 2,
    triggers: [{ event: "ops-hub/ticket.triage" }],
  },
  async ({ event, step }: InngestCtx) => {
    const { ticket_id, project_id, tenant_id } = event.data as TriageEventData;
    return await step.run("triage", () =>
      triageOneTicket(getPool(), ticket_id, project_id, tenant_id)
    );
  }
);

// Cron sweep: catches tickets that existed before T-22 deployed (or missed events).
// Dispatches ops-hub/ticket.triage events so triageTicket handles each ticket
// with its own retry budget and LangFuse trace.
export const sweepNewTickets = inngest.createFunction(
  {
    id: "sweep-new-tickets",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }: InngestCtx) => {
    type SweepRow = { id: string; project_id: string; tenant_id: string };
    const tickets = (await step.run("find-new-tickets", async () => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [
          STAGING_TENANT_ID,
        ]);
        await client.query("SELECT set_config('app.current_project', $1, true)", [
          STAGING_PROJECT_ID,
        ]);
        const { rows } = await client.query<{
          id: string;
          project_id: string;
          tenant_id: string;
        }>(
          "SELECT id, project_id::text, tenant_id::text FROM tickets WHERE state = 'new' LIMIT 20"
        );
        await client.query("COMMIT");
        return rows;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })) as SweepRow[];

    if (tickets.length === 0) return { swept: 0 };

    await step.sendEvent(
      "dispatch-triage",
      tickets.map((t) => ({
        name: "ops-hub/ticket.triage" as const,
        data: {
          ticket_id: t.id,
          project_id: t.project_id,
          tenant_id: t.tenant_id,
        },
      }))
    );

    return { swept: tickets.length };
  }
);
