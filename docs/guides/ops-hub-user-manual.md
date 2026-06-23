# Ops Hub Staging — Founder's User Manual

> **Who this is for:** Haytham (founder). This guide covers everything you need to use, test, and monitor the Ops Hub staging environment.
> **Current state:** Sprint 1 complete (20/20 tasks). Staging is live and fully instrumented. Sprint 2 goal: flow your first real ticket end-to-end.

---

## Table of Contents

1. [Overview — What Is the Ops Hub?](#1-overview)
2. [How to Open a Ticket](#2-how-to-open-a-ticket)
3. [How to Use FreeScout](#3-how-to-use-freescout)
4. [Sprint 2 End-to-End Test Guide](#4-sprint-2-end-to-end-test-guide)
5. [Monitoring Dashboards](#5-monitoring-dashboards)
6. [Emergency Procedures](#6-emergency-procedures)
7. [Quick Reference](#7-quick-reference)

---

## 1. Overview

### What the Ops Hub does

The Ops Hub is an AI-powered operations platform. When a client sends a support email, the system:

1. **Receives** the email in FreeScout (your helpdesk)
2. **Routes** it to the right AI agent (triage, research, draft response)
3. **Delivers** a resolution — or escalates to you if human judgment is needed
4. **Tracks** every ticket, cost, and metric automatically

You do not manually handle tickets day-to-day. You review escalations, monitor dashboards, and make strategic decisions.

### The agent team

Eleven AI agents run the build. You interact with them through `FOUNDER_QUEUE.md` — the only file you need to read regularly.

| Agent | What they do |
|---|---|
| **PM** | Sprint planning, task tracking, coordinates everything |
| **Tech Lead** | Architecture decisions, code design |
| **Production Manager** | Deploys, Coolify, infrastructure |
| **QA Manager** | Testing, bug verification |
| **Security Lead** | OWASP audits, secrets hygiene, compliance |
| **Evals Lead** | AI quality gates — nothing ships without eval pass |
| **Knowledge Lead** | Documentation, runbooks, KB articles |
| **Data Engineer** | Metrics, dashboards, cost tracking |
| **Solutions Architect** | Client onboarding, integrations |
| **Frontend Engineer** | Ticket portal UI, ops dashboard |
| **CodeRabbit** | Automated PR code review (GitHub app) |

### Your role

You own **business and UX decisions** only. Technical decisions are agent-owned. When an agent needs you, they post to `FOUNDER_QUEUE.md`. Check it once or twice a day.

---

## 2. How to Open a Ticket

### Staging: email method (primary)

Send an email to the FreeScout inbox. The system picks it up automatically.

1. Open your email client
2. Send to the configured FreeScout mailbox address (check FreeScout Settings > Mailboxes for the exact address)
3. Subject = your issue title; body = description
4. FreeScout creates a ticket within minutes

### Direct via FreeScout UI

1. Go to your FreeScout URL (see [Quick Reference](#7-quick-reference))
2. Log in with your admin credentials
3. Click **New Conversation** (top right)
4. Fill in: mailbox, subject, customer email, message body
5. Click **Create**

### What happens next

| Step | Who handles it | Time |
|---|---|---|
| Ticket received in FreeScout | Automatic | Instant |
| AI triage and categorization | AI agents | < 2 min |
| Draft response generated | AI agents | < 5 min |
| Resolution sent or escalation raised | AI agents / you | Depends on complexity |

> **Sprint 2 note:** The full AI triage pipeline is the Sprint 2 deliverable. In staging today, tickets arrive and are stored — the automated AI response flow is being wired up.

---

## 3. How to Use FreeScout

### Accessing FreeScout

FreeScout is your helpdesk. It runs on Coolify staging.

- **URL:** Find it in Coolify dashboard under `ops-hub-staging` project (the FreeScout app URL)
- **Login:** Admin credentials you set during provisioning
- **What you see:** All incoming tickets, conversations, and statuses

### Key screens

**Inbox view**
- Shows all open tickets
- Green = resolved, Yellow = pending, Red = overdue (SLA breach)
- Click any ticket to open the conversation thread

**Conversation view**
- Full email thread with the client
- AI-drafted responses appear as internal notes before sending
- You can edit or approve before sending (this will be configurable)
- Add notes visible only to agents, not the client

**Reports**
- Ticket volume, resolution times, and agent performance
- Available under Reports menu (left sidebar)

### Ticket statuses

| Status | Meaning |
|---|---|
| Open | Waiting for action |
| Pending | Waiting for client reply |
| Active | Being worked on |
| Resolved | Done — closed |
| Spam | Filtered out automatically |

### Managing mailboxes

Settings > Mailboxes shows your configured email inboxes. Each mailbox maps to a project (e.g., one for TTS, one for each future client).

> **To add a new client mailbox:** go to Settings > Mailboxes > Add Mailbox. This is a founder action — no agent needs to be involved for basic mailbox setup.

---

## 4. Sprint 2 End-to-End Test Guide

This is your acceptance test for Sprint 2. When you can walk through these steps successfully, Sprint 2 is complete and M1 criteria #10–#12 are met.

### Prerequisites

- [ ] You're logged into FreeScout at the staging URL
- [ ] You can reach `https://ops-hub-staging.inatechshell.ca/health` (returns `{"status":"ok"}`)
- [ ] You're logged into LangFuse at `https://us.cloud.langfuse.com`
- [ ] You're logged into Sentry at `https://sentry.io`

### Step 1 — Send a test ticket

Send an email to your FreeScout staging mailbox:

```
Subject: Test ticket — Sprint 2 E2E
Body: This is a test ticket to verify the end-to-end flow.
Please provide a summary of the Ops Hub staging environment.
```

### Step 2 — Verify ticket appears in FreeScout

1. Open FreeScout
2. Check the inbox — your ticket should appear within 1–2 minutes
3. Click to open it and confirm the subject and body are correct

**Expected:** Ticket visible in FreeScout inbox. Status: Open.

### Step 3 — Verify AI processing in LangFuse

1. Open LangFuse → `https://us.cloud.langfuse.com`
2. Select the ops-hub project
3. Go to Traces
4. Look for a trace named `ticket-triage` or similar with a timestamp matching your email send time

**Expected:** A trace showing the ticket was received, processed through the AI pipeline, and a response was drafted.

### Step 4 — Verify response drafted or sent

Back in FreeScout:
1. Open your test ticket
2. Look for an internal note or draft response from the AI
3. The response should be relevant to your test message

**Expected:** AI-drafted response visible as a note or sent reply.

### Step 5 — Verify no errors in Sentry

1. Open Sentry → your ops-hub project
2. Check Issues for any new errors in the last 5 minutes
3. There should be no new unhandled errors

**Expected:** Zero new errors from processing your test ticket.

### Step 6 — Mark complete

If all 5 steps pass:
- Sprint 2 milestone achieved
- M1 criteria #10 (ticket received and processed), #11 (AI response generated), #12 (end-to-end verified) are all green
- Report to agents in your next message: "Sprint 2 E2E test passed."

---

## 5. Monitoring Dashboards

### UptimeRobot — Uptime monitoring

**Purpose:** Alerts you if any staging service goes down.

**Your 3 monitors:**

| Monitor | URL being checked | What it means if down |
|---|---|---|
| ops-hub-staging health | `https://ops-hub-staging.inatechshell.ca/health` | Main app is down |
| litellm-staging health | `https://litellm-staging.inatechshell.ca/health` | AI model router is down |
| TTS app health | TTS app URL | TTS staging is down |

**How to check:**
1. Log into UptimeRobot at `https://uptimerobot.com`
2. Dashboard shows green (up) or red (down) for each monitor
3. Click a monitor to see response time history and downtime incidents

**Alert setup:** Go to My Settings > Alert Contacts to add your email (`haythamismail@gmail.com`) so you get notified immediately when something goes down.

### Sentry — Error monitoring

**Purpose:** Catches runtime errors in the app and notifies you.

**How to check:**
1. Log into Sentry at `https://sentry.io`
2. Select the ops-hub project
3. Issues tab shows all current errors grouped by type
4. Click any issue to see the full stack trace and when it started

**Key things to look for:**
- New issues appearing after a deploy (means the deploy broke something)
- `fatal` or `error` level issues (not `warning` or `info`)
- Errors repeating frequently (a loop or unhandled failure)

**Testing Sentry works:** Hit `https://ops-hub-staging.inatechshell.ca/debug-sentry` in your browser. This deliberately triggers a test error that should appear in Sentry within 30 seconds.

### LangFuse — AI trace monitoring

**Purpose:** Shows you every AI call the system makes — what was sent, what came back, how long it took, and what it cost.

**How to check:**
1. Log into LangFuse at `https://us.cloud.langfuse.com`
2. Select the ops-hub project
3. Traces tab shows all recent AI operations
4. Click any trace to see the full input/output and model used

**What's traced today:**
- Every call to `/health` emits a `health-check` trace (confirms the pipeline is connected)
- Sprint 2 will add ticket-processing traces

**Useful for:**
- Diagnosing why the AI gave a bad response (see the exact prompt)
- Checking latency spikes
- Reviewing cost per operation

### GitHub Actions — CI/CD pipeline

**Purpose:** Every code change runs automated checks before it can merge.

**How to check:**
1. Go to `https://github.com/admin-nutshell/ops-hub-00/actions`
2. Latest runs should show green checkmarks
3. A red X means a check failed and a merge was blocked

**The 4 required checks:**

| Check | What it verifies |
|---|---|
| Lint & Type Check | Code style and TypeScript types are clean |
| Unit Tests | Core logic passes automated tests |
| Security Scan | No secrets leaked, no known vulnerabilities |
| Eval Gate | AI agent behavior hasn't regressed |

### Coolify — Deployment platform

**Purpose:** Manages all running services on the VPS.

**How to check:**
1. Log into Coolify at `https://coolify.inatechshell.ca`
2. Navigate to the `ops-hub-staging` project
3. Each service shows Running (green) or Stopped/Error (red)
4. Click any service to see logs and restart if needed

---

## 6. Emergency Procedures

### Service is down (UptimeRobot alert)

1. Check UptimeRobot to confirm which service is down
2. Log into Coolify → navigate to the affected service → check its logs
3. If the service shows as stopped: click **Restart** in Coolify
4. Wait 60 seconds, then check UptimeRobot again
5. If it's still down after restart: post to `FOUNDER_QUEUE.md` with tag `URGENT:` and describe what you saw

### App is behaving unexpectedly

1. Check Sentry for new errors (Issues tab)
2. Check LangFuse for any unusual traces
3. If you see a clear error: post to `FOUNDER_QUEUE.md` with the Sentry issue URL
4. Agents will triage and fix

### Suspected security issue (credential leak, unauthorized access)

1. **Immediately** set `EMERGENCY_STOP: true` at the top of `FOUNDER_QUEUE.md`
2. This halts all agent activity
3. Post `URGENT: [Security Lead] Suspected security incident — [describe what you saw]` in `FOUNDER_QUEUE.md`
4. Do NOT change any passwords or rotate keys until the Security Lead has assessed — premature rotation can destroy the audit trail
5. Wait for Security Lead assessment before taking further action

### CI pipeline stuck / all PRs blocked

1. Go to GitHub Actions (`https://github.com/admin-nutshell/ops-hub-00/actions`)
2. Look for a run that's been running > 15 minutes — it may be hung
3. Click the run → Cancel workflow
4. Re-trigger by merging a trivial commit or re-running the failed job
5. If it keeps failing: post to `FOUNDER_QUEUE.md` — Tech Lead will diagnose

### How to use the emergency stop

```
# In FOUNDER_QUEUE.md, change this:
EMERGENCY_STOP: false

# To this:
EMERGENCY_STOP: true
```

All agents check this flag before acting. Setting it to `true` stops everything immediately. Only use it for genuine emergencies.

---

## 7. Quick Reference

### URLs

| Service | URL | Purpose |
|---|---|---|
| ops-hub app (staging) | `https://ops-hub-staging.inatechshell.ca` | Main app |
| ops-hub health check | `https://ops-hub-staging.inatechshell.ca/health` | App health |
| LiteLLM (staging) | `https://litellm-staging.inatechshell.ca` | AI model router |
| Coolify | `https://coolify.inatechshell.ca` | Deploy dashboard |
| GitHub repo | `https://github.com/admin-nutshell/ops-hub-00` | Code + CI |
| Sentry | `https://sentry.io` | Error monitoring |
| LangFuse | `https://us.cloud.langfuse.com` | AI traces |
| UptimeRobot | `https://uptimerobot.com` | Uptime monitoring |
| Inngest | `https://app.inngest.com` | Background job dashboard |

### Key files in the repo

| File | What it is | How often to read |
|---|---|---|
| `FOUNDER_QUEUE.md` | Escalations needing your input | Daily |
| `WORK.md` | Live task board — all sprint status | When you want a full picture |
| `DECISIONS.md` | Log of every agent decision and why | Reference only |

### FOUNDER_QUEUE.md response format

When agents post an item for you, respond directly in the file:

```
APPROVED: [your decision]
— or —
REJECTED: [reason]
— or —
MORE INFO: [specific business question]
```

Agents poll this file and act on your response. You don't need to message agents separately.

### Severity tags in FOUNDER_QUEUE.md

| Tag | Meaning | Respond within |
|---|---|---|
| `URGENT:` | P1 incident or financial decision | < 1 hour |
| `BLOCKING:` | Agents cannot proceed | < 4 hours |
| *(none)* | Standard ask | < 24 hours |

### What agents decide vs. what you decide

**Agents decide (no input needed):**
- All code, architecture, security, and infrastructure choices
- Sprint task sequencing
- Tool and library selection
- Test and eval design

**You decide:**
- Business logic ("what counts as a resolution?")
- UX and copy tone
- Cost decisions > $20/mo
- New project or tenant onboarding
- Compliance carve-outs or regulatory decisions

### Monthly calendar

| When | What |
|---|---|
| Monthly (July 31 first) | Monthly briefing from PM — Sprint review + M2 planning |
| Quarterly | PIPEDA compliance self-check (Security Lead produces report) |
| Monthly | KB review — Knowledge Lead flags stale articles |
| Monthly | Cost reconciliation — Data Engineer publishes COGS report |

---

*Last updated: 2026-06-22. Maintained by Knowledge Lead agent. For questions or corrections, post to `FOUNDER_QUEUE.md`.*
