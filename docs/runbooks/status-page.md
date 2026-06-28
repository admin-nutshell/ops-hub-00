# Status Page Runbook

**URL:** https://status.inatechshell.ca
**Hosting:** GitHub Pages (auto-deployed via `deploy-status.yml`)
**Theme:** Cstate (Hugo module)
**Incident automation:** UptimeRobot → ops-hub webhook → `repository_dispatch` → `status-incident.yml`
**Branch layout:**
- `main` — Hugo config (`status/config.yml`, `status/go.mod`, `status/static/CNAME`)
- `status-content` — incident Markdown files only (`status/content/*.md`); unprotected so GitHub Actions can write directly

---

## Accessing the status page

The page is publicly accessible at `https://status.inatechshell.ca`. No authentication needed. It reflects the last Hugo build (triggered automatically on any `status/**` commit to main, or via workflow_dispatch).

---

## Adding a new monitored component

Edit `status/config.yml` and add an entry under `params.systems`:

```yaml
params:
  systems:
    - name: "New Service"
      description: "What it does"
      url: "https://new-service.inatechshell.ca/health"
```

Then create the corresponding UptimeRobot monitor for the URL, and add the webhook alert contact pointing to the ops-hub webhook (see below). PR → merge → `deploy-status.yml` rebuilds automatically.

---

## Opening an incident manually

Go to GitHub → Actions → "Status Page — Incident Management" → Run workflow:
- **action:** `open`
- **title:** brief description (e.g. "Ops Hub elevated error rate")
- **affected:** comma-separated system names exactly as in `status/config.yml` (e.g. `Ops Hub Staging`)
- **severity:** `notice` | `disrupted` | `down`

The workflow creates a Markdown file in `status/content/`, commits to the `status-content` branch (unprotected — bypasses main branch protection), then triggers a Pages rebuild. The incident appears on the status page within ~2 minutes.

---

## Resolving an incident manually

Go to GitHub → Actions → "Status Page — Incident Management" → Run workflow:
- **action:** `resolve`
- **title:** any label (used in commit message only)

The workflow finds the most recent open incident, marks it resolved, and triggers a rebuild.

---

## UptimeRobot webhook automation

When configured (see FQ-47), UptimeRobot sends a JSON payload to:
```
POST https://ops-hub-staging.inatechshell.ca/api/status/webhook?secret=<STATUS_WEBHOOK_SECRET>
```

The ops-hub app validates the secret and forwards a `repository_dispatch` event (`status-alert`) to GitHub. `status-incident.yml` then creates or resolves the incident file and rebuilds the site.

**alertType mapping:**
- `1` → monitor went down → creates a new incident at `down` severity
- `2` → monitor came back up → resolves the most recent open incident

**Required Coolify env vars:**
- `STATUS_WEBHOOK_SECRET` — shared secret between UptimeRobot and the webhook endpoint
- `GITHUB_STATUS_DISPATCH_TOKEN` — GitHub fine-grained PAT with `Actions: Read and Write` on this repo

---

## Troubleshooting

**Status page not updating after incident workflow runs:**
- Check GitHub Actions → `status-incident.yml` run for errors
- Verify `deploy-status.yml` was triggered (look for a run triggered by `workflow_dispatch`)
- If Hugo module fetch failed, check Go version in CI

**Webhook returning 403:**
- Verify `STATUS_WEBHOOK_SECRET` Coolify env var matches the `?secret=` query param in the UptimeRobot webhook URL

**Webhook returning 503:**
- `GITHUB_STATUS_DISPATCH_TOKEN` is not set or is empty in Coolify env vars

**Webhook returning 502:**
- The GitHub PAT may lack `Actions: Read and Write` permission, or has expired
- Check the `detail` field in the 502 response body for the GitHub API error message

**`deploy-status.yml` fails at Hugo build:**
- Hugo module fetch may have failed (network or version issue)
- Check the "Fetch Cstate Hugo module" step logs for details
- If `go.sum` is missing or stale, re-running the workflow usually resolves transient fetch failures
