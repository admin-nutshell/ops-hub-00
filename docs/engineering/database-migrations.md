# Database Migrations

> How schema changes ship safely across dev → staging → prod, without breaking multi-tenant isolation or running history.

---

## Tool: Supabase migrations

Supabase has built-in migration support via the CLI. Migration files are versioned, timestamped SQL files in the repo. No additional tooling needed.

Migration files location:

```
supabase/migrations/
  └── 20260618120000_initial_schema.sql
  └── 20260619140000_add_feature_flags_table.sql
  └── 20260620090000_add_audit_log.sql
```

---

## Core principles

### 1. Forward-only

We don't write `DOWN` migrations. Rolling back is done by writing a new forward migration that undoes the previous change. This keeps history linear and auditable.

### 2. Destructive changes require an ADR

Any migration that:

- Drops a table
- Drops a column with data
- Changes a column type in a way that loses data
- Removes an index that production queries depend on

…requires an ADR in `docs/adr/` AND founder approval logged in `DECISIONS.md`. Non-negotiable.

### 3. Staging-first, always

Every migration runs on **staging first** and must pass for at least 24 hours before promotion to prod. No exceptions, including hotfixes.

### 4. Multi-tenant boundary checks

Every migration that touches a tenant-data table must verify Row-Level Security (RLS) policies still hold. Security Lead reviews migrations touching:

- Any table with a `tenant_id` column
- The `feature_flags` table
- The `audit_log` table
- Auth-related tables
- Anything in the `vault` schema

---

## Migration naming

```
<UTC timestamp>_<verb>_<short_description>.sql
```

Examples:

- `20260618120000_create_tickets_table.sql`
- `20260619140000_add_index_on_audit_log_tenant_id.sql`
- `20260620090000_drop_unused_legacy_table.sql` (requires ADR)

Timestamps in UTC ensure ordering even across timezones and multiple authors.

---

## Migration content rules

| Pattern | Allowed? | Notes |
|---|---|---|
| `CREATE TABLE` | ✅ Yes | Default for any new structure |
| `ALTER TABLE ... ADD COLUMN` | ✅ Yes | Default to nullable; backfill in a separate migration |
| `ALTER TABLE ... DROP COLUMN` | ⚠️ ADR required | Often safer to mark column unused and drop later |
| `DROP TABLE` | ⚠️ ADR required | Verify no production queries reference it first |
| `CREATE INDEX CONCURRENTLY` | ✅ Yes | Preferred for large tables in prod |
| `CREATE INDEX` (blocking) | ⚠️ Caution | Only on small tables or during maintenance window |
| Data backfills | ✅ Yes | Separate migration file; idempotent SQL |
| RLS policy changes | ⚠️ Security Lead review | Always |
| Schema permissions changes | ⚠️ Security Lead review | Always |

---

## Per-project migration scoping

Each project's migrations live in its own subdirectory of the Ops Hub repo (when the project is hosted in the same repo) or in its own repo (when separate):

```
supabase/migrations/
├── ops_hub/        ← Ops Hub platform schema (projects table, audit log, etc.)
├── tts/            ← TTS-specific schema
└── <project_2>/    ← Future project
```

Cross-project foreign keys are **prohibited.** Each project owns its own data tables. Shared platform tables (projects, audit_log, feature_flags) live in `ops_hub/` and are queryable by all but written by the platform only.

---

## Migration workflow

| Step | Who | What |
|---|---|---|
| 1. Author migration | Tech Lead or Data Engineer | Write SQL file in feature branch |
| 2. Test on local dev DB | Author | Run migration; verify queries still work |
| 3. PR + review | Author + Security Lead (if tenant-data) | Standard PR flow |
| 4. Merge → staging | Production Manager (automated CI) | Migration runs on merge to `main` |
| 5. 24h staging verification | Production Manager | Watch for errors; verify performance |
| 6. Manual promotion to prod | Production Manager + founder for sensitive | `supabase db push --linked` against prod |
| 7. Log to DECISIONS.md | Tech Lead | Record migration ID + summary |

---

## Backfills

When a migration needs to populate data in newly-added columns:

```
20260620090000_add_severity_to_tickets.sql            ← schema change
20260620091000_backfill_severity_from_legacy.sql      ← separate migration
```

Backfills should be:

- **Idempotent** (safe to re-run)
- **Batched** for large tables (don't lock prod for 20 minutes)
- **Logged to `audit_log`** if they modify tenant data

---

## Rollback procedure

If a migration causes a problem in prod:

1. **Don't run a `DOWN`.** Author a forward migration that fixes the problem.
2. **If the problem is severe enough that prod is broken NOW:** trigger an emergency rollback at the application level via feature flag, while the new fix-forward migration is authored.
3. **Document the incident** in `docs/post-mortems/` and update this policy if new failure modes emerged.

---

## Backup before destructive changes

For any ADR-classified destructive migration:

```bash
supabase db dump --linked --file=backups/pre_migration_<timestamp>.sql
```

Backup goes to encrypted-at-rest storage (Supabase Storage with private bucket). Retention: 90 days minimum.

---

## How this policy is used

- Tech Lead and Data Engineer author and review all migrations
- Security Lead reviews migrations touching tenant data, vault, audit log
- Production Manager owns the deploy mechanics
- Founder approves any destructive (ADR-required) migration
