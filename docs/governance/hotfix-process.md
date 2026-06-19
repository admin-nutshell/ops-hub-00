# Hotfix Process

> When and how we expedite a fix to production without compromising our safety bar.

---

## What counts as a hotfix-worthy situation

A hotfix is the **expedited path** through the deploy pipeline. It still passes the same gates, just on a compressed timeline. Use it only when:

| Trigger | Hotfix justified? |
|---|---|
| P1 incident: prod down, data loss risk, security breach | ✅ Yes |
| P1 customer-facing bug blocking critical workflow for multiple tenants | ✅ Yes |
| Regression introduced by recent deploy that's actively harming users | ✅ Yes |
| Security vulnerability with active exploitation potential | ✅ Yes |
| P2 issue annoying but not blocking | ❌ No — use normal flow |
| New feature someone really wants soon | ❌ No — use normal flow |
| Founder excitement | ❌ No — use normal flow |

When in doubt, default to the normal flow. The standard pipeline is fast enough (typically < 24 hours from PR to prod for low-risk changes).

---

## Hotfix lifecycle

### Step 1: Incident ticket created

Before any code is written:

- [ ] Incident ticket created in FreeScout (or wherever active incidents live)
- [ ] Severity assigned (must be P1 for hotfix path; P2 uses normal flow)
- [ ] Production Manager + Tech Lead notified in `WORK.md` with `INCIDENT:` prefix
- [ ] Founder notified in `FOUNDER_QUEUE.md` with `URGENT:` prefix
- [ ] Incident commander designated (default: Production Manager)

### Step 2: Decide approach

Within 15 minutes of incident detection:

| Option | When |
|---|---|
| **Feature flag kill switch** | If the broken feature has a flag — toggle it off. Skip hotfix entirely. < 5 minutes. |
| **Rollback to previous release** | If the issue is from the most recent deploy. Coolify "redeploy previous image". < 5 minutes. |
| **Forward fix (hotfix)** | If neither of the above applies. Continue to Step 3. |

Always prefer feature flag → rollback → forward fix, in that order.

### Step 3: Branch + fix

- [ ] Create branch: `hotfix/INC-<ticket-id>`
- [ ] Author the minimal fix — no unrelated changes
- [ ] Write a test that fails without the fix and passes with it
- [ ] Update the eval suite if relevant
- [ ] Push branch + open PR

### Step 4: Expedited review (compressed gates)

| Gate | Normal flow | Hotfix flow |
|---|---|---|
| CodeRabbit review | Required, address all blockers | Required, address blockers OR explicit override with rationale |
| CI tests | Must pass | Must pass — no override |
| Eval suite | Must pass | Must pass — no override |
| Security review | Required for tenant-data | Required, expedited (Security Lead notified directly in `WORK.md`) |
| QA Manager sign-off | Required | Required, expedited |
| Founder approval | Risk-class dependent | Always required for hotfix |

**Eval suite and CI tests are never overridden, even for hotfix.** A regression slipped through is what caused the incident in the first place.

### Step 5: Merge + staging deploy

- [ ] Merge PR to `main`
- [ ] Coolify deploys to staging automatically
- [ ] Smoke tests on staging pass
- [ ] **Canary window: minimum 30 minutes** (not the standard 4–72 hours)
- [ ] Production Manager watches all monitoring during canary

### Step 6: Prod deploy

- [ ] Founder explicit approval recorded in `FOUNDER_QUEUE.md`
- [ ] Tenant pre-notification sent if customer-facing (skip only if downtime is the issue)
- [ ] Coolify deploys to prod
- [ ] Smoke tests pass
- [ ] Production Manager watches monitoring intensively for **first 30 minutes**

### Step 7: Confirm resolution

- [ ] Original incident metric returns to baseline
- [ ] Affected tenants confirm resolution (where applicable)
- [ ] Incident ticket marked resolved with timestamp
- [ ] Hotfix logged in `DECISIONS.md` with link to incident ticket

---

## Post-hotfix follow-up (within 7 days)

A hotfix is not over until the follow-up is done. This is non-negotiable.

- [ ] **Post-mortem** in `docs/post-mortems/INC-<ticket-id>.md` — Tech Lead authors
  - What happened
  - Why (root cause, not symptom)
  - How we detected it
  - How we fixed it
  - What we'll change to prevent recurrence
- [ ] **Eval case added** for the regression — Evals Lead
- [ ] **Regression test added** to standard CI — QA Manager
- [ ] **Monitoring threshold updated** if detection was too slow — Data Engineer
- [ ] **Policy doc update** if a new failure mode revealed a gap — relevant agent
- [ ] **Knowledge base article** if tenant-facing — Knowledge Lead
- [ ] **Founder review** of post-mortem within 7 days

---

## Hotfix scope discipline

A hotfix branch must contain **only** the fix for the incident. Common temptations to resist:

| Tempting addition | Why it's prohibited |
|---|---|
| "While we're in here, let's refactor this..." | Increases risk; do separately |
| "Let's also fix this related bug..." | Different ticket, different deploy |
| "Add a feature flag for next time..." | Yes, but in a separate PR |
| Update unrelated dependencies | Different concerns, different review |

If a hotfix PR drifts in scope, Tech Lead or Production Manager closes it and asks the author to start over with a minimal change.

---

## When the hotfix process itself fails

If a hotfix introduces a NEW problem in prod:

1. Immediate rollback (Coolify redeploy previous image)
2. Treat as a new incident with its own ticket
3. Do not chain another hotfix on top — pause, breathe, root-cause first
4. Founder explicitly approves any subsequent hotfix attempt

Repeated hotfix failures are a signal that the underlying system needs broader work, not more rushing.

---

## Hotfix metrics tracked

| Metric | Target | Tracked in |
|---|---|---|
| Time from incident detection to first response | < 5 min for P1 | Incident tickets |
| Time from detection to fix deployed to prod | < 2 hours for P1 | Incident tickets |
| Hotfixes per quarter | < 4 (more suggests systemic quality issue) | Monthly metrics dashboard |
| Hotfixes followed by post-mortem within 7 days | 100% | Tech Lead audit |
| Hotfixes that introduced new incidents | 0 target | Incident tickets |

---

## How this policy is used

- Production Manager is incident commander by default; owns this process
- Tech Lead reviews hotfix PRs with extra scrutiny
- Security Lead expedites reviews for tenant-data hotfixes
- Evals Lead and QA Manager ensure no eval/test override happens
- Founder gives explicit approval for every hotfix prod deploy
- This document is reviewed quarterly for fit, especially after any post-mortem
