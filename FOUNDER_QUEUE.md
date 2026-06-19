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

Founder responds in-line by editing the file:

- `APPROVED:` <agent> — <optional context>
- `REJECTED:` <agent> — <reason>
- `MORE INFO:` <specific question>

After founder responds, the originating agent removes the item from this queue and proceeds. Resolved items archive to `docs/founder-queue-archive/YYYY-MM.md` weekly.

---

## Open queue

*(empty — agents will post items here once Sprint 1 begins)*

---

## Recently resolved (this week)

*(empty)*

---

*Founder: this is the only file you're required to read regularly. Everything else updates around you.*
