# ADR-0006 — Dashboard Settings Write Surface: Per-Function Model Routing + RLS Write Model

- **Status:** Proposed (pending Security Lead + Evals Lead sign-off; PM to scope into Sprint 7)
- **Date:** 2026-07-08
- **Author:** Tech Lead
- **Deciders:** Tech Lead (proposer); Security Lead (RLS write policies, least-privilege grants, audit atomicity, auth-identity decision); Evals Lead (runtime model-swap vs. the eval gate); Frontend Engineer (write UI + API routes); Production Manager (env/config, go-live); Founder (auth-identity + billing-lever calls)
- **Supersedes:** none
- **Related:** ADR-0001 (env topology), ADR-0004 (LiteLLM schema isolation — the alias/registry model), ADR-0005 (staging + prod share one Supabase project), `DECISIONS.md` 2026-07-04 T-57 (dashboard Basic Auth + documented session-auth upgrade trigger), `docs/engineering/feature-flags.md`, `docs/engineering/database-schema.md`, WORK.md T-58 (eval gate is schema-validation-only today)

---

## Context

Sprint 6 shipped the Ops Dashboard as a **read-only** MVP (`web/`, T-57–T-70). It reads via `ops_hub_app` (non-superuser, RLS-bound) over `OPS_HUB_APP_LOGIN_URL`; `service_role` is never touched at runtime (CLAUDE.md non-negotiable #3). Sprint 7 adds the deliberately-deferred **settings / write area**, covering three surfaces:

1. **Per-function model routing** — let the founder pick which LLM each of the three agent functions (Triage, Respond, KB Learn) uses.
2. **SLA target editor** — edit response targets held in `tenants.sla_config`.
3. **Feature-flag toggles** — toggle rows in `feature_flags`.

Two of these are genuine **backend** gaps, not just missing UI:

- **Model routing:** all three functions today read the *same* env var. Verified call sites:
  - `src/inngest/ticket-triage.ts` — `LITELLM_TRIAGE_MODEL ?? "triage-model"` (primary) + `LITELLM_FALLBACK_MODEL ?? "fallback-model"` (fallback). Only Triage has fallback logic.
  - `src/inngest/ticket-respond.ts` (L127, L301) — hardcodes `process.env.LITELLM_TRIAGE_MODEL ?? "triage-model"` inline. No independent config, no model param plumbed through.
  - `src/inngest/kb-learn.ts` (L53, L160) — same inline `LITELLM_TRIAGE_MODEL ?? "triage-model"`.
  - So there is nothing for a UI to point at for Respond/KB Learn — the config does not exist yet.
- **Feature flags:** the `feature_flags` table exists with a full `feature_flags_write FOR ALL to ops_hub_app` RLS policy already in place (`20260618120100_enable_rls_policies.sql`), but zero read/write path in application code and zero UI.

A write surface materially changes the threat model: the read-only dashboard could leak at worst; a write dashboard can *corrupt tenant config, silently change billing posture, or take a production agent function offline.*

Constraints that bound the decision: **provider-neutral** (never name Anthropic/OpenAI in business logic — route via LiteLLM aliases), **app-agnostic** (Project #2 works with config only, nothing hardcoded to TTS), **free-tier-first**, **eval-gated** (no capability change ships without passing Promptfoo), and **least-privilege** (`service_role` never at runtime; don't hand `ops_hub_app` broad new grants).

---

## Decision A — Per-function model routing: a project-scoped DB config table read at invocation

**Introduce a new project-scoped table `agent_model_routing` as the single source of truth for per-function model selection. Each Inngest function resolves its model from this table at invocation (folded into its existing DB transaction), falling back to per-function env-var defaults, then to the registered LiteLLM alias literal.**

### Schema (Tech Lead authors; founder applies as `service_role`)

```
agent_model_routing
  id             uuid primary key default gen_random_uuid()
  project_id     uuid not null references projects(id) on delete cascade
  function_key   text not null check (function_key in ('triage','respond','kb_learn'))
  primary_model  text not null        -- a registered LiteLLM alias string
  fallback_model text                 -- nullable; see "Fallback scope" below
  updated_at     timestamptz not null default now()
  updated_by     text                 -- audit convenience; authoritative record is audit_log
  unique (project_id, function_key)
```

- **Values are LiteLLM alias strings only** (`triage-model`, `fallback-model`, `meta/llama-3.3-70b-instruct`, or any registered alias) — never raw provider model ids. LiteLLM owns the alias→provider mapping (ADR-0004), so storing aliases keeps business logic provider-neutral by construction and app-agnostic (Project #2 brings its own LiteLLM aliases; a new project with no rows falls through to its env defaults).
- **No `environment` column.** Unlike `feature_flags`, this table does not carry dev/staging/prod. Per ADR-0005, staging and prod are the same physical Supabase project distinguished by *rows*; the prod agent container runs with `POLLING_PROJECT_ID = tts-prod` and staging with a different project id. **`project_id` therefore already is the environment/scope boundary**, and it is the axis RLS gates on. Adding a second, un-gated `environment` axis would let config desync from what RLS enforces. **Assumption made explicit for Project #2: a project_id must not be reused across a project's own staging and prod — each environment is a distinct project row** (already true for tts-staging vs tts-prod).

### Read path (backend change)

- New helper `resolveModelRouting(client, projectId, functionKey) → { primary, fallback }`.
- **Precedence:** `agent_model_routing` row (if present) → per-function env default → alias literal. Introduce the missing per-function env defaults (`LITELLM_RESPOND_MODEL`, `LITELLM_KBLEARN_MODEL`) so the backend gap is closed even before any row exists; the table is the dashboard-editable override on top.
- **Fold the read into the function's existing transaction/connection.** Triage already opens two connections per ticket and sets the tenant/project GUC; the routing read rides that same connection — it does **not** open a third. Respond and KB Learn similarly read within their existing DB access. Read-per-invocation (no cache) is correct at current volume (hundreds/day) so a dashboard edit takes effect on the next invocation; caching is a future optimization noted only if volume grows.
- **Fallback scope (resolved, not left implicit):** Sprint 7 keeps fallback behavior as-is — **Triage primary+fallback; Respond and KB Learn primary-only.** The `fallback_model` column exists and is nullable but is populated/consumed only for `triage` this sprint. Adding real fallback *logic* to Respond/KB Learn is separate backend work and a separate capability change (own eval), explicitly out of Sprint 7 scope.

### Dashboard editor

- Model picker is a **dropdown, not a free-text field.** The candidate list is the set of currently-registered LiteLLM aliases. **See threat-model item T-B4 for how that list is obtained without handing the dashboard the LiteLLM master key.**
- On write, the chosen string is validated against the current alias set before persisting — an unknown/typo'd model is rejected so a fat-finger can never take a production function offline.

### What we did NOT do and why

- **Per-function env vars only (no table).** Rejected as the *primary* mechanism: env vars are not dashboard-editable without giving the web app a Coolify-API write path (new powerful surface + a redeploy per edit). Kept as the *fallback/bootstrap* layer only.
- **Extend `projects.context_schema` (jsonb) or `feature_flags`.** Rejected: `context_schema` mirrors Project Context config.json — folding operational routing into it muddies that concern and has no clean per-field write policy or audit story. `feature_flags` is semantically flags, not config values.
- **A second LiteLLM config layer / router service.** Rejected as over-engineering — LiteLLM already is the router; we only need to choose which alias each function names.

---

## Decision B — RLS write model and threat model (three surfaces)

The load-bearing principle for **all** writes: **scope is server-pinned and RLS-enforced, never client-trusted.** The API derives `project_id`/`tenant_id` from the server-side `DASHBOARD_PROJECT_ID`/`DASHBOARD_TENANT_ID` config (`web/lib/project.ts`), sets them as transaction-local GUCs, and every write policy carries a `with check` binding the row to `current_tenant_id()` / `current_project_id()`. Because `ops_hub_app` is `nobypassrls`, a write aimed at the wrong tenant/project is rejected by the `with check` **even if the app code has a bug** — a single-admin dashboard is *not* assumed safe on its own. The client submits only the *value to change* and the *record key*, never a tenant/project id.

### Surface 1 — SLA target edits (`tenants`, tenant-scoped)

- **Today:** `tenants` has a `tenants_select` policy only — **no write policy**, so writes are `service_role`-only and currently impossible from `ops_hub_app`. But note: the initial migration granted `ops_hub_app` table-level `UPDATE` on **all** public tables. So the *grant* already exists; only the missing policy blocks it. Naively adding a policy would open **every** `tenants` column.
- **Least-privilege change required (not just "add a policy"):**
  ```
  REVOKE UPDATE ON tenants FROM ops_hub_app;
  GRANT UPDATE (sla_config) ON tenants TO ops_hub_app;   -- sla_config ONLY
  ```
  plus a new RLS policy:
  ```
  create policy tenants_update_sla on tenants
    for update to ops_hub_app
    using (id = current_tenant_id())
    with check (id = current_tenant_id());
  ```
  Column-level grant means that even a compromised app path cannot change `name`, `tier`, `project_id`, or `sla_tier` — only `sla_config`.
- **T-B3 — `sla_tier` is a billing lever, NOT an SLA target.** `sla_tier = 'premium'` is the +$200 CAD/mo add-on (DECISIONS.md, Pricing Option D). It must be **excluded** from the SLA-target editor's grant (hence `UPDATE (sla_config)` only, deliberately omitting `sla_tier`). If the dashboard could write `sla_tier` it would silently become a billing control. Tier changes stay a separate, out-of-scope action. The Sprint-6 mockup frames this surface around `sla_config` targets, which matches.
- **Input validation:** `response_target_minutes` (and any per-urgency targets) must be bounded positive integers; write via `jsonb_set` on specific keys, not a blind blob overwrite that could drop the premium structure.

### Surface 2 — Model-routing edits (`agent_model_routing`, project-scoped)

- New table → new policies. Grant `SELECT, INSERT, UPDATE` (the `alter default privileges` in the RLS migration will auto-grant all four verbs to `ops_hub_app` on any new public table — so **explicitly `REVOKE DELETE`** to keep this edit-not-delete). Policies:
  ```
  create policy amr_select on agent_model_routing
    for select to ops_hub_app, authenticated
    using (project_id = current_project_id());
  create policy amr_insert on agent_model_routing
    for insert to ops_hub_app
    with check (project_id = current_project_id());
  create policy amr_update on agent_model_routing
    for update to ops_hub_app
    using (project_id = current_project_id())
    with check (project_id = current_project_id());
  -- no delete policy: routing rows are edited, not deleted.
  ```
- Cross-project write is denied by the `with check`; the server never accepts a project id from the client.
- **T-B4 — new credential surface (Security Lead decision required).** The model-validation dropdown needs the set of registered LiteLLM aliases. The dashboard container today holds **only** `OPS_HUB_APP_LOGIN_URL` — it does **not** hold `LITELLM_URL` or a LiteLLM key. Options, in order of preference:
  - **(a) Static curated allowlist** (config/env in the dashboard): zero new secret, ties naturally to the eval reconciliation below (only pre-evaled aliases are selectable). **Recommended.**
  - (b) Server-side cached fetch of `/model/info` using a **read-limited** LiteLLM key (not the master key), refreshed on an interval — adds one scoped secret.
  - (c) Persist the alias list into a small DB table that a backend job refreshes — no new dashboard secret, more moving parts.
  - Rejected: giving the dashboard the LiteLLM **master key** (powerful; can register/delete models) — disproportionate to a dropdown.
- **T-B1 — the eval-gate collision (Evals Lead decision required, highest-priority).** A dashboard-editable model router is a **runtime capability change that bypasses CI** — exactly what the standing "no capability change ships without passing Promptfoo >95%" rule governs. And per WORK.md T-58, the Promptfoo gate is **schema-validation-only today** — there is no live model-quality eval, so a naive "Evals Lead signs off in CI" step is currently a no-op. This must be reconciled explicitly, not left unstated. Options:
  - **(a) Restrict the dropdown to a curated set of pre-evaled aliases** (pairs with T-B4 option (a)). Any alias in the list has already passed an eval; runtime selection among them is safe. **Recommended for Sprint 7.**
  - (b) Make the real live-model eval gate a hard Sprint-7 dependency before the router ships (larger scope; Evals Lead territory).
  - (c) Founder explicitly accepts runtime-swap risk for a single-operator dashboard.
  - The ADR records (a) as the recommendation; final call is Evals Lead + founder.

### Surface 3 — Feature-flag toggles (`feature_flags`, project-scoped)

- **Finding: the DB write path already fully exists.** `feature_flags_write FOR ALL to ops_hub_app` (project-scoped, with-check) is in place and is the path agents use per `feature-flags.md`. **No new RLS work is required here.**
- **But `FOR ALL` is broader than a toggle needs** (it includes INSERT of arbitrary flags and DELETE). Least-privilege at the **API layer**, not the DB layer: the dashboard write route only issues `UPDATE (enabled, rollout_percentage)` on **existing** rows in scope; it does **not** expose flag create/delete. Flag *creation* stays a Tech-Lead/migration action per the `feature-flags.md` authority table. This matches that table's "Toggle a flag in prod → Production Manager (with founder approval for tenant-facing flags)" — the founder-operated dashboard is an appropriate toggle surface.
- Leave the existing DB policy unchanged (agents legitimately use its full breadth); constrain only what the dashboard surface can emit.

### Audit trail (all three surfaces)

- **Destination: `audit_log`.** The CLAUDE.md "key facts" list names `agent_actions`/`ticket_events`, but **those tables do not exist** — verified against every migration. The real, append-only, SOC-2 evidence table is `audit_log`. Do **not** create a new table; one audit trail.
- **Every settings write emits an `audit_log` row in the SAME transaction as the config change** — atomic: either both commit or neither. There is never a config change without an audit record. This is stronger than the agent-path pattern (which logs breaches in a separate step).
  - `actor` = the dashboard identity (see T-B2), `action` = `sla_config.update` | `model_routing.update` | `feature_flag.toggle`, `resource_type`/`resource_id` = the edited row, `payload` = `{ before, after }`.
  - **Tenant vs project stamping:** SLA edits are tenant-scoped → stamp `tenant_id`. Model-routing and flag toggles are project-scoped → stamp `tenant_id = NULL`, `project_id` set. The `audit_log_insert` policy is `with check (true)` so both insert cleanly; T-66 already widened `audit_log_select_platform` so NULL-tenant platform rows are readable via the platform-incidents feed. The plumbing exists.

### T-B2 — Auth identity (Security Lead + founder decision; may gate go-live)

The dashboard sits behind Traefik **Basic Auth** (a single shared `opsadmin` credential — DECISIONS.md 2026-07-04 T-57). That decision **explicitly documented that the write area is the trigger to upgrade to per-user session auth.** Sprint 7 *is* that trigger. Consequence for the audit trail: with a single shared credential, `audit_log.actor` can only record "the dashboard," not an individual human. Decision required:
- **(a)** Upgrade the write surface to per-user session auth (individual actor attribution), or
- **(b)** Founder explicitly accepts single-shared-credential audit granularity for a single-operator dashboard.

This is a genuine security/business call, not a technical default. Flagged here for Security Lead + founder; whichever is chosen must be recorded before the write surface goes live.

### Other write-layer controls (Security Lead review checklist)

- **CSRF / state-change protection.** Basic Auth is auto-attached by the browser to same-origin requests, so a state-changing write route needs its own defense: require a custom header / CSRF token on writes and/or check `Origin`/`Referer` server-side. Write routes are POST/PUT only; no state change on GET.
- **SQL injection:** all writes fully parameterized (same discipline as existing code); no string-interpolated identifiers.
- **Fail-closed:** if the GUC isn't set (bug), RLS returns/writes zero rows rather than defaulting to a wrong scope.

---

## Consequences

- **Positive:** Respond/KB Learn get independent, editable routing for the first time; the change is provider-neutral and app-agnostic (Project #2 = config only); least-privilege is *improved* (SLA edit tightens the pre-existing broad `tenants` UPDATE grant); one audit trail covers all writes atomically; the model-picker-from-curated-allowlist design resolves the eval-gate bypass without waiting on a live eval gate.
- **Negative / accepted:** a new table + backend read-path change (small, folded into existing transactions); the write surface forces the T-57 auth-upgrade decision now; a curated allowlist means adding a new model is a config/eval action, not a free-text dashboard entry (intended).
- **Open items that must resolve before go-live:** T-B1 (eval reconciliation — Evals Lead), T-B2 (auth identity — Security Lead + founder), T-B3 (`sla_tier` excluded from grant — encoded above), T-B4 (LiteLLM credential surface — Security Lead).

---

## Security Lead Review

*(pending — to be appended, as in ADR-0003/0004)*

## Evals Lead Review

- **Reviewer:** Evals Lead (Prompt Quality)
- **Date:** 2026-07-08
- **Scope:** T-B1 only — reconciliation of the dashboard-editable model router against the standing eval gate. (T-B4's credential surface is Security Lead's call in the section above; the resolution below happens to give T-B4 option (a) for free.)
- **Verdict:** **RESOLVED, adopt ADR option (a) — a curated per-function allowlist. No FOUNDER_QUEUE escalation.** This is an agent-owned technical call (CONSTITUTION "could a senior engineer answer this by reading the repo?" → yes). The trip-wire (option (c), accepting raw runtime-swap risk, which would relax a standing CLAUDE.md constraint) was **not hit** — see KB Learn below.

- **What is actually true today (the finding that shapes the wording):**
  - Only **Triage** and **Respond** have dedicated prompt evals (`evals/ticket-triage.yaml`, `evals/ticket-respond.yaml`). **KB Learn has no eval file** — confirmed against the full `evals/` listing.
  - Both pipeline evals pin the **prompt contract** against one reference model, `anthropic:claude-sonnet-4-6`. Production routes each prompt through a **LiteLLM alias**, which resolves elsewhere (`triage-model` currently → `gpt-4o-mini`; `meta/llama-3.3-70b-instruct` → NVIDIA NIM). And per T-58 the CI Eval Gate is **schema-validation-only**. **Net: no alias has a live per-target-model quality pass.** So the allowlist must NOT be described as "eval-tested aliases" — that would contradict this repo's own T-58/T-B1 finding.
  - The three currently-registered aliases (`triage-model`, `fallback-model`, `meta/llama-3.3-70b-instruct`) are confirmed live and persistent per DECISIONS.md 2026-07-04 (FQ-53 closeout).

- **The honest inclusion criterion (what "curated" means here):** an alias is in a function's list iff (1) it is a currently-registered LiteLLM alias **and** (2) it is the model that function **already runs in production today** (verified call sites: `ticket-triage.ts` = `triage-model` primary + `fallback-model` fallback; `ticket-respond.ts` and `kb-learn.ts` = `triage-model`). The allowlist **freezes the production-accepted choice-set so the dashboard can only choose among vetted models, never introduce a new one.** It is a *constraint on selection*, not a live eval pass — that is the true, defensible guarantee, and it is exactly what T-B1 asks for.

- **Published allowlist (the concrete artifact T-73 and T-75 consume):** `src/config/model-allowlist.ts` — a small typed per-function const keyed to T-72's `function_key` CHECK literals:
  - `triage: ["triage-model", "fallback-model"]` — the only function with both slots in production + prompt-eval coverage of both.
  - `respond: ["triage-model"]` — primary-only this sprint; prompt-eval covered.
  - `kb_learn: ["triage-model"]` — primary-only; see below.
  - **`meta/llama-3.3-70b-instruct` is deliberately EXCLUDED** from every list: registered, but the legacy standalone NVIDIA alias and not the current production model of any function. Exposing it in the dropdown would be precisely the un-vetted runtime swap this resolution exists to prevent. (Registration ≠ selectability.)

- **KB Learn (why the trip-wire did NOT fire):** KB Learn has no prompt eval, but pinning its list to its single current production model (`["triage-model"]`, a choice-set of one) **eliminates** runtime-swap risk rather than accepting it — it is the status quo made non-expandable, the opposite of option (c). No standing constraint is relaxed, so no escalation. **Coverage-gap follow-up logged (Evals Lead, non-blocking):** author `evals/kb-learn.yaml`; until it exists, KB Learn's list cannot grow past `triage-model`.

- **Process (also in the artifact's header):** the list is append-controlled, not free-text. Adding a new selectable alias requires: (1) register it in LiteLLM; (2) run that function's promptfoo eval against **that alias's target model** (not just the pinned `claude-sonnet-4-6` reference), clear **>95%**, record in DECISIONS.md — a manual multi-provider `promptfoo eval` run via LiteLLM until the live gate (option (b)) ships in Sprint 8; (3) add the alias in the same PR that records the result. Removing an alias needs no eval.

- **Scope boundary (pre-empting an over-read):** this allowlist constrains which aliases the dashboard may **select**; it does **not** constrain what each alias **resolves to** inside LiteLLM — remapping an alias to a different provider is a LiteLLM master-key admin action, out of this surface's scope (ties to T-B4).

- **Sign-off / handoff:** **T-73 is unblocked.** Its `resolveModelRouting()` must validate any persisted/edited routing value against `src/config/model-allowlist.ts` (reject out-of-list values, fail-closed). **T-75's** dropdown sources its options from the same file and re-validates before submit. `web/` is a separate tsconfig — if it cannot import across the boundary it must mirror the file with a source-of-truth pointer, both updated together.
