# Disaster Recovery

> What we'd do if the VPS burned down at 3am, plus our backup strategy and recovery objectives.

---

## Recovery objectives (per environment)

| Environment | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) |
|---|---|---|
| dev | Best effort | 24 hours |
| staging | 4 hours | 24 hours |
| **prod** | **2 hours** | **15 minutes** |

**RTO** = how long can the system be down before recovery is complete.
**RPO** = how much data loss is acceptable (measured backward from the incident).

---

## Backup strategy

### Database (Supabase)

| Type | Cadence | Retention | Location |
|---|---|---|---|
| Automatic point-in-time recovery | Continuous (WAL) | 7 days | Supabase managed |
| Daily full backup | Daily 03:00 UTC | 30 days | Supabase managed |
| Manual pre-migration snapshot | Per destructive migration | 90 days | Encrypted private storage |
| Weekly off-site export | Sundays | 6 months | Encrypted private storage (separate provider) |

### Application code

- **Primary:** GitHub repos (admin-nutshell org)
- **Mirror:** Founder's local clone (refreshed weekly)
- **Container images:** Container registry (retained 90 days)

### Configuration & secrets

| Asset | Backup method | Retention |
|---|---|---|
| Coolify project configs | Daily export to encrypted storage | 90 days |
| Vault contents | Encrypted snapshot weekly | 90 days |
| Inngest workflow definitions | Source-controlled in repo | Git history |
| LangFuse project configs | Daily JSON export | 30 days |
| Feature flag table | Part of database backup | (per DB policy) |

### Audit logs

- **Hot:** 90 days in Supabase
- **Cold archive:** 2 years in encrypted private storage
- **Compliance retention** (when applicable): per regulatory requirement

---

## Failure scenarios & response

### Scenario 1: Single container crashes

**Likelihood:** weekly  
**Detection:** Coolify health check fails  
**Response:** Coolify auto-restarts container. If 3 consecutive restarts fail, alert Production Manager.  
**Recovery time:** < 5 minutes  

### Scenario 2: Coolify dashboard inaccessible

**Likelihood:** rare  
**Detection:** UptimeRobot flag  
**Response:** SSH to VPS, restart Coolify, investigate. Containers usually keep running.  
**Recovery time:** < 30 minutes  

### Scenario 3: Database corruption (single table)

**Likelihood:** rare  
**Detection:** Application errors + Supabase logs  
**Response:** Point-in-time recovery to just before corruption. Investigate cause.  
**Recovery time:** < 1 hour  
**Data loss:** up to 15 minutes (the RPO)  

### Scenario 4: Full Supabase project loss

**Likelihood:** very rare  
**Detection:** Supabase status page + monitoring  
**Response:** Restore from daily backup to new project; update connection strings; redeploy apps.  
**Recovery time:** 2–4 hours  
**Data loss:** up to 24 hours (last daily backup)  

### Scenario 5: VPS lost (Hostinger outage, hardware failure)

**Likelihood:** very rare  
**Detection:** UptimeRobot + Hostinger status  
**Response:** Provision new VPS, install Coolify, restore configs from backup, redeploy apps from registry, restore Supabase connections.  
**Recovery time:** 2–8 hours depending on severity  
**Data loss:** none for app code; up to 24 hours for any state held only on VPS  

### Scenario 6: GitHub account compromise

**Likelihood:** very rare  
**Detection:** Unexpected commits, GitHub security alerts  
**Response:** Lock account; rotate all CI secrets; review recent commits; restore from clean local clone if needed.  
**Recovery time:** 4–24 hours  

### Scenario 7: Founder unavailable (bus factor)

**Likelihood:** unknown  
**Detection:** Repeated missed FOUNDER_QUEUE polls  
**Response:** Pre-designated delegate (named in `docs/governance/delegation.md`) has break-glass credentials and authority for emergency continuity.  
**Note:** This is documented separately and treated as a governance matter, not a technical one.  

---

## Recovery runbooks

Each scenario has a step-by-step runbook in `docs/runbooks/`:

```
docs/runbooks/
├── restart-failed-container.md
├── coolify-recovery.md
├── database-point-in-time-recovery.md
├── full-supabase-restore.md
├── vps-rebuild.md
├── github-account-lockdown.md
└── founder-unavailable.md
```

Runbooks include exact commands, credentials needed (with Vault references, not literal values), and verification steps.

---

## Backup verification

A backup that hasn't been tested is not a backup.

| Test | Cadence | Owner |
|---|---|---|
| Restore last daily backup to a scratch DB, verify schema + sample queries | Monthly | Data Engineer |
| Restore Coolify configs to scratch instance | Quarterly | Production Manager |
| Restore Vault snapshot to test instance | Quarterly | Security Lead |
| Full VPS rebuild drill | Annually | Production Manager + founder |

Failures from any test trigger immediate investigation and policy update.

---

## Annual DR drill

Once per year, on a planned weekend:

1. Simulate full VPS loss
2. Provision fresh VPS
3. Restore everything to a "DR" subdomain (not affecting prod)
4. Measure actual RTO and RPO achieved
5. Compare to objectives; update procedures if gaps found
6. Document lessons in `docs/post-mortems/dr-drill-<year>.md`

---

## Communication during incidents

| Severity | Tenant comms | Frequency |
|---|---|---|
| Single container restart, < 5 min outage | Optional | — |
| Single component degraded > 15 min | Status page update | When confirmed |
| Full outage > 30 min | Email + status page | Within 15 min of detection, then hourly |
| Data loss event | Direct outreach + email | As soon as scope is known |

Comms templates live in `docs/comms/incident-templates/`.

---

## How this policy is used

- Production Manager owns the DR runbooks and quarterly verification
- Data Engineer owns database backup verification
- Security Lead owns Vault and access-related recovery
- Tech Lead reviews recovery objectives annually for fit
- Founder approves policy changes and runs the annual drill
