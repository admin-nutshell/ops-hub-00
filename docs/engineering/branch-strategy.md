# Branch Strategy

> How we use git in the Ops Hub repo.

---

## Model: GitHub Flow with eval-gated merges

We use **GitHub Flow**, not GitFlow — simpler, well-suited to a small autonomous build team, and matches CodeRabbit's review pattern.

### Core rules

- **`main` is always deployable.** Every commit on `main` is expected to be deployable to staging without further work.
- **All work happens on short-lived feature branches.** Lifetime target: **< 3 days** from branch creation to merge.
- **Every change goes through a PR.** No direct pushes to `main` — branch protection enforces this.
- **No long-lived branches** except `main`. No `develop`, no `release`, no `staging` branches.
- **Hotfix branches** are allowed only with a documented incident ticket. See `docs/governance/hotfix-process.md`.

---

## Branch naming convention

| Type | Format | Example |
|---|---|---|
| Feature | `feature/<short-description>` | `feature/add-litellm-cost-tracking` |
| Bugfix | `fix/<short-description>` | `fix/canary-monitoring-false-positive` |
| Hotfix | `hotfix/<incident-id>` | `hotfix/INC-2026-0042` |
| Chore | `chore/<short-description>` | `chore/upgrade-langfuse-sdk` |
| Docs | `docs/<short-description>` | `docs/add-byok-runbook` |

---

## PR requirements (enforced via GitHub branch protection)

Every PR to `main` must pass these gates before merge:

1. **CodeRabbit review** — automated style/structural/quality review (advisory but tracked)
2. **CI green** — lint + tests passing
3. **Eval suite green** — Evals Lead's prompt evals pass (for PRs touching prompts or agent definitions)
4. **Security review** — Security Lead reviews PRs touching auth, vault, tenant data, or dependency additions
5. **QA Manager sign-off** — for PRs implementing fixes or new features
6. **At least one human (or designated agent) approval** — enforced via GitHub PR approval

For PRs touching **only documentation** outside `docs/security/` or `docs/governance/`, gates 3–5 are auto-waived.

---

## Merge → deploy flow

| Step | Trigger | Destination |
|---|---|---|
| Merge to `main` | Manual click on green PR | Automatic deploy to **staging** |
| Canary window | Automatic | Staging monitored 24–72 hours per change risk class |
| Production promotion | Manual approval by Production Manager | Deploy to **prod** |

Production deploys are **never automatic** from `main` — always require explicit promotion after canary success.

---

## What blocks a merge

| Condition | Resolution |
|---|---|
| Failing eval | Fix the regression OR get explicit founder waiver logged in `DECISIONS.md` |
| Security review flagged risk | Address findings OR get Security Lead approval with mitigation |
| CodeRabbit blocker | Address comment OR document why it's safe to ignore |
| Conflict with `main` | Rebase the feature branch on latest `main` |
| Branch older than 7 days | Rebase or close-and-restart — staleness is a quality risk |

---

## Long-lived branch policy

**Default: don't use them.** If a piece of work genuinely needs > 3 days of in-flight code (e.g., a major refactor), use **feature flags** instead — ship to `main` behind a flag, iterate in trunk, enable when complete. See `docs/engineering/feature-flags.md`.

---

## How this policy is enforced

- **CodeRabbit + GitHub branch protection rules** enforce most gates automatically
- **CI workflows** (defined in `docs/engineering/ci-cd-pipeline.md`) enforce eval, test, security gates
- **The Tech Lead and Production Manager agents** monitor branch hygiene and surface stale branches to PM weekly
