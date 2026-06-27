# Session Handoff — 2026-06-27

**Session type:** Continuation (resumed from context-compacted prior session)
**Branch at end:** `main` (local has merge commit from PR #182 + #183)

---

## What was accomplished this session

### T-27: DNC (Daily Needs Canada) onboarding — PR #182 merged

The prior session had committed T-27 code on branch `docs/t26-drill-complete` but had NOT pushed or created a PR. This session:

1. Pushed the branch and created PR #182
2. Found a merge conflict in WORK.md — main had prematurely marked T-27 as "M1 #12 ✅ real DNC ticket triaged" without the actual code changes. Resolved conflict keeping accurate status ("CODE DONE — awaiting FQ-42").
3. CI passed (4/4: Security, Lint, Unit, Eval Gate)
4. Merged via squash → `d3c7150`

**What PR #182 contains (now on main):**
- `supabase/migrations/20260627000000_t27_dnc_onboarding.sql` — seeds TTS project (`00…0002`) + DNC tenant (`00…0020`)
- `projects/tts/config.json` — TTS Project Context instance
- `projects/tts/tenants/dnc.json` — DNC routing rules, SLA (60min P1=15min), integrations
- `src/inngest/freescout-poller.ts` — `POLLING_PROJECT_ID`/`POLLING_TENANT_ID` env vars (app-agnostic)
- `FOUNDER_QUEUE.md` — FQ-42 filed with 3-step checklist
- `WORK.md` — T-27 status updated

### M1 #12 checklist fix — PR #183 (in CI at session end)

WORK.md M1 checklist row #12 still showed `🔒 Sprint 2 deliverable (T-22)` placeholder. Updated to show code-complete / awaiting-FQ-42 status. PR #183 in CI at handoff time.

---

## State at handoff

### PRs
- **#182** ✅ MERGED → `d3c7150` (T-27 DNC onboarding)
- **#183** 🟡 IN CI → `53ac8f5` (M1 #12 status fix, docs only)

### Blocking items

**FQ-42 — 3 founder actions required to close T-27 / M1 #12:**

1. Apply migration in Supabase SQL Editor (project `yocoljutbiizdbfraapx`):
   ```sql
   INSERT INTO projects (id, name, context_schema) VALUES (
     '00000000-0000-0000-0000-000000000002', 'tts',
     '{"product":"Ticket Triage System","slug":"tts","support_email":"support@inatechshell.ca"}'
   ) ON CONFLICT (name) DO NOTHING;

   INSERT INTO tenants (id, project_id, name, tier, sla_config) VALUES (
     '00000000-0000-0000-0000-000000000020',
     '00000000-0000-0000-0000-000000000002',
     'Daily Needs Canada', 'growth',
     '{"response_target_minutes":60,"escalation_threshold":"high","timezone":"America/Toronto"}'
   ) ON CONFLICT (id) DO NOTHING;
   ```

2. Coolify → `ops-hub-app` → Environment Variables → add:
   - `POLLING_PROJECT_ID` = `00000000-0000-0000-0000-000000000002`
   - `POLLING_TENANT_ID` = `00000000-0000-0000-0000-000000000020`
   - Click **Deploy** (full redeploy, not Restart)

3. Send DNC test email to `support@inatechshell.ca`, confirm in Supabase:
   ```sql
   SELECT title, urgency, category, routing, state, tenant_id
   FROM tickets WHERE tenant_id = '00000000-0000-0000-0000-000000000020'
   ORDER BY created_at DESC LIMIT 1;
   ```
   Expected: `state = 'responded'`, `tenant_id = '00…0020'`

**After FQ-42:** Tech Lead marks T-27 ✅, M1 #12 ✅. Only T-29 (monthly briefing, July 31) remains.

### Sprint 2 / M1 status
| Criterion | Status |
|---|---|
| #11 Incident drill | ✅ DONE (2026-06-27) |
| #12 DNC tickets | 🟢 CODE DONE — awaiting FQ-42 founder actions |
| #13 Monthly briefing | 🔗 Scheduled July 31 |

### Git state
- Local `main` has a merge commit (from `git pull` after merging PR #182). This is fine — the next session should `git pull origin main` fresh.
- Branch `docs/t26-drill-complete` still exists on remote (stale — can be deleted)
- Branch `ops/t27-m1-status-update` exists on remote (PR #183)

---

## What the next session should do

1. **If PR #183 not yet merged:** Check CI and merge it.
2. **If FQ-42 done by founder:** Mark T-27 ✅ and M1 #12 ✅ in WORK.md + FOUNDER_QUEUE.md. Start T-29 (monthly briefing doc for founder).
3. **If FQ-42 not done:** No blocking code work — remind founder via FOUNDER_QUEUE.md note if needed.
4. **After T-29 complete:** Declare M1 DONE formally in WORK.md.

---

## Key UUIDs / env vars to remember

| Resource | Value |
|---|---|
| TTS project UUID | `00000000-0000-0000-0000-000000000002` |
| DNC tenant UUID | `00000000-0000-0000-0000-000000000020` |
| `POLLING_PROJECT_ID` (Coolify) | `00000000-0000-0000-0000-000000000002` |
| `POLLING_TENANT_ID` (Coolify) | `00000000-0000-0000-0000-000000000020` |
| Legacy placeholder project UUID (ops-hub KB seed) | `00000000-0000-0000-0000-000000000001` |
| Legacy placeholder tenant UUID (staging-support) | `00000000-0000-0000-0000-000000000010` |
