# FreeScout Modules — Installation Guide

> **Who this is for:** Production Manager agent and founder. Documents how modules are packaged into the FreeScout staging container and how to add more in the future.

---

## Architecture

The ops-hub FreeScout instance runs the `nfrastack/freescout` Docker image managed by Coolify. FreeScout modules are PHP packages placed in `/www/html/Modules/{ModuleName}/` inside the container and activated via `php artisan module:enable`.

Because Coolify rebuilds the container from the Docker image on every deploy, modules installed ad-hoc via `docker exec` would be lost on the next redeploy. The solution: **custom Docker image** that bakes the modules into the image itself.

**Image path:** `docker/freescout/Dockerfile`
**GHCR image:** `ghcr.io/admin-nutshell/ops-hub-00/freescout:latest`
**Activation script:** `docker/freescout/init-modules.sh` (runs at every container start via `/etc/cont-init.d/`)

---

## Currently installed modules

| Module | Version | Purpose | Installed by |
|---|---|---|---|
| **Webhooks** | master | Fires HTTP webhooks on ticket events (Conversation Created/Updated) — required for FreeScout → Inngest pipeline (T-21) | `build-freescout-custom-image.yml` (PT-1) |

---

## PT-1: Webhooks module installation

### How it was installed

1. `docker/freescout/Dockerfile` extends `nfrastack/freescout:latest`:
   - Downloads `freescout-webhooks` from GitHub (master branch)
   - Extracts to `/www/html/Modules/Webhooks/`
   - Copies `init-modules.sh` to `/etc/cont-init.d/50-freescout-modules`
2. GitHub Actions workflow `build-freescout-custom-image.yml`:
   - Builds the custom image → pushes to GHCR
   - PATCHes Coolify freescout-staging app to use the GHCR image
   - Stop → Start → polls health
3. On container start: `init-modules.sh` runs `php artisan module:enable Webhooks` and `php artisan migrate --force`

### Post-installation verification

1. Log into `https://freescout-staging.inatechshell.ca` as `haytham@inatechshell.ca`
2. Navigate to **Manage → Settings**
3. Confirm **Webhooks** appears in the Settings sidebar
4. Click **Webhooks → Add Webhook**:
   - **URL:** `https://ops-hub-staging.inatechshell.ca/api/webhooks/freescout`
   - **Events:** Conversation Created, Conversation Updated
   - Save

---

## PT-2: FreeScout API key

FreeScout's core REST API is built-in — no module required.

### Retrieve the API key

1. Log into `https://freescout-staging.inatechshell.ca`
2. Profile menu (top-right) → **Settings → API**
   OR navigate directly to: `https://freescout-staging.inatechshell.ca/settings/api`
3. Copy the API key shown (or click **Generate API Key** if none exists)

### Store in Coolify

1. Coolify → `ops-hub-staging` project → `freescout-staging` app → **Environment Variables**
2. Add: `FREESCOUT_API_KEY` = `<paste key>`
3. Save — no container restart needed (env var is read by ops-hub app, not FreeScout itself)

### Where the key is used

The ops-hub application uses `FREESCOUT_API_KEY` via its own Coolify env vars (not FreeScout's env vars) to call the FreeScout API:
- `POST /api/conversations/{id}/threads` — post auto-reply (T-23 ticket-respond)
- `GET /api/conversations` — list/search tickets

---

## Adding a new module in the future

1. Edit `docker/freescout/Dockerfile` — add the module download/extract steps (follow the Webhooks pattern)
2. Update `docker/freescout/init-modules.sh` — add `php artisan module:enable {ModuleName}` line
3. Push the changes on a feature branch → open PR → CI validates
4. After merge: manually trigger `build-freescout-custom-image.yml` from GitHub Actions tab

---

## Module sources

| Module | Source | License |
|---|---|---|
| Webhooks | `https://github.com/freescout-help-desk/freescout-webhooks` | AGPL |
| FreeScout app store | `https://freescout.net/modules/` | Various |

---

*Last updated: 2026-06-23. Owner: Production Manager.*
