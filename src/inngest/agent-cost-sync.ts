import { Pool } from "pg";
import { inngest } from "./client";
import { createLazyPool } from "./utils";

type InngestCtx = Parameters<Parameters<typeof inngest.createFunction>[1]>[0];

// The three trace names emitted today (ticket-triage.ts, ticket-respond.ts,
// kb-learn.ts) all use the identical trace-level metadata contract:
//   langfuse.trace({ name, metadata: { ticket_id, project_id, tenant_id } })
// If a new agent starts emitting cost-bearing traces, add its trace name here
// AND confirm it follows the same metadata shape — the sync silently skips
// (does not crash on) any trace whose metadata doesn't match (see
// parseTraceMetadata below), so a mismatch fails safe but silently; check
// `agent_cost_events` row counts after adding a new name.
export const TRACE_NAMES = ["ticket-triage", "ticket-respond", "kb-learn"] as const;
export type TraceName = (typeof TRACE_NAMES)[number];

type LangfuseTrace = {
  id: string;
  timestamp: string;
  name: string | null;
  metadata: unknown;
  totalCost: number | null;
};

type LangfuseTracesResponse = {
  data: LangfuseTrace[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
};

export type CostRow = {
  langfuseTraceId: string;
  traceName: TraceName;
  projectId: string;
  tenantId: string;
  ticketId: string | null;
  totalCostUsd: number;
  traceTimestamp: string;
};

const _opsPool = createLazyPool("OPS_HUB_APP_LOGIN_URL");
export function getPool(): Pool {
  return _opsPool.get();
}
export function _resetPool(mock?: Pool): void {
  _opsPool.reset(mock);
}

// Fetch a page of traces of a given name from LangFuse's public Traces API.
// Auth: HTTP Basic, publicKey as username / secretKey as password — the SAME
// LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY already configured in Coolify for
// the SDK (src/langfuse.ts). No new credential is required for this feed.
//
// fields=core,io,metrics: 'io' is required to get `metadata` back; 'metrics'
// is required to get `totalCost` back (LangFuse returns -1 for totalCost if
// the 'metrics' field group is omitted — confirmed against the public
// OpenAPI spec, cloud.langfuse.com/generated/api/openapi.yml).
export async function fetchLangfuseTraces(
  name: TraceName,
  fromTimestamp: string,
  page = 1,
  limit = 100
): Promise<LangfuseTracesResponse> {
  const baseUrl =
    process.env.LANGFUSE_BASEURL ?? process.env.LANGFUSE_HOST ?? "https://us.cloud.langfuse.com";
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    throw new Error("LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not configured");
  }

  const url = new URL(`${baseUrl}/api/public/traces`);
  url.searchParams.set("name", name);
  url.searchParams.set("fromTimestamp", fromTimestamp);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("fields", "core,io,metrics");

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LangFuse ${resp.status}: ${text.slice(0, 200)}`);
  }

  return (await resp.json()) as LangfuseTracesResponse;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parses raw trace metadata into { projectId, tenantId, ticketId }. Returns
// null (skip this trace) if project_id/tenant_id are missing or not
// well-formed UUIDs. This is the defensive boundary that keeps a stray or
// future trace with a different metadata shape (e.g. emitTrace("health-check")
// has NO metadata at all) from writing a null-tenant row or crashing the sync.
export function parseTraceMetadata(
  metadata: unknown
): { projectId: string; tenantId: string; ticketId: string | null } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const projectId = typeof m.project_id === "string" ? m.project_id : null;
  const tenantId = typeof m.tenant_id === "string" ? m.tenant_id : null;
  const ticketId = typeof m.ticket_id === "string" ? m.ticket_id : null;

  if (!projectId || !tenantId) return null;
  if (!UUID_RE.test(projectId) || !UUID_RE.test(tenantId)) return null;
  if (ticketId && !UUID_RE.test(ticketId)) return null;

  return { projectId, tenantId, ticketId };
}

// Maps raw LangFuse traces to insertable rows, dropping any trace that fails
// parseTraceMetadata. totalCost defaults to 0 rather than being dropped —
// LangFuse returns null cost for a trace with no completed generation yet
// (e.g. still in flight), and 0 is the correct value to store, not "skip".
export function tracesToRows(name: TraceName, traces: LangfuseTrace[]): CostRow[] {
  const rows: CostRow[] = [];
  for (const t of traces) {
    const parsed = parseTraceMetadata(t.metadata);
    if (!parsed) continue;
    rows.push({
      langfuseTraceId: t.id,
      traceName: name,
      projectId: parsed.projectId,
      tenantId: parsed.tenantId,
      ticketId: parsed.ticketId,
      totalCostUsd: t.totalCost ?? 0,
      traceTimestamp: t.timestamp,
    });
  }
  return rows;
}

// Upsert cost rows into Supabase. Rows are grouped by (project_id, tenant_id)
// so the transaction-local RLS GUC (app.current_tenant / app.current_project)
// matches every row written in that transaction — same per-tenant-transaction
// pattern as ticket-triage.ts / sla-monitor.ts. ON CONFLICT DO UPDATE (not DO
// NOTHING): a trace's cost can still be settling shortly after creation
// (async generation.end()/flush), so a later sync run must overwrite the
// earlier total, never silently keep a possibly-incomplete first value.
export async function upsertCostRows(pool: Pool, rows: CostRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const byTenant = new Map<string, CostRow[]>();
  for (const r of rows) {
    const key = `${r.projectId}:${r.tenantId}`;
    const bucket = byTenant.get(key) ?? [];
    bucket.push(r);
    byTenant.set(key, bucket);
  }

  let written = 0;
  for (const bucket of byTenant.values()) {
    const { projectId, tenantId } = bucket[0];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
      await client.query("SELECT set_config('app.current_project', $1, true)", [projectId]);
      for (const r of bucket) {
        await client.query(
          `INSERT INTO agent_cost_events
             (project_id, tenant_id, ticket_id, langfuse_trace_id, trace_name, total_cost_usd, trace_timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (langfuse_trace_id) DO UPDATE
             SET total_cost_usd = EXCLUDED.total_cost_usd,
                 synced_at = now()`,
          [
            r.projectId,
            r.tenantId,
            r.ticketId,
            r.langfuseTraceId,
            r.traceName,
            r.totalCostUsd,
            r.traceTimestamp,
          ]
        );
        written++;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return written;
}

// Pulls every page of a given trace name since `fromTimestamp` and upserts it.
export async function syncTraceName(
  pool: Pool,
  name: TraceName,
  fromTimestamp: string
): Promise<number> {
  let page = 1;
  let written = 0;
  for (;;) {
    const resp = await fetchLangfuseTraces(name, fromTimestamp, page);
    const rows = tracesToRows(name, resp.data);
    written += await upsertCostRows(pool, rows);
    if (resp.data.length === 0 || page >= resp.meta.totalPages) break;
    page++;
  }
  return written;
}

// Cron: syncs LangFuse per-ticket cost into Supabase every 10 minutes — keeps
// dashboard freshness comfortably under the 15-minute bar (Data Engineer
// quality bar). Looks back 24h on every run: cheap at current ticket volume
// and covers any run that failed/was skipped since the last success (the
// idempotent upsert makes re-fetching the same window safe).
//
// Fail-closed gate: LangFuse Cloud is one shared project and Supabase is one
// shared DB across ops-hub-staging/prod — if both environments ran this cron,
// both would pull and write the exact same rows (harmless given the upsert,
// but pointless double work and double outbound API calls). Set
// AGENT_COST_SYNC_ENABLED=true on exactly ONE ops-hub environment's Coolify
// env vars (today: ops-hub-prod — same choice already made for
// POLLING_ENABLED, see freescout-poller.ts).
export const syncAgentCosts = inngest.createFunction(
  { id: "agent-cost-sync", retries: 2, triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }: InngestCtx) => {
    if (process.env.AGENT_COST_SYNC_ENABLED !== "true") {
      return { synced: 0 };
    }

    const fromTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let totalWritten = 0;

    for (const name of TRACE_NAMES) {
      const written = (await step.run(`sync-${name}`, () =>
        syncTraceName(getPool(), name, fromTimestamp)
      )) as number;
      totalWritten += written;
    }

    return { synced: totalWritten };
  }
);
