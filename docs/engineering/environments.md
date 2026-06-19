# Environments

> Three tiers, per project, fully isolated. All on the shared Hostinger VPS via Coolify.

---

## The three environments

| Env | Where it runs | Purpose | Cost |
|---|---|---|---|
| **dev** | Local machines + per-agent Claude Code sessions | Local development, agent prototyping | $0 |
| **staging** | Coolify project on Hostinger VPS, per project | Pre-prod verification, canary deploy target | $0 (shares VPS) |
| **prod** | Coolify project on Hostinger VPS, per project | Live system serving real tenants | Already paid (existing VPS) |

---

## Isolation guarantees

Each environment is a **separate Coolify project** on the same VPS. They share hardware; everything else is isolated:

| What's isolated | How |
|---|---|
| Containers | Separate Docker containers per env per project |
| Databases | Separate Supabase databases (or separate schemas in shared instance for cost) |
| Environment variables | Separate Coolify env-var sets per Coolify project |
| Secrets / API keys | Separate vault entries per env (`vault://<project>/staging/*`, `vault://<project>/prod/*`) |
| Domains | Separate subdomains: `staging.app.inatechshell.ca`, `app.inatechshell.ca` |
| Logs | Separate Sentry environments, separate LangFuse namespaces |

---

## Per-project naming

| Project | dev | staging | prod |
|---|---|---|---|
| Ops Hub | local | `ops-hub-staging` | `ops-hub-prod` |
| TTS (Project #1) | local | `tts-staging` | `tts-prod` |
| Future Project #2 | local | `<project>-staging` | `<project>-prod` |

---

## What runs where

| Component | dev | staging | prod |
|---|---|---|---|
| App containers | local Docker / on-demand | persistent | persistent |
| Database | local Postgres / Supabase free | dedicated Supabase project | dedicated Supabase project |
| Inngest workflows | local Inngest dev server | Inngest Cloud free tier | Inngest Cloud free tier (or self-hosted) |
| LangFuse | local instance (optional) | LangFuse Cloud free tier | LangFuse Cloud free tier (or self-hosted) |
| LiteLLM | local config | self-hosted on VPS | self-hosted on VPS |
| Sentry | dev project | staging project | prod project |
| UptimeRobot | not monitored | monitored | monitored |

---

## Environment promotion rules

| From → To | Trigger | Approver |
|---|---|---|
| dev → staging | Merge to `main` | Automatic (CI/CD) |
| staging → prod | After successful canary window | Production Manager (with Tech Lead sign-off on architectural changes) |

**Never:** skip staging. Even hotfixes deploy to staging first — see `docs/governance/hotfix-process.md` for the expedited (but still staged) path.

---

## Data flow between environments

| Direction | Allowed? | Notes |
|---|---|---|
| prod data → staging | **Never** in raw form | Synthetic / anonymized tenant data only |
| staging data → prod | **Never** | Staging is throwaway by definition |
| prod data → dev | **Never** | Tenant data is sacred — synthetic only locally |
| dev → staging | Yes via PR + merge | Standard flow |
| dev → prod | **Never directly** | Only via staging |

---

## Environment-specific configuration

Each environment has its own values for:

- Domain / URL
- Database connection string
- API keys (per vault entry)
- Feature flag defaults (see `docs/engineering/feature-flags.md`)
- Log verbosity (DEBUG in dev, INFO in staging, WARN in prod)
- Rate limits per agent (looser in dev, tighter in prod)
- Cost budget caps (none in dev, defined in staging/prod)

Configuration drift between staging and prod is itself a risk — see `docs/deploys/checklist.md` for the parity check before each promotion.

---

## How this policy is used

- Production Manager agent references this doc on every deploy
- Tech Lead references when designing changes that span environments
- Solutions Architect references when onboarding new projects (each project needs all three envs provisioned)
- Data Engineer references when wiring monitoring per environment
