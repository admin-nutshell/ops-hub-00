import { Pool } from "pg";
import { inngest } from "./client";
import { STAGING_PROJECT_ID, STAGING_TENANT_ID } from "./freescout-poller";
import { createLazyPool } from "./utils";

type ResolveEventData = {
  ticket_id: string;
  project_id: string;
  tenant_id: string;
};

export type ResolveResult = { state: "resolved" } | { skipped: true; reason: string };

type SweepRow = { id: string; project_id: string; tenant_id: string };
type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

const _opsPool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
export function getPool(): Pool {
  return _opsPool.get();
}
export function _resetPool(mock?: Pool): void {
  _opsPool.reset(mock);
}

// Configurable via AUTO_RESOLVE_AFTER_HOURS env var (default: 24).
// Tickets in 'responded' state older than this are auto-resolved.
const AUTO_RESOLVE_HOURS = parseInt(process.env.AUTO_RESOLVE_AFTER_HOURS ?? "24", 10);

// Atomically advances a single ticket from 'responded' → 'resolved'.
// Idempotent: returns { skipped } if the ticket is not in 'responded' state.
// Uses a single transaction so there is no TOCTOU race between the state
// check and the UPDATE.
export async function resolveOneTicket(
  pool: Pool,
  ticketId: string,
  projectId: string,
  tenantId: string
): Promise<ResolveResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_project', $1, true)", [projectId]);
    const { rowCount } = await client.query(
      "UPDATE tickets SET state = 'resolved', owner_agent = 'ticket-resolve' WHERE id = $1 AND state = 'responded'",
      [ticketId]
    );
    await client.query("COMMIT");
    if ((rowCount ?? 0) === 0) {
      return { skipped: true, reason: "not_responded" };
    }
    return { state: "resolved" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Event-driven: marks one ticket resolved when ops-hub/ticket.resolve fires.
// On success, emits ops-hub/ticket.resolved for the KB learn function.
export const resolveTicket = inngest.createFunction(
  {
    id: "ticket-resolve",
    retries: 2,
    triggers: [{ event: "ops-hub/ticket.resolve" }],
  },
  async ({ event, step }: InngestCtx) => {
    const { ticket_id, project_id, tenant_id } = event.data as ResolveEventData;
    const result = (await step.run("resolve", () =>
      resolveOneTicket(getPool(), ticket_id, project_id, tenant_id)
    )) as ResolveResult;

    if (!("skipped" in result)) {
      await step.sendEvent("dispatch-kb-learn", {
        name: "ops-hub/ticket.resolved" as const,
        data: { ticket_id, project_id, tenant_id },
      });
    }

    return result;
  }
);

// Cron sweep: finds responded tickets older than AUTO_RESOLVE_HOURS and dispatches
// ops-hub/ticket.resolve events so resolveTicket handles each with its own retry budget.
// Runs every 15 minutes; LIMIT 20 guards against runaway scans.
export const sweepRespondedTickets = inngest.createFunction(
  {
    id: "sweep-responded-tickets",
    retries: 1,
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }: InngestCtx) => {
    const tickets = (await step.run("find-responded-tickets", async () => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [
          STAGING_TENANT_ID,
        ]);
        await client.query("SELECT set_config('app.current_project', $1, true)", [
          STAGING_PROJECT_ID,
        ]);
        const { rows } = await client.query<SweepRow>(
          `SELECT id, project_id::text, tenant_id::text
           FROM tickets
           WHERE state = 'responded'
             AND updated_at < now() - ($1 || ' hours')::interval
           LIMIT 20`,
          [AUTO_RESOLVE_HOURS]
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
      "dispatch-resolve",
      tickets.map((t) => ({
        name: "ops-hub/ticket.resolve" as const,
        data: { ticket_id: t.id, project_id: t.project_id, tenant_id: t.tenant_id },
      }))
    );

    return { swept: tickets.length };
  }
);
