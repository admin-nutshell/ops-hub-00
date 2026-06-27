# M3 Scoping — DNC Production Go-Live

**Author:** Solutions Architect  
**Date:** 2026-06-27  
**Sprint:** Sprint 3 (T-33 exit deliverable)  
**Target:** M3 — end August 2026  
**Status:** Scoping complete; blocked on FQ-43 (founder decisions)

---

## 1. Objective

M1 criterion #12 (T-27) proved that **DNC tickets flow through Ops Hub in staging** — a test email
confirmed the full pipeline: FreeScout → triage → respond → `state=responded`, `tenant_id=…0020`.

M3 means **DNC in production** — real Daily Needs Canada customer support emails processed
automatically by Ops Hub's AI pipeline, with live SLA enforcement (60-min response target) and
LangFuse cost + latency visibility.

The staging test (M1 #12) used:
- `freescout-staging.inatechshell.ca` with a manually sent test email
- Staging Supabase (`yocoljutbiizdbfraapx`) with synthetic tenant data
- `litellm-staging.inatechshell.ca` gpt-4o-mini
- Staging Coolify project (`ops-hub-staging`)

M3 replaces every staging component with a production-grade counterpart.

---

## 2. Current state (post-T-27, 2026-06-27)

| Component | Staging (done) | Production (needed for M3) |
|---|---|---|
| ops-hub app | `ops-hub-staging.inatechshell.ca` ✅ | `ops-hub.inatechshell.ca` |
| FreeScout | `freescout-staging.inatechshell.ca` ✅ | `freescout.inatechshell.ca` |
| LiteLLM | `litellm-staging.inatechshell.ca` ✅ | `litellm.inatechshell.ca` |
| Supabase | Project `yocoljutbiizdbfraapx` (staging) ✅ | New prod project |
| TTS project row | UUID `00…0002` in staging DB ✅ | Same UUID in prod DB |
| DNC tenant row | UUID `00…0020` in staging DB ✅ | Same UUID in prod DB |
| DNC email intake | `support@inatechshell.ca` → staging FreeScout ✅ | DNC customer email → prod FreeScout (see §3.1) |
| Coolify project | `ops-hub-staging` ✅ | `ops-hub-prod` (provisioned; needs env vars) |
| LangFuse namespace | Staging traces ✅ | Prod namespace (same LangFuse project, `environment=prod` tag) |
| Sentry environment | `ops-hub-staging` ✅ | `ops-hub-prod` |

---

## 3. Production delta: what changes

### 3.1 Email routing (FQ-43 item A — founder decision required)

The core question: **what email address do real DNC customers send support tickets to?**

| Option | Setup | Trade-off |
|---|---|---|
| A — New DNC domain | `support@dailyneedscanada.ca` → Google Workspace → prod FreeScout IMAP | Clean separation; requires DNC to own or acquire a domain and configure MX records |
| B — Shared ITS inbox with routing | `support@inatechshell.ca` → Gmail filter → two FreeScout instances (staging + prod) | No new domain; risks staging/prod bleed on shared inbox |
| C — Subdomain alias | `dnc@support.inatechshell.ca` → prod FreeScout IMAP | Low-cost; depends on Google Workspace alias config |

**Recommendation:** Option A or C. Option B (shared inbox) creates an operational risk of emails
landing in the wrong FreeScout instance. Option C is practical if DNC does not yet have its own
domain. Option A is cleanest at scale.

### 3.2 Supabase (prod)

A **new Supabase project** is required (per ADR-0001: staging ≠ prod; no data-flow between environments).

Once provisioned:
1. Apply all 7 migrations in order (same T-11 runbook):
   - `20260618120000_initial_schema.sql`
   - `20260618120100_enable_rls_policies.sql`
   - `20260621130000_kb_seed.sql`
   - `20260623180000_t21_freescout_intake.sql`
   - `20260624000000_t22_ticket_triage_columns.sql`
   - `20260625000000_t23_responded_state.sql`
   - `20260627000000_t27_dnc_onboarding.sql`
2. Create `ops_hub_app` login role + Vault secrets (T-12 runbook — same SQL, new project)
3. Set `OPS_HUB_APP_LOGIN_URL` in prod Coolify to the new project's connection string

All migrations are idempotent (`ON CONFLICT DO NOTHING`) and forward-only. No data migration from
staging — prod starts clean. The TTS project row and DNC tenant row will be seeded by migration #7.

### 3.3 FreeScout (prod)

Deploy `tiredofit/freescout` to the `ops-hub-prod` Coolify project:

| Env var | Staging value | Prod value |
|---|---|---|
| `APP_URL` | `https://freescout-staging.inatechshell.ca` | `https://freescout.inatechshell.ca` |
| `DB_HOST` | Staging Supabase Supavisor | Prod Supabase Supavisor |
| `DB_USERNAME` | `freescout_user.yocoljutbiizdbfraapx` | `freescout_user.<prod-project-id>` |
| `DB_PASSWORD` | `<staging-password>` | `<prod-password>` |
| `MAIL_FROM_ADDRESS` | `support@inatechshell.ca` | DNC email (per §3.1 decision) |

After deploy:
1. Configure IMAP mailbox (same setup as staging, pointing to prod DNC email address)
2. Apply `ops_hub_app` GRANT + ALTER DEFAULT PRIVILEGES on prod FreeScout DB (same
   `docker exec artisan tinker` procedure as T-22, but on the prod container)

The GRANT must be applied via `artisan tinker` after FreeScout's first startup (FreeScout creates
its tables on boot; the GRANT cannot be in a pre-boot migration). This is a **founder action**
(SSH or Coolify terminal access required).

### 3.4 LiteLLM (prod)

Deploy LiteLLM to `ops-hub-prod` Coolify project:

| Env var | Staging value | Prod value |
|---|---|---|
| `LITELLM_MASTER_KEY` | `<staging-key>` | New secret |
| `STORE_MODEL_IN_DB` | `True` | `True` |
| `DATABASE_URL` | Staging Supabase (LiteLLM schema) | Prod Supabase |
| Domain | `litellm-staging.inatechshell.ca` | `litellm.inatechshell.ca` |

After deploy, run `configure-litellm-openai-only.yml` (PR #176) against the prod LiteLLM endpoint
to register `gpt-4o-mini` as `triage-model` and `meta/llama-3.3-70b-instruct` alias.

**ADR-0004 note:** LiteLLM's `DATABASE_URL` currently points at the same Supabase project as
ops-hub-app (schema isolation by prefix). For prod, we should use a separate Supabase project for
LiteLLM's own DB (or the same prod Supabase project with the same schema isolation). ADR-0004
defines the restricted role approach — apply the same pattern to the prod deploy.

### 3.5 ops-hub-app (prod env vars)

The `ops-hub-prod` Coolify project was provisioned in M1 (criterion #2). The env vars that **change**
from staging to prod:

| Env var | Staging | Prod |
|---|---|---|
| `OPS_HUB_APP_LOGIN_URL` | Staging Supabase connection string | Prod Supabase connection string |
| `FREESCOUT_DB_URL` | Staging FreeScout DB | Prod FreeScout DB |
| `LITELLM_URL` | `http://<staging-docker-suffix>:4000` | `http://<prod-docker-suffix>:4000` |
| `LITELLM_MASTER_KEY` | Staging key | Prod key |
| `SENTRY_DSN` | `ops-hub-staging` project DSN | `ops-hub-prod` project DSN (or same project, different env) |
| `NODE_ENV` | `staging` | `production` |

Env vars that stay the **same**:
- `POLLING_PROJECT_ID` = `00000000-0000-0000-0000-000000000002` (TTS UUID is logical, not env-specific)
- `POLLING_TENANT_ID` = `00000000-0000-0000-0000-000000000020` (DNC UUID is logical)
- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` (same LangFuse project; env tagged by `NODE_ENV`)
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` (same Inngest Cloud account; environment=Production)
- `FREESCOUT_BOT_USER_ID` = `1` (first admin user; will be `1` in prod FreeScout too)

### 3.6 DNS

Three A records needed if not already configured:
- `ops-hub.inatechshell.ca` → VPS IP (`187.124.76.235`)
- `freescout.inatechshell.ca` → VPS IP
- `litellm.inatechshell.ca` → VPS IP

Coolify auto-provisions TLS via Let's Encrypt when the domain is added to each service.

---

## 4. Pre-production migration runbook

### Phase 1 — Supabase (founder, ~20 min)

1. Create new Supabase project in Canada Central (free tier)
2. Run all 7 migration files via SQL Editor (copy-paste from `supabase/migrations/`, in order)
3. Run T-11 runbook (`docs/engineering/t11-migration-runbook.md`) to create `ops_hub_app` login role
4. Copy connection strings (Transaction-mode pooler + Session-mode pooler) from Supabase dashboard

### Phase 2 — LiteLLM (founder, ~10 min)

1. Add LiteLLM to `ops-hub-prod` Coolify project (clone staging service, update domain + DB URL)
2. Trigger `configure-litellm-openai-only.yml` against prod endpoint
3. Smoke test: `curl https://litellm.inatechshell.ca/health`

### Phase 3 — FreeScout (founder, ~30 min)

1. Add FreeScout to `ops-hub-prod` Coolify project (clone staging service, update domain + DB URL + email vars)
2. On first successful start, open `https://freescout.inatechshell.ca` and create admin user
3. Configure IMAP mailbox with DNC support email credentials
4. Apply GRANT via `artisan tinker` (same command as T-22 procedure):
   ```
   DB::statement("GRANT SELECT ON conversations, threads TO ops_hub_app;")
   DB::statement("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app;")
   ```

### Phase 4 — ops-hub-app prod (founder + agent, ~15 min)

1. Set all env vars in `ops-hub-prod` Coolify project (see §3.5 table)
2. Deploy ops-hub to prod; verify `/health` returns `200`
3. Verify Inngest dashboard shows prod environment synced at `https://ops-hub.inatechshell.ca/api/inngest`

### Phase 5 — E2E smoke test (agent)

Agent sends a test email to the DNC support address → verifies:
- FreeScout prod: email received in inbox
- Inngest: `ticket-triage` runs with `tenant_id = 00000000-0000-0000-0000-000000000020`
- Supabase prod: ticket row with `state=responded`
- LangFuse: trace visible with cost metadata (T-31 instrumentation)
- FreeScout prod: internal note posted in conversation

---

## 5. Go / no-go checklist

All items must be green before declaring M3 live:

| # | Gate | How to verify | Owner |
|---|---|---|---|
| 1 | Prod Supabase: all 7 migrations applied | `SELECT count(*) FROM tickets;` returns `0` (table exists, empty) | Founder |
| 2 | Prod Supabase: RLS isolation passes | `pnpm test:integration` with prod `OPS_HUB_APP_LOGIN_URL` | Security Lead |
| 3 | Prod FreeScout: email fetch active | ≥1 test email received and visible in inbox | Founder |
| 4 | Prod FreeScout: `ops_hub_app` GRANT active | `SELECT COUNT(*) ...` on `conversations` returns a number | Prod Manager |
| 5 | Prod LiteLLM: `triage-model` reachable | `curl https://litellm.inatechshell.ca/health` → 200 | Prod Manager |
| 6 | Prod ops-hub: health + Inngest synced | `/health` 200; Inngest dashboard shows prod env | Prod Manager |
| 7 | E2E smoke test passes | `state=responded`, `tenant_id=…0020` in prod Supabase | Agent |
| 8 | LangFuse prod traces visible with cost | One trace in LangFuse with `promptTokens` populated | Data Engineer |
| 9 | Real DNC ticket volume confirmed | ≥1 real customer email received + processed (not a test) | Founder |

---

## 6. Open risks

| Risk | Severity | Mitigation |
|---|---|---|
| DNC doesn't have real customer ticket volume by end-August | High | Confirm with founder (FQ-43 item B) — if no real traffic, M3 date slips, not an agent decision |
| FreeScout GRANT wiped on LiteLLM/FreeScout redeploy | Medium | ADR-0004 procedure for LiteLLM; same approach applies to FreeScout — apply GRANT after every redeploy via artisan tinker |
| `LITELLM_URL` internal Docker suffix changes on LiteLLM redeploy | Medium | Must check `docker ps \| grep <prefix>` after each redeploy; CLAUDE.md warns about this |
| Prod Supabase free-tier event limits | Low | Monitor monthly event count in LangFuse; 50K free-tier ceiling (T-09 note); revisit before M3 if volume spikes |
| Single LLM provider (gpt-4o-mini via OpenAI) | Low | OpenAI fallback is the current config; NVIDIA was abandoned (FQ-40). For prod, consider rate limits if DNC ticket volume grows above ~100 tickets/day |

---

## 7. Dependencies and timeline

```
FQ-43 resolved (founder)
    ├─ Email routing decision (§3.1) — gates Phase 3 (FreeScout)
    └─ Prod Supabase created — gates all other phases

Phase 1: Supabase    [week 1 of August]
Phase 2: LiteLLM     [week 1 of August, can parallel]
Phase 3: FreeScout   [week 1–2 of August]
Phase 4: ops-hub     [week 2 of August]
Phase 5: E2E smoke   [week 2 of August]
Go/no-go review      [mid-August, agent-owned]
M3 live declaration  [≤ 2026-08-31]
```

---

## 8. Out of scope for M3

- **Multi-tenant routing** — M3 is DNC only (single tenant on prod). Additional tenants are Phase 2.
- **Production BYOK** — DNC uses ITS-owned LLM credentials (not customer-provided keys).
- **SLA alerting** — P1 alert automation (< 15 min) is Phase 2; human review at M3.
- **CI staging-creds integration tests** — M2 follow-up; M3 still uses manual smoke tests.
- **Ops Hub prod Supabase for LiteLLM isolation (ADR-0004)** — can use same prod project with schema
  isolation at M3; separate DB for LiteLLM is Phase 2.
