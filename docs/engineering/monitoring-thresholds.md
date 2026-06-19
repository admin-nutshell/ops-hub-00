# Monitoring Thresholds

> What we measure, when we alert, and who responds.

---

## Tools

| Tool | What it monitors | Plan |
|---|---|---|
| **Sentry** | Application errors, performance regressions | Developer (free) |
| **UptimeRobot** | HTTP endpoint uptime, response time | Free (50 monitors) |
| **LangFuse** | Agent traces, latency, cost, eval scores | Free Cloud / self-hosted |
| **Inngest dashboard** | Workflow run failures, retries, queue depth | Free Cloud |
| **Supabase dashboard** | Database health, query performance, storage | Built-in |
| **Coolify dashboard** | Container health, deploy status, resource use | Built-in (self-hosted) |

All $0/mo.

---

## What we measure (per project, per environment)

### Application health

| Metric | Threshold | Severity if breached |
|---|---|---|
| HTTP 5xx error rate | > 1% over 5 min | P2 |
| HTTP 5xx error rate | > 5% over 5 min | P1 |
| API response p95 latency | > 2× baseline for 10 min | P2 |
| API response p95 latency | > 5× baseline for 5 min | P1 |
| Endpoint uptime | < 99.5% rolling 24h | P2 |
| Endpoint uptime | < 99% rolling 1h | P1 |

### Agent system health

| Metric | Threshold | Severity |
|---|---|---|
| Agent run failure rate | > 5% over 1 hour | P2 |
| Agent run failure rate | > 20% over 15 min | P1 |
| Workflow queue depth | > 100 pending for 30 min | P2 |
| Workflow queue depth | > 500 pending | P1 |
| Eval score regression | > 5% drop vs baseline | P3 (investigate) |
| Eval score regression | > 15% drop vs baseline | P2 |
| LangFuse trace volume | Sudden spike > 3× normal | P3 (investigate) |

### Cost governance

| Metric | Threshold | Action |
|---|---|---|
| Per-ticket token cost | > 3× expected for tier | Hard stop, post to FOUNDER_QUEUE.md |
| Daily project token spend | > 50% of monthly budget projected | Warning |
| Daily project token spend | > 80% of monthly budget projected | P2 alert |
| Daily project token spend | > 100% of monthly budget | P1 alert + hard stop on new workflows |

### Database health

| Metric | Threshold | Severity |
|---|---|---|
| Connection pool saturation | > 80% for 5 min | P2 |
| Connection pool saturation | > 95% for 1 min | P1 |
| Slow query (> 5s) | Any in prod | P3 (investigate) |
| Storage usage | > 80% of plan | P3 |
| Storage usage | > 95% of plan | P2 |

### Security signals

| Metric | Threshold | Severity |
|---|---|---|
| Failed auth attempts (single user) | > 10 in 1 min | P2 |
| Failed auth attempts (single IP) | > 100 in 5 min | P1 |
| Cross-tenant query attempt detected | Any | P1 |
| Secret detected in logs | Any | P1 |
| Vault access from unexpected source | Any | P1 |

---

## Alert routing

| Signal source | First responder agent | Escalation if not acked in SLA |
|---|---|---|
| Sentry application errors | Production Manager | Tech Lead → founder |
| Sentry performance regressions | Tech Lead | founder for sustained issues |
| UptimeRobot downtime | Production Manager | founder for > 10 min outage |
| LangFuse anomalies | Evals Lead | Tech Lead |
| Inngest workflow failures | Production Manager | Tech Lead |
| Cost spikes | Production Manager | founder if > $50/day unexpected |
| Security signals | Security Lead | founder immediately for P1 |
| Database health | Data Engineer | Tech Lead → founder |

Alerts post to `WORK.md` for non-urgent and `FOUNDER_QUEUE.md` for P1 / founder-facing.

---

## SLA for alert acknowledgment

| Severity | First-response SLA (agent picks up) | Founder notification |
|---|---|---|
| P1 | 5 minutes | Immediate (in FOUNDER_QUEUE.md with `URGENT:` prefix) |
| P2 | 30 minutes | If unresolved in 2 hours |
| P3 | 2 hours | Daily digest only |

---

## Alert hygiene rules

To avoid alert fatigue:

1. **No noisy alerts.** If an alert fires > 5 times/week without action being warranted, the threshold is wrong — Production Manager + Data Engineer revise it.
2. **Auto-resolve.** Alerts that clear automatically post a "resolved" message and don't require manual close.
3. **No duplicate alerts.** Within a 5-minute window, the same condition triggers once, not N times.
4. **Maintenance window suppression.** Planned maintenance pauses non-critical alerts (P1 always fires).
5. **Weekly review.** Data Engineer reviews alert volume + actionability weekly; tunes thresholds with Tech Lead approval.

---

## Dashboards (read by humans)

| Dashboard | Audience | Cadence |
|---|---|---|
| **Ops Hub Health** (overall agent + system metrics) | Founder, all agents | Real-time |
| **Per-Project Health** (TTS, etc.) | Founder, Solutions Architect | Real-time |
| **Cost Tracker** (by project, by provider, by agent) | Founder | Daily |
| **Eval Trends** (regression detection) | Evals Lead, Tech Lead | After every PR + nightly |
| **Tenant Health** (per-tenant ticket volume, SLA adherence) | Founder, Solutions Architect | Daily |

Initial dashboards built as HTML pages served from the Ops Hub admin panel — no third-party dashboard tool needed for v1.

---

## How this policy is used

- Data Engineer owns metric instrumentation and dashboard build
- Production Manager owns alert routing and on-call response
- Tech Lead reviews threshold tuning
- Security Lead owns security-signal thresholds specifically
- Founder receives only P1 + budget-related alerts directly
