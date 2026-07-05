# T-58 — Data lineage: agent cost + eval health

Sprint 6, Track A. Prerequisite for T-59 (Ops Dashboard build). Owner: Data Engineer.

This doc exists so the source→storage→dashboard path for two of the four charter daily
pillars (`02_stakeholders.md`) is traceable end to end, the way an auditor would expect.

---

## 1. Agent cost

### Source of truth
LangFuse Cloud (US region). Every LLM call made by `ticket-triage.ts`, `ticket-respond.ts`,
and `kb-learn.ts` is wrapped in a `langfuse.trace({ name, metadata: { ticket_id, project_id,
tenant_id } })` + `.generation(...)` (T-31, Sprint 3). LangFuse computes `totalCost` per trace
from the model + token usage recorded on each generation.

### Pipeline
```
LiteLLM call (ticket-triage / ticket-respond / kb-learn)
  → langfuse.trace()/.generation() (existing, T-31)
  → LangFuse Cloud (US) — computes totalCost, retains trace + metadata
  → agent-cost-sync Inngest cron (NEW, T-58, src/inngest/agent-cost-sync.ts)
      - GET /api/public/traces (LangFuse public API), Basic Auth
        (LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY — same keys already in Coolify
        for the SDK; no new credential)
      - fields=core,io,metrics → returns metadata + totalCost per trace
      - parses ticket_id/project_id/tenant_id from trace metadata; SKIPS any
        trace that doesn't carry a valid project_id+tenant_id (defends against
        traces outside our contract, e.g. `emitTrace("health-check")`)
      - upserts into Supabase `agent_cost_events` (ON CONFLICT (langfuse_trace_id)
        DO UPDATE — cost can settle after a trace closes)
  → Supabase `agent_cost_events` (NEW table) / `agent_cost_daily` (NEW rollup view)
  → dashboard query layer (src/metrics/agentCost.ts) → T-59 (not yet built)
```

### Storage
- `agent_cost_events` — one row per LangFuse trace. Columns: `project_id`, `tenant_id`
  (both FK, not null), `ticket_id` (uuid, **not** FK — a cost row must not fail to sync
  because the ticket it refers to was later deleted/renamed), `langfuse_trace_id` (unique,
  dedup key), `trace_name`, `total_cost_usd`, `trace_timestamp`, `synced_at`.
- `agent_cost_daily` — `security_invoker` view: daily sum of `total_cost_usd` + count per
  `(project_id, tenant_id, trace_name)`. This is what T-59's cost-over-time / cost-per-project
  tiles should query, not the raw table, unless a per-ticket drill-down is needed.

### Scoping / isolation
Tenant-scoped like every other table (CLAUDE.md non-negotiable #8). SELECT policy:
`tenant_id = current_tenant_id()`. Write policy restricted to `ops_hub_app` (the sync's
role), scoped to `project_id = current_project_id() and tenant_id = current_tenant_id()`.
**The write-side scoping is a consistency guard, not the isolation boundary** — the sync
sets the GUC from the same metadata it's about to insert, so `WITH CHECK` is trivially
satisfied for any tenant it processes (same trust model as `sla-monitor.ts` writing
`audit_log`). The SELECT policy is the real isolation boundary and is what T-60 must verify:
querying as tenant A's session must never return tenant B's cost rows.

### PII
None. Only UUIDs (project/tenant/ticket ids), a trace id (LangFuse's own id, not
customer-identifying), a numeric cost, and timestamps. No ticket title/body/customer text is
copied into this table.

### Freshness / retention
Cron runs every 10 minutes (`*/10 * * * *`), looks back 24h each run — comfortably under the
15-minute dashboard freshness bar even accounting for one missed run. No retention policy
change needed yet (same DB, same lifecycle as `tickets`); revisit if/when a Sprint-7 data
retention pass happens.

### Environment gating
`AGENT_COST_SYNC_ENABLED` must be `true` on exactly ONE ops-hub environment (today:
ops-hub-prod, same choice as `POLLING_ENABLED`) — LangFuse Cloud is one shared project and
Supabase is one shared DB across staging/prod, so running the cron on both would double-fetch
the same traces (harmless given the upsert, but wasteful and confusing to reason about).

### Founder action required to go live
1. Apply migration `supabase/migrations/20260704010000_t58_agent_cost_eval_health.sql` via
   Supabase SQL Editor as `service_role` (same pattern as every prior migration).
2. Set `AGENT_COST_SYNC_ENABLED=true` in ops-hub-prod's Coolify env vars, redeploy.
3. First live cron run writes the first real rows — confirm with:
   `select count(*) from agent_cost_events;` (as service_role, or as `ops_hub_app` with the
   tenant GUC set, per the standing RLS pattern).

No new secret is required — `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` and
`OPS_HUB_APP_LOGIN_URL` already exist in Coolify.

---

## 2. Eval health

### Source of truth today
**There isn't one that measures quality.** T-17's `Eval Gate` CI job runs
`npx promptfoo validate` — this checks that each `evals/*.yaml` file is well-formed. It does
NOT invoke an LLM grader, does NOT run the `llm-rubric` assertions defined in those files, and
produces no pass/fail signal about actual agent behavior. Storing this result as "eval health"
would misrepresent a YAML-schema check as the charter's >95% quality pass-rate KPI
(`09_delivery.md`) — explicitly called out as a guardrail for this task and treated as a hard
line, not a suggestion.

### Decision taken (documented per the task's own instructions)
**Option (b):** build the storage + query layer now; leave it genuinely empty until a real
LLM-rubric gate exists (Evals Lead / Tech Lead follow-up to T-17 — eval *design* is Evals
Lead's territory; Data Engineer owns the storage/query layer per the team's stated division of
labor). No fabricated pass rate, no schema-validation result relabeled as quality.

### Storage
`eval_gate_runs` — `project_id` (nullable: a CI eval run is platform-wide today, not
tenant/customer data — same nullable-scope precedent as `audit_log`'s platform events),
`run_type` (`schema_validation` | `llm_rubric`), `status`, `total_cases`, `passed_cases`,
`pass_rate` (**GENERATED column, structurally NULL for `run_type = 'schema_validation'`** —
this is the guardrail: even a future careless writer cannot make a schema check's row carry a
believable quality number), `git_sha`, `workflow_run_url`, `ci_run_at`.

### Query layer
`src/metrics/getEvalHealth()` (`src/metrics/evalHealth.ts`) reads the latest
`run_type = 'llm_rubric'` row only. If none exists (true today — table is empty), it returns:

```
{ status: "pending", message: "No eval-quality runs yet — pending real gate. ..." }
```

T-59 must render this literally (e.g. "Eval health: pending — no quality gate yet"), not
substitute a green checkmark, a percentage, or silently omit the tile.

### What is explicitly NOT done in this task
No writer is wired into CI. Recording `schema_validation` results (or, later, real
`llm_rubric` results) from `pr-checks.yml`'s `evals` job requires a scoped DB credential as a
new CI secret — a deliberate scope boundary for this task, and a decision for whoever builds
the real gate (likely bundled with that work, since the real gate needs its own CI wiring
regardless).

### PII
None. No ticket/customer data of any kind in this table.
