# Deploy Checklist

> Every prod deploy follows this list. No skipping, even for hotfixes (which use the expedited path in `docs/governance/hotfix-process.md`).

---

## Risk classification

Every change deploys with one of three risk classes. Production Manager assigns this at PR merge time.

| Class | Examples | Canary window | Approvers |
|---|---|---|---|
| **Low** | Docs, copy changes, internal-only config, minor UI tweaks | 4 hours staging | Production Manager |
| **Medium** | New features behind flags, non-tenant-facing infra, refactors | 24 hours staging | Production Manager + Tech Lead |
| **High** | Auth changes, vault changes, migration with data backfill, new agent capabilities, prompt changes for tenant-facing flows | 72 hours staging | Production Manager + Tech Lead + Security Lead + founder |

---

## Pre-deploy gates (before merge to `main`)

Production Manager verifies, in order:

- [ ] PR has CodeRabbit review (resolved or explicitly waived)
- [ ] All CI checks green (lint, tests, security scans)
- [ ] Eval suite green (for prompt / agent PRs)
- [ ] Security Lead approval (for tenant-data / auth / vault PRs)
- [ ] QA Manager sign-off (for feature / fix PRs)
- [ ] Risk class assigned and documented in PR description
- [ ] Rollback plan documented in PR description
- [ ] Feature flag in place (for medium/high risk changes)
- [ ] Migration backup taken (for migrations changing data)
- [ ] Monitoring dashboards confirm green baseline pre-deploy

---

## Staging deploy (automatic on merge)

After merge to `main`:

- [ ] CI builds container image
- [ ] Coolify deploys to staging environment
- [ ] Health checks pass (liveness, readiness)
- [ ] Smoke tests pass on staging
- [ ] Production Manager posts to `WORK.md` confirming staging deploy succeeded
- [ ] Canary window timer starts

---

## During canary window

| What | Who | When |
|---|---|---|
| Watch error rate vs baseline | Production Manager + Sentry | Continuously |
| Watch latency vs baseline | Production Manager + UptimeRobot | Continuously |
| Watch eval scores vs baseline | Evals Lead + LangFuse | At start, then hourly |
| Watch agent run success rate | Production Manager + Inngest dashboard | Continuously |
| Watch cost per workflow vs baseline | Production Manager + LangFuse | Hourly sample |
| Watch security signals | Security Lead | Continuously |

**If any P1 or P2 metric breaches threshold during canary:** auto-rollback in staging, halt promotion, root-cause before retry.

**If only P3 metrics breach:** investigate; may extend canary window or proceed with caveats logged.

---

## Promotion gates (before prod deploy)

Production Manager verifies, in order:

- [ ] Canary window completed without P1/P2 metric breach
- [ ] No regressions in eval scores
- [ ] No customer-reported issues from staging (if applicable)
- [ ] All required approvers signed off (per risk class)
- [ ] Rollback plan reviewed (still applicable?)
- [ ] Feature flags configured correctly for prod
- [ ] Founder approval recorded for High-risk class
- [ ] Maintenance window scheduled (for High-risk class affecting availability)
- [ ] Tenant pre-notification sent (for tenant-facing High-risk changes)

---

## Prod deploy execution

- [ ] Production Manager triggers prod deploy via Coolify
- [ ] CI/CD runs prod-promotion.yml workflow
- [ ] Container image promoted from staging to prod registry tag
- [ ] Coolify deploys to prod environment
- [ ] Health checks pass
- [ ] Smoke tests pass on prod
- [ ] Production Manager confirms deploy success in `WORK.md`
- [ ] Deploy logged to `DECISIONS.md` with risk class and approvers

---

## Post-deploy monitoring (first 60 minutes)

| Time after deploy | What to verify |
|---|---|
| 0–5 min | All health checks green, no error spike |
| 5–15 min | Latency stable, no eval regressions, no cost spike |
| 15–30 min | Normal traffic patterns, no tenant complaints |
| 30–60 min | Full metric baseline holds; deploy considered "stable" |

Production Manager stays attentive to alerts for the first hour. After 60 min, normal alert routing resumes.

---

## Post-deploy follow-up

- [ ] Knowledge Lead triggered to run Feature Adaptation cycle (if user-visible change)
- [ ] Tenant comms sent (if user-facing improvement worth highlighting)
- [ ] Sentry release tagged
- [ ] LangFuse baseline updated (if intentional behavior shift)
- [ ] Internal runbook updated (if operational change)

---

## Rollback triggers (during deploy or first 60 min post-deploy)

Automatic rollback if **any** of the following:

- Health check fails
- Smoke test fails
- Error rate > 2× baseline for > 5 min
- Latency p95 > 5× baseline for > 5 min
- Cost per workflow > 3× baseline for > 15 min
- Security signal: cross-tenant data leak detected
- Security signal: secret leak detected in logs

Production Manager can also **manually rollback** at any time within the first 60 min for any reason, no founder approval needed.

Rollback procedure: Coolify "redeploy previous image" — completes in < 2 minutes.

---

## Failed deploy debrief

If a deploy is rolled back or required manual intervention:

- [ ] Tech Lead documents what happened in `docs/post-mortems/`
- [ ] Production Manager updates this checklist if a new failure mode was discovered
- [ ] QA Manager adds a regression test for the missed case
- [ ] Evals Lead adds an eval case for any prompt-related failure

---

## How this policy is used

- Production Manager owns this checklist; every deploy run through it explicitly
- Tech Lead reviews changes to the checklist itself
- Security Lead enforces gates 2 (security review) and 3 (security signals during canary)
- Founder approves only High-risk deploys
