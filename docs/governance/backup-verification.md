# Backup Verification

**Automation:** `.github/workflows/verify-backup.yml` — runs monthly (1st of month, 06:00 UTC) + `workflow_dispatch`
**Alert threshold:** backup older than 25 hours → workflow fails → GitHub Actions shows a red run
**Supabase project:** `yocoljutbiizdbfraapx` (Canada Central)

---

## What it checks

The workflow calls the Supabase Management API (`GET /v1/projects/{ref}/database/backups`), finds the most recent backup by `inserted_at` timestamp, and computes its age. If age > 25 hours the workflow exits non-zero.

Supabase free tier creates daily backups and retains them for 7 days. The 25-hour threshold gives a 1-hour buffer over the expected 24-hour cadence before alerting.

---

## Viewing results

Each run writes a formatted summary to the GitHub Actions step summary tab:

1. Go to **Actions → Monthly Backup Verification**
2. Open any run → click the **verify-backup** job
3. The summary table shows last backup timestamp, age, and pass/fail status

Run history is retained for 90 days (GitHub default). For longer retention, download the summary before the window expires.

---

## Required secret

`SUPABASE_ACCESS_TOKEN` — a Supabase personal access token with read access to project `yocoljutbiizdbfraapx`.

**To create:** Supabase dashboard → Account → Access tokens → Generate new token → name it `ops-hub-backup-verify` → copy → add as GitHub repo secret `SUPABASE_ACCESS_TOKEN`.

See FQ-48 for the one-time setup action.

---

## Running manually

```
gh workflow run verify-backup.yml --repo admin-nutshell/ops-hub-00
```

Or: GitHub → Actions → Monthly Backup Verification → Run workflow.

---

## Troubleshooting

**"SUPABASE_ACCESS_TOKEN secret is not set"** → FQ-48 not yet completed; founder needs to create the token and add the secret.

**"Supabase Management API call failed"** → Token may have expired or been revoked. Regenerate at Supabase → Account → Access tokens, update the GitHub secret.

**"No backups found"** → Free-tier backups may have been paused (project inactive > 7 days). Check Supabase dashboard → Database → Backups. Reactivate the project if needed.

**Backup is stale (> 25h)** → Check Supabase dashboard for any backup failure notices. If Supabase is healthy and the backup is merely late, re-run the workflow in 2–3 hours. If backups are consistently missing, escalate to FOUNDER_QUEUE.md.
