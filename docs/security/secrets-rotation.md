# Secrets Rotation

> When and how we rotate every credential. Built around the simple principle: a compromised secret should be replaceable in under 1 hour.

---

## Inventory of secrets

| Secret type | Where stored | Used by | Rotation cadence |
|---|---|---|---|
| Anthropic API key (per project) | Supabase Vault | Model Router (LiteLLM) | 90 days |
| OpenAI API key (per project) | Supabase Vault | Model Router | 90 days |
| Other LLM provider keys (GLM, Kimi, etc.) | Supabase Vault | Model Router | 90 days |
| Supabase service-role key | Coolify env vars + Vault | App backend | 180 days |
| Supabase anon key | Coolify env vars | App frontend | 180 days |
| Database passwords | Supabase managed | Supabase internal | Managed by Supabase |
| Coolify deploy token | GitHub Actions secrets | CI/CD | 90 days |
| Container registry credentials | GitHub Actions secrets | CI/CD | 180 days |
| LangFuse SDK keys | Coolify env vars | All agents (for tracing) | 180 days |
| Inngest signing keys | Coolify env vars | Inngest workflows | 180 days |
| Sentry DSN | Coolify env vars | App backend | 365 days (low-risk public-ish key) |
| SSH keys to VPS | Local + 1Password / Bitwarden | Founder + Production Manager | 365 days |
| GitHub Personal Access Tokens | GitHub Actions secrets | CI/CD | 90 days |
| Webhook signing secrets (FreeScout, etc.) | Coolify env vars | Workflows | 180 days |
| CodeRabbit API key | GitHub installation | CodeRabbit GitHub app | Managed by CodeRabbit |

---

## Standard rotation procedure

1. **Generate new credential** in the provider's console (Anthropic, OpenAI, Supabase, etc.)
2. **Add new credential to Vault / Coolify env vars** alongside the old one (both active briefly)
3. **Update Model Router config** to use new credential
4. **Verify** with a test workflow / agent run
5. **Update all consumers** if more than one place uses the credential
6. **Verify** again across all consumers
7. **Revoke old credential** in the provider's console
8. **Document** rotation date in `docs/security/rotation-log.md`

For most secrets the entire procedure takes 15–30 minutes and is zero-downtime if done in this order.

---

## Emergency rotation (suspected compromise)

If a secret may have leaked:

1. **Immediately** revoke the old credential at the provider
2. Generate a new one
3. Push the new value to Vault / Coolify
4. Restart affected services (Coolify "redeploy" → < 2 minutes)
5. Post to `FOUNDER_QUEUE.md` with `URGENT: SECRET ROTATION` prefix
6. Review logs for any unauthorized use of the old credential
7. Document the incident in `docs/post-mortems/`

Target: full emergency rotation in **< 1 hour** from detection to restored service.

---

## Detection of leaked secrets

We rely on multiple layers:

| Layer | Tool | Trigger |
|---|---|---|
| Pre-commit | `gitleaks` | Block commit containing secret patterns |
| CI on every PR | `gitleaks` action | Block merge |
| GitHub secret scanning | Built-in | Alert on push of known credential patterns |
| LangFuse log scrub | Custom filter | Alert if a key pattern appears in agent logs |
| Sentry log scrub | Built-in | Auto-redact known credential formats |

Any detection triggers emergency rotation procedure for the affected credential.

---

## Vault access discipline

| Who can read Vault | What |
|---|---|
| Model Router (LiteLLM) | LLM provider keys, per project |
| App backend | Supabase service-role key (own project only) |
| Production Manager (agent) | Read-only access for verification during deploys |
| Founder | All Vault entries (break-glass admin) |
| Other agents | No direct Vault access — they request resources, not credentials |

Every Vault read is **audit-logged** with: who, when, what, why (from agent context).

---

## Audit log

Vault access log retained for:

- **90 days** in hot storage (queryable from admin panel)
- **2 years** in cold archive (encrypted S3-compatible storage)

Reviewed monthly by Security Lead for:

- Unexpected access patterns
- Credentials read but not used (possible exfiltration)
- Failed read attempts (possible probing)

---

## Rotation calendar

Production Manager maintains a rolling rotation calendar:

```
docs/security/rotation-log.md
```

Each entry records: secret name, rotated date, next-due date, who rotated, verification status.

A weekly automated check warns 14 days before any credential's due date. A daily check warns at 1 day. Anything past due posts P2 alert.

---

## Onboarding new secrets

When a new credential type is introduced (e.g., adding Kimi provider):

- [ ] Tech Lead adds an ADR documenting the new secret type
- [ ] Security Lead approves storage location and rotation policy
- [ ] Production Manager adds entry to the rotation calendar
- [ ] This document is updated with the new row in the inventory table

---

## How this policy is used

- Security Lead owns this policy and the rotation calendar
- Production Manager executes rotations and updates the log
- Tech Lead authors ADRs for new secret types
- Founder approves any policy changes
