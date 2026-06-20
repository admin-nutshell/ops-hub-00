# Deploy Plan: T-08 LiteLLM + T-10 FreeScout — Staging

**Date:** 2026-06-20
**Environment:** `ops-hub-staging` on Coolify (`coolify.inatechshell.ca`)
**Status:** PENDING — awaiting Coolify API token (FQ-07)
**Production Manager:** Claude (Sonnet 4.6)

---

## Pre-deploy checklist

- [x] QA Manager handoff: T-08 + T-10 specs authored by Tech Lead; no pre-deploy test suite required for initial staging deploy of vendor images
- [ ] Security Lead sign-off: not required — no secrets vault changes; env vars pre-loaded by founder; images are public registry vendor images
- [x] Rollback paths defined (see below)
- [x] Canary target identified: `ops-hub-staging` for 24h
- [ ] Sentry + UptimeRobot baselines: T-13/T-14 not yet active — gap noted, not blocking (no prior baseline exists for a service that hasn't been deployed)
- [ ] On-call founder notified: FQ-07 raised — founder is aware this deploy is pending

---

## T-08: LiteLLM

### Service definition

| Field | Value |
|---|---|
| Project | `ops-hub-staging` |
| Service type | Docker image (public registry) |
| Image | `ghcr.io/berriai/litellm:main-latest` |
| Port | 4000 |
| Env vars | Pre-loaded in Coolify: `LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `STORE_MODEL_IN_DB=True`, `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` |

### Deploy steps (Coolify API)

```bash
# 1. Create service in ops-hub-staging project
POST /api/v1/services
{
  "type": "docker",
  "project_uuid": "<ops-hub-staging-uuid>",
  "name": "litellm-staging",
  "image": "ghcr.io/berriai/litellm:main-latest",
  "ports_exposes": "4000"
}

# 2. Deploy (start) the service
POST /api/v1/services/<service-uuid>/start
```

### Post-deploy verification

```bash
# Primary check — unauthenticated readiness probe
curl -s https://<litellm-staging-url>/health/readiness
# Expected: HTTP 200, body contains {"status": "healthy", ...}

# Secondary check — model-level health (requires master key)
curl -s -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  https://<litellm-staging-url>/health
# Expected: HTTP 200, per-model status in body
```

### Known first-boot behaviour

- DB connectivity errors in logs are non-fatal if Postgres migrations (T-11) have not yet run. LiteLLM runs its own Prisma migrations against `DATABASE_URL` at first boot — this is separate from T-11 (Ops Hub schema migrations). If startup stalls beyond 5 minutes, check `DATABASE_URL` format (`postgresql://` not `postgres://`).

### Rollback path

Delete the Coolify service via `DELETE /api/v1/services/<service-uuid>`. No prior version exists in staging; rollback is a no-op remove. Estimated rollback time: < 2 minutes.

---

## T-10: FreeScout

### Service definition

| Field | Value |
|---|---|
| Project | `ops-hub-staging` |
| Service type | Docker image (public registry) |
| Image | `thatwebagency/freescout` |
| Port | 80 |
| DB | MariaDB sidecar (Option A — official support path) |

### DB decision (agent-owned)

FreeScout officially supports MySQL/MariaDB only. A MariaDB sidecar container will be added to the same `ops-hub-staging` project. FreeScout env vars will point to it (`DB_CONNECTION=mysql`, `DB_HOST=<mariadb-sidecar-hostname>`, `DB_PORT=3306`). If `DB_CONNECTION=pgsql` is already in Coolify staging vars, it will be overridden for FreeScout only.

### Deploy steps (Coolify API)

```bash
# 1. Add MariaDB sidecar
POST /api/v1/services
{
  "type": "mariadb",
  "project_uuid": "<ops-hub-staging-uuid>",
  "name": "freescout-mariadb"
}

# 2. Create FreeScout service
POST /api/v1/services
{
  "type": "docker",
  "project_uuid": "<ops-hub-staging-uuid>",
  "name": "freescout-staging",
  "image": "thatwebagency/freescout",
  "ports_exposes": "80",
  "environment_variables": {
    "DB_CONNECTION": "mysql",
    "DB_HOST": "<mariadb-sidecar-hostname>",
    "DB_PORT": "3306",
    "DB_DATABASE": "freescout",
    "DB_USERNAME": "freescout",
    "DB_PASSWORD": "<from-coolify-vars>"
  }
}

# 3. Deploy both services
POST /api/v1/services/<mariadb-uuid>/start
POST /api/v1/services/<freescout-uuid>/start
```

### Post-deploy verification

1. FreeScout setup/login page loads at staging URL (HTTP 200)
2. Submit one test ticket via the UI and confirm it appears in FreeScout inbox

### Rollback path

Delete FreeScout service and MariaDB sidecar via Coolify API. No prior version exists in staging; rollback is a no-op remove. Estimated rollback time: < 5 minutes.

---

## Canary window

- Duration: 24 hours from deploy timestamp for both services
- Monitoring: Check Coolify logs every 30 minutes during first 2 hours; every 2 hours thereafter
- Success criteria: No crash loops; health endpoints return 200; LangFuse receives at least one trace from LiteLLM
- Failure criteria: Service crash loop after 5 minutes with no DB connection; health endpoint returning 5xx

---

## Post-deploy actions (after canary success)

1. Update WORK.md: T-08 and T-10 status → "Canary complete — Done"
2. Update M1 checklist items #4 and #6
3. Trigger T-09 (LangFuse trace test from LiteLLM)
4. Notify Data Engineer to verify LangFuse trace receipt
5. Sign off ADR-0001 (environment topology — deployability confirmed)
6. Set up UptimeRobot monitors for both staging URLs (T-14)

---

*Deploy plan authored 2026-06-20. Execution pending Coolify API token (FQ-07).*
