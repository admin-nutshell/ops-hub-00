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

### FQ-07 — Coolify API access feature gate is disabled

```
BLOCKING: [Production Manager] Root cause confirmed via run #27887003804 (2026-06-20).
  The COOLIFY_API_TOKEN is valid — Coolify recognises the token and applies rate limiting.
  But Coolify returns HTTP 403 with this exact JSON body:
    {"success":true,"message":"You are not allowed to access the API."}
  Rate-limit headers confirm the request reaches Coolify (x-ratelimit-remaining: 199).
  This is NOT a token problem. It is Coolify's API access feature gate being disabled.

  Evidence summary:
    - Unauthenticated probe → HTTP 401 {"message":"Unauthenticated."} ✓ (expected)
    - Authenticated probe   → HTTP 403 {"success":true,"message":"You are not allowed to access the API."}
    - Server: nginx (reverse proxy for Coolify — the 403 is from Coolify, not a firewall)
    - x-ratelimit headers present → Coolify processed the request before rejecting it

  Action needed (one-time, ~1 minute in Coolify dashboard):
    1. Log into Coolify at https://coolify.inatechshell.ca
    2. Go to Settings (gear icon, top-left or side nav)
    3. Find the "API" section — there is an "Enable API" or "API Access" toggle
    4. Enable it and Save
    (Alternative path if not in Settings: Profile → Teams → select your team → API → enable)
    5. No need to regenerate the token. The existing COOLIFY_API_TOKEN is valid.
    6. Re-run the workflow: GitHub Actions → Deploy Staging Services → Run workflow (target=all)

  Impact if delayed: T-08 + T-10 undeployed; M1 #4 + #6 blocked; T-09, T-19 blocked downstream.
  Linked: run #27887003804 (full diagnostic logs with headers + body),
    .github/workflows/deploy-staging-services.yml (deploy workflow — no changes needed)
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
