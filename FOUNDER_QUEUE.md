# FOUNDER_QUEUE.md — Escalations to Founder

> Items needing founder input. Polled by founder 1–2x per day. All other decisions are agent-owned per RACI in `05_people_and_process.md`.

---

## Emergency stop

```
EMERGENCY_STOP: false
```

Setting `EMERGENCY_STOP: true` halts all agent activity immediately. Used only in genuine emergencies (security incident, runaway cost, suspected compromise). Restore to `false` after the situation is contained.

---

## Format

```
[Severity tag] [Agent name] Ask summary
        Context: <1–3 lines>
        Impact if delayed: <what happens if founder doesn't respond>
        Linked: <ticket / ADR / file references>
```

Severity tags:

| Tag | When to use | Founder response time |
|---|---|---|
| `URGENT:` | P1 incident, security signal, financial decision | < 1 hour |
| `BLOCKING:` | Agent cannot continue without answer | < 4 hours |
| *(none)* | Standard ask | < 24 hours |

Founder responds ONLY to business logic and UI/UX decisions.
All technical decisions (security, architecture, tooling, configuration) are made by the
relevant agent and presented as recommendations — not questions. Agents must bring a
recommendation WITH rationale, not a choice between options.

Founder response types:
- `APPROVED:` — business/UX decision accepted
- `REJECTED:` [reason] — business/UX decision declined
- `MORE INFO:` [specific business question] — only when business context is genuinely missing

After founder responds, the originating agent removes the item from this queue and proceeds. Resolved items archive to `docs/founder-queue-archive/YYYY-MM.md` weekly.

---

## Open queue

---

### FQ-38 — BLOCKING: [Tech Lead] Rebuild Ops Hub schema after DB reset — paste 5 migrations in Supabase SQL Editor

```
BLOCKING: Supabase project yocoljutbiizdbfraapx DB reset wiped all public-schema tables.
  No backup/PITR on free tier. Role ops_hub_app_login and Vault secrets confirmed surviving.
  Schema must be rebuilt from the 5 migration files in the repo.
  ticket-triage (T-22) is broken until this is done: tickets table does not exist.

Safety analysis — all 5 migrations are safe to re-run in this exact state:
  Migration 1 (initial_schema): CREATE TABLE has no IF NOT EXISTS, but tables are gone —
    no conflict possible. Extensions use IF NOT EXISTS. Trigger function uses CREATE OR REPLACE.
    ✅ safe.
  Migration 2 (rls_policies): ops_hub_app role creation uses DO $$ IF NOT EXISTS guard.
    Grants are idempotent (re-granting is a no-op). CREATE POLICY has no IF NOT EXISTS guard,
    but policies don't exist yet (tables were just created). CREATE OR REPLACE on resolver fns.
    ✅ safe for this run. NOTE: not idempotent if run a second time — don't paste twice.
  Migration 3 (kb_seed): project insert uses ON CONFLICT DO NOTHING. KB article inserts have
    no ON CONFLICT guard but kb_articles is empty — no uniqueness conflict possible.
    ✅ safe.
  Migration 4 (t21_freescout_intake): ALTER TABLE ADD COLUMN IF NOT EXISTS. Tenant insert
    uses ON CONFLICT (id) DO NOTHING. ✅ fully idempotent.
  Migration 5 (t22_ticket_triage_columns): all ALTER TABLE ADD COLUMN IF NOT EXISTS +
    CREATE INDEX IF NOT EXISTS. ✅ fully idempotent.

FreeScout GRANT status: DB reset wiped the public schema, which also dropped the FreeScout
  tables (conversations, threads) that were co-tenanted there. The GRANT from FQ-34 is gone
  with those tables. After the schema rebuild below:
    1. Restart the FreeScout container (or wait for its next health-check restart) so Laravel
       re-runs its migrations and recreates conversations + threads.
    2. Re-issue the GRANT from FQ-34 (exact command below).
  T-21 (pollFreeScout) will fail until both steps are done.

Post-rebuild: ops-hub-app does NOT need a restart — the PG pool reconnects on next query
  and will see the rebuilt schema automatically.
```

**Action: paste the SQL below into Supabase SQL Editor (project yocoljutbiizdbfraapx) as service_role. Run as one block.**

```sql
-- ============================================================
-- OPS HUB SCHEMA REBUILD — run in Supabase SQL Editor
-- Project: yocoljutbiizdbfraapx
-- Date: 2026-06-25
-- Prerequisite: public schema is empty (DB reset confirmed).
-- ops_hub_app_login role and Vault secrets are confirmed present.
-- ============================================================


-- ── MIGRATION 1: initial_schema (20260618120000) ─────────────

create extension if not exists vector;
create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create table projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  context_schema  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete restrict,
  name        text not null,
  tier        text not null check (tier in ('starter', 'growth', 'scale')),
  sla_config  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index tenants_project_id_idx on tenants (project_id);

create table tickets (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete restrict,
  tenant_id    uuid not null references tenants(id) on delete restrict,
  title        text not null,
  body         text,
  severity     text not null check (severity in ('P1', 'P2', 'P3')),
  state        text not null default 'new'
                 check (state in (
                   'new','triaged','investigating','in_progress','blocked',
                   'in_review','staged','deploying','verifying','resolved',
                   'closed','reopened','wont_fix','duplicate')),
  owner_agent  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tickets_project_tenant_idx on tickets (project_id, tenant_id);
create index tickets_state_idx          on tickets (state);
create index tickets_severity_idx       on tickets (severity);
create trigger tickets_set_updated_at
  before update on tickets
  for each row execute function set_updated_at();

create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references projects(id) on delete set null,
  tenant_id      uuid references tenants(id)  on delete set null,
  timestamp      timestamptz not null default now(),
  actor          text not null,
  action         text not null,
  resource_type  text not null,
  resource_id    uuid,
  payload        jsonb not null default '{}'::jsonb
);
create index audit_log_project_tenant_ts_idx on audit_log (project_id, tenant_id, timestamp);
create index audit_log_resource_idx          on audit_log (resource_type, resource_id);

create table feature_flags (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  environment         text not null check (environment in ('dev', 'staging', 'prod')),
  flag_key            text not null,
  enabled             boolean not null default false,
  rollout_percentage  int not null default 0 check (rollout_percentage between 0 and 100),
  description         text,
  sunset_date         date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, environment, flag_key)
);
create trigger feature_flags_set_updated_at
  before update on feature_flags
  for each row execute function set_updated_at();

create table kb_articles (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  title       text not null,
  body        text not null,
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);
create index kb_articles_project_id_idx on kb_articles (project_id);


-- ── MIGRATION 2: rls_policies (20260618120100) ───────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ops_hub_app') then
    create role ops_hub_app nologin;
  end if;
end $$;

grant usage on schema public to ops_hub_app;
grant select, insert, update, delete on all tables in schema public to ops_hub_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to ops_hub_app;

create or replace function current_tenant_id() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
    nullif(current_setting('app.current_tenant', true), '')::uuid
  );
$$;

create or replace function current_project_id() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'project_id', '')::uuid,
    nullif(current_setting('app.current_project', true), '')::uuid
  );
$$;

alter table projects      enable row level security;
alter table tenants       enable row level security;
alter table tickets       enable row level security;
alter table audit_log     enable row level security;
alter table feature_flags enable row level security;
alter table kb_articles   enable row level security;

create policy projects_select      on projects      for select to ops_hub_app, authenticated using (id = current_project_id());
create policy tenants_select       on tenants       for select to ops_hub_app, authenticated using (id = current_tenant_id());
create policy tickets_select       on tickets       for select to ops_hub_app, authenticated using (tenant_id = current_tenant_id());
create policy tickets_insert       on tickets       for insert to ops_hub_app, authenticated with check (tenant_id = current_tenant_id());
create policy tickets_update       on tickets       for update to ops_hub_app, authenticated using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy audit_log_insert     on audit_log     for insert to ops_hub_app             with check (true);
create policy audit_log_select     on audit_log     for select to ops_hub_app, authenticated using (tenant_id = current_tenant_id());
create policy feature_flags_select on feature_flags for select to ops_hub_app, authenticated using (project_id = current_project_id());
create policy feature_flags_write  on feature_flags for all    to ops_hub_app             using (project_id = current_project_id()) with check (project_id = current_project_id());
create policy kb_articles_select   on kb_articles   for select to ops_hub_app, authenticated using (project_id = current_project_id());
create policy kb_articles_write    on kb_articles   for all    to ops_hub_app             using (project_id = current_project_id()) with check (project_id = current_project_id());


-- ── MIGRATION 3: kb_seed (20260621130000) ────────────────────

insert into projects (id, name, context_schema)
values ('00000000-0000-0000-0000-000000000001', 'ops-hub', '{}')
on conflict (name) do nothing;

insert into kb_articles (project_id, title, body) values
('00000000-0000-0000-0000-000000000001', 'Ops Hub — Getting Started',
 'Placeholder: overview of the Ops Hub platform, agent roles, and ticket flow. To be expanded in Sprint 2.'),
('00000000-0000-0000-0000-000000000001', 'FreeScout → Ops Hub ticket intake runbook',
 'Placeholder: steps for routing a FreeScout ticket through the triage agent. To be expanded after T-19.');


-- ── MIGRATION 4: t21_freescout_intake (20260623180000) ───────

alter table tickets add column if not exists freescout_conversation_id bigint unique;

insert into tenants (id, project_id, name, tier)
values ('00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-000000000001',
        'staging-support', 'starter')
on conflict (id) do nothing;


-- ── MIGRATION 5: t22_ticket_triage_columns (20260624000000) ──

alter table tickets add column if not exists urgency  text check (urgency in ('critical', 'high', 'normal', 'low'));
alter table tickets add column if not exists category text;
alter table tickets add column if not exists routing  text;
create index if not exists tickets_urgency_idx on tickets (urgency);


-- ── POST-RUN VERIFICATION ─────────────────────────────────────
-- Run this block separately after the above completes.
-- Expected: 6 tables, 1 project, 1 tenant, 2 kb_articles.

select tablename from pg_tables where schemaname = 'public' order by tablename;
select count(*) as projects  from projects;
select count(*) as tenants   from tenants;
select count(*) as kb_articles from kb_articles;
select column_name from information_schema.columns
  where table_name = 'tickets' order by ordinal_position;
```

**After verification passes — re-issue the FreeScout GRANT (FQ-34):**

Wait for FreeScout to reconnect and re-run its Laravel migrations (conversations + threads will reappear in the Table Editor). Then run:

```sql
-- Run in Supabase SQL Editor AFTER conversations + threads are visible in Table Editor.
-- This re-issues the GRANT that was lost with the reset.
-- Must be run AS freescout_user (same method as FQ-34: docker exec on FreeScout container).
```

Exact FQ-34 re-issue command (run on FreeScout container, same as before):
```
docker exec <freescout-container-name> php artisan tinker --execute="DB::statement('GRANT SELECT ON conversations, threads TO ops_hub_app');"
```

Container name: check `docker ps` on VPS or Coolify → FreeScout service → Container name.

```
Linked: T-21 (PR #140), T-22 (PR #141), FQ-31, FQ-34 (GRANT must be re-issued after FreeScout remigrates)
```

---

### ~~FQ-36 — URGENT: [Tech Lead] Fix LITELLM_URL in Coolify — wrong URL causes TLS failure, ticket triage broken~~ — PARTIAL: TLS fixed, now Docker networking

```
PARTIAL: Founder applied the manual fix (LITELLM_URL → http://litellm-staging:4000).
  TLS error resolved ✅ but triage now fails with a ~3m TIMEOUT instead.
  Diagnosis: ETIMEDOUT = SYN dropped = Docker network isolation.
  'litellm-staging' hostname resolves but port 4000 is unreachable from ops-hub-app.
  See FQ-37 for the active investigation and fix.
Linked: FQ-37 (active)
```

---

### FQ-37 — URGENT: [Tech Lead] LiteLLM unreachable from ops-hub-app — Docker network isolation

```
URGENT: [Tech Lead] T-22 ticket triage is timing out after ~3 min on every run:
  TypeError: fetch failed  (30s timeout added by PR #143 — surface time cut to 30s)

Root cause (high confidence): ops-hub-app and litellm-staging are in DIFFERENT Coolify
  projects. Coolify assigns each project its own Docker network. Service-to-service
  hostnames like 'litellm-staging' only resolve within the same project/network.
  Diagnosis: ETIMEDOUT (SYN dropped, ~3 min) = name resolves, but packets are dropped
  between network segments. ENOTFOUND would indicate DNS failure; ECONNREFUSED would
  indicate wrong port — neither applies here.

Awaiting: Run diagnose-litellm.yml after merging PR #143 to confirm the project mismatch
  and identify which URL works from inside the ops-hub-app container.

--- Interim fix (1 minute, manual) ---

  In Coolify → ops-hub-app → Environment Variables:
  CHANGE  LITELLM_URL  from: http://litellm-staging:4000
                         to: http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io

  This hairpin-NAT URL exits the container to the VPS's own public IP on port 80 and
  re-enters via Traefik → litellm-staging. It works regardless of Docker network topology.
  CONFIRMED reachable from GitHub Actions runner (external). After Coolify change, restart
  ops-hub-app to apply.

  NOTE: Do NOT use port 80 if there's a redirect to HTTPS — check that the HTTP URL
  returns 200, not 301. If it redirects, add the FQDN cert fix first (see PR #143 step B).

--- Permanent fix (recommended, after PR #143 merges) ---

  Option A — Connect to same network (cleanest, one-time):
    Coolify dashboard → litellm-staging → Settings → Connected Networks
    Add the same network as ops-hub-app (likely 'coolify' or the ops-hub-staging network).
    After this, 'http://litellm-staging:4000' will resolve correctly.
    Set LITELLM_URL back to http://litellm-staging:4000 and restart ops-hub-app.

  Option B — Use sslip.io HTTP URL (already works, minimal change):
    Set LITELLM_URL=http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io in Coolify.
    The fix-litellm-tls.yml workflow (PR #143) will do this automatically.

Impact if delayed: T-22 cannot be validated. Conv 6+7 remain at state='new'. T-23 blocked.
Linked: T-22 (PR #141), FQ-35/FQ-36 (resolved), PR #143
```

---

### ~~FQ-35 — BLOCKING: [Tech Lead] Run T-22 migration + add LITELLM env vars to Coolify ops-hub-app~~ — PARTIALLY RESOLVED

```
PARTIAL: Actions 1 (migration) and 2 (LITELLM_MASTER_KEY) appear complete — ticket-triage
  runs are firing and reaching LiteLLM. However LITELLM_URL was set to the wrong value
  (https:// URL with a self-signed cert). See FQ-36 for the corrective action.
Linked: FQ-36 (active)
```

---

### ~~FQ-32 — [Tech Lead] Add OPS_HUB_APP_LOGIN_URL env var to Coolify ops-hub-app~~ — SUPERSEDED by FQ-33

```
RESOLVED (env var added) but with incorrect username format — missing project ref suffix.
Supabase session pooler requires ops_hub_app_login.yocoljutbiizdbfraapx as the username,
not ops_hub_app_login. pollFreeScout is failing with ENOIDENTIFIER.
See FQ-33 for the corrected value.
```

---

### ~~FQ-33 — BLOCKING: [Tech Lead] Fix OPS_HUB_APP_LOGIN_URL — username missing project ref suffix~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — OPS_HUB_APP_LOGIN_URL updated with correct
  .yocoljutbiizdbfraapx suffix. pollFreeScout now connects successfully.
  T-21 verified end-to-end: two tickets ingested (freescout_conversation_id: 6 + 7).
  Linked: T-21 (PR #140), FQ-32 (superseded)
```

---

### ~~FQ-34 — BLOCKING: [Tech Lead] Run GRANT as freescout_user via docker exec~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — GRANT SELECT ON conversations, threads TO ops_hub_app
  executed via docker exec artisan tinker. pollFreeScout can now SELECT from both tables.
  T-21 verified end-to-end.
  Linked: T-21 (PR #140), FQ-31, DECISIONS.md 2026-06-23
```

---

### ~~FQ-31 — [Tech Lead] Apply T-21 migration in Supabase SQL Editor~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — T-21 migration applied (freescout_conversation_id column
  added to tickets; staging-support tenant seeded). T-21 verified end-to-end.
  Linked: T-21 (PR #140)
```

---


### FQ-30 — [Tech Lead] Remove FREESCOUT_API_KEY from Coolify ops-hub-app env vars (cleanup)

```
[Tech Lead] Sprint 2 is now using Supabase direct polling (DECISIONS.md 2026-06-23) —
  the FreeScout REST API is no longer part of the architecture. FREESCOUT_API_KEY was
  added to Coolify ops-hub-app env vars for the now-abandoned PT-2 approach and should
  be removed.

Action: Coolify dashboard -> ops-hub-app -> Environment -> delete FREESCOUT_API_KEY.

Non-blocking. No urgency — can be done at next convenience before Sprint 2 closes.
Linked: DECISIONS.md 2026-06-23 (T-21 Supabase direct polling pivot)
```

---

### ~~FQ-28 — [Production Manager] FreeScout admin access for Sprint 2 pre-sprint ops~~ — SUPERSEDED by FQ-30

```
[Production Manager] Sprint 2 pre-sprint ops (PT-1 + PT-2) need FreeScout admin access.

Context: Two configuration steps are needed before the AI pipeline can be wired up:
  PT-1: Add a webhook in FreeScout admin (Settings → Webhooks) pointing to
        https://ops-hub-staging.inatechshell.ca/api/webhooks/freescout
        (events: Conversation Created, Conversation Updated)
  PT-2: Generate a FreeScout API key (Profile → API Access) and provide it so
        Production Manager can store it in Coolify as FREESCOUT_API_KEY.

Recommendation: Production Manager will attempt both via browser automation using the
  FreeScout admin account (haytham@inatechshell.ca). If a saved browser session exists
  this can proceed without founder involvement.

Impact if delayed: T-21 (webhook receiver) cannot be tested E2E; T-23 (auto-response)
  cannot POST replies to FreeScout. Both are on the Sprint 2 critical path.

Linked: T-21, T-23, PT-1, PT-2, Sprint 2 plan
```

---

### FQ-29 — [Solutions Architect] Confirm DNC project scope for T-27 (M1 criterion #12)

```
[Solutions Architect] T-27 scope requires clarification on what "DNC" refers to.

Context: M1 criterion #12 is "DNC tickets flowing through Ops Hub." Before T-27 can be
  scoped, the Solutions Architect needs to know:
  (a) Is DNC a specific client project to onboard?
  (b) Or is DNC a ticket type/compliance category (e.g. Do-Not-Contact)?
  (c) What does a DNC ticket look like — example subject/body?

Recommendation: Please confirm in one sentence. Once confirmed, Solutions Architect
  will own the full T-27 implementation with no further input needed.

Impact if delayed: T-27 cannot be scoped; M1 criterion #12 cannot close. Non-blocking
  for T-21–T-26 (AI pipeline can be built and drilled before T-27 starts).

Linked: T-27, M1 criterion #12
```

---

### ~~FQ-27 — BLOCKING: litellm-staging 502 — Traefik port mismatch~~ — RESOLVED

```
RESOLVED: [Production Manager] 2026-06-23 — Fully automated fix. No founder action taken.
  Root cause: Coolify deployed litellm-staging with Traefik loadbalancer.server.port=80;
    LiteLLM listens on port 4000. Every request hit port 80 (nothing) → 502.
  Fix path (PRs #119–#125):
    1. Decoded base64 custom_labels from Coolify API
    2. Replaced port=80 → port=4000 in Traefik + Caddy label refs (sed)
    3. Re-encoded as base64 — PATCH /applications/{uuid} HTTP 200
    4. POST /stop → POST /start: container recreated with correct Traefik labels
    5. Health poll: HTTP 200 ✅ (litellm-staging.inatechshell.ca reachable)
    6. configure-litellm-nvidia.yml auto-dispatched and succeeded:
       POST /model/new HTTP 200 — meta/llama-3.3-70b-instruct registered in LiteLLM DB
       GET /model/info — 1 entry confirmed ✅
  T-08 ✅ DONE. M1 criterion #4 complete.
  Linked: T-08, PRs #119–#125, runs #28043591139 + #28043673055
```

---

### ~~FQ-26 — BLOCKING: Verify litellm-staging container health + env vars~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — litellm-staging confirmed Running (up 20 minutes).
  All env vars present: DATABASE_URL ✅, LITELLM_MASTER_KEY ✅, STORE_MODEL_IN_DB=True ✅,
  NVIDIA_API_KEY ✅. Workflow re-triggered. A new issue was subsequently found (see FQ-27).
  Linked: T-08, FQ-27
```

---

### ~~FQ-25 — BLOCKING: LITELLM_MASTER_KEY + NVIDIA_API_KEY GitHub secrets not resolving~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — Both secrets confirmed set in GitHub Actions:
  LITELLM_MASTER_KEY ✅ and NVIDIA_API_KEY ✅. Workflow re-triggered successfully.
  Linked: T-08, FQ-26
```

---

### ~~FQ-24 — BLOCKING: Set FreeScout custom domain in Coolify dashboard~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — FQDN set in Coolify UI for freescout-staging.
  Caddy now routes https://freescout-staging.inatechshell.ca to the FreeScout container.
  FreeScout confirmed live. Admin email updated to support@inatechshell.ca.
  T-10 ✅ DONE. M1 criterion #6 complete. Sprint 2 E2E test path unblocked.
  Linked: T-10, PRs #98–#109, run #28002846589
```

---

### ~~FQ-22 — BLOCKING: Add FREESCOUT_DB_PASS secret~~ — RESOLVED (superseded by FQ-23)

```
RESOLVED: [Founder] 2026-06-23 — FREESCOUT_DB_PASS secret added. However, v3 redeploy
  (run #28000210274) revealed a new blocker: the Supabase master password contains an
  '@' character. The psql client inside nfrastack/freescout splits the connection URL
  on the FIRST '@', making the host resolve to '24zakhsh@pooler-hostname' — DNS fails.
  New action needed: see FQ-23 BLOCKING below.
  Linked: T-10, FQ-23
```

---

### ~~FQ-23 — BLOCKING: Create dedicated FreeScout DB user in Supabase~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — freescout_user created in Supabase SQL Editor;
  FREESCOUT_DB_PASS updated to FreeScoutStaging2026.
  Production Manager updated workflow DB_USER → freescout_user.yocoljutbiizdbfraapx
  (PR #104) and ran v3 redeploy (run #28001287578).

  Container logs confirmed success:
    - Empty database detected → migrations ran
    - Admin user created: mai@leelaecospa.com
    - nginx + php-fpm started
    - HTTP 200 at https://freescout-staging.inatechshell.ca

  T-10 DONE. M1 criterion #6 complete. Sprint 2 E2E test unblocked.
  Linked: T-10, PR #104, run #28001287578
```

---

### ~~FQ-18 — One-time action: Change ops-hub-app domain to HTTPS in Coolify dashboard (T-07 blocker)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — DNS A record added (ops-hub-staging.inatechshell.ca →
  187.124.76.235), domain set to https://ops-hub-staging.inatechshell.ca in Coolify,
  app restarted. Inngest Cloud app synced successfully at
  https://ops-hub-staging.inatechshell.ca/api/inngest. ops-hub registered in Inngest
  Production environment. T-07 complete. T-09 and T-13 unblocked.
  Linked: T-07, FQ-13 (resolved), PR #78/79/80
```

---

### ~~FQ-17 — One-time action: Create 3 UptimeRobot monitors manually (API blocked by free plan)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-23 — 3 monitors created manually in UptimeRobot dashboard
  (free plan blocks newMonitor API — confirmed via getAccountDetails, active_subscription:null).
  Active monitors:
    1. ops-hub-staging health → https://ops-hub-staging.inatechshell.ca/health
    2. litellm-staging health → https://litellm-staging.inatechshell.ca/health
    3. TTS app health         → TTS app URL
  Note: /api/inngest monitor deleted — Inngest returns 405 on GET by design (signed POST
  required); uptime monitors using GET would generate constant false alerts.
  T-14 ✅ Done. M1 criterion #9 ✅ Done. Sprint 1: 20/20 (100%).
```

---

### ~~FQ-16 — One-time action: Execute T-12 Vault setup (5-step SQL in Supabase SQL Editor)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — T-12 Vault setup complete. All security checks passed:
  - ops_hub_app_login role created (login=true, bypassrls=false)
  - langfuse_secret_key stored in Vault
  - ops_hub_app_password stored in Vault
  - internal.get_secret() accessor created
  - anon/authenticated have no accessor access
  - ops_hub_app cannot read vault directly
  T-12 done. T-18 integration test unblocked (can now run against real ops_hub_app_login path).
  Linked: T-12 (PR #69), T-18 (PR #72), docs/engineering/t12-vault-runbook.md
```

---

### ~~FQ-15 — One-time action: Run T-11 Supabase migrations (runbook ready, gate cleared)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-21 — T-11 migrations applied via Supabase SQL Editor.
  All 6 tables verified in public schema. LiteLLM tables also present (expected —
  STORE_MODEL_IN_DB=True). T-12 (Vault setup) now unblocked. T-19 and T-20 unblocked.
  T-18 unblocks after T-12.
  Linked: T-11, T-12, T-18, T-19, T-20
```

---

### ~~FQ-14 — One-time action: UptimeRobot monitor setup (3 staging URLs)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — Option A complete. UPTIMEROBOT_API_KEY set in GitHub
  Actions secrets. Agents unblocked to create monitors. T-14 in flight.
  Linked: T-14, WORK.md
```

---

### ~~FQ-13 — One-time action: Inngest Cloud app provisioning (signing key + event key)~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-22 — INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY set in
  Coolify env vars for ops-hub-app. Container redeploys on next PR merge to main.
  Pending founder action: after redeploy, verify /api/inngest returns 200 with
  introspection JSON; send test/hello.world event from Inngest Cloud dashboard to
  confirm helloWorld function executes.
  Linked: T-07, PR #49 (merged), WORK.md
```

---

### ~~FQ-12 — One-time action: GHCR auth on Coolify VPS~~ — RESOLVED

```
RESOLVED: [Founder] 2026-06-21 — Option B chosen: docker login ghcr.io configured on
  Coolify VPS with read:packages PAT. Login confirmed successful. VPS can now pull
  private GHCR images. T-07 Inngest staging deploy unblocked.
  Linked: PRs #53–#55, T-07
```

---

### ~~FQ-11 — T-10 FreeScout: Supabase Supavisor pooler rejects project~~ — RESOLVED

```
RESOLVED: [Production Manager] 2026-06-21 — Founder provided correct pooler hostname
  (aws-1-ca-central-1.pooler.supabase.com, not aws-0) and updated SUPABASE_STAGING_DB_URL
  GitHub secret to the pooler URL.

  Additional root causes found and fixed agent-side (no founder action needed):
    - Pooler URL had no explicit :5432 port → URL parser put hostname in DB_PORT → fixed by
      numeric guard + default-5432 fallback (PR #46, run #27916949231).
    - laravel_db_is_populated() uses DB_SSL_MODE not FREESCOUT_DB_PGSQL_SSL_MODE → added
      DB_SSL_MODE=require to container env (PR #46).
    - tiredofit/freescout image had no SKIP_DB_READY → switched to nfrastack/freescout
      (PR #45); SKIP_DB_READY=TRUE now bypasses the pg_isready loop.

  T-10 FreeScout DEPLOYED. Health check green. Run #27916949231 ✓ all steps, 3m50s.
  Linked: PRs #42–#46, FQ-10 (resolved), DECISIONS.md
```

---

### ~~FQ-10 — T-10 FreeScout: VPS directory permissions block PostgreSQL; architecture choice needed~~ — RESOLVED

```
RESOLVED: [Production Manager] 2026-06-21 — Founder chose Option B (Supabase).
  VPS outbound TCP:5432 is now OPEN (iptables rule added by founder).
  Workflow reverted to tiredofit/freescout + Supabase PostgreSQL (PRs #36–#37).
  Coolify-managed PostgreSQL permanently abandoned on this VPS (bind-mount root:root
  permission bug is systemic; all 10 autonomous fix paths were exhausted in PRs #25–#34).
  New active blocker: Supabase session pooler rejects project (see FQ-11).
  Linked: PRs #25–#37, FQ-09 (superseded), FQ-11 (active)
```

---

### ~~FQ-09 — VPS firewall blocks outbound TCP:5432~~ — SUPERSEDED BY FQ-10

```
SUPERSEDED: [Production Manager] 2026-06-21 — the PR #25 agent workaround (internal PG)
  ultimately failed due to VPS directory permission issues (see FQ-10). FQ-09's recommended
  action (open outbound TCP 5432) is now the RECOMMENDED path in FQ-10 Option B.
  This item is retained for reference. No separate founder action needed — FQ-10 covers it.
  Linked: FQ-10 (active), PRs #25–#34
```

---

### ~~FQ-08 — FreeScout MariaDB sidecar is crashing on Coolify VPS~~ — RESOLVED (agent-owned)

```
RESOLVED: [Production Manager] 2026-06-20 — no founder action required.

  Root cause identified: thatwebagency/freescout does NOT exist on Docker Hub (returns HTTP 404).
  The MariaDB sidecar crash was a secondary symptom; the primary failure was that Docker could
  never pull the FreeScout image on any deploy attempt.

  Fix applied via PR #17 (fix/freescout-postgresql-tiredofit):
    - Switched to tiredofit/freescout (actively maintained; latest release June 13, 2026;
      PostgreSQL support via DB_TYPE=pgsql)
    - Eliminated MariaDB sidecar; FreeScout now connects to existing Supabase PostgreSQL
    - FREESCOUT_STAGING_ADMIN_PASS secret created; SUPABASE_STAGING_DB_URL already present
    - Workflow: removes freescout-mariadb if present, deletes+recreates FreeScout app if
      still pointing to wrong image, sets tiredofit env vars with pgsql/Supabase config

  No cost impact: uses existing Supabase staging DB ($0 additional).
  Staging trade-off accepted: FreeScout tables co-tenant in Ops Hub Supabase public schema
  for Sprint 1 staging only; production will use a dedicated database.

  Linked: PR #18, DECISIONS.md 2026-06-20 [Production Manager] entry.
```

---

### ~~FQ-07 — Coolify API access feature gate is disabled~~ — RESOLVED (agent-confirmed)

```
RESOLVED: [Production Manager] 2026-06-21 — Coolify API access was enabled by founder
  (evidenced by all subsequent workflow runs returning HTTP 200 from /api/v1/servers).
  PRs #19–#22 all ran successfully against the Coolify API. No further action needed.
  FQ-07 archived to docs/founder-queue-archive/.
```

---

### ~~FQ-06 — Approve merge of PR #1: CI pipeline skeleton~~ — RESOLVED

```
APPROVED: [Founder] — Merge PR #1. Agents handle all technical configuration
  including branch protection settings. Tech Lead owns branch protection setup —
  find a way to execute without repo admin or escalate to a solution.
```

---

### ~~FQ-01 — Coolify provisioning~~ — RESOLVED

```
APPROVED: [Founder] — Coolify projects ops-hub-staging and ops-hub-prod provisioned
  at https://coolify.inatechshell.ca. Production Manager has full admin access via
  the existing Coolify instance. Proceed with T-07 through T-15.
```

---

### ~~FQ-02 — Supabase project for Ops Hub~~ — RESOLVED

```
APPROVED: [Founder] — Supabase project for Ops Hub created (2026-06-18).
  Dedicated project (separate from TTS). pgvector enabled. Region: Canada Central
  (PIPEDA compliant). Connection details in docs/infrastructure/supabase-ops-hub.md
  (placeholder values — real values stored in Coolify env vars, never committed).
  T-11 (migrations) and T-12 (Vault setup) are now unblocked.
```

---

### ~~FQ-03 — Repo naming vs. charter~~ — RESOLVED

```
APPROVED: [Founder] — Update docs to reflect actual repo name (admin-nutshell/ops-hub-00).
  Do not rename the repo. 09_delivery.md updated; DECISIONS.md logged.
```

---

### ~~FQ-05 — LangFuse Cloud data residency (PIPEDA awareness)~~ — RESOLVED

```
APPROVED: [Founder] — LangFuse US region approved for Sprint 1 and Sprint 2.
  Revisit before M3 when real tenant tickets start flowing.
```

---

### ~~FQ-04 — DNC go-live target date~~ — WITHDRAWN

```
WITHDRAWN: [Founder] — DNC is parked. Focus is building the Ops Hub system.
  M3 timeline is deferred until further notice. Solutions Architect proceeds
  with generic onboarding checklist only (no DNC-specific timeline).
```

---

## Recently resolved (this week)

- **FQ-01** (2026-06-18) — Coolify provisioned (`ops-hub-staging` + `ops-hub-prod` at `coolify.inatechshell.ca`). APPROVED by Founder. Unblocks T-07–T-15.
- **FQ-02** (2026-06-18) — Supabase project provisioned. APPROVED by Founder. Unblocks T-11, T-12, T-18, T-20.
- **FQ-05** (2026-06-20) — LangFuse Cloud US region approved for Sprint 1 + Sprint 2. Revisit before M3 (real tenant data).

---

*Founder: this is the only file you're required to read regularly. Everything else updates around you.*
