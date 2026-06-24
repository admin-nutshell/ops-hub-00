import { Pool } from "pg";
import { inngest } from "./client";

// Fixed staging UUIDs seeded in migration 20260623180000_t21_freescout_intake.sql.
// Production will route by conversation mailbox → tenant; deferred to a future sprint.
export const STAGING_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
export const STAGING_TENANT_ID = "00000000-0000-0000-0000-000000000010";

// FreeScout status / state / thread-type constants (FreeScout v1.x Laravel source).
// Verified against: freescout-help-desk/freescout database migrations.
const FS_STATUS_ACTIVE = 1;
const FS_STATE_PUBLISHED = 2;
const FS_THREAD_TYPE_CUSTOMER = 1;

export type InsertedTicket = {
  id: string;
  freescout_conversation_id: string;
};

type PollResult = {
  polled: number;
  inserted: InsertedTicket[];
};

// Lazy singleton — created on first invocation, reused across cron runs in the
// same Node process. max:2 because the cron is single-threaded by design.
let _pool: Pool | null = null;
export function getPool(): Pool {
  if (!_pool) {
    const url = process.env.OPS_HUB_APP_LOGIN_URL;
    if (!url) throw new Error("OPS_HUB_APP_LOGIN_URL is not set");
    _pool = new Pool({ connectionString: url, max: 2 });
  }
  return _pool;
}

// Exported for unit tests that need to inject a mock pool.
export function _resetPool(mock?: Pool): void {
  _pool = mock ?? null;
}

export const pollFreeScout = inngest.createFunction(
  { id: "freescout-poll", retries: 2, triggers: [{ cron: "* * * * *" }] },
  async ({
    step,
  }: {
    step: Parameters<Parameters<typeof inngest.createFunction>[1]>[0]["step"];
  }) => {
    const result: PollResult = await step.run("poll-and-insert", async () => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        // GUC must be transaction-local (is_local=true) for pooler safety.
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [
          STAGING_TENANT_ID,
        ]);
        await client.query("SELECT set_config('app.current_project', $1, true)", [
          STAGING_PROJECT_ID,
        ]);

        // Read active published conversations + first customer thread body.
        // Polling newest-first (id DESC) so new tickets are caught on each run;
        // LIMIT 100 guards against runaway scans on large mailboxes.
        const { rows: convRows } = await client.query<{
          conv_id: string; // pg returns bigint as string
          subject: string;
          body: string | null;
        }>(
          `
          SELECT
            c.id::text AS conv_id,
            c.subject,
            (SELECT t.body
               FROM threads t
              WHERE t.conversation_id = c.id
                AND t.type  = $1
                AND t.state = $2
              ORDER BY t.id ASC
              LIMIT 1) AS body
          FROM conversations c
          WHERE c.status = $3
            AND c.state  = $4
          ORDER BY c.id DESC
          LIMIT 100
        `,
          [FS_THREAD_TYPE_CUSTOMER, FS_STATE_PUBLISHED, FS_STATUS_ACTIVE, FS_STATE_PUBLISHED]
        );

        const inserted: InsertedTicket[] = [];
        for (const row of convRows) {
          const { rows: newRows } = await client.query<InsertedTicket>(
            `
            INSERT INTO tickets
              (project_id, tenant_id, title, body, severity, freescout_conversation_id)
            VALUES ($1, $2, $3, $4, 'P3', $5::bigint)
            ON CONFLICT (freescout_conversation_id) DO NOTHING
            RETURNING id, freescout_conversation_id::text
          `,
            [
              STAGING_PROJECT_ID,
              STAGING_TENANT_ID,
              (row.subject ?? "").trim() || "(no subject)",
              row.body ?? null,
              row.conv_id,
            ]
          );
          inserted.push(...newRows);
        }

        await client.query("COMMIT");
        return { polled: convRows.length, inserted };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (result.inserted.length > 0) {
      await step.sendEvent(
        "dispatch-triage-events",
        result.inserted.map((t) => ({
          name: "ops-hub/ticket.triage" as const,
          data: {
            ticket_id: t.id,
            freescout_conversation_id: t.freescout_conversation_id,
            project_id: STAGING_PROJECT_ID,
            tenant_id: STAGING_TENANT_ID,
          },
        }))
      );
    }

    return { polled: result.polled, inserted: result.inserted.length };
  }
);
