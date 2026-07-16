# Customer Data Access / Deletion Request (PIPEDA) — Standard Operating Procedure

## Trigger

A ticket or direct report falls into this category when a data subject (a tenant, or an
individual named in tenant data) asks Ops Hub — via any channel — to:

- **Access/export** what personal data is held about them ("what information do you have on
  me", "send me a copy of my data", "export my account data")
- **Delete/erase** their personal data ("delete my account and all my data", "remove my
  information", "close my account under PIPEDA/GDPR")
- **Correct** inaccurate personal data held about them
- **Withdraw consent** for a specific use of their data

Concretely, this is almost always a ticket that arrives through the normal FreeScout →
ops-hub → Inngest → LiteLLM `ticket-triage` pipeline and gets classified into
`category: "compliance"` (the same category `evals/ticket-respond.yaml` cases (m)/(q)/(the
GDPR-ruling case) already exist to guard). That existing prompt rule — never confirm, deny,
or act on a compliance/regulatory matter, route it to be confirmed by "the right team" instead
(T-116, Sprint 19) — is exactly what this document is "the right team" process *for*. A
data-subject request is never eligible for `ticket-respond` auto-send. If it reaches this
point with an auto-drafted reply already attached, discard the draft; it does not get sent.

This is distinct from a **regulatory inquiry** (a letter/call from the Office of the Privacy
Commissioner of Canada or another regulator) — that is not this SOP; see Escalation below.

---

## Owner

**Security Lead** runs point end-to-end. Compliance posture (including the quarterly PIPEDA
self-check) is explicitly Security Lead's domain per `.claude/team/SECURITY.md`, and this is
the same "review the concrete payload/scope before anything touches production" discipline
Security Lead already applies to credential/secret changes, applied here to a customer's
personal data instead.

Security Lead delegates specific steps but stays accountable for the request until close:

| Step | Delegate | Why |
|---|---|---|
| Data location / query drafting | Tech Lead | Owns schema/architecture knowledge |
| Execution against the production DB | Production Manager | Owns all prod execution + rollback discipline |
| Independent verification | QA | Owns multi-tenant isolation testing |
| Customer-facing reply (manual, never LLM-drafted) | PM + Knowledge Lead | Same pairing SECURITY.md already assigns for tenant-facing incident comms |
| Eval fixture check (only if this tenant's real ticket text ever got captured into `evals/*.yaml`) | Evals Lead | Evals Lead owns everything under `evals/` |

---

## Severity / priority classification

This does **not** use the `tickets.severity` enum (`P1`/`P2`/`P3`) — that scale measures
production incident impact, not data-rights risk. Use two tiers instead:

- **Tier A — Deletion / Erasure / Withdrawal of consent.** Higher technical risk: the action
  is destructive and, once executed, not reversible in the normal Production Manager sense
  (there is no "redeploy the previous image" for an erased row). Requires the full sign-off
  chain below before execution, and a pre-execution proof-of-deletion snapshot (see Step 4).
- **Tier B — Access / Export / Correction.** Lower technical risk (read-mostly, or a scoped
  update). Same identity-verification bar as Tier A — a wrong disclosure is a tenant-data leak
  regardless of tier — but no destructive-action sign-off is required.

Both tiers get a `tickets.state` of `investigating` while in progress (never `resolved` until
Step 6 below is complete) and are excluded from `ticket-respond` auto-send for the life of the
request.

---

## Step-by-step procedure

1. **Flag and pull out of auto-response.** *(Whoever first sees it — usually PM via the
   triage pipeline's `category: "compliance"` classification, or any agent that spots one
   manually.)* Confirm the ticket is tagged `category: "compliance"` in its triage output;
   if it landed in another category by triage error, correct it. Set `tickets.state =
   'investigating'`. Notify Security Lead. **Done when:** ticket is tagged, state is
   `investigating`, no auto-drafted reply is queued or sent, Security Lead is aware.

2. **Verify identity.** *(Security Lead.)* Confirm the requester is the actual data subject
   (or their authorized representative) before disclosing or deleting anything — this is the
   same cross-tenant-leak concern Security Lead's per-PR checklist already treats as a hard
   stop, applied to a live request instead of a diff. Cross-reference the requester's email
   against the contact info tied to the `tenants` row for that account. If the requester's
   email doesn't match anything on file, or the request is ambiguous about which tenant it
   concerns, send one manual (non-LLM) reply asking for the minimum verifying detail needed
   (e.g., the account/tenant name and the email the account is registered under) before doing
   anything else. Log the outcome to `audit_log` (`actor` = requester email, `action` =
   `'data_request_identity_verified'` or `'data_request_identity_failed'`,
   `resource_type = 'tenant'`, `resource_id` = the tenant's `id`, `payload` = method used —
   never the raw verifying data itself). **Done when:** verification has a documented
   pass/fail outcome in `audit_log`, tied to a specific `tenant_id`.

   If verification fails and the requester cannot resolve it, do not proceed — see
   Escalation.

3. **Map the data.** *(Tech Lead, informed by Security Lead.)* Enumerate every table this
   tenant's personal data could live in, scoped to that tenant's `id` — never a global query:
   - `tenants` — `name`, `sla_config` (tenant-level record itself)
   - `tickets` — `title`, `body` (marked untrusted tenant input in the schema; frequently
     where actual PII lands, since customers paste account details into ticket text)
   - `audit_log` — `payload`/`actor` may reference this tenant's data in past entries
   - FreeScout `conversations`/`threads` — owned by `freescout_user`, ops-hub only has
     GRANT SELECT; a deletion here is a **separate, FreeScout-side action** and must be
     called out explicitly as a follow-up, not silently assumed done by the ops-hub-side
     work
   - `kb_articles` — only if tenant-submitted content was ever ingested into the KB (rare;
     check before assuming N/A)

   Note the one real schema constraint that affects execution order: `tickets.tenant_id`
   references `tenants(id)` with **`on delete restrict`** — the `tenants` row cannot be
   deleted while any `tickets` rows still reference it. If the request is a full
   account-deletion (not just individual ticket content), ticket rows must be handled first.

   Write the scoped query plan (which tables, which columns, which `tenant_id`) into the
   ticket/task notes. **Done when:** a written data map exists and has been read by Security
   Lead before Step 4 starts — mirrors the "review the concrete payload/scope before
   implementation" rule SECURITY.md already applies to secret/credential changes.

4. **Security Lead reviews the concrete query before it runs.** *(Security Lead.)* Same gate
   as any privileged prod data change: read the actual SQL/script Tech Lead drafted, confirm
   it is tenant-scoped (no global `DELETE`/`SELECT` without a `WHERE tenant_id = ...`), and
   confirm it doesn't reach into another tenant's rows via an unscoped join. For Tier A
   (deletion): confirm the plan below for `audit_log` rows (anonymize, don't hard-delete —
   the table is append-only and is SOC 2/audit evidence; replace identifying fields with a
   redaction marker rather than removing the row, which would itself corrupt the audit trail)
   and for `tickets` rows (hard-delete the row content, but leave one new `audit_log` entry
   recording that a deletion occurred, dated and tenant-stamped, containing no PII itself —
   that entry is retained forever as the deletion has legally occurred, since the audit trail
   entry proves compliance without holding the erased data). **Done when:** Security Lead has
   signed off on the exact query text, in writing, in the task notes.

5. **Take a proof-of-deletion snapshot (Tier A only).** *(Production Manager.)* Because a hard
   delete has no rollback path in the normal Production Manager sense, capture a minimal
   internal record before executing — row IDs, table names, timestamp, and a hash of the
   deleted content, **not the PII itself** — sufficient to prove what was removed and when if
   ever challenged, without defeating the deletion by keeping a restorable copy. Store this
   record per Security Lead's compliance-evidence convention (`docs/security/compliance/`).
   **Done when:** the proof record exists and contains no raw personal data.

6. **Execute.** *(Production Manager, same discipline as any other prod change: written down
   before, logged after — per PRODUCTION.md's env-var and deploy rules applied to data
   instead of config.)* No agent holds `service_role` at runtime (`CLAUDE.md` security
   non-negotiable #3); `ops_hub_app`, the role all runtime agent code uses, cannot bypass RLS
   to touch another tenant's rows. That means Step 4's approved query cannot simply be run
   ad hoc through the app — it runs the same way any privileged cross-row change does in this
   repo: as a reviewed, forward-only data migration (or one-off script under the same
   discipline), applied via the SQL Editor under `service_role`, against the actual Supabase
   project (`yocoljutbiizdbfraapx`, Canada Central — this is a production-only action; staging
   holds no real tenant PII by design, so there is nothing to execute there). For access
   requests this is a scoped `SELECT`/export; for deletion, the anonymize/hard-delete plan
   from Step 4. **Done when:** the query has run and Production Manager has confirmed it
   affected exactly the expected row count (not more, not fewer).

7. **QA independently verifies.** *(QA.)* Re-query the same scoped tables independently of
   Production Manager's confirmation. For access requests: confirm the exported package
   matches what is actually stored — no under-disclosure (missing rows) and no
   over-disclosure (any other tenant's data leaking in, QA's standing multi-tenant-isolation
   responsibility from `.claude/team/QA.md`). For deletion requests: confirm the target rows
   are gone or correctly anonymized, and that no residual copy exists in another
   ops-hub-reachable table. **Done when:** QA records a pass/fail verdict against the original
   request scope, same format as any other QA bug/verification report.

8. **Reply to the customer.** *(PM + Knowledge Lead, manual — never an LLM-drafted
   `ticket-respond` output, per the T-116 lesson that this pipeline must not fabricate
   compliance commitments.)* Send the export (access requests) or a completion confirmation
   (deletion requests) via a manual FreeScout reply. **Done when:** the customer has a reply
   in-thread and `tickets.state` moves toward `resolved`.

9. **Close out.** *(Security Lead + PM.)* Confirm the Step 2 and Step 6 `audit_log` entries
   exist and are complete. Log the request in `DECISIONS.md` — request type, tenant (by ID,
   not by any personal identifier), verification method, tables touched, outcome — with all
   PII redacted from the write-up itself; the audit trail lives in `audit_log`, not in a
   committed markdown file. Move the task to `done` in `WORK.md`. **Done when:** both log
   entries exist and the task is closed.

---

## Required reviewers / sign-offs before this can close

- **Security Lead** — mandatory. This touches customer/tenant data and (for Tier A) a
  destructive prod data change; both are explicit "required, routed by path, not asked-for"
  gates per `CONSTITUTION.md`.
- **QA** — mandatory (Step 7). No data-rights request closes on Production Manager's word
  alone, same as no deploy closes without QA sign-off.
- **Production Manager** — mandatory for the actual execution (Step 6) and, for Tier A, the
  pre-execution snapshot (Step 5).
- **CR (CodeRabbit)** — if the scoped query is committed as a one-off script/migration rather
  than run ad hoc through the SQL Editor, it goes through CR's first-pass review like any
  other change to `supabase/migrations/` or `src/`.
- **Evals Lead** — only if Step 3's data map turns up this tenant's real ticket text inside
  any `evals/*.yaml` fixture; if so, Evals Lead confirms it's purged and notes it in
  `DECISIONS.md`. Not required otherwise.
- **PM** — closes the loop in `WORK.md`/`DECISIONS.md`; not a technical sign-off, but the
  request does not count as closed without it.

---

## SLA / target timeline

PIPEDA is explicit here, not just aspirational: **s. 8(3)** of the Act requires a response
"not later than thirty days after the request is received," with a limited extension available
under **s. 8(4)** (further time reasonably required, or the request requires translation/
consultation) provided the requester is notified of the extension and the reason within the
original 30 days; failing to respond within the applicable time is a **deemed refusal**
under **s. 8(5)**. Schedule 1 / Principle 4.9 (Individual Access) is the softer *how* — respond
with reasonable promptness — but the hard *when* is this statutory 30-calendar-day deadline,
and that is the ceiling this SOP is built against. Internally, given this team's own stated
bar (`CLAUDE.md`: < 1hr MTTR on P1s, > 95% SLA attainment) we hold ourselves to a much tighter
working target and treat the statutory deadline as the line that triggers escalation, not the
target itself:

| Milestone | Target |
|---|---|
| Ticket flagged out of auto-response, Security Lead notified (Step 1) | Same business day |
| Identity verified or verification request sent (Step 2) | Within 1 business day of flagging |
| Full completion — access delivered or deletion executed + QA-verified (Steps 3–8) | Within 10 business days |
| Hard ceiling (PIPEDA s. 8(3) statutory deadline, absent a documented s. 8(4) extension) | 30 calendar days |

A slip past the 10-business-day internal target is handled within the team (reassign,
reprioritize) exactly like any other task slip in `WORK.md`. Only a slip that puts the
30-calendar-day statutory deadline genuinely at risk escalates — see below.

---

## Escalation

Per `CONSTITUTION.md` and `FOUNDER.md`, the Founder handles business/legal-authority
decisions only — routine execution of this SOP stays entirely within the team. Post to
`FOUNDER_QUEUE.md`, in the required format, only when:

- Identity cannot be verified and the requester disputes or escalates the refusal — this is a
  business-risk judgment call (deny and risk a complaint, or disclose on weaker evidence and
  risk a real leak), not a technical one.
- The 30-calendar-day PIPEDA statutory deadline is genuinely at risk of being missed.
- Deletion is technically infeasible without violating another legal retention obligation, or
  without corrupting another tenant's referential/data integrity — a real product trade-off
  only the Founder can weigh, same class of call as SECURITY.md's "should TTS hold tenant PII
  at all."
- The request surfaces a suspected or confirmed cross-tenant data exposure in the process of
  investigating it — Security Lead's existing hard-stop rule (post immediately, not at
  close-out).
- What actually arrived is a **formal regulatory inquiry** (a letter/call from the OPC or
  another regulator), not an ordinary customer request — SECURITY.md already lists this as
  its own escalation trigger, separate from this SOP.
- The tenant's contract/SLA tier implies a data-handling commitment that this request
  conflicts with — pricing/SLA calls are Founder's domain by definition.

Everything else — normal identity verification, normal query drafting and execution, a
10-business-day slip that isn't threatening the 30-day ceiling — is resolved within the team
and never reaches the queue.

---

## What "done" looks like

- [ ] Ticket tagged `category: "compliance"`, `state` moved to `investigating`, excluded from
      `ticket-respond` auto-send for its entire lifecycle
- [ ] Identity verification outcome logged in `audit_log`, tied to a specific `tenant_id`
- [ ] Written data map exists covering every table in scope (Step 3), including the
      FreeScout `conversations`/`threads` caveat if applicable
- [ ] Security Lead signed off on the exact query/script text before execution
- [ ] Tier A only: proof-of-deletion snapshot captured, containing no raw PII, filed under
      `docs/security/compliance/`
- [ ] Query executed by Production Manager against production (`yocoljutbiizdbfraapx`,
      Canada Central) — never staging
- [ ] QA independently re-verified completeness and confirmed no cross-tenant leakage, with a
      recorded pass/fail verdict
- [ ] Customer received a manual, non-LLM-drafted reply via FreeScout
- [ ] Final `audit_log` entry recorded for the completed action (immutable evidence)
- [ ] `WORK.md` task moved to `done`; `DECISIONS.md` entry logged with all PII redacted
- [ ] Evals Lead confirmed (only if applicable) that no `evals/*.yaml` fixture retained this
      tenant's real data
- [ ] No open `FOUNDER_QUEUE.md` item tied to this request, unless it is intentionally still
      pending an actual Founder business decision

A request is not "done" on Production Manager's execution alone, and not "done" on a customer
reply alone — it is done only when every box above is checked.