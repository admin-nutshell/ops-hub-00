# FOUNDER_QUEUE.md — Escalations to Founder

> Items needing founder input. Polled by founder 1–2x per day. All other decisions are agent-owned per RACI in `05_people_and_process.md`.

---

## Emergency stop

```
EMERGENCY_STOP: false
```

Setting `EMERGENCY_STOP: true` halts all agent activity immediately. Used only in genuine emergencies (security incident, runaway cost, suspected compromise). Restore to `false` after the situation is contained.

---

## Format

```
[Severity tag] [Agent name] Ask summary
        Context: <1–3 lines>
        Impact if delayed: <what happens if founder doesn't respond>
        Linked: <ticket / ADR / file references>
```

Severity tags:

| Tag | When to use | Founder response time |
|---|---|---|
| `URGENT:` | P1 incident, security signal, financial decision | < 1 hour |
| `BLOCKING:` | Agent cannot continue without answer | < 4 hours |
| *(none)* | Standard ask | < 24 hours |

Founder responds ONLY to business logic and UI/UX decisions.
All technical decisions (security, architecture, tooling, configuration) are made by the
relevant agent and presented as recommendations — not questions. Agents must bring a
recommendation WITH rationale, not a choice between options.

Founder response types:
- `APPROVED:` — business/UX decision accepted
- `REJECTED:` [reason] — business/UX decision declined
- `MORE INFO:` [specific business question] — only when business context is genuinely missing

After founder responds, the originating agent removes the item from this queue and proceeds. Resolved items archive to `docs/founder-queue-archive/YYYY-MM.md` weekly.

---

## Open queue

---

### FQ-07 — COOLIFY_API_TOKEN returns 403 on `/api/v1/servers`

```
BLOCKING: [Production Manager] COOLIFY_API_TOKEN GitHub secret is set but the token is rejected
  with HTTP 403 when the deploy workflow calls GET /api/v1/servers.
  Context (2026-06-20):
    - GitHub Actions secret COOLIFY_API_TOKEN confirmed set (founder reply: FQ-07 resolved).
    - Deploy workflow (deploy-staging-services.yml) triggered on run #27886275175.
    - First API call: GET https://coolify.inatechshell.ca/api/v1/servers
      Response: HTTP 403 (curl exit code 22 = server rejected the request).
    - 403 ≠ 401. The token IS being sent (Authorization: Bearer ***). The server recognises
      the request format but denies access — this means the token has insufficient scope or is
      a wrong token type (e.g. project-scoped instead of account-level, or OAuth vs API key).
  Action needed: In Coolify dashboard → Profile (top-right) → API Tokens → copy the token and
    verify it is an account-level (root) token, not project-scoped. If unsure, delete the
    existing token, create a new one under Profile → API Tokens → New Token (no scope restriction),
    copy the new value, and update the GitHub Actions secret COOLIFY_API_TOKEN at:
    https://github.com/admin-nutshell/ops-hub-00/settings/secrets/actions
    Re-run the workflow after updating: Actions → Deploy Staging Services → Run workflow.
  Impact if delayed: T-08 (LiteLLM) + T-10 (FreeScout) remain undeployed; M1 checklist items #4
    and #6 stay blocked; T-09 (LangFuse trace test) and T-19 (integration test) blocked downstream.
  Linked: github.com/admin-nutshell/ops-hub-00/actions/runs/27886275175 (failed run logs),
    .github/workflows/deploy-staging-services.yml (the workflow), WORK.md Production Manager section
```

---

### ~~FQ-06 — Approve merge of PR #1: CI pipeline skeleton~~ — RESOLVED

```
APPROVED: [Founder] — Merge PR #1. Agents handle all technical configuration
  including branch protection settings. Tech Lead owns branch protection setup —
  find a way to execute without repo admin or escalate to a solution.
```

---

### ~~FQ-01 — Coolify provisioning~~ — RESOLVED

```
APPROVED: [Founder] — Coolify projects ops-hub-staging and ops-hub-prod provisioned
  at https://coolify.inatechshell.ca. Production Manager has full admin access via
  the existing Coolify instance. Proceed with T-07 through T-15.
```

---

### ~~FQ-02 — Supabase project for Ops Hub~~ — RESOLVED

```
APPROVED: [Founder] — Supabase project for Ops Hub created (2026-06-18).
  Dedicated project (separate from TTS). pgvector enabled. Region: Canada Central
  (PIPEDA compliant). Connection details in docs/infrastructure/supabase-ops-hub.md
  (placeholder values — real values stored in Coolify env vars, never committed).
  T-11 (migrations) and T-12 (Vault setup) are now unblocked.
```

---

### ~~FQ-03 — Repo naming vs. charter~~ — RESOLVED

```
APPROVED: [Founder] — Update docs to reflect actual repo name (admin-nutshell/ops-hub-00).
  Do not rename the repo. 09_delivery.md updated; DECISIONS.md logged.
```

---

### ~~FQ-05 — LangFuse Cloud data residency (PIPEDA awareness)~~ — RESOLVED

```
APPROVED: [Founder] — LangFuse US region approved for Sprint 1 and Sprint 2.
  Revisit before M3 when real tenant tickets start flowing.
```

---

### ~~FQ-04 — DNC go-live target date~~ — WITHDRAWN

```
WITHDRAWN: [Founder] — DNC is parked. Focus is building the Ops Hub system.
  M3 timeline is deferred until further notice. Solutions Architect proceeds
  with generic onboarding checklist only (no DNC-specific timeline).
```

---

## Recently resolved (this week)

- **FQ-01** (2026-06-18) — Coolify provisioned (`ops-hub-staging` + `ops-hub-prod` at `coolify.inatechshell.ca`). APPROVED by Founder. Unblocks T-07–T-15.
- **FQ-02** (2026-06-18) — Supabase project provisioned. APPROVED by Founder. Unblocks T-11, T-12, T-18, T-20.
- **FQ-05** (2026-06-20) — LangFuse Cloud US region approved for Sprint 1 + Sprint 2. Revisit before M3 (real tenant data).

---

*Founder: this is the only file you're required to read regularly. Everything else updates around you.*
