# 08 — Communications

> How we talk to tenants, ourselves, and investors. Templates, cadence, and tone — designed so the founder writes only material communications and the agents handle the routine flow.

---

## Section 1 — Tenant communications

### Communication channels

| Channel | Purpose | Who writes |
|---|---|---|
| **Email (per-tenant)** | Routine: acknowledgments, resolutions, scheduled maintenance | Production Manager (auto) |
| **In-app banner / notification** | High-visibility: active incident, planned maintenance window | Production Manager (auto) |
| **Status page** (public) | Real-time platform health, incident timeline | Auto-driven by monitoring |
| **Founder direct email** | High-touch: account issues, material incidents, retention plays | Founder |
| **Solutions Architect direct outreach** | Onboarding, quarterly business review, expansion conversations | Solutions Architect |

### SLA-aligned response timing

| Severity | First acknowledgment | Milestone update cadence | Resolution comms |
|---|---|---|---|
| P1 | ≤ 5 minutes (auto) | Hourly until resolved | Within 30 min of resolution |
| P2 | ≤ 15 minutes (auto) | Every 4 hours | Within 2 hours of resolution |
| P3 | ≤ 1 hour (auto) | Daily | Within 1 business day of resolution |

Acknowledgment is **automatic** — Production Manager agent fires it on ticket triage. Milestone and resolution comms are agent-drafted, founder-reviewed for P1 and tenant-facing P2.

---

### Template — Auto-acknowledgment (P1)

```
Subject: [URGENT] We're on it — Ticket #<ID>

Hi <Tenant contact>,

We've received your report and our team is investigating now. Here's what's happening:

• Ticket: #<ID>
• Severity: P1 (Critical)
• Assigned to: <Production Manager> + <Tech Lead>
• You'll hear from us within the next hour with a status update.

If you need to add information, reply to this email or update the ticket directly: <link>.

— In a Tech-Shell Ops
```

### Template — Auto-acknowledgment (P2)

```
Subject: We've received your ticket — #<ID>

Hi <Tenant contact>,

Thanks for the report. Here's where things stand:

• Ticket: #<ID>
• Severity: P2 (High)
• Assigned to: <Production Manager>
• Expected next update: within 4 hours

You can track status here: <link>.

— In a Tech-Shell Ops
```

### Template — Auto-acknowledgment (P3)

```
Subject: Ticket #<ID> received

Hi <Tenant contact>,

We've logged your request and will look into it within the next business day. We'll let you know when there's news.

Track status: <link>.

— In a Tech-Shell Ops
```

---

### Template — Investigation milestone update

```
Subject: Ticket #<ID> — Update at <timestamp>

Hi <Tenant contact>,

Here's where we are:

• Status: Investigating (<X> hours in)
• What we've confirmed: <plain-English summary>
• What we're checking next: <next step>
• Estimated next update: <time>

If anything is blocking you in the meantime, please reply.

— <Agent or Founder name>
```

### Template — Fix-in-progress update

```
Subject: Ticket #<ID> — Root cause found

Hi <Tenant contact>,

Quick update:

• Root cause: <plain-English explanation>
• Fix status: Code change in review (<link to PR or status>)
• Expected deployment: <window>
• Workaround (if any): <plain instructions>

We'll confirm when the fix is live.

— <Agent or Founder name>
```

### Template — Resolution

```
Subject: Ticket #<ID> — Resolved

Hi <Tenant contact>,

The issue is resolved as of <timestamp>.

• What happened: <one or two plain-English sentences>
• What we did: <one or two plain-English sentences>
• Action needed from you: <none, or specific steps>

If you see anything related to this, please reply and we'll reopen.

— <Agent or Founder name>
```

---

### Incident communication protocol (P1 / P2 only)

In addition to the per-tenant ticket flow above, **incidents affecting multiple tenants** trigger broader communication.

#### Initial incident notice (sent within 15 min of confirmation)

```
Subject: [Incident] <Short description> — Investigating

Hi <Tenant contact>,

We're investigating an issue that may be affecting your <module / workflow>:

• What we're seeing: <symptom in plain English>
• What's affected: <scope — module, tenants, features>
• What we're doing: <action being taken>
• Status updates: <link to status page>

You don't need to do anything right now. We'll update you as we know more.

— In a Tech-Shell Ops
```

#### Incident ongoing update (per severity cadence)

Same template, with current state of investigation.

#### Incident resolution + summary

```
Subject: [Resolved] <Short description>

Hi <Tenant contact>,

The incident is fully resolved. Quick summary:

• Time affected: <start> to <end> (<duration>)
• What happened: <plain-English explanation>
• What we did: <plain-English explanation>
• What we're doing to prevent recurrence: <one or two concrete commitments>

If you experienced any data loss or workflow disruption, please reply and we'll work through it with you.

A more detailed post-mortem will be available <by date> at <link>.

— <Founder name>
```

For P1 incidents, the resolution email is **founder-signed**. P2 incidents can be Production Manager- or Solutions Architect-signed.

---

### Maintenance window protocol

Scheduled maintenance (rare, mostly avoidable with our infra):

| Notice timing | Channel |
|---|---|
| 7 days advance | Email + in-app banner |
| 24 hours advance | Email reminder + in-app banner |
| 1 hour advance | In-app banner only |
| Maintenance start | Status page updated |
| Maintenance end | Status page + post-maintenance email if window slipped |

Template:

```
Subject: Scheduled maintenance — <date>, <time window>

Hi <Tenant contact>,

We have planned maintenance scheduled:

• When: <date>, <time window> (<your local timezone>)
• Expected impact: <none / brief downtime / limited functionality>
• Why: <plain-English reason>
• If you need to avoid the window: <workaround or alternative time>

We don't expect issues. Status page will be live throughout: <link>.

— In a Tech-Shell Ops
```

---

### Tone guidelines

Every tenant-facing communication follows these rules:

| Do | Don't |
|---|---|
| Use plain English; translate jargon | Use unexplained acronyms or internal codenames |
| Give specific times and concrete actions | Say "shortly" or "we're looking into it" without detail |
| Take responsibility cleanly | Blame third parties or vendors |
| Apologize once if warranted, then focus forward | Repeat apologies; over-explain |
| Be brief; respect their time | Add boilerplate or marketing language |
| Sign with a name (real for founder, role for agent) | Use anonymous "the team" |

**The blameless rule:** we never blame a tenant, a vendor, or a person on our team in tenant comms. We describe what happened and what we did. Internal post-mortems are where blame analysis (if any) lives.

---

## Section 2 — Public status page

### Tool: Cstate (free, open source, self-host on Coolify)

Cstate is a static-site status page generator. It runs as a tiny container on the existing VPS, costs $0/mo, and is updated automatically by the Production Manager agent based on monitoring signals.

Status page URL (target): `status.inatechshell.ca`

### What appears on the status page

| Component | Live status | Recent incidents |
|---|---|---|
| TTS — Web app | ✅/⚠️/❌ | Last 90 days |
| TTS — API | ✅/⚠️/❌ | Last 90 days |
| TTS — Background workflows | ✅/⚠️/❌ | Last 90 days |
| Ops Hub — Agent system | ✅/⚠️/❌ (internal only) | Last 90 days |
| Authentication | ✅/⚠️/❌ | Last 90 days |
| Database | ✅/⚠️/❌ | Last 90 days |

### Automatic incident posting

When a P1 or P2 incident is confirmed:

1. Production Manager updates status page within 5 minutes
2. Initial post: "Investigating — <component> — <symptom>"
3. Updates posted as state advances (Identified → Monitoring → Resolved)
4. Resolved entry stays on the page for 90 days

---

## Section 3 — Internal status reporting

### Continuous — `WORK.md`

Live status board. All agents read and write. Founder skims occasionally.

(See `05_people_and_process.md` for full WORK.md protocol.)

### Daily — agent session start / end

Each agent posts to WORK.md at the start and end of each working session. Nothing is "in someone's head" — it's all in the file.

### Weekly — Friday retro

PM authors a retro to `docs/retros/YYYY-WW.md` covering:

- **What we shipped this week** (PRs merged, tickets closed, deploys completed)
- **What slipped** (anything that should have shipped but didn't, with reason)
- **What we learned** (post-mortem takeaways, eval insights, tenant feedback)
- **What changes next week** (process tweaks, priority shifts)

Founder reads this in < 5 minutes Saturday or Monday morning.

### Monthly — founder briefing

First Monday of the month, PM authors a one-page briefing to `docs/briefings/YYYY-MM.md`.

#### Founder briefing template

```markdown
# Founder Briefing — <Month YYYY>

## Headline
<One sentence: the most important thing the founder needs to know>

## Metrics
| Metric | This month | Prior month | Trend |
|---|---|---|---|
| Tickets opened | | | |
| Tickets resolved | | | |
| Avg resolution time (by severity) | | | |
| SLA adherence | | | |
| Per-project LLM spend | | | |
| Tenant count | | | |
| New tenants this month | | | |
| Tenant churn | | | |

## Wins
- <2–4 bullets>

## Concerns
- <Real concerns with proposed action, not generic worry>

## Decisions needed from founder
- <Anything posted to FOUNDER_QUEUE.md this month that's still open>

## Looking ahead
- <Next month's planned priorities>
```

### Quarterly — board-quality update (used internally + adapted for investors)

Same structure as monthly, expanded with:

- Eval trend (regression rate over the quarter)
- DR drill or backup verification results
- Risk register review summary
- Tool stack health (free-tier headroom, paid-tier decision points)
- Per-project P&L if multiple projects active

---

## Section 4 — Investor communications

Founder is targeting Pre-Seed of $150K–$300K CAD. Investors expect concise, regular, signal-rich updates.

### Monthly investor email (founder-authored)

Sent first week of each month to: investor list, advisors, candidate investors.

#### Template

```markdown
Subject: In a Tech-Shell — <Month YYYY> Update

Hi all,

**Headline:** <One sentence on the most important thing>

**Key numbers:**
- Tenants on TTS: <count> (<delta> vs last month)
- MRR: <CAD amount> (<delta>)
- Burn: <CAD amount>
- Runway: <months>

**Wins:**
- <2–4 specific, verifiable wins>

**Lowlights:**
- <1–3 things that didn't go well; what we learned>

**Asks:**
- <Specific asks: introductions, advice, customer leads, etc.>

**What's next:**
- <Top 2–3 priorities for next month>

Reply to anything you want to dig into.

— Haytham
```

Investors love the **"Asks"** section. Always have at least one specific ask.

### Quarterly deep update (founder-authored)

Same monthly structure plus:

- Updated capitalization table summary
- Technical milestones (TTS module shipped, Ops Hub phase complete)
- Customer references (with permission)
- Updated 12-month plan and budget
- Any pivot or strategy shift

### Material event notifications (founder-authored, ad hoc)

Triggered by:

| Event | Notify within |
|---|---|
| New tenant signed (material deal size) | 1 week |
| Tenant lost (material) | 1 week with explanation |
| Security incident (notifiable) | Per breach notification protocol |
| Key hire | 1 week |
| Strategic partnership signed | 1 week |
| Material press / coverage | 1 week |
| Fundraise milestone (term sheet, close) | Per legal counsel |

Short, factual, no spin. Investors don't reward hype; they reward signal.

### Investor list management

A simple `investors.md` file (not committed to public repo; lives in private founder workspace) tracks:

- Name, firm, email
- Relationship stage (warm intro, met, term sheet, invested, declined)
- Last touch
- Specific interests / asks they've made
- Next touch planned

Solutions Architect maintains; founder uses for monthly send and personalized outreach.

---

## Section 5 — Communications ownership matrix

| Communication | Drafted by | Approved by | Sent by |
|---|---|---|---|
| Tenant acknowledgment | Production Manager (auto) | (auto) | Production Manager (auto) |
| Tenant milestone update | Production Manager | Production Manager (P3) / PM (P2) / Founder (P1) | Production Manager |
| Tenant resolution (P3 / P2) | Production Manager | PM | Production Manager |
| Tenant resolution (P1) | Production Manager | Founder | Founder |
| Incident broadcast | Production Manager | Founder | Production Manager |
| Status page update | Production Manager (auto) | (auto, with override) | (auto) |
| Maintenance announcement | Production Manager | Founder | Production Manager |
| Weekly retro | PM | — | PM (to docs/) |
| Monthly founder briefing | PM | PM | PM (to docs/) |
| Monthly investor email | Founder | Founder | Founder |
| Quarterly investor update | Founder (PM drafts metrics section) | Founder | Founder |
| Material event notification | Founder | Founder | Founder |
| Post-mortem (internal) | Tech Lead | PM + Founder | PM (to docs/) |
| Post-mortem (tenant-facing summary) | Tech Lead | Founder | Founder |

---

## How this file is used

- **Production Manager** references templates daily for tenant comms
- **PM** references for weekly retros and monthly briefings; produces the docs
- **Solutions Architect** references for tenant onboarding comms and QBR (quarterly business review) patterns
- **Founder** references for investor cadence and material event triggers
- **Tech Lead** references the post-mortem comms protocol

Updates to templates evolve based on tenant and investor feedback. Material changes logged in `DECISIONS.md`.
