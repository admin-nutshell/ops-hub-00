# Sprint 2 — Synthetic Incident Drill + Post-Mortem

**Task:** T-26 — M1 criterion #11
**Status:** PENDING EXECUTION — blocked on FQ-41 (GRANT) + PR #175/#176 merge
**Owner:** Production Manager + Tech Lead
**Target date:** July 17, 2026

---

## Pre-flight checklist (verify BEFORE starting the drill)

All items must be green before sending the test email.

| # | Check | How to verify | Status |
|---|---|---|---|
| 1 | PR #175 merged (security refactoring) | `git log --oneline origin/main \| head -3` | ⏳ pending |
| 2 | PR #176 merged + `configure-litellm-openai-only.yml` triggered | `gh run list --workflow=configure-litellm-openai-only.yml` — latest run green | ⏳ pending |
| 3 | FQ-41 resolved: GRANT on conversations/threads | Supabase SQL Editor: `SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'conversations' AND grantee = 'ops_hub_app'` — expect 1 row | ⏳ pending |
| 4 | FreeScout Gmail OAuth connected | FreeScout UI → Mailboxes → ITS Support → Incoming Email → Test Connection: "Connection is successful" | ⏳ pending |
| 5 | T-23 migration applied (`responded` state CHECK) | Supabase SQL Editor: `SELECT unnest(enum_range(NULL::ticket_state))` or check the CHECK constraint on `tickets.state` — must include `'responded'` | ⏳ pending |
| 6 | ops-hub staging healthy | `curl -s https://ops-hub-staging.inatechshell.ca/health` → `{"status":"ok"}` | verify at drill time |
| 7 | Inngest dashboard reachable | `https://app.inngest.com` — ops-hub environment visible | verify at drill time |
| 8 | LangFuse traces reachable | `https://us.cloud.langfuse.com` | verify at drill time |

**Note on items 3+4:** Both require the founder to SSH to the Coolify VPS and run the commands in FQ-41. See FOUNDER_QUEUE.md for the exact commands.

**Note on item 5:** Apply via Supabase SQL Editor (same pattern as T-11 runbook):
```sql
-- Migration: 20260625000000_t23_responded_state.sql
-- Run in Supabase SQL Editor as the postgres role

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_state_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_state_check
  CHECK (state IN ('new', 'triaged', 'responded', 'resolved', 'closed'));
```
*(Verify the exact constraint name and values against the current schema before running.)*

---

## Drill scenario — "Silent Billing Failure"

A synthetic P1 incident: a customer reports that TTS billing stopped working silently — charges are not going through but no error is shown. Chosen because it has clear urgency (revenue impact, critical), a non-trivial category (billing/payments), and requires specific routing (engineering → payments team).

### Step 1 — Send the trigger email

Send from any account to: **support@inatechshell.ca**

```
Subject: TTS billing completely broken — customers can't pay

Body:
Hi,

Our TTS app billing has been silently failing for the past 2 hours.
Customers are attempting to pay but charges are not going through.
No error is shown to the customer — they just get a blank confirmation screen.
We have confirmed this affects all payment methods (credit card, PayPal).
This is a revenue-critical issue. We need this resolved immediately.

Affected: all TTS customers attempting checkout
Started: approximately 2 hours ago
Environment: production
```

### Step 2 — Verify FreeScout received the email (T-10 baseline)

1. Open FreeScout: `https://freescout-staging.inatechshell.ca`
2. Log in as `haytham@inatechshell.ca`
3. Confirm the email appears in the ITS Support inbox
4. Note the conversation ID from the URL (e.g., `/conversation/8`)

**Expected timing:** FreeScout fetches IMAP every ~5 minutes. If the email doesn't appear within 10 minutes, check the FreeScout cron log via `docker exec ... php artisan freescout:fetch-emails` (see FQ-41 Step 3).

### Step 3 — Verify pollFreeScout picked it up (T-21)

1. Open Inngest dashboard: `https://app.inngest.com`
2. Navigate to: Functions → `freescout-poll` → Recent Runs
3. Find the run after the email arrived
4. Confirm: `polled: N, inserted: 1` in the run output
5. Confirm: `ops-hub/ticket.triage` event dispatched with the new ticket ID

**Expected timing:** `pollFreeScout` runs every 60 seconds. Allow up to 2 minutes after FreeScout receives the email.

### Step 4 — Verify ticket-triage classified the ticket (T-22)

1. In Inngest dashboard: Functions → `ticket-triage` → Recent Runs
2. Confirm: run completed with `urgency: "critical"` (or `"high"`) + `category: "billing"` (or similar) + `state: "triaged"`
3. In Supabase SQL Editor, verify the DB state:
```sql
SELECT id, title, urgency, category, routing, state, owner_agent
FROM tickets
WHERE freescout_conversation_id = <conversation_id_from_step_2>::bigint;
```
Expected: `state = 'triaged'`, `urgency IN ('critical','high')`, `owner_agent = 'ticket-triage'`

4. Confirm: `ops-hub/ticket.respond` event dispatched (check Inngest Events tab)

**Expected timing:** `ticket-triage` runs within seconds of receiving the `ticket.triage` event.

### Step 5 — Verify ticket-respond drafted a reply (T-23)

**Note:** T-23 delivery to FreeScout requires `FREESCOUT_DB_URL` + `FREESCOUT_BOT_USER_ID` provisioned. If those are not yet set, `respondOneTicket` will skip at the delivery step — the ticket will stay `triaged` and LangFuse will show a successful draft. This is expected behavior; T-23 is config-gated.

1. In Inngest dashboard: Functions → `ticket-respond` → Recent Runs
2. Confirm: run completed (not errored)
3. Check LangFuse: `https://us.cloud.langfuse.com` → Traces → filter by `ticket-respond`
4. Verify: a `draft-response` generation was recorded with a non-empty draft output
5. If FREESCOUT_DB_URL is provisioned: check FreeScout conversation for an internal NOTE from the bot user
6. In Supabase:
```sql
SELECT state, owner_agent FROM tickets
WHERE freescout_conversation_id = <conversation_id>::bigint;
```
Expected (if delivery live): `state = 'responded'`, `owner_agent = 'ticket-respond'`
Expected (if delivery dormant): `state = 'triaged'` (acceptable for M1 criterion #11 — pipeline up to respond step is demonstrated)

**Expected timing:** `ticket-respond` runs within seconds of receiving the `ticket.respond` event.

---

## Pass/fail criteria for M1 criterion #11

M1 criterion #11 requires: "First synthetic incident drill + post-mortem authored."

The drill PASSES M1 if the following are confirmed:

| Criterion | Evidence |
|---|---|
| Email received by FreeScout | Ticket visible in FreeScout inbox |
| Ticket created in Supabase with `state = 'new'` | SQL query in Step 4 |
| Ticket triage ran and classified correctly | Inngest run output + DB `state = 'triaged'` |
| LLM classification is plausible (urgency critical or high, category billing or payments) | Inngest run output |
| `ticket-respond` function ran without error | Inngest run output |
| LangFuse draft recorded | LangFuse trace in `ticket-respond` |
| Post-mortem below is completed | This document |

**Acceptable gap:** FreeScout NOTE delivery (requires FREESCOUT_DB_URL) is explicitly deferred — the M1 criterion does not require the full respond path to be live, only that the AI pipeline runs. The NOTE delivery path has unit tests and is config-gated per ADR-0003.

---

## Post-mortem (to be filled in after drill execution)

**Date:** ___________
**Duration:** ___________
**Participants:** Production Manager, Tech Lead

### Timeline

| Time (UTC) | Event |
|---|---|
| | Test email sent to support@inatechshell.ca |
| | Email appeared in FreeScout inbox |
| | `pollFreeScout` created ticket in Supabase |
| | `ticket-triage` completed; ticket state → `triaged` |
| | `ticket-respond` ran; LangFuse trace confirmed |
| | Drill complete |

### Observed classification

| Field | Expected | Actual |
|---|---|---|
| urgency | `critical` or `high` | |
| category | `billing` or `payments` | |
| routing | `engineering` or `payments` | |
| reasoning | Mentions revenue/billing | |

### Issues encountered

*(any failures, retries, unexpected states)*

### Action items

| Item | Owner | Due |
|---|---|---|
| | | |

### M1 criterion #11

- [ ] Drill executed end-to-end
- [ ] Post-mortem fields completed
- [ ] No unresolved P0 action items
- [ ] **M1 #11 ✅ COMPLETE**

---

*Written by Tech Lead (2026-06-26). Ready to execute once FQ-41 GRANT is re-issued and PRs #175/#176 are merged.*
