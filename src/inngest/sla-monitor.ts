import { Pool } from "pg";
import { inngest } from "./client";
import { STAGING_PROJECT_ID, STAGING_TENANT_ID } from "./freescout-poller";
import { createLazyPool } from "./utils";

type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

type BreachRow = {
  id: string;
  project_id: string;
  tenant_id: string;
  title: string;
  urgency: string | null;
  freescout_conversation_id: string | null;
  minutes_open: number;
  response_target_minutes: number;
};

const _opsPool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
export function getPool(): Pool {
  return _opsPool.get();
}
export function _resetPool(mock?: Pool): void {
  _opsPool.reset(mock);
}

// Separate FreeScout pool for posting breach notes. Optional — if FREESCOUT_DB_URL
// is absent, notes are skipped and the audit_log entry is the only artefact.
const _fsPool = createLazyPool("FREESCOUT_DB_URL");

async function postBreachNote(
  conversationId: string,
  minutesOpen: number,
  target: number
): Promise<void> {
  if (!process.env.FREESCOUT_DB_URL) return;
  const botUserIdRaw = process.env.FREESCOUT_BOT_USER_ID;
  if (!botUserIdRaw) return;
  const botUserId = parseInt(botUserIdRaw, 10);
  if (isNaN(botUserId)) return;

  const note =
    `⚠️ SLA BREACH — This ticket has been open for ${Math.round(minutesOpen)} minutes ` +
    `(target: ${target} min). Immediate attention required.`;

  const client = await _fsPool.get().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO threads
         (conversation_id, user_id, created_by_user_id, type, status, state,
          source_via, source_type, action_type, body, created_at, updated_at)
       VALUES ($1::bigint, $2::bigint, $2::bigint, 3, 1, 2, 1, 1, 0, $3, now(), now())`,
      [conversationId, botUserId, note]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Finds open tickets past their SLA deadline and logs each breach to audit_log.
// Dedup via NOT EXISTS prevents duplicate entries for the same ticket.
// Premium tenants use per-urgency targets; standard tenants use sla_config flat target.
// Returns the breached tickets so a second step can post FreeScout notes.
export async function findAndLogBreaches(pool: Pool): Promise<BreachRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [STAGING_TENANT_ID]);
    await client.query("SELECT set_config('app.current_project', $1, true)", [STAGING_PROJECT_ID]);

    // CTE resolves response_target_minutes once per ticket so the CASE is not repeated
    // in the WHERE clause. Premium: per-urgency (30/60/240/480 min). Standard: flat
    // from sla_config JSON, defaulting to 240 min if the key is absent.
    const { rows: breached } = await client.query<BreachRow>(
      `WITH candidates AS (
         SELECT
           t.id,
           t.project_id::text,
           t.tenant_id::text,
           t.title,
           t.urgency,
           t.freescout_conversation_id::text,
           EXTRACT(EPOCH FROM (now() - t.created_at)) / 60 AS minutes_open,
           CASE tn.sla_tier
             WHEN 'premium' THEN
               CASE t.urgency
                 WHEN 'critical' THEN 30
                 WHEN 'high'     THEN 60
                 WHEN 'normal'   THEN 240
                 ELSE                 480
               END
             ELSE
               COALESCE((tn.sla_config->>'response_target_minutes')::int, 240)
           END AS response_target_minutes
         FROM tickets t
         JOIN tenants tn ON tn.id = t.tenant_id
         WHERE t.state IN ('new', 'triaged')
           AND NOT EXISTS (
             SELECT 1 FROM audit_log al
             WHERE al.resource_type = 'ticket'
               AND al.resource_id   = t.id
               AND al.action        = 'sla_breach'
           )
       )
       SELECT * FROM candidates
       WHERE minutes_open > response_target_minutes
       LIMIT 20`
    );

    if (breached.length > 0) {
      // Bulk-insert one audit_log row per newly-discovered breach.
      // Each row records minutes_open + response_target_minutes for post-mortems.
      for (const t of breached) {
        await client.query(
          `INSERT INTO audit_log
             (project_id, tenant_id, actor, action, resource_type, resource_id, payload)
           VALUES ($1, $2, 'sla-monitor', 'sla_breach', 'ticket', $3, $4)`,
          [
            t.project_id,
            t.tenant_id,
            t.id,
            JSON.stringify({
              title: t.title,
              urgency: t.urgency,
              minutes_open: Math.round(t.minutes_open),
              response_target_minutes: t.response_target_minutes,
            }),
          ]
        );
      }
    }

    await client.query("COMMIT");
    return breached;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Cron: runs every 5 minutes. Detects SLA breaches and logs them.
// Step 1 — find + log breaches atomically (dedup via NOT EXISTS).
// Step 2 — post FreeScout internal notes for human awareness (optional: skipped
//           if FREESCOUT_DB_URL is absent). Note failures are logged but do not
//           cause the step to fail; the audit_log entry is the source of truth.
export const sweepSlaBreaches = inngest.createFunction(
  {
    id: "sla-monitor",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }: InngestCtx) => {
    const breached = (await step.run("find-and-log-breaches", () =>
      findAndLogBreaches(getPool())
    )) as BreachRow[];

    if (breached.length === 0) return { breaches: 0 };

    if (process.env.FREESCOUT_DB_URL) {
      await step.run("post-breach-notes", async () => {
        const errors: string[] = [];
        for (const t of breached) {
          if (!t.freescout_conversation_id) continue;
          try {
            await postBreachNote(
              t.freescout_conversation_id,
              t.minutes_open,
              t.response_target_minutes
            );
          } catch (err) {
            // Non-fatal: audit_log entry already committed; note failure is informational.
            errors.push(`${t.id}: ${String(err).slice(0, 80)}`);
          }
        }
        return { notes_attempted: breached.length, errors };
      });
    }

    return { breaches: breached.length };
  }
);
