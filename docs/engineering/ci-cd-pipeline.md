# CI/CD Pipeline

> What runs automatically when, who approves what, and how code gets from a commit to production.

---

## Tools

- **GitHub Actions** — CI workflows, eval runs, security scans, image builds (free tier for public repos and within the GitHub Free private-repo Actions minutes)
- **Coolify** — deployment automation, container management, env var handling
- **CodeRabbit** — automated PR review
- **Promptfoo** — eval suite runner (invoked from GitHub Actions)
- **LangFuse** — eval result storage and comparison
- **Sentry** — error tracking post-deploy
- **UptimeRobot** — uptime checks post-deploy

All free or self-hosted.

---

## Pipeline stages

### On every push to a branch (not `main`)

```
1. Checkout
2. Lint (eslint / ruff / etc.)
3. Type-check (tsc / mypy / etc.)
4. Unit tests
5. Integration tests (against ephemeral test DB)
6. Coverage report (posted as PR comment)
```

Estimated runtime: < 5 minutes.

### On PR open / update

In addition to the per-branch stages, PRs run:

```
7. CodeRabbit review (automated)
8. Eval suite — IF the PR touches prompts, agents, or eval-relevant code
9. Security scans:
   - Dependency CVE scan (npm audit / safety)
   - Secret detection (gitleaks)
   - SAST (semgrep)
10. Multi-tenant isolation tests — IF the PR touches data layer
11. Build container image (smoke test that it compiles)
```

Estimated runtime: < 10 minutes total.

PR cannot be merged unless ALL of these are green. Branch protection enforces this.

### On merge to `main`

```
12. All branch + PR stages re-run on the merge commit
13. Build production container image
14. Push image to container registry
15. Trigger Coolify deploy to staging
16. Wait for staging health checks
17. Run staging smoke tests
18. Notify Production Manager agent in WORK.md
```

Estimated runtime: < 15 minutes.

### Manual: promotion to prod (after canary window)

Triggered by Production Manager agent (or founder for sensitive changes):

```
19. Verify canary success criteria met
20. Trigger Coolify deploy to prod
21. Wait for prod health checks
22. Run prod smoke tests
23. Notify Knowledge Lead to trigger Feature Adaptation
24. Log to DECISIONS.md
```

---

## Eval gate detail

When a PR touches:

- Anything under `agents/` (prompts, system messages, sub-agent definitions)
- Anything under `evals/`
- The Model Router config
- The Project Context schema

…the **eval suite must pass.** This is non-negotiable.

The Evals Lead agent posts results as a PR comment with:

- Pass/fail count per agent
- Comparison against the `main` baseline
- Highlighted regressions (cases that pass on `main` but fail on this PR)
- Suggested next action

Founder can waive a failing eval **only by explicit comment + entry in `DECISIONS.md`** — never silently.

---

## Workflow file locations

```
.github/workflows/
├── pr-checks.yml          ← runs on PR open/update
├── main-deploy.yml        ← runs on merge to main
├── nightly-evals.yml      ← runs daily, broader eval coverage
├── security-scan.yml      ← runs weekly + on dependency changes
└── prod-promotion.yml     ← manual trigger, deploys to prod
```

---

## Eval suite invocation

```bash
# Local
promptfoo eval --config evals/<agent>/promptfooconfig.yaml

# In CI
promptfoo eval --config evals/<agent>/promptfooconfig.yaml --output results.json
# Then publish results.json to LangFuse for trend tracking
```

---

## Secrets in CI

GitHub Actions has access to:

- Coolify API token (for deploys)
- Container registry credentials (for image push)
- LangFuse keys (for eval result publishing)
- Sentry release-tracking key

CI **does not** have access to:

- Production API keys (those live in Coolify env vars, never in CI)
- Customer data / tenant credentials
- Founder-level admin credentials

Secrets in GitHub Actions are scoped to repository and never written to logs.

---

## Failure modes & responses

| Failure | Auto-response | Escalation |
|---|---|---|
| Lint fails | PR can't merge | Author (agent) fixes |
| Unit test fails | PR can't merge | Author fixes; QA Manager flagged if pattern |
| Eval regresses | PR can't merge | Evals Lead investigates; founder waiver if intentional |
| Security scan flags critical | PR blocked | Security Lead must approve before any further action |
| Staging deploy fails | Automatic rollback to previous staging image | Production Manager triages |
| Prod deploy fails | Automatic rollback to previous prod image | Production Manager + founder notified |
| Prod smoke test fails | Automatic rollback + alert | Production Manager + founder notified immediately |

---

## How this policy is used

- Production Manager agent owns the deploy workflows and references this doc for every deploy
- Tech Lead references when designing pipeline changes
- Evals Lead references for the eval gate mechanics
- Security Lead references for security scan gates
- Founder rarely interacts directly — only when a waiver or escalation is needed
