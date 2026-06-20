# CI/CD Pipeline

> What runs automatically when, who approves what, and how code gets from a commit to production.
> **Status:** Implementation-ready spec for T-15 (GitHub Actions). Authored by Tech Lead (T-05).
> **Related:** `docs/engineering/branch-strategy.md`, `docs/engineering/environments.md`, `docs/engineering/database-migrations.md`, ADR-0001, ADR-0002.

---

## 0. Toolchain decision (read first — T-15 depends on it)

The repo is greenfield (no `package.json`/`pyproject.toml` at authoring time). The stack signals — Inngest's TS dev server, the TypeScript feature-flag helper in `feature-flags.md`, Promptfoo (Node), Supabase Edge Functions (Deno/TS) — point to **TypeScript / Node.js 20 as the primary language.** Python is a **secondary** path for any LiteLLM-adjacent or data tooling.

**Decision (Tech Lead, T-05):**
- **Primary toolchain: Node.js 20 + TypeScript.** Package manager: **pnpm**. This is what T-15 scaffolds first.
- **Secondary toolchain: Python 3.12** (only if/when Python code lands; the spec below includes the Python job but it is a no-op skip until a `pyproject.toml` exists).
- The eval-gate thresholds and test paths below are **forward declarations** — there is no app code yet. They are the **authoritative contract** that T-15 (CI), T-16 (eval cases), and T-19 (integration test) must satisfy, not placeholders to be reinvented.

---

## Tools

- **GitHub Actions** — CI workflows, eval runs, security scans, image builds (GitHub Free private-repo Actions minutes)
- **Coolify** — deployment automation, container management, env var handling; staging deploy is triggered via Coolify **deploy webhook** (preferred) or API token
- **CodeRabbit** — automated PR review
- **Promptfoo** — eval suite runner, invoked from GitHub Actions
- **LangFuse** — eval result storage and trend comparison
- **Sentry** — error tracking post-deploy
- **UptimeRobot** — uptime checks post-deploy

All free or self-hosted (see ADR-0002).

---

## 1. Trigger conditions (authoritative)

| Event | Workflow file | What runs | Deploys? |
|---|---|---|---|
| Push to a **feature branch** that has an open PR | `pr-checks.yml` (on `pull_request`) | lint + type-check + tests + eval gate (conditional) + security scans + build smoke | No |
| **PR opened / updated** to `main` | `pr-checks.yml` | same as above; these are the **required status checks** | No |
| **Merge to `main`** | `main-deploy.yml` (on `push` to `main`) | re-run all checks on merge commit, build prod image, **auto-deploy to staging**, staging smoke tests | **Yes → staging (automatic)** |
| **Manual dispatch** (`workflow_dispatch`) | `prod-promotion.yml` | verify canary criteria, **deploy to prod**, prod smoke tests | **Yes → prod (manual only)** |
| **Nightly schedule** (cron) | `nightly-evals.yml` | broader eval coverage across all agents | No |
| **Weekly schedule + dependency changes** | `security-scan.yml` | full dependency CVE + SAST sweep | No |

**Hard rule:** there is **no automatic path to prod.** `main` → staging is automatic; staging → prod is `workflow_dispatch` only, triggered by the Production Manager (or founder for sensitive changes). This matches `branch-strategy.md` and `environments.md`.

---

## 2. Lint step

| | |
|---|---|
| **Linter (TS/JS)** | **ESLint 9** (flat config `eslint.config.js`) with `@typescript-eslint`, plus **Prettier** for formatting (`prettier --check`) |
| **Type check** | `tsc --noEmit` against `tsconfig.json` (strict mode on) |
| **Linter (Python, secondary)** | **Ruff** (`ruff check` + `ruff format --check`) against `pyproject.toml` — job skips if no `pyproject.toml` present |
| **Command (CI)** | `pnpm lint && pnpm typecheck` (scripts defined in `package.json` by T-15) |
| **Pass criteria** | zero errors. Warnings do not block but are surfaced in the PR. |

T-15 creates `eslint.config.js`, `.prettierrc`, and `tsconfig.json` (strict) as part of scaffolding.

---

## 3. Test step

| | |
|---|---|
| **Test runner (TS)** | **Vitest** (fast, TS-native, ESM-friendly) |
| **Test runner (Python, secondary)** | **pytest** — skipped until Python code exists |
| **Test locations** | unit: co-located `*.test.ts` next to source; integration: `tests/integration/**/*.test.ts` |
| **Integration DB** | ephemeral Postgres via Supabase CLI local stack (`supabase start`) or a throwaway Supabase branch DB; migrations from `supabase/migrations/` applied before tests run. **Never** runs against staging/prod. |
| **Command (CI)** | `pnpm test` (unit) and `pnpm test:integration` |
| **Coverage** | collected by Vitest; report posted as a PR comment; no hard coverage % gate in M1 (added in Phase 2) |
| **Pass criteria** | all tests green |

The first integration test (T-19: ticket intake → `new` → `triaged` state machine) lives at `tests/integration/ticket-state-machine.test.ts`.

---

## 4. Eval gate step (Promptfoo)

The non-negotiable quality gate. Mirrors `04_architecture.md` Concern 6 and `branch-strategy.md`.

| | |
|---|---|
| **Runner** | Promptfoo CLI |
| **Eval file location** | `evals/<agent>/promptfooconfig.yaml`; cases under `evals/<agent>/cases/`; shared synthetic datasets in `evals/datasets/` |
| **When it runs** | the eval gate is **required** when a PR touches any of: `agents/**` (prompts, system messages, sub-agent defs), `evals/**`, the Model Router config, or the Project Context schema. (Path filter in `pr-checks.yml`.) For PRs that touch none of these, the gate auto-passes (recorded as "not applicable"). |
| **Command (CI)** | `promptfoo eval --config evals/<agent>/promptfooconfig.yaml --output results.json` per affected agent, then publish `results.json` to LangFuse |
| **Pass/fail criteria** | **> 95% pass rate** across the affected agents' cases (matches the Phase 1 KPI in `09_delivery.md`). Below 95% **blocks the merge.** |
| **Regression reporting** | Evals Lead agent posts a PR comment: pass/fail count per agent, comparison vs. the `main` baseline, highlighted regressions (cases passing on `main` but failing on the PR), suggested next action. |
| **Waiver** | A founder may waive a failing eval **only** by explicit PR comment **plus** a `DECISIONS.md` entry. Never silently. (Founder-owned; not an agent decision.) |

This step is wired by T-17 (Evals Lead) on top of the `pr-checks.yml` skeleton from T-15.

---

## 5. Staging deploy step (automatic, on merge to `main`)

Runs in `main-deploy.yml` after all checks re-pass on the merge commit.

```
1. Checkout merge commit
2. Re-run lint + type-check + tests (fast fail before building)
3. Build production container image (Docker)
4. Push image to container registry (GitHub Container Registry — ghcr.io, free for the repo)
5. Apply DB migrations to STAGING Supabase (supabase db push against staging)
6. Trigger Coolify STAGING deploy:
   - POST to the Coolify deploy webhook for `ops-hub-staging`
     (webhook URL stored as the GitHub secret COOLIFY_STAGING_DEPLOY_HOOK)
   - fallback: Coolify API call with COOLIFY_API_TOKEN if a webhook is unavailable
7. Wait for staging health check (poll the app /health endpoint until 200, with timeout)
8. Run staging smoke tests (pnpm test:smoke against the staging URL)
9. Notify Production Manager in WORK.md (open the canary window)
```

**Migrations note:** migrations run against staging here and must soak ≥ 24h before prod (per `database-migrations.md`). Migrations are forward-only; a bad migration is fixed forward, not rolled back.

**Failure behavior:** if the staging deploy or smoke test fails, Coolify auto-rolls back to the previous staging image; Production Manager is notified. The merge is not reverted (fix forward), but prod promotion is blocked until staging is green.

---

## 6. Prod deploy step (manual promotion only)

Runs in `prod-promotion.yml`, **`workflow_dispatch` only.** There is no `push`/`schedule` trigger on this workflow — that is the structural guarantee that prod is never auto-deployed.

```
1. Manual trigger by Production Manager (or founder for sensitive/High-risk changes)
2. Verify canary success criteria met (staging green for the required canary window,
   24–72h per change risk class per branch-strategy.md)
3. Apply DB migrations to PROD Supabase (only those soaked ≥24h on staging)
4. Trigger Coolify PROD deploy (webhook COOLIFY_PROD_DEPLOY_HOOK)
5. Wait for prod health check
6. Run prod smoke tests
7. On failure: auto-rollback to previous prod image + alert Production Manager + founder
8. Notify Knowledge Lead to trigger Feature Adaptation
9. Log the promotion to DECISIONS.md
```

High-risk prod deploys are founder-owned per the RACI — the workflow requires a founder approval (GitHub Environments "required reviewers" on a `production` environment) before step 4 for changes flagged High-risk.

---

## 7. PR status checks — all four must pass before merge

GitHub branch protection on `main` requires these checks green before the merge button enables:

| # | Required check | Provided by | Blocks merge? |
|---|---|---|---|
| 1 | **Lint + type-check** (§2) | `pr-checks.yml` job `lint` | Yes |
| 2 | **Tests** (unit + integration) (§3) | `pr-checks.yml` job `test` | Yes |
| 3 | **Eval gate > 95%** (§4) | `pr-checks.yml` job `evals` (or "n/a" pass) | Yes |
| 4 | **Security scans** (§8) — CVE + secret detection + SAST | `pr-checks.yml` job `security` | Yes (critical findings block) |

Plus the branch-strategy.md human/agent gates (CodeRabbit review, Security Lead review for tenant-data/vault/auth PRs, QA Manager sign-off for fixes/features, ≥1 approval). For **docs-only** PRs outside `docs/security/` and `docs/governance/`, checks 3 and the human review gates are auto-waived (per branch-strategy.md), but lint/build still run.

Branch protection settings T-15 must configure:
- Require status checks 1–4 to pass.
- Require branches up to date before merge.
- Require ≥1 approval; dismiss stale approvals on new commits.
- No direct pushes to `main`; no force-push; no deletion.

---

## 8. Security scans (gate detail)

Runs in `pr-checks.yml` (job `security`) and weekly in `security-scan.yml`:

```
- Dependency CVE scan:  pnpm audit (and `safety`/`pip-audit` when Python lands)
- Secret detection:     gitleaks (fails on any committed secret)
- SAST:                 semgrep (default + typescript rulesets)
- Multi-tenant isolation tests: run when the PR touches supabase/migrations/** or
  the data layer — exercises cross-tenant RLS via the ops_hub_app role (T-18).
```

Critical findings block the PR; Security Lead must approve before further action.

---

## 9. Workflow file locations

```
.github/workflows/
├── pr-checks.yml          ← on pull_request: lint, test, evals, security, build smoke (required checks)
├── main-deploy.yml        ← on push to main: rebuild + migrate + auto-deploy staging + smoke
├── nightly-evals.yml      ← scheduled: broad eval coverage
├── security-scan.yml      ← scheduled weekly + on dependency changes
└── prod-promotion.yml     ← workflow_dispatch only: manual prod promotion
```

---

## 10. Secrets in CI

GitHub Actions secrets (repository- or environment-scoped; never written to logs):

| Secret | Used by | Scope |
|---|---|---|
| `COOLIFY_STAGING_DEPLOY_HOOK` | `main-deploy.yml` | repo |
| `COOLIFY_PROD_DEPLOY_HOOK` | `prod-promotion.yml` | `production` environment (gated) |
| `COOLIFY_API_TOKEN` | deploy fallback | repo |
| `SUPABASE_STAGING_DB_URL` / access token | staging migrations | repo |
| `SUPABASE_PROD_DB_URL` / access token | prod migrations | `production` environment |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | eval result publishing | repo |
| `SENTRY_AUTH_TOKEN` | release tracking | repo |
| `GHCR` token | image push | provided by `GITHUB_TOKEN` |

CI **does not** have access to: production **LLM** API keys (those live in Supabase Vault, read only by the Model Router — ADR-0002 §3/§4), customer/tenant data, or founder admin credentials. The prod-scoped secrets live behind the GitHub `production` environment with required reviewers, so a PR from a feature branch cannot reach them.

---

## 11. Failure modes & responses

| Failure | Auto-response | Escalation |
|---|---|---|
| Lint / type-check fails | PR can't merge | Author (agent) fixes |
| Unit / integration test fails | PR can't merge | Author fixes; QA Manager flagged if pattern |
| Eval < 95% | PR can't merge | Evals Lead investigates; founder waiver if intentional (DECISIONS.md) |
| Security scan critical | PR blocked | Security Lead must approve before any further action |
| Staging deploy fails | Auto-rollback to previous staging image | Production Manager triages; prod promotion blocked |
| Migration fails on staging | Deploy aborts; image not promoted | Tech Lead + Production Manager; fix-forward migration |
| Prod deploy fails | Auto-rollback to previous prod image | Production Manager + founder notified |
| Prod smoke test fails | Auto-rollback + alert | Production Manager + founder immediately |

---

## How this policy is used

- **Production Manager** owns the deploy workflows (`main-deploy.yml`, `prod-promotion.yml`) and references this doc for every deploy.
- **Tech Lead** owns this spec and the scaffolding decision (§0); references it when designing pipeline changes.
- **Evals Lead** owns the eval gate mechanics (§4) and wires T-17 on top of the T-15 skeleton.
- **Security Lead** owns the security gates (§8) and the prod-environment secret scoping (§10).
- **Founder** interacts only on waivers (§4) and High-risk prod approvals (§6).
