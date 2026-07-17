# Runbook — Deploy Health Gate (T-123)

**Owner:** Production Manager
**Built:** 2026-07-16, Sprint 22 Phase 2 Track B
**Related:** `.claude/team/AUTONOMY.md` (`redeploy-already-authorized` category's unlock gate), `docs/planning/target-operating-model-implementation-plan.md` §3

---

## What this is

An automated, mandatory step in `main-deploy.yml` and `prod-deploy.yml` that
runs after every qualifying deploy and proves the deploy is actually healthy
— not just "the container started." Before this existed, that verification
was a manual runbook step a human had to remember to do after the fact.

The gate is a single script, `scripts/deploy-health-gate.sh`, called from
both deploy workflows with the same two paths:

| Endpoint | Built by | Catches |
|---|---|---|
| `/health/env` | T-63 | Missing/dropped required env vars on the live process (the T-47 incident class — 9 vars silently vanished from Coolify, uncaught for 2 days) |
| `/health/litellm-internal` | T-97 | A silently-rejected `LITELLM_MASTER_KEY` or unreachable internal LiteLLM target (the FQ-69 incident class — `/health/litellm` stayed green through this because it never sends an Authorization header) |

Both endpoints already existed and were already independently proven
(T-63's unit tests; T-97's dedicated `verify-litellm-internal-health-
handler.yml` live-verification workflow). This task's job was to actually
**wire them into the deploy path itself**, so a broken redeploy fails the
GitHub Actions run in red instead of silently going green and waiting to be
caught by the next 6-hourly UptimeRobot/T-98 poll or a human noticing.

`deploy-staging-services.yml` (LiteLLM/FreeScout infra deploys) had a
separate, older problem: its health checks polled correctly but only ever
printed a `⚠️ Not yet 200` warning and exited 0 regardless — a genuinely
broken infra deploy reported SUCCESS. T-123 also fixed this (fail-loud after
retries, same shape as the other two workflows) since it's the exact
antipattern this task exists to close, in a file this task's own scope
explicitly named as an example.

---

## What happens when the gate fails

The deploy workflow run goes **red**, with a clear `::error::` line naming
which check failed and the last HTTP status/response body seen. That is the
entire v1 behavior — **no automatic rollback.**

### Why fail-loud-only, not auto-rollback, in v1

- Auto-rollback (re-patch the previous image tag via the Coolify API +
  restart) is mechanically simple, but triggering it unattended before a
  human has looked at *why* the gate failed is a real risk of its own —
  masking a root cause, or rolling back into a state that's ALSO broken for
  an unrelated reason. `PRODUCTION.md`'s own rollback decision tree already
  encodes "notify PM, root-cause" as the answer for anything beyond a
  feature-flag toggle — it does not say "retry automatically."
- The existing manual path is fast and well-proven: re-run `prod-deploy.yml`
  (or the staging equivalent) with the previous known-good `image_tag`/SHA.
  This has been used repeatedly in this project's history and comfortably
  clears the < 15 min mean-rollback-time bar in `PRODUCTION.md`.
- Auto-rollback is a defensible, natural v2 — and it ties directly into
  **Track C** (wiring the T-98 synthetic-ticket monitor into deploy gating),
  which the implementation plan itself already names as a place an
  auto-rollback path could live ("before (or immediately after, with an
  auto-rollback path) going live"). Building it here, ahead of that design
  work, would risk inventing something Track C then has to rework.

### What a human does when the gate fails

1. Read the `::error::` line(s) in the failed workflow run — they name the
   exact endpoint and last HTTP status/body.
2. If `/health/env` failed: an env var was dropped. Check Coolify's env var
   list for the affected app directly (`GET /applications/{uuid}/envs`) —
   this is also the standing Coolify duplicate-row footgun's usual symptom
   (see `feedback_coolify_env_vars` memory / Track A of this same sprint),
   so audit for duplicate rows, not just missing ones.
3. If `/health/litellm-internal` failed: LiteLLM auth or reachability is
   broken. Check `/health/litellm` (shallow reachability) and `/health/env`
   for `LITELLM_MASTER_KEY`/`LITELLM_URL` presence as a first split — see
   `docs/deploys/2026-07-10-t97-litellm-internal-auth-monitor.md` for the
   FQ-69 diagnosis playbook this endpoint was originally built from.
4. Roll back: re-dispatch the deploy workflow with the previous known-good
   `image_tag` (prod) or push a revert commit (staging, which deploys
   automatically on `src/**` merges).
5. Log the incident in `DECISIONS.md`, even if it self-resolved on retry —
   per `PRODUCTION.md`'s quality bar, every incident gets a note.
6. If root cause isn't clear after the above, escalate per `PRODUCTION.md`'s
   escalation rules (`FOUNDER_QUEUE.md`, required format).

---

## Where the gate runs

- **`main-deploy.yml`** (staging, auto on qualifying `src/**` etc. merges):
  runs right after the existing shallow `/health` poll, before the Inngest
  sync step. A failure here skips the Inngest sync (default GitHub Actions
  behavior for a step with no `if:`) but the SC7 "stop ops-hub-staging"
  step still runs (`if: always()`) — a failed gate does not leave staging
  running in violation of T-98's SC7 default-stopped state.
- **`prod-deploy.yml`** (manual `workflow_dispatch` promotion): same shape,
  after the existing prod `/health` poll, before the prod Inngest sync.
  **This is a prod-affecting change** — flagged explicitly in the PR, needs
  Tech Lead + Security Lead review of that specific diff. It was NOT
  live-verified against an actual prod deploy in this task (that would mean
  promoting an unreviewed change to production, which is out of scope) —
  see `docs/deploys/2026-07-16-t123-deploy-health-gate.md` for exactly what
  WAS verified.
- **`deploy-staging-services.yml`** (manual `workflow_dispatch`, LiteLLM/
  FreeScout infra): the two existing health-check steps now retry-then-fail
  instead of warn-then-succeed.

---

## Explicitly NOT built here (out of scope, named honestly)

- **Coolify duplicate-env-row guard** — the other half of `AUTONOMY.md`'s
  `redeploy-already-authorized` unlock condition. A separate, parallel
  Sprint 22 track. Do not assume this runbook covers it.
- **Wiring the T-98 synthetic-ticket monitor into deploy gating** — Track C,
  a later, separate task. This gate's design (fail loud, clear reason,
  script-based so it's easy to call from another workflow) is meant to make
  that a natural extension, not a rewrite, but T-98's own signal is not
  consulted by this gate.
- **Automatic rollback** — see "Why fail-loud-only" above.
- **Smoke-testing an actual ticket end-to-end** (as opposed to the app's own
  self-reported health) — that is exactly what the T-98 monitor already does
  on its own schedule; duplicating it inside the deploy gate was judged
  unnecessary scope for v1 and is Track C's natural home if ever wanted here.
