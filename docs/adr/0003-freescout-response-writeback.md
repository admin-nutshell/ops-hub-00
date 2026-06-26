# ADR-0003 — FreeScout Response Write-Back Path

- **Status:** Proposed
- **Date:** 2026-06-25
- **Author:** Tech Lead
- **Deciders:** Tech Lead (proposer); Production Manager (env/infra credential); Security Lead (privileged cross-app DB write)
- **Supersedes:** none
- **Related:** ADR-0002 (tool stack), `src/inngest/ticket-respond.ts` (T-23), `src/inngest/freescout-poller.ts` (T-21), `src/inngest/ticket-triage.ts` (T-22), WORK.md (T-23), `DECISIONS.md` (2026-06-23 Supabase-polling pivot)

---

## Context

T-23 (`ticket-respond`) drafts a reply to a triaged ticket via LiteLLM and must deliver that draft back onto the originating FreeScout conversation so a human agent can review and send it. The intake direction (FreeScout → Ops Hub) is already solved by T-21 polling FreeScout's `conversations`/`threads` tables directly over Supabase, because the FreeScout REST API was unavailable (the `Api` module is disabled by default and enabling it needs `docker exec` we cannot script; the paid module is out of scope — see `DECISIONS.md`, 2026-06-23). The **return** direction (Ops Hub → FreeScout) faces the same wall plus a sharper constraint:

- `ops_hub_app` (the only DB role Ops Hub holds at runtime) has **GRANT SELECT only** on FreeScout's `conversations`/`threads` tables (CLAUDE.md). It is read-only there by design and must stay that way — a write grant to `ops_hub_app` on another app's tables widens the blast radius of our app credential.
- There is no FreeScout REST API available.
- We must not silently add credentials or env vars (project rule; CLAUDE.md security non-negotiable #4).

So the decision is narrowly: **how does `ticket-respond` put a note on a FreeScout conversation, given we own the data store but not a write path to it today.**

---

## Decision

**Deliver the draft as an internal FreeScout NOTE, written via a dedicated `freescout_user` connection behind a mockable delivery seam, config-gated on a new credential that is flagged (not added) by this ADR.**

Concretely, as implemented in `src/inngest/ticket-respond.ts`:

1. **Note, not reply.** The draft is posted as a FreeScout *note* (internal, thread `type=3`), never as a customer-sent message. An unreviewed AI draft must never auto-email a customer; a human approves and sends from the FreeScout UI. This is the load-bearing safety decision and is independent of transport.

2. **Separate connection, separate role.** The write uses `getFreeScoutPool()` built from a new `FREESCOUT_DB_URL` (the `freescout_user` credential that already owns `threads`). `ops_hub_app` keeps its read-only posture on FreeScout tables; our reads/updates of the `tickets` table continue through the existing `OPS_HUB_APP_LOGIN_URL` pool. The two databases are the same Supabase instance but two distinct privilege contexts.

3. **Mockable seam.** Delivery is an injected `FreeScoutDelivery` function. The Inngest handler wires in the real `postFreeScoutNote`; unit tests inject a mock. The *tested* surface is draft generation + state machine + tracing — none of it depends on a live FreeScout write.

4. **Config-gated, fail-safe.** With `FREESCOUT_DB_URL` absent (staging today), delivery throws "unavailable" *before* any state change, so the ticket stays `triaged` and is retried — no corruption, no lost work, no half-responded state. State advances to `responded` only after a confirmed note write.

5. **State migration.** `'responded'` was not a valid `tickets.state` value; `supabase/migrations/20260625000000_t23_responded_state.sql` adds it. Without this the live `UPDATE` would throw a check-violation that mocked tests cannot catch.

**This is a Tech-Lead-owned call, not a founder item** — a senior engineer resolves it by reading the repo. The only thing that leaves this ADR is a request to Production Manager to provision a scoped `freescout_user` credential and a Security Lead review of that privileged write. Routed via WORK.md, not FOUNDER_QUEUE.

---

## Options considered

### Option A — Write to FreeScout `threads` as `freescout_user`, behind a gated seam (CHOSEN)
- **Pros:** No new infrastructure or paid module. Uses the same direct-DB approach already ratified for intake (T-21), so the team owns one consistent pattern. The note path is internal-only (safe). Free.
- **Cons:** Couples us to FreeScout's internal Laravel schema. A raw `INSERT` does not run FreeScout's application-layer side effects (conversation counters, last-activity timestamps), so the note's display/metadata must be verified against the live DB before enabling. Requires a new `freescout_user` write credential.
- **Mitigation:** Seam + config gate keep the brittle part isolated, off by default, and swappable. The INSERT column set is marked **unverified against live schema** in code and must be confirmed (and ideally validated against FreeScout's own `Thread` model defaults) before the gate is opened in any environment.

### Option B — Write via `ops_hub_app` with a new write GRANT on FreeScout tables
- **Rejected.** Directly violates the CLAUDE.md read-only constraint on FreeScout tables and widens our app credential's blast radius across app boundaries. The role separation in Option A costs nothing extra and is strictly safer.

### Option C — FreeScout REST API (`POST /conversations/{id}/threads`)
- **Rejected for now, preferred long-term.** This is the clean, app-supported path that triggers FreeScout's own side effects correctly. Blocked by the same wall as intake: the `Api` module is disabled-by-default and the paid module is out of scope (`DECISIONS.md`, 2026-06-23). **Revisit trigger:** if/when the `Api` module is enabled (founder/infra action) or FreeScout is replaced, migrate delivery to the REST API and retire the direct-DB write. The seam makes this a one-function swap.

### Option D — Do not write to FreeScout; surface drafts only in Ops Hub
- **Rejected.** Defeats the purpose — the human agent lives in FreeScout. A draft they cannot see in their tool is not a response. Kept on record as the do-nothing baseline.

---

## Free-tier-first evaluation

Per the standing rule, every option here is $0: Option A/B reuse the existing Supabase Postgres; Option C's blocker is precisely a *paid* module we declined. No option introduces spend. The chosen path adds zero infrastructure — only a scoped DB credential.

---

## Consequences

- **New credential to provision (flagged, not added):** `FREESCOUT_DB_URL` (a `freescout_user` DSN with INSERT on `threads`) and `FREESCOUT_BOT_USER_ID` (the FreeScout staff user the note is attributed to). Owner: Production Manager (Coolify env), with a Security Lead look at the grant scope. Until both are set, `ticket-respond` is registered but dormant — exactly the "ready to wire" state T-23 targets.
- **Pre-enable verification (blocking before the gate opens):** confirm `threads` NOT NULL columns and the `type`/`state`/`status`/`source_*` enum constants against the live FreeScout DB; confirm a raw INSERT renders correctly in the FreeScout UI.
- **At-least-once delivery:** the FreeScout write and the `tickets` UPDATE span two privilege contexts and are not atomic. A crash between them re-drafts and re-posts on retry (a duplicate note). Acceptable for the scaffold; a dedup guard (e.g. skip if a `ticket-respond` note already exists on the conversation) is a documented follow-up.
- **Activation wiring:** `ticket-respond` listens on `ops-hub/ticket.respond`. The dispatch from `triageTicket` is intentionally not added (T-23 must not modify `ticket-triage.ts`; T-22 is blocked on FQ-39). When T-22 validates, add the one-line `step.sendEvent` in `triageTicket`, or a `sweepTriagedTickets` cron mirroring `sweepNewTickets`.

---

## Review

- **Security Lead:** sign-off required on the `freescout_user` write-credential scope (least-privilege: INSERT on `threads` only, no broader FreeScout access) and on the cross-app write posture before the gate is enabled.
- **Production Manager:** owns provisioning `FREESCOUT_DB_URL` + `FREESCOUT_BOT_USER_ID` in Coolify and the pre-enable live-schema verification.
- **Evals Lead:** the draft prompt is a new agent capability — covered by T-25 (`evals/ticket-respond.yaml`); the eval gate governs any prompt change.

---

## Security Lead Review

- **Reviewer:** Security Lead (AppSec)
- **Date:** 2026-06-25
- **Verdict:** **CONDITIONAL SIGN-OFF.** The write-back design is sound and fail-safe. One condition is **blocking before Production Manager provisions the credential**; the rest are **track-before-activation** (before the dispatch is wired and the gate is opened in any live environment). This is an agent-owned security call (Security Lead authority per the decision matrix), **not** a FOUNDER_QUEUE item — nothing is live and nothing is escalated.

### What is fine (and why)

- **NOTE-not-reply is the correct load-bearing control.** Posting `type=3` (internal note) means an unreviewed AI draft is never emailed to a customer. Approved.
- **No SQL injection in the INSERT path.** `postFreeScoutNote` uses a fully parameterized `INSERT` (`$1::bigint`, `$2::bigint`, `$3`). The LiteLLM-drafted `note` is bound as `$3`, never string-concatenated, so it cannot alter SQL structure. `conversationId`/`botUserId` are cast to `bigint`, which additionally rejects non-numeric input. The `escapeXml` step is prompt-delimiter hygiene (LLM defense), not the SQL control — the parameterization is. This is fine.
- **Config-gate is a sound fail-closed default.** With `FREESCOUT_DB_URL` absent, `getFreeScoutPool()` throws **before** any state change; the ticket stays `triaged` and retries. No half-state, no corruption, no secret leaked in the error string. As a *safety* default it is sufficient. Note it is an availability gate, not an authorization boundary — it does not constrain *what* may be written once the credential exists, which is why the least-privilege condition below matters.
- **Non-atomic at-least-once write is acceptable for v1.** The FreeScout `INSERT` and the `tickets` UPDATE span two privilege contexts and are not atomic; a crash between them re-posts a duplicate note on retry. For a dormant, human-reviewed, internal-note scaffold the blast radius is "a human sees two drafts and picks one" — no customer impact, no data corruption (the `triaged` guard keeps the state machine idempotent). Acceptable as-is.
- **Secret hygiene verified.** Scanned the T-23 diff: no DSN/password committed (only `postgresql://mock` in tests). No new dependencies added. Zero secrets in git history holds.

### Condition C1 — BLOCKING before provisioning (least-privilege role, not `freescout_user`)

Question (a) from the review brief. **Do not use the `freescout_user` DSN for `FREESCOUT_DB_URL`.** `freescout_user` is FreeScout's own application login role and the **owner** of every FreeScout table — it can SELECT/INSERT/UPDATE/DELETE/TRUNCATE/DROP across `customers`, `emails`, `users` (bcrypt password hashes), `mailboxes`, `conversations`, `threads`, and FreeScout settings. Handing that DSN to Ops Hub gives our app the widest possible blast radius inside another app's data store, and reuses a credential the live FreeScout app also holds. That is precisely the "widens blast radius across app boundaries" reasoning this ADR used to reject Option B — it applies symmetrically here. The task needs exactly **one** privilege: `INSERT` on `threads`.

**Condition:** provision `FREESCOUT_DB_URL` with a **dedicated least-privilege LOGIN role** (`freescout_writer`) holding `INSERT` on `threads` **only** (plus the sequence grant the serial `id` requires) and nothing else. SQL and the two-context execution procedure are in `docs/engineering/t23-freescout-writeback-runbook.md`. The `GRANT INSERT ON threads` **must** be issued AS `freescout_user` via `docker exec ... artisan tinker` (same owner-grant path as FQ-34 — `postgres`/`service_role` cannot grant on tables it does not own in this Supabase setup); putting it in the SQL Editor reproduces the FQ-34 failure exactly.

This condition gates Production Manager's next step: provision `freescout_writer`, not `freescout_user`.

### Track before ACTIVATION (non-blocking for provisioning)

- **T1 — Stored-XSS / HTML-injection into the FreeScout staff UI.** The LLM-drafted body is written by **raw INSERT**, bypassing FreeScout's application-layer write-time sanitization. If FreeScout renders `threads.body` without output-encoding, ticket content engineered to make the model emit `<script>`/HTML could execute in a support agent's browser when they open the note. `escapeXml` does not cover this (it escapes for prompt delimiters, not HTML rendering). Mitigants already present: internal-note audience, human review before send, and FreeScout's normal HTMLPurifier-on-output. **Action:** during pre-enable verification confirm FreeScout output-sanitizes `thread.body`, or HTML-encode/strip the draft before INSERT. Non-blocking for provisioning; resolve before the gate opens in prod.
- **T2 — Residual the table grant cannot enforce.** `INSERT` on `threads` cannot constrain the row to `type=3`; the "note only / never emailed" guarantee lives entirely in `postFreeScoutNote`'s application code. The reason no customer email fires is that a **raw DB INSERT bypasses FreeScout's mail pipeline** (an app-layer side effect, same reason it skips counters/timestamps). **Action:** the pre-enable live-schema verification the ADR already mandates must explicitly confirm a raw INSERT triggers **no outgoing email**.
- **T3 — Dedup guard for the non-atomic write.** Already a documented ADR follow-up; add the "skip if a `ticket-respond` note already exists on the conversation" guard before the dispatch is wired and the path runs unattended.
- **T4 — Audit trail.** For SOC 2 / PIPEDA readiness, emit an audit-log entry per FreeScout write (conversation id, run/event id, timestamp, attributing bot user). Today only the LangFuse draft trace and `owner_agent='ticket-respond'` on the ticket record the action; the cross-app write itself is not separately logged.

### Sign-off statement

Security Lead **approves the write-back design with conditions**. Provisioning is **unblocked the moment `FREESCOUT_DB_URL` points at a least-privilege `freescout_writer` role (C1)** built per the runbook. T1–T4 must be resolved before the delivery gate is opened in any live environment but do not block provisioning the (still-dormant) credential.
