# Premium SLA Tier

**Implemented:** Sprint 4 / T-39
**Schema migration:** `supabase/migrations/20260628000000_t39_sla_tier.sql`
**Enforced by:** `src/inngest/sla-monitor.ts` (`sweepSlaBreaches` cron, every 5 min)

---

## Overview

`sla_tier` is an add-on flag on the `tenants` table, independent of the billing `tier` column (`starter / growth / scale`). Any billing tier can carry Premium SLA.

| `sla_tier` | Breach detection | Targets |
|---|---|---|
| `standard` (default) | Flat deadline from `sla_config.response_target_minutes` | Configured per-tenant in `sla_config` JSON |
| `premium` | Per-urgency, hardcoded | See table below |

---

## Premium SLA thresholds

| Urgency | Response target |
|---|---|
| `critical` | 30 minutes |
| `high` | 60 minutes |
| `normal` | 4 hours (240 min) |
| `low` | 8 hours (480 min) |

These targets start from ticket **creation time** (when the FreeScout conversation was first polled into ops-hub). The clock does not pause for business hours — targets are wall-clock.

---

## How breach detection works

`sla-monitor` runs every 5 minutes. For each ticket in `new` or `triaged` state with no existing `sla_breach` audit_log entry:

1. Computes `response_target_minutes` via a SQL CASE expression:
   - `sla_tier = 'premium'` → urgency-based target from the table above
   - `sla_tier = 'standard'` → `COALESCE(sla_config->>'response_target_minutes', 240)::int`
2. Compares `minutes_open` (time since `created_at`) against the target
3. On breach: inserts a row into `audit_log` with `action = 'sla_breach'` + posts an internal FreeScout note if `FREESCOUT_DB_URL` is set

The dedup guard (`NOT EXISTS audit_log WHERE action='sla_breach'`) ensures each ticket triggers at most one breach record.

---

## Activating Premium SLA for a tenant

1. Apply the migration to staging/production (Supabase SQL Editor):
   ```sql
   -- supabase/migrations/20260628000000_t39_sla_tier.sql
   ALTER TABLE tenants ADD COLUMN sla_tier text NOT NULL DEFAULT 'standard'
     CHECK (sla_tier IN ('standard', 'premium'));
   ```

2. Upgrade a specific tenant:
   ```sql
   UPDATE tenants SET sla_tier = 'premium' WHERE name = '<tenant-name>';
   ```

3. Verify with a query:
   ```sql
   SELECT name, tier, sla_tier, sla_config FROM tenants;
   ```

No app restart required — `sla-monitor` reads `sla_tier` on every sweep.

---

## Standard SLA reference

Standard tenants use `sla_config->>'response_target_minutes'`. If that key is absent, the fallback is **240 minutes (4 hours)**.

To set a custom target for a standard tenant:
```sql
UPDATE tenants
SET sla_config = jsonb_set(sla_config, '{response_target_minutes}', '120')
WHERE name = '<tenant-name>';
```

---

## Pricing / business decisions

SLA tier upgrades are a **founder decision** — no agent should set `sla_tier = 'premium'` without explicit authorization. If a customer requests Premium SLA, post to `FOUNDER_QUEUE.md`.
