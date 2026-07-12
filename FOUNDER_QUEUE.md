# FOUNDER_QUEUE.md

> Items here require founder action. Each item has: what is blocked, the minimum action required, and who to notify when done.

---

## ✅ FQ-73 — RESOLVED: password set + `EVAL_GATE_DB_URL` GitHub secret added

**Filed:** 2026-07-10 | **Resolved:** 2026-07-11
**Filed by:** Production Manager (Sprint 9, T-93 last mile; mechanism ruled on by Security Lead)
**Status:** RESOLVED — founder ran the password-provisioning script via Supabase SQL Editor and added the resulting value as the `EVAL_GATE_DB_URL` GitHub Actions secret. Team now runs `verify-eval-gate-ci-writer-role.yml` to confirm the credential is scoped exactly as designed before relying on it.
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, same as FQ-45/61/62/67/68/71/72).
**Deadline:** Non-blocking. The eval gate itself already works today without this — it still catches a regression and blocks a bad pull request either way. This only turns on saving a *history* of each run to the database (so the dashboard/team can look back at past runs later).

**In plain language:** Two weeks ago you created a brand-new, deliberately near-powerless database login (`eval_gate_ci_writer`, FQ-72) that can do exactly one thing — add a row to one results table — and nothing else. It's created but it has no password yet, so right now it can't actually be used at all (like a key blank with no cuts). This request is the very last step: give it a password, and hand that password to our automated checks (GitHub) so they can use it.

**Why this is two small copy-pastes, not one click:** Setting a database password requires the same "owner" access level you already use in the Supabase SQL Editor for every migration so far — it can't be done from an automated robot/workflow safely. (We looked hard for a one-click way to do this from GitHub directly; it turns out GitHub would have to keep a copy of an all-powerful database key sitting around waiting to be used, which is exactly the kind of risk this whole project has been trying to eliminate. The two-copy-paste way below keeps that key out of GitHub's hands entirely — it's the safer path, not a shortcut we settled for.)

**What's needed (2 steps, one sitting — don't do step 1 today and step 2 tomorrow; do them back to back):**

1. **Run one script in Supabase SQL Editor** (Dashboard → project `yocoljutbiizdbfraapx` → SQL Editor, same place you've run every migration this sprint): open `supabase/ops/t93_set_eval_gate_ci_writer_password.sql`, paste its **entire contents**, click **Run**. A result grid appears with exactly one column/one row — a long value starting with `postgresql://`. That's the only output; nothing else needs copying.
2. **Copy that ENTIRE value** and paste it into GitHub: this repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → Name: `EVAL_GATE_DB_URL` → Value: (paste) → **Add secret**.

That's it — two pastes, one sitting. If you get interrupted between step 1 and step 2 (close the tab, browser crashes, whatever) — don't hunt for the value again. Just **re-run step 1** to get a fresh one and continue from there; running the script again is completely safe (it's designed to be re-run).

**What this does NOT do:** it does not touch any customer data, tickets, or any other table — the login this password unlocks can only ever add one kind of row to one results table, and can't read, change, or delete anything, anywhere (that's the whole design of FQ-72, unchanged). Declining this (Option B below) leaves the eval gate exactly as capable as it is today — it just keeps skipping the "also save a copy of this run to the database" step, the same way it has been.

**Options:**
- **(A)** Run the two steps above (recommended).
- **(B)** Do nothing — the eval gate keeps working (still catches regressions, still blocks bad pull requests) but keeps skipping the database-history step, same as today.

**Recommendation:** (A) — this is the last remaining piece of a feature the team has been building carefully over several sessions (FQ-71, FQ-72, and now this), it was reviewed by the Security Lead specifically to make sure this exact request is the safest possible way to do it, and it takes about two minutes.

**Notify:** Production Manager / Tech Lead / Security Lead once done — the team then runs one verification check (`verify-eval-gate-ci-writer-role.yml`, already built and waiting) to prove the new password only allows the one narrow action it's supposed to, before relying on it.

---

## ✅ FQ-72 — RESOLVED: scoped CI role `eval_gate_ci_writer` created via Supabase SQL Editor

**Filed:** 2026-07-10 | **Resolved:** 2026-07-10
**Filed by:** Tech Lead (Sprint 9, T-93; design origin = Security Lead review of T-93 CI DB persistence)
**Status:** RESOLVED — founder applied the migration via Supabase SQL Editor. Verified: `eval_gate_runs_insert_ci` policy present on `eval_gate_runs`, confirming the migration ran to completion (it's the final statement in the script). The role exists, INSERT-only, no password yet (inert until the team's follow-up sets one).
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, same as FQ-71/FQ-68/FQ-67/FQ-61/FQ-62/FQ-45).
**Deadline:** Non-blocking for today's live service — nothing uses this role yet. It unblocks the *deferred* DB-persistence step of the live eval gate (`eval-gate-live.yml`), which today just prints the row it *would* write. Needed before that gate can actually record its runs to the database.

**In plain language:** We're building the "real" eval gate — the automated check that re-runs our AI prompts on a pull request and can block a change that makes them behave worse. When it runs, we want it to save a small record of each run into the database (one row: pass/fail, how many tests passed, the git commit). To do that, the automated check needs a database login of its own.

The safe way to give it one is the whole point of this request. We already have a database login sitting in our automation (`SUPABASE_STAGING_DB_URL`), and the obvious shortcut would be to reuse it — but the security review found that login is an **owner-level, master key of the database**: it can read and write *everything*, including real customer support tickets, and it ignores all the safety walls we put up. Handing that to an automated check that runs automatically on every pull request would mean: if that login ever leaked (e.g. someone opens a malicious pull request), the whole database is exposed. That was rejected.

Instead, this creates a **brand-new, deliberately near-powerless login** just for the eval gate. It can do exactly one thing — add a row to the one eval-results table — and **nothing else**: it can't read any table (not even that one), can't change or delete anything, can't touch customer data. If it ever leaked, the worst case is someone adds junk rows to a CI-results table. That's the trade-off the security review asked for: assume the login can leak, and make leaking it harmless.

One more thing that's intentional: this new login is created **without a password**, so it **cannot actually log in yet** — it just exists, inert. A follow-up step (handled by the team, not you) will set a password and finish wiring it up. So running this migration is safe and does not, by itself, turn anything on.

**What's needed (via Supabase Dashboard → SQL Editor, project `yocoljutbiizdbfraapx`, as the project owner / `service_role`):**
1. Run the full contents of `supabase/migrations/20260710000000_t93_eval_gate_ci_writer_role.sql` (forward-only, idempotent — guarded role-create + `drop policy if exists`, safe to re-run). Expected: a few `DO` / `ALTER ROLE` / `GRANT` / `REVOKE` / `CREATE POLICY` / `COMMENT` confirmations, no errors. **If instead you see an error mentioning permission to create a role (e.g. "permission denied to create role" / "must have CREATEROLE"), stop and tell the team** — it just means this project's SQL Editor is locked down and the role has to be created from the Supabase dashboard instead; it is not a problem with the migration.
2. **Verify** with these four queries (they prove the security property — the login can only INSERT into one table and read nothing):
   ```sql
   -- (a) the role exists with the right attributes (login=t, inherit=f, bypassrls=f, connlimit=3):
   select rolname, rolcanlogin, rolinherit, rolbypassrls, rolconnlimit
     from pg_roles where rolname = 'eval_gate_ci_writer';

   -- (b) its statement timeout is 15s:
   select rolname, rolconfig from pg_roles where rolname = 'eval_gate_ci_writer';
   --     expect rolconfig to contain: statement_timeout=15s

   -- (c) it has EXACTLY one table privilege — INSERT — and no SELECT/UPDATE/DELETE:
   select grantee, privilege_type from information_schema.role_table_grants
     where table_name = 'eval_gate_runs' and grantee = 'eval_gate_ci_writer';
   --     expect EXACTLY one row: eval_gate_ci_writer | INSERT

   -- (d) its INSERT policy is present:
   select polname from pg_policy
     where polrelid = 'eval_gate_runs'::regclass
       and polname = 'eval_gate_runs_insert_ci';
   --     expect one row.
   ```
3. Reply here or in `WORK.md` once done — the team then does the follow-up (set the role's password, create the `EVAL_GATE_DB_URL` GitHub secret with an explicit `:5432` port, and wire the INSERT into `eval-gate-live.yml`). That follow-up gets its own review; this FQ does **not** make the gate write to the DB by itself.

**Options:**
- **(A)** Apply the migration as written (recommended).
- **(B)** Do nothing — the eval gate keeps printing the row it *would* write but never persists it (the gate itself still works and still blocks regressions; only the historical DB record is missing).

**Recommendation:** (A) — the migration implements the Security Lead review's spec exactly, was verified against the actual code that writes the row (`recordEvalGateRun` in `src/metrics/evalHealth.ts`), and creates the least-privilege alternative that closes the "reuse the master-key credential in an auto-triggered PR job" risk the review rejected. Lower blast-radius than any migration in the FQ-67/68/71 series (it *reduces* the credential surface of the eval gate rather than opening new access).

**Notify:** Tech Lead / Security Lead / Production Manager once done.

---

## ✅ FQ-71 — RESOLVED: migration applied via Supabase SQL Editor — `case_results` column live on `eval_gate_runs`

**Filed:** 2026-07-09 | **Resolved:** 2026-07-10
**Filed by:** Evals Lead (Sprint 9, T-92; Tech Lead concurs — this is ADR-0007 Finding 4 / Condition C3)
**Status:** RESOLVED — founder applied the migration via Supabase SQL Editor. Verified: `select column_name, data_type from information_schema.columns where table_name='eval_gate_runs' and column_name='case_results';` returned `case_results | jsonb`. T-92's DB-persistence half is now unblocked — the gate can write and later compare per-test baselines against the real table.
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, same as FQ-67/FQ-68/FQ-61/FQ-62/FQ-45).
**Deadline:** Non-blocking for today's live service — nothing reads or writes this column yet. It gates the *DB half* of the T-92 green-baseline record (the eval run itself + its per-test detail are captured as a CI artifact regardless). Needed before the real eval gate (T-93/T-94) can persist or compare baselines against the database.

**In plain language:** Sprint 9 is building the "real" eval gate — the one that actually re-runs our AI prompts and blocks a change that makes them behave worse. For the gate to answer "did this change make something worse?" it has to remember, per individual test, what "good" looked like last time — not just a total score. (A total score hides a swap: one test breaks while another improves, the total is unchanged, and a real regression sails through.) The `eval_gate_runs` table today only stores totals. This adds one optional column to hold the per-test detail. It's a smaller, safer change than the last two migrations (FQ-67/FQ-68): it creates no table, changes no permissions, and opens no new access — it just adds a nullable column to a table whose access is already locked down. Existing dashboard code is unaffected (it reads named columns only).

**What's needed (via Supabase Dashboard → SQL Editor, project `yocoljutbiizdbfraapx`, as the project owner/`service_role`):**
1. Run the full contents of `supabase/migrations/20260709020000_t92_eval_gate_case_results.sql` (forward-only, idempotent — `add column if not exists`, safe to re-run). Expected: an `ALTER TABLE` + `COMMENT` confirmation, no errors.
2. **Verify** with:
   ```sql
   select column_name, data_type
     from information_schema.columns
    where table_name = 'eval_gate_runs' and column_name = 'case_results';
   ```
   — expect one row: `case_results | jsonb`.
3. Reply here or in `WORK.md` once done — the T-92 green-baseline DB row (per-test detail from the captured baseline) can then be written, and T-93 can wire baseline comparison against the live table.

**Recommendation:** Apply as written — a single nullable additive column, no RLS/grant change, reviewed against the existing `eval_gate_runs` schema (T-58) and the ADR-0007 Tech Lead review that recommends exactly this per-test path (Finding 4 / C3). Lowest-risk migration in the FQ-67/68/71 series.

**Notify:** Evals Lead / Tech Lead once done.

---

## ✅ FQ-70 — RESOLVED: staging billing topped up; litellm-prod's Anthropic key rotated

**Filed:** 2026-07-10 | **Staging resolved:** 2026-07-12 | **Prod resolved:** 2026-07-12
**Filed by:** Production Manager, T-90 follow-up investigation.
**Status:** RESOLVED, both halves. Founder topped up the Anthropic account's credit (fixed litellm-staging's `fallback-model` — the eval gate ran its first real, fully-graded quality check as a direct result, run [29195017036](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29195017036), GATE PASS, DB write confirmed). Founder then went into Coolify's `litellm-prod` app (UUID `hlik1d96uvkkjzpbxa3azhcv`), deleted the stale `ANTHROPIC_API_KEY` row(s) from **Production Environment Variables**, added a fresh working key, and redeployed. Re-verified live (2026-07-12, [run 29195788372](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29195788372)): `GET /health/readiness -> HTTP 200`; `POST /chat/completions (model=fallback-model) -> HTTP 200` — **litellm-prod's fallback-model is HEALTHY.** The duplicate-row footgun is also confirmed cleared (exactly one `ANTHROPIC_API_KEY` row remains). Production's model fallback path is fully restored — if the primary model (gpt-4o-mini) ever fails, the backup will now actually work.

**Context:** T-90 (provisioning the LiteLLM eval virtual key) found litellm-**staging**'s `fallback-model` alias (anthropic/claude-haiku-4-5-20251001, T-46) is Anthropic-credit-exhausted (`HTTP 400`, `"Your credit balance is too low to access the Anthropic API"` — confirmed on 2 independent runs, [29065628215](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29065628215), [29066125110](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29066125110)). `configure-litellm-anthropic-fallback.yml`'s own header says it targets staging only, so I checked whether prod has a separate fallback path and whether it shares the same problem.

**Read-only investigation** (`diagnose-litellm-prod-anthropic-fallback.yml`, [run 29066315771](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29066315771) + [run 29066486166](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29066486166)), no mutation:
- litellm-**prod DOES** have its own, separately-configured `fallback-model` → `anthropic/claude-haiku-4-5-20251001` registration (independent of staging's — confirmed via `/model/info`).
- A single minimal completion smoke test against it (master key, read-only) **failed**, but with a **different error class** than staging's billing shortfall: `HTTP 401`, `litellm.AuthenticationError: ... "invalid x-api-key"`. This is an authentication failure, not a credit/billing failure — the key litellm-prod is using is itself rejected by Anthropic, independent of account balance.
- litellm-prod has **2 duplicate `ANTHROPIC_API_KEY` rows** in its Coolify env vars (count only checked, values never read/printed) — this matches the known Coolify "Save appends rows, not upsert; last row wins" footgun already on file for this project. It's possible an **earlier** row held a still-valid key that got shadowed when a later (bad) row was saved on top — I stopped short of reading/testing either raw value directly against Anthropic, since that crosses from "read a count" into "handle credential material outside its established use," which isn't a Production Manager unilateral call.
- **App-level routing confirmed, not assumed:** WORK.md's T-46 entry records `LITELLM_FALLBACK_MODEL=fallback-model` was explicitly set in ops-hub-prod's own Coolify env vars (2026-07-02, alongside staging), and `triageOneTicket` (`src/inngest/ticket-triage.ts`) retries via that env var on primary failure — so this is a live, wired route, not a dormant registration.
- **Net effect:** if ops-hub-prod's primary model (triage-model / gpt-4o-mini) ever fails, the fallback attempt will also fail (401). Primary-model outages in production currently have **no working fallback**.

**Options:**
- **(A)** Founder (or Production Manager, once authorized) opens Coolify's litellm-prod env vars UI, inspects both `ANTHROPIC_API_KEY` rows' actual values, and either restores whichever is valid or replaces both with a fresh key + tops up the Anthropic account if the root cause is exhausted/revoked credit (same account as staging, or a separate one — worth confirming which). Also worth deduping the 2 rows while in there (cosmetic, but the same footgun class flagged elsewhere in this file for `LITELLM_URL`).
- **(B)** Accept the risk for now — primary model (OpenAI gpt-4o-mini) has been reliable in practice; fallback stays broken until this is revisited. Document the residual risk in the runbook.
- **(C)** Remove/disable the `fallback-model` routing on prod entirely until a valid key is in place, so a primary-model failure fails loudly (visible incident) instead of silently attempting a fallback that's guaranteed to also fail.

**Recommendation:** (A) — this is a genuine gap in production's resilience (the whole point of a fallback model is to survive exactly the kind of primary-provider outage this key currently can't help with), and fixing it needs either a credential value or a billing/account decision only the founder has visibility into. Low urgency in practice (OpenAI primary has been stable), but should not sit indefinitely given it's a live customer-impacting gap if OpenAI ever has an outage.

**Deadline:** non-blocking — does not gate T-90, T-93, or any Sprint 9 build task. Revisit at founder's convenience; flagging now per CLAUDE.md's customer-impacting-incident escalation criterion rather than waiting for an actual outage to discover it.

---

## ✅ FQ-69 — RESOLVED: 70% of production tickets (14/20) were stuck un-triaged — root cause fixed, entire backlog drained on real data

**Filed:** 2026-07-09 | **UPGRADED twice, ROOT-CAUSED (Tech Lead), then RESOLVED (user-authorized fix) — all same day.**
**Filed by:** QA Manager / PM session (found during T-85's pre-injection pre-flight). **Root-caused by:** Tech Lead. **Fix dispatched with explicit user authorization.**
**Status:** RESOLVED. `fix-ops-hub-prod-litellm-master-key.yml` dispatched ([run 29043946687](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29043946687), success) — self-abort pre-flight reconfirmed the key was still rejected (401) immediately before mutating (diagnosis still held), 2 duplicate `LITELLM_MASTER_KEY` rows deleted, correct value set, restart confirmed healthy, post-fix probe confirmed the aligned key now authenticates (200). **Waited ~13 minutes (2+ `sweepNewTickets` cycles) and re-ran the read-only diagnostic** ([run 29044809037](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29044809037)): all 11 previously-stuck sampled tickets now show `state='responded'`, `owner_agent='ticket-respond'`. **Full prod state distribution: 14 `responded` + 6 `resolved` = 20/20 — zero tickets remain in `state='new'`.** The entire backlog drained end-to-end (triage AND respond) on real production rows within 13 minutes of the fix — a stronger green signal than a synthetic E2E ticket would have given. **T-85's QA E2E injection is no longer necessary** to prove the pipeline healthy; the real-data drain already is that proof.
**Deadline:** N/A — resolved.

---

**✅ ROOT CAUSE CONFIRMED (Tech Lead, 2026-07-09) — ops-hub-prod's `LITELLM_MASTER_KEY` is not accepted by litellm-prod.**

One consolidated read-only diagnostic (`diagnose-ops-hub-prod-triage-blocked.yml`, PRs #349/#350) settled every open question in two dispatches ([run 29042495432](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29042495432), auth-probe [run 29043170190](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29043170190)):

- **Scoping ruled OUT:** ops-hub-prod has `POLLING_PROJECT_ID=…0003`, `POLLING_TENANT_ID=…0030`, `POLLING_ENABLED=true` → the poller and the `*/5` `sweepNewTickets` cron both scope to exactly where the stuck tickets live. The live paths DO reach and re-attempt them. So the stall is a per-call failure, not orphaned/unreached data.
- **Master-key rejection = the cause, proven by a live 401 (not merely a hash diff):** the app's key (sha256[0:16] `6d8b57842c40a030`) ≠ litellm-prod's (`90b285b2d96353e1`), **and** a probe using ops-hub-prod's OWN key against litellm-prod `/chat/completions` returned **HTTP 401 `token_not_found_in_db`**. That is LiteLLM's error for a token that is neither the master key nor a registered virtual key — so the "maybe it's a valid virtual key that just differs" possibility is eliminated. Consequence: every `classifyTicket` 401s on BOTH the primary and the fallback model → `triageOneTicket` throws before the `UPDATE … SET state='triaged'` → the ticket never leaves `new`. This matches the DB signature exactly (`owner_agent` NULL + `since_last_update`==`age` on all 14). The prior external smoke test only ever passed because it used litellm-prod's OWN key, never the app's — the exact gap this incident lived in. This mismatch predates today (explains the 3.6-day-old rows); the already-fixed `LITELLM_URL` staleness was a separate, more recent fault stacked on top.
- **`LITELLM_URL` is currently fine:** 2 rows, but both hold the identical correct value (`hlik1d96uvkkjzpbxa3azhcv-132650269773`). The duplicate is a cosmetic footgun to dedup later (re-run `fix-ops-hub-prod-litellm-url.yml`), not a cause.

**Proposed fix (AUTHORED, NOT dispatched — awaiting authorization):** `fix-ops-hub-prod-litellm-master-key.yml`. It reads litellm-prod's `LITELLM_MASTER_KEY` (masked), **self-aborts if ops-hub-prod's current key already authenticates** (so it's safe even if state changed), deletes all `LITELLM_MASTER_KEY` rows on ops-hub-prod (closes the duplicate-row footgun), sets the correct value, restarts, and verifies the aligned key now returns 200. Requires typed `confirm=ALIGN-MASTER-KEY`. **Aligning the key also drains the 14-ticket backlog on its own** — the next few `sweepNewTickets` cycles re-classify them successfully; no manual reprocessing needed.

**Options:**
- **(A) Authorize the key-alignment fix** (recommended) — dispatch `fix-ops-hub-prod-litellm-master-key.yml` with `confirm=ALIGN-MASTER-KEY`; Production Manager runs it after a deployability glance, Security Lead eyeballs the masked secret-copy step. Fixes the pipeline and drains the backlog.
- (B) Founder sets ops-hub-prod's `LITELLM_MASTER_KEY` = litellm-prod's `LITELLM_MASTER_KEY` manually via Coolify UI (delete the stale/duplicate rows, set one correct value, restart), if you prefer not to run the Action.
- (C) Do nothing — not viable; real tickets keep silently failing.

**Recommendation:** (A). One follow-up worth a founder note: root cause of *how* the keys diverged isn't established (litellm-prod's master key was likely rotated on a redeploy without updating ops-hub-prod). Worth a hardening item — a monitor that periodically probes the app's real internal path (not the external URL with litellm's own key), since `/health/litellm` structurally can't catch this.

**T-85 E2E gate (Deliverable 4):** still **NOT safe** to inject a test ticket. After the fix, the true green signal is the existing 14 stuck tickets draining to `triaged`/`responded` — re-run `diagnose-stuck-triage-tickets.yml` and watch `state='new'` fall to 0. Only inject a fresh E2E ticket once the real backlog clears; that drain IS the end-to-end proof.

**Seeded-vs-real question — RESOLVED: the stuck tickets are REAL, not seeded.** All 20 tickets carry non-null, distinct FreeScout conversation ids (0 null across `new`+`resolved`). The "4 tickets share a timestamp to the microsecond" observation is the SAME cluster as the diagnostic's "6 rows at `03:36:30.530646`" (the earlier run only sampled 4 of the 6 because it queried 11 specific ids), and is fully explained by the poller inserting a whole poll batch in ONE transaction — Postgres freezes `now()`/`created_at` per transaction, so a 6-ticket poll cycle stamps all 6 identically. `clock_timestamp()` could not collide like this; a single-transaction batch insert is the only explanation, and it's the poller's normal behavior on real tickets. The "seeded/test data" hypothesis below is disproven.

---

**RESOLVED sub-issue — the LITELLM_URL regression described in the original filing below:** authorized by the user, dispatched `fix-ops-hub-prod-litellm-url.yml confirm_container_name=hlik1d96uvkkjzpbxa3azhcv-132650269773` ([run 29039193854](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29039193854), success — 2 stale duplicate `LITELLM_URL` rows deleted, correct value set, restart confirmed healthy). Live `triage-model` completion smoke test already passed pre-fix; `/health`/`/health/env` both clean post-fix. **This part is closed.**

**NOT resolved — the bigger finding, discovered verifying the fix actually helped:** a direct, RLS-scoped read-only query against the real `tickets` table (via `ops_hub_app`, `diagnose-stuck-triage-tickets.yml`, prod project+tenant scope, [run 29040684620](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29040684620)) — no ticket title/body printed, state/age/owner only — found:
- **14 of 20 total prod tickets (70%) are in `state='new'`**, `owner_agent` is `NULL` on all of them (never successfully picked up), and `since_last_update` is **exactly equal to `age`** on every one — meaning **zero successful state transitions have ever occurred** on these rows since they were created. The other 6 tickets are `resolved`; **none** are in `triaged`/`responded` — the pipeline appears to have never successfully completed for anything currently live.
- Ages of the 11 tickets sampled directly range from **02:51:53** (under 3 hours) to **3 days 14:46:02** — i.e. this predates today's T-85 session entirely and is not caused by it. Checked *after* the LITELLM_URL fix (18:27, ~24 min post-fix, well past several 5-minute `sweepNewTickets` cron cycles) — the newest ticket (~3h old) is still stuck, so the URL fix alone did not clear the backlog. Something else is also wrong, or was already wrong independent of the URL issue.
- **Four of the eleven sampled tickets share an identical age down to the microsecond** (`14:50:35.663125`) — real customer emails arriving independently would not do this. Strongly suggests at least some of these rows are seeded/test data (e.g. from an earlier E2E/eval session) rather than genuine FreeScout-sourced customer tickets — worth confirming before treating all 14 as real customer impact.

**Recommendation:** do NOT run T-85's QA E2E ticket injection against production until this is understood — an E2E ticket could land in the same stuck state for a reason unrelated to what's being tested. This needs a Tech Lead investigation into why `classifyTicket`/`triageOneTicket` never advances these specific tickets (or why they exist with identical timestamps at all) — separate from and predating the LITELLM_URL regression. Not filing this as a founder decision; flagging per the customer-impact escalation criterion and because a genuinely stuck backlog of real-looking prod tickets going back 3.5 days deserves visibility.

**Original filing below (superseded in part — the LITELLM_URL fix it requested is done; the deeper issue found afterward is the open item now):**

**UPDATE — this is live, not hypothetical:** a read-only query against real LangFuse Cloud data (`verify-agent-cost-feed.yml`, [run 29022632064](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29022632064)) found **14,800 `ticket-triage` traces in the last 24 hours**, all scoped to prod (`project_id=00…0003`, `tenant_id=00…0030`), in tight bursts roughly every 3 minutes, against a small repeating set of ~8–9 ticket IDs. Cross-checked against the code: a trace is only created on a genuine triage *attempt* against a ticket still in `state='new'` (already-triaged tickets short-circuit before any trace is created). The only thing that repeatedly re-dispatches the same small ticket set every few minutes is the `sweepNewTickets` cron (every 5 min) plus Inngest's automatic retries — the signature you'd expect if every `classifyTicket` call is throwing (stale internal URL → `getaddrinfo EAI_AGAIN`, same failure as T-71) before the ticket can advance out of `'new'`. **This was not confirmed by reading a raw error string or live ticket rows** (deliberately did not use the superuser DB credential available in CI to read real ticket content for this — out of scope, adjacent to the CLAUDE.md service-role-at-runtime constraint) — but the pattern plus the independently-confirmed stale-URL mismatch below make this high-confidence, not a guess.

**Context — what I know, what I checked (all read-only, nothing mutated):**
T-85's `freeze-schema` dispatch and the follow-up restart-verify both restarted litellm-prod. Per CLAUDE.md, litellm-prod's internal Docker container suffix changes on every restart/redeploy of that container — this is the exact same mechanism that caused the T-71 outage on 2026-07-08 (ops-hub-prod's `LITELLM_URL` pointed at a container that no longer existed → `getaddrinfo EAI_AGAIN` → 100% triage failure). Nothing in the T-62/T-85 workflow chain re-syncs `LITELLM_URL` after a litellm-prod restart — same gap, recurred.

Re-ran both read-only diagnostics fresh just now:
- `diagnose-litellm-prod-container.yml` (run [29021890649](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29021890649), success) → litellm-prod's current real container: **`hlik1d96uvkkjzpbxa3azhcv-132650269773`**.
- `diagnose-ops-hub-prod-litellm-url.yml` (run [29021898836](https://github.com/admin-nutshell/ops-hub-00/actions/runs/29021898836)) → ops-hub-prod's configured `LITELLM_URL`: **`http://hlik1d96uvkkjzpbxa3azhcv-025723857913:4000`** — the OLD, pre-restart container. (That run shows red-X in Actions — harmless: the URL's `://` broke the `GITHUB_OUTPUT` write, a formatting bug, not a data problem. The value printed cleanly in the log before that error.) Also found **2 `LITELLM_URL` entries** currently on ops-hub-prod — the known Coolify duplicate-row footgun (last row wins, but a second stale row sitting there is exactly how this class of bug tends to compound).

**Not yet an active incident** — `/health` and `/health/env` both report 200/all-present on ops-hub-prod (env-var *presence* is fine; it's the *value* that's wrong), and the 24h monitoring window apparently didn't see triggering live traffic. But this will fail the next real ticket the same way T-71 did.

**What's needed:** Production Manager already built the exact guarded workflow for this failure mode — `fix-ops-hub-prod-litellm-url.yml` (requires `confirm_container_name` typed explicitly as a safety confirmation, matches it against the `hlik1d96uvkkjzpbxa3azhcv-<digits>` pattern, deletes all existing `LITELLM_URL` rows first — closing the duplicate-row gap too — sets the one correct value, restarts, polls `/health`). Needs:
1. Authorization for Production Manager (or the founder directly) to dispatch it with `confirm_container_name=hlik1d96uvkkjzpbxa3azhcv-132650269773` — re-confirm the container name fresh immediately before running, since it can move again on any subsequent litellm-prod restart.
2. Confirm post-run: `/health` → 200, exactly ONE `LITELLM_URL` row (not two).
3. Reply here once done — QA resumes T-85's live ticket E2E on a known-good pipeline.

**Options:**
- **(A) Authorize now** — dispatch `fix-ops-hub-prod-litellm-url.yml` with the container name above. Fixes the live regression and unblocks T-85 immediately.
- (B) Wait and let QA's E2E ticket injection surface the failure live first, then fix reactively (same as how T-71 was originally found) — not recommended, since the diagnosis is already complete and this just burns a real support-mailbox ticket on a predictable failure.
- (C) Founder runs the fix manually via Coolify UI instead of the GitHub Action, if preferred.

**Recommendation:** (A) — the workflow is pre-built, guarded, and scoped to exactly this failure; re-confirming the container name at dispatch time (rather than trusting this filed value) is the one thing to insist on, since it's the whole point of that input being a manual safety confirmation rather than an automatic read.

**Notify:** QA Manager once done — will immediately resume the T-85 E2E (real ticket → FreeScout → triage → respond → Supabase `state=responded` → LangFuse trace → FreeScout UI reply).

---

## ✅ FQ-68 — Apply T-82's fix via Supabase SQL Editor (service_role) — re-creates a missing policy, Security Lead approved

**Filed:** 2026-07-09 | **Resolved:** 2026-07-09
**Filed by:** PM (Sprint 7, on behalf of Tech Lead/Security Lead)
**Status:** RESOLVED — founder ran the fix via Supabase SQL Editor. Verified: `select polname from pg_policy where polrelid = 'feature_flags'::regclass;` returned both `feature_flags_select` and `feature_flags_write`. T-82 fully closed. QA re-running T-78's live harness to confirm 21/21.
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, same as FQ-67/FQ-61/FQ-62/FQ-45)
**Deadline:** Non-blocking for today's live service — but it's what QA needs to finish signing off Sprint 7's write surface.

**In plain language:** while testing the new dashboard settings feature, QA found that the feature-flags part of it can't actually save anything — not because of a bug in the new code, but because a permission that was *supposed* to be set up back in June never actually took effect on the real database. It's a safe kind of broken (nothing leaked, it just silently refused to save), but it needs a one-line fix to actually work. This has happened once before (the same thing with a different table, fixed back on 2026-07-04) — same root cause, already known.

**What's needed (via Supabase Dashboard → SQL Editor, project `yocoljutbiizdbfraapx`, as the project owner/`service_role`):**
1. Run:
   ```sql
   drop policy if exists feature_flags_write on feature_flags;
   create policy feature_flags_write on feature_flags
     for all to ops_hub_app
     using (project_id = current_project_id())
     with check (project_id = current_project_id());
   ```
2. **Verify** with:
   ```sql
   select polname from pg_policy where polrelid = 'feature_flags'::regclass;
   ```
   — expect two rows back: `feature_flags_select` and `feature_flags_write`.
3. Reply here once done — QA re-runs the live verification harness to confirm all 21 checks pass.

**Recommendation:** Apply as written — Security Lead independently verified this is byte-identical to a policy that already exists in the codebase, just re-applying it since it never actually landed live. Same pattern as every prior migration here.

**Notify:** PM/QA once done.

---

## ✅ FQ-67 — Apply T-72's migration via Supabase SQL Editor (service_role) — Security Lead approved, no changes needed

**Filed:** 2026-07-08 | **Resolved:** 2026-07-08
**Filed by:** PM (Sprint 7, on behalf of Tech Lead/Security Lead)
**Status:** RESOLVED — founder ran the migration SQL via Supabase SQL Editor. Verified: `select relname from pg_class where relname = 'agent_model_routing';` returned one row. `agent_model_routing` is now live on the real database. T-72 fully closed (code merged + reviewed + applied). QA (T-78) can now verify the write paths against the real table.
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, same as every prior migration in this repo, e.g. FQ-61/FQ-62/FQ-45)
**Deadline:** Non-blocking for today's live service (nothing changes for FreeScout/LiteLLM/ticket triage) — but it's the next thing gating Sprint 7's dashboard write-surface build (T-73/T-74/T-75 all read or write through this schema).

**In plain language:** Sprint 7 is adding a settings area to the Ops Dashboard — the ability to pick which AI model each function (Triage/Respond/KB-Learn) uses, edit SLA targets, and toggle feature flags. Before any of that can be built, it needs a small, reviewed database change. That review is done: the Security Lead checked it independently (not just trusted the description) and **approved it with zero changes required** — see PR #312 (`docs/adr/0006-dashboard-settings-write-surface.md` §Security Lead Review) for the full write-up. The migration file itself is already merged into `main`.

**What the migration does (already reviewed, already merged as code — just not run against the live database yet):**
1. Creates one new table, `agent_model_routing`, to hold which model each function uses.
2. Locks down who can change it — only the app's own restricted database role, only for its own project, and specifically **blocks deleting rows** (they can only be edited).
3. Tightens the existing `tenants` table's write permission from "can update anything" down to "can only update the SLA target field" — and deliberately **excludes** the premium-tier billing field, so a dashboard bug could never accidentally change what you're being billed.

Nothing about today's live ticket-triage pipeline changes — this only adds a new, unused-until-built table and narrows a permission that wasn't being used for broad writes anyway.

**What's needed (via Supabase Dashboard → SQL Editor, project `yocoljutbiizdbfraapx`, as the project owner/`service_role`):**
1. Open the SQL Editor and run the full contents of `supabase/migrations/20260708000000_t72_agent_model_routing_sla_grant.sql` (137 lines, forward-only, safe to re-run if you ever need to). Expected output: a mix of `CREATE TABLE`, `CREATE POLICY`, `GRANT`/`REVOKE` confirmations — no errors, since this is a clean first apply.
2. **Verify** with:
   ```sql
   SELECT relname FROM pg_class WHERE relname = 'agent_model_routing';
   ```
   — expect the one name back.
3. Reply here or in `WORK.md` once done — Tech Lead then continues T-73/T-74/T-75 against the live table.

**Recommendation:** Apply as written — this is routine migration application (same pattern as every prior migration in this repo, all reviewed and applied via SQL Editor) and it's already been through a real, documented security review with a clean approval, not a rubber stamp.

**Notify:** PM/Tech Lead once done.

---

## ✅ FQ-66 — Ops Dashboard write surface: per-user session auth, or accept shared-credential audit granularity?

**Filed:** 2026-07-08 | **Resolved:** 2026-07-08
**Filed by:** PM (Sprint 7 scoping, from ADR-0006 T-B2)
**Status:** RESOLVED — founder accepted the PM recommendation (Option B) directly: "not a technical person, recommend and proceed." Decision recorded in `DECISIONS.md`. `audit_log.actor` will record "dashboard" for Sprint 7's write surface; the single-shared-credential Basic Auth gate stays as-is. Upgrade path to per-user session auth (Option A) remains documented and open — revisit when a second dashboard user is added or a SOC-2 audit requires per-human attribution. T-77 closed on this basis; T-74's audit-actor semantics build to match "dashboard" as the actor value.
**Needs:** Decision (security posture + build scope)
**Deadline:** ~July 13, 2026 — **blocking** on the Sprint 7 write-surface build (T-74 / T-77): the write UI/API can't be cut until this is settled. Nothing live is affected today; a one-line reply ("A" or "B") is enough.

**In plain language:** Sprint 6 shipped the read-only Ops Dashboard behind a single shared username/password (`opsadmin`). When we built that, we wrote down that *adding a write area is the moment to revisit login* — because once the dashboard can *change* things (which model each agent uses, SLA targets, feature flags), the change log (`audit_log`) should ideally record *who* made each change. With one shared login, the log can only say "the dashboard did it," not which person. Sprint 7 adds exactly that write area (ADR-0006). This is the one write-surface decision the design flags as genuinely yours (a security-posture + cost call), not a technical default the team should just pick.

**Context:** The dashboard is single-operator today (you). Every settings write is logged to `audit_log` atomically in the same transaction as the change — that plumbing exists regardless of this decision; the only question is whether the *actor* field names a human or "the dashboard." The other open write-surface question ADR-0006 raised — how a dashboard model swap squares with our eval gate — is being handled **team-side** by the Evals Lead (restricting the model picker to a curated set of already-eval-passed models, which keeps the eval gate intact); no action needed from you there.

**Options:**
  A. **Upgrade the write surface to per-user session auth now** — individual actor attribution in the audit log, stronger SOC-2 evidence. Trade-off: real added build scope (session middleware + a login UI) that likely spills into Sprint 8; the write area waits on it.
  B. **Accept the single shared-credential audit granularity for now** — the write area ships this sprint behind the existing gate; `audit_log.actor` records "dashboard." Trade-off: no per-human attribution while you're the sole operator; the documented upgrade path is deferred, not cancelled.

**Recommendation:** **B for Sprint 7.** You are the sole dashboard operator today, it keeps the sprint on scope, and it honors free-tier-first — and the upgrade path (option A) stays open and documented. Move to A when a second dashboard user is added or a SOC-2 audit requires per-human attribution. If you'd rather have individual attribution from day one, pick A and we'll scope session auth as its own task, accepting that the write area slips toward Sprint 8.

**Notify:** PM once you reply — T-77 records the decision in `DECISIONS.md`, and T-74's audit-actor semantics are finalized to match before go-live.

---

## ✅ FQ-65 — Ops Dashboard PRODUCTION: one domain action to complete the secure redo (staging already fixed, see FQ-64 below)

**Filed:** 2026-07-07 | **Resolved:** 2026-07-08
**Filed by:** Production Manager (T-70 Phase 2 prep)
**Status:** RESOLVED — founder attached the domain (`https://` scheme, DNS A record in Hostinger), reviewed/approved PR #281, and authorized deploy. Full account in WORK.md T-70: a real drift bug was caught live (the deploy workflow's own gate-name logic hadn't actually been updated to `dashauth-prod` despite PR #281's header claiming it was — root-caused via independent `curl`, fixed for real in PR #287), then re-verified 401 unauthenticated / 200 authenticated on both `http://` and `https://`. Founder logged into the real production dashboard and confirmed it live. Independently re-confirmed today (2026-07-08): `curl https://ops-dashboard-prod.inatechshell.ca/` → **401**. Heading was never updated with a resolved marker at the time — fixed retroactively, same pattern as FQ-61/FQ-59.
**Needs:** One Coolify UI action + one DNS record (~5 minutes) — do this whenever you're ready to bring the prod dashboard back; not urgent
**Deadline:** Non-blocking — nothing is exposed today. The prod dashboard was deliberately deleted this session (see FQ-64 below) rather than left broken, so there is currently no prod dashboard at all, gated or not.

**Where things stand:** your staging Ops Dashboard is back up and password-protected today (see FQ-64 for the fix). The production dashboard is intentionally NOT live — per your instruction not to rush prod onto the setup that caused the 404 incident, I removed the broken prod app entirely and prepared (but did not run) a hardened version.

**What changed in the hardened version, in plain language:**
1. It will refuse to go live on a temporary `sslip.io` address the way the first attempt did — it now requires a real, secure (`https://`) address before it will even start the app.
2. It never puts the dashboard online before the password gate is in place — today's version created the app, deployed it, and only afterward added the password; the new version won't start the app at all until it can deploy with the password gate already built in.

**The one thing only you can do:** attach a real domain to the (not-yet-existing-until-you-ask-me) prod dashboard app, same as you did for staging (FQ-63):
1. Let me know you're ready — I'll dispatch the workflow once to create the app (stopped, nothing reachable) and hand you its Coolify app name/UUID.
2. In Coolify: open that app → Settings/General → Domains → enter `ops-dashboard-prod.inatechshell.ca` → Save.
3. Add the matching DNS record for `ops-dashboard-prod.inatechshell.ca` (same pattern as the other `*.inatechshell.ca` records already in place).
4. Reply here — I'll re-dispatch the same workflow, which will detect the real domain and go straight through deploy → password gate → verification, and report back the actual 401/200 results before calling it done.

**Also needs your review (not a chat approval — a real PR review):** the code for this hardened version lives in **PR #281** (unmerged, not self-merged — prod-infra change). It folds together two things: the fix for today's incident (already live-tested and confirmed working on staging) and the new domain-required logic above. I'd like your sign-off on that PR before it merges and before the redeploy happens.

**Recommendation:** no rush — do this whenever convenient. The platform is healthy, staging works, and nothing is degraded by prod staying offline a while longer.

**Notify:** Production Manager once the domain + DNS are in place (or once you've reviewed/approved PR #281) — I'll take it from there.

---

## ✅ FQ-64 — Ops Dashboard (prod AND staging) both stuck at 404 — RESOLVED 2026-07-07 (staging), root cause CONFIRMED LIVE

**Filed:** 2026-07-07 | **Staging resolved:** 2026-07-07
**Filed by:** Production Manager (T-70 incident response)
**Status:** Staging dashboard restored and verified (401 unauthenticated, 200 authenticated with real content). Root cause confirmed live, not just theorized — see the Phase 1 update below. Prod dashboard was deleted (not repaired) as part of this fix, on the founder's explicit authorization to "redo prod the secure way as a clean follow-up" — see **FQ-65 above** for what's left before prod comes back.

**✅ Phase 1 resolution (2026-07-07, same day as filing):** the broken `ops-hub-dashboard-prod` app (UUID `om6qsemx9upajj9yemid1ti3` — the one carrying the colliding `dashauth` Traefik middleware definition) was deleted via the Coolify API. Staging (`ops-hub-dashboard-staging`, UUID `r14c3p7jzwo4wxyprd4yxyev`) was then stopped and restarted so Traefik would re-read its labels without the collision. Result, verified twice (by the automation and independently by hand): unauthenticated request → **401**; authenticated request → **200**, real themed dashboard content (44,575 bytes, theme-v2 marker present, zero "failed to load" cards). Full run: [28890818621](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28890818621). **This is the load-bearing confirmation: removing the one thing that changed (the duplicate `dashauth` definition) immediately fixed the one thing that broke (staging's gate) — the middleware-name-collision theory is now proven, not just well-supported.** Full incident record: `docs/deploys/2026-07-07-t70-dashboard-prod-404-incident.md` (Phase 1 update section).

**⚠️ CORRECTION (2026-07-07, same day, before any founder action taken):** the original write-up below asked you to authorize restarting the shared Traefik proxy (option A). **That was wrong — do not act on it.** A second look found a better-supported, much lower-risk explanation and fix, which is what actually resolved this (see Phase 1 resolution above). Original evidence preserved below for the record; read the correction first.

**Corrected diagnosis:** both dashboard apps define a Traefik authentication rule with the exact same internal name (`dashauth`) but different passwords (staging's vs. prod's, by design — separate credentials per environment). Traefik can only track one rule per name; when it sees two different, conflicting definitions under the same name, it discards the rule entirely rather than guessing which one is right — and every page that depended on that rule (both dashboards, and only the dashboards — nothing else uses this name) goes offline. This fits the evidence better than the original "proxy is stuck" theory: if the proxy itself were broken, EVERY app on the server would be affected, not just the two that happen to share this one name. It also explains the timing exactly — staging broke the moment the prod deploy created the second, conflicting definition.

~~**Important calibration — this is my best-supported theory, not yet proven live.** I was blocked (correctly, by this session's own safety rules) from testing the rename against the real prod app myself, so I have not watched it fix anything with my own eyes.~~ **Superseded — see the Phase 1 resolution at the top of this entry: the theory WAS tested live (by deleting the colliding app rather than renaming it) and confirmed. No further founder action is needed for the collision fix itself.** The two options originally listed here (manual relabel, or merge PR #281) are moot for staging's restoration, which is already done. PR #281 is still open and still needs your review, but now for **Phase 2** (the secure prod redo) — see **FQ-65 above** for that ask, which also carries PR #281's own updated content forward.

**Original filing below (evidence trail, recommendation superseded by the correction above):**

**Deadline:** Non-blocking for customer traffic (see "current safe state" below) — the dashboard itself is not usable until this is resolved, but nothing is exposed and no other service is degraded

**In plain language:** the production Ops Dashboard deploy you authorized this session ran, built correctly, and applied the password gate correctly — but the dashboard is currently unreachable (a plain 404 "not found", not a working page, gated or otherwise). While investigating, the SAME 404 turned up on the staging dashboard too, even though it was confirmed working (password-gated, live) earlier today. Every other product on this server (ops-hub-staging, FreeScout, LiteLLM) is completely unaffected and working normally. **Nothing is leaking — the dashboard is simply offline, not exposed.** The fix requires briefly restarting the shared traffic router that sits in front of all our Coolify-hosted apps, which is outside what I'll do without your sign-off, since a restart briefly touches every product on this server, not just the dashboard.

**What happened (evidence, not guesswork):**
1. The T-70 workflow ([run 28875816358](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28875816358)) built the prod dashboard image, created the Coolify app (`ops-hub-dashboard-prod`, UUID `om6qsemx9upajj9yemid1ti3`), deployed it (Coolify confirmed the deployment `finished`), applied the Basic Auth gate to its Traefik labels (confirmed correctly merged — `middlewares=gzip,dashauth`, digest present, rule/service/entryPoints intact), then blocking-verified with 10 retries. All 10 got HTTP 404, so the workflow correctly refused to declare it live (it needed 401).
2. QA independently confirmed the URL returns a 404 with an 18-byte body — zero dashboard content, zero data exposure.
3. I diagnosed rather than guessed: the container is healthy (`restart_count: 0`, clean `Next.js ... Ready in 0ms` boot log, no crash loop) and its Traefik labels are well-formed and correctly gated. Ruled out the two most likely causes (crash-looping container, a broken label rewrite).
4. I then found the staging dashboard (`ops-hub-dashboard-staging`, previously verified 401-gated and working the same day, per T-69/DECISIONS.md) had ALSO started returning the identical bare 404 — with zero staging-side actions taken by anyone. Every real-domain app on the same server/IP (`ops-hub-staging.inatechshell.ca`, `freescout-staging.inatechshell.ca`, `litellm-staging.inatechshell.ca`, `coolify.inatechshell.ca` itself) responded normally throughout.
5. I tried the two safest, most in-scope, already-precedented fixes, in order:
   - Restarted the staging dashboard container via the existing `restart-dashboard-staging.yml` (stop+start) — container came back healthy, still 404.
   - Ran a full, genuine redeploy of staging via the existing `provision-ops-dashboard-staging.yml` (Coolify confirmed deployment `finished`, a real container recreation, not just a restart) — still 404.
6. Conclusion: this isn't the dashboard app, its image, its labels, or its container. Both dashboard apps are healthy and correctly configured, yet the shared Traefik proxy on this server isn't routing to either of them, while it continues routing every "real domain" app fine. The apps that broke are exactly the ones discovered dynamically via Docker container labels (auto-assigned `*.sslip.io` preview addresses); apps with a real, Coolify-managed custom domain are unaffected. The server's own Coolify record showed `unreachable_count: 5` around the time of the T-70 deploy, consistent with a brief host hiccup that could have interrupted Traefik's live container-label watch without Traefik ever restarting to pick it back up.

**Options:**
- **(A) — Recommended.** Restart the `coolify-proxy` (Traefik) container via the Coolify UI or API (Server → coolify-proxy → Restart). This is a few seconds of interruption for every app on this server (ops-hub-prod, ops-hub-staging, FreeScout, LiteLLM, the dashboard) while Traefik comes back up and re-reads all current container labels — the standard fix for a stuck docker-label provider. I did not do this myself: it's outside "prod dashboard app only," and briefly affects every customer-facing product on this server, which needs your sign-off per our own guardrails.
- **B.** Wait/monitor — if this is a transient host issue, it may self-resolve. I have no evidence it's self-healing (staging has been broken since ~14:55 and a real redeploy at 15:25 didn't restore it), so I don't recommend waiting.
- **C.** Ask Hostinger/infra support if there's a known host-level event in this window (the `unreachable_count: 5` datapoint) before restarting, in case there's a deeper cause. Slower, but rules out a recurring problem.

**Recommendation (SUPERSEDED — see correction at the top of this entry):** ~~(A) — restart `coolify-proxy`~~. Kept for the record only; do not act on this. The corrected recommendation is the label rename (option 1 or 2 above), which is narrower, lower-risk, and doesn't touch any other product on the server.

**Current safe state (unchanged since the original T-70 failure):** both dashboard apps return 404 to unauthenticated requests — no dashboard content, no data exposure, confirmed by both QA and me. No other production service is affected. I made no changes to `ops-hub-prod` (the backend), no prod data was touched, and I did not attempt the proxy restart myself.

**Notify:** Production Manager, on completion — I'll run the verification and update `WORK.md`/`DECISIONS.md`.

---

## FQ-63 — Ops Dashboard staging is live and gated; one action needed for a real (TLS) domain

**Filed:** 2026-07-06
**Filed by:** Production Manager (T-68)
**Needs:** One Coolify UI action (~2 minutes)
**Deadline:** Non-blocking — the dashboard already works and is password-protected today. This is only about upgrading from a plain-HTTP preview link to a proper `https://` address.

**In plain language:** the Ops Dashboard is built, deployed, working, and locked behind a username/password on our staging server. Right now you can reach it at:

```
http://r14c3p7jzwo4wxyprd4yxyev.187.124.76.235.sslip.io/
```

That's a temporary, auto-generated address (no padlock/HTTPS) — fine for checking that it works, not what we want to actually use day to day. To give it a normal, secure address:

1. Log into Coolify: `https://coolify.inatechshell.ca`
2. Go to the `ops-hub-staging` project → find the app named **`ops-hub-dashboard-staging`**
3. Open its Settings/General tab → find the **Domains** field
4. Enter: `ops-dashboard-staging.inatechshell.ca` (matches the naming of our other staging tools, e.g. `ops-hub-staging.inatechshell.ca`)
5. Click **Save**, then click **Deploy** (not just Restart)
6. Reply here (or in WORK.md) once done — Production Manager will then re-run the already-prepared `apply-dashboard-basic-auth.yml` workflow to re-apply the password gate to the new address and confirm it with the same 401/200 checks already passing on the temporary address today.

**The password is already handled — nothing to do there.** The credential Tech Lead generated back on 2026-07-04 (FQ-59) was still sitting in a local scratchpad file this session, so it was reused as-is (never regenerated, never shown in chat or committed anywhere). It has now also been stored as two GitHub repo secrets so future automation can reuse it without ever displaying it again. **If you haven't already saved the username + password from that original FQ-59 note into your password manager, please do that now** — that's the one thing only you can do; everything else about this credential is handled.

**Not done in this task (separate follow-up, on purpose):** the production dashboard (`ops-hub-prod`) was NOT created or touched — this task was scoped to staging only, per the original plan's own recommendation to validate the deploy shape on staging first. Standing up prod the same way is a small follow-up task once you're happy with staging.

**Recommendation:** do this whenever convenient — it's a cosmetic/production-hygiene upgrade (real domain + normal TLS padlock), not a functional fix. The dashboard is already secure (password-gated) and fully working on the temporary address.

---

## ✅ FQ-62 — T-66: apply audit_log platform-select RLS migration via Supabase SQL Editor (service_role)

**Filed:** 2026-07-06 | **Closed:** 2026-07-06
**Filed by:** Security Lead (T-66)
**Status:** RESOLVED — founder action complete

**Resolution:** Founder applied the migration via Supabase SQL Editor as `service_role`. Confirmed live: `SELECT polname FROM pg_policy WHERE polname='audit_log_select_platform'` returns 1 row. QA re-ran `t60-dashboard-rls-verify.yml` on main → [run 28827786102](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28827786102), **21/21 pass**, Check 2 ("FIXED T-66") green — the platform-incidents feed is now readable, fail-closed and no-cross-tenant properties both hold. Code side (widened policy + corrected comment + updated test) was already merged in PR #265. T-66 marked done in WORK.md.

**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, T-11 runbook, ADR-0005 risk #2: "SQL Editor access is restricted to the founder; agents never hold service_role")
**Deadline:** Non-blocking for the dashboard MVP go-live (the platform-incidents feed has no writer yet, so nothing user-visible changes today) — but required before T-60's Check 2 can go green and T-66 can close. Convenient to run in the same SQL Editor sitting as FQ-61.

**Context:** T-60's live verification (Check 2, DECISIONS.md 2026-07-06) proved that platform-incident
rows in `audit_log` (`tenant_id IS NULL`) are unreadable through RLS: the original `audit_log_select`
policy is `USING (tenant_id = current_tenant_id())`, and `NULL = current_tenant_id()` is never true, so
`getPlatformIncidents` (the dashboard's platform-incidents feed) was permanently empty — dead code in
the deny direction, **not a leak**. T-66's fix is a new migration,
`supabase/migrations/20260706000000_t66_widen_audit_log_select_platform.sql`, which adds a second,
`ops_hub_app`-only permissive SELECT policy (`audit_log_select_platform`) exposing NULL-tenant rows only
when the caller's project GUC matches the row's `project_id`. The original `audit_log_select` policy is
untouched; the `authenticated` role gains nothing (split-policy decision + fail-closed derivation
recorded in DECISIONS.md 2026-07-06 T-66 — that entry is the security review for this widening).

**Independent of FQ-61/T-67 — no ordering dependency:** `audit_log` predates T-58's tables (it ships in
the initial schema), so this migration applies cleanly whether or not FQ-61's T-58 migration has landed.
Run them in either order, or in the same sitting.

**What's needed (founder, via Supabase Dashboard → SQL Editor, as the project owner/`service_role`):**
1. Open the SQL Editor for project `yocoljutbiizdbfraapx` and run the full contents of
   `supabase/migrations/20260706000000_t66_widen_audit_log_select_platform.sql` (forward-only,
   idempotent — `drop policy if exists` then `create policy`; no table/data changes, no destructive
   statements). Expected output: `DROP POLICY` (no-op notice on first apply) then `CREATE POLICY`.
2. **Verify** with: `SELECT polname FROM pg_policy WHERE polrelid = 'audit_log'::regclass;`
   — expect `audit_log_select_platform` in the list (alongside the existing `audit_log_insert` and
   `audit_log_select`).
3. Reply here or in WORK.md once done — QA Manager then re-dispatches `t60-dashboard-rls-verify.yml`
   to confirm Check 2 goes green (the harness now asserts the NULL-tenant row IS visible with the
   correct project scope and hidden without one).

**Single-project note:** per ADR-0005 (`docs/adr/0005-prod-db-same-project.md`), staging and prod are
the same physical Supabase project (`yocoljutbiizdbfraapx`) — **one apply covers both environments.**

**Recommendation:** Apply as written — the policy widening was deliberately scoped to the narrowest
read path that fixes the bug (ops_hub_app only, project-matched, NULL-tenant rows only) and security
review is already recorded; this is routine migration application, same pattern as every prior
migration in this repo.

---

## ✅ FQ-61 — T-67: apply T-58 migration via Supabase SQL Editor (service_role) — blocks Sprint 6 dashboard MVP

**Filed:** 2026-07-06 | **Resolved:** 2026-07-06
**Filed by:** Production Manager (T-67, escalating a live blocker QA proved in T-60)
**Status:** RESOLVED — founder applied the migration. Re-verified live via `t60-dashboard-rls-verify.yml` (21/21 pass, up from 14/21). T-58/T-59/T-60/T-67 all closed. Heading was never updated with a resolved marker at the time — fixed retroactively 2026-07-08 while auditing queue accuracy, no new action needed.
**Needs:** Authorization + a founder-run action (agents never hold `service_role` — CLAUDE.md non-negotiable #3, T-11 runbook, ADR-0005 risk #2: "SQL Editor access is restricted to the founder; agents never hold service_role")
**Deadline:** Blocking — this is the Sprint 6 dashboard-MVP critical path (T-58 → T-59 → T-60). QA cannot close T-60 or clear T-59 until this lands.

**Context:** QA's live T-60 verification ([run 28807345913](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28807345913)) proved via `pg_class` (world-readable) that the T-58 migration —
`supabase/migrations/20260704010000_t58_agent_cost_eval_health.sql` — was **never applied** to the live
Supabase project (`yocoljutbiizdbfraapx`). `agent_cost_daily`, `agent_cost_events`, and `eval_gate_runs`
are **absent** while `tenants`/`projects`/`tickets`/`audit_log` are present. This is exactly the
"founder/ops action still required" step T-58's own WORK.md row flagged on 2026-07-04 and it was never
actioned. Consequence: the agent-cost and eval-health dashboard tiles (2 of the 4 charter daily pillars)
render "failed to load" against the live DB — graceful (each tile has its own try/catch, page still
HTTP 200), **not a crash and not an RLS defect** (RLS/tenant-scoping was separately verified clean, no
cross-tenant leak, by the same T-60 run).

I (Production Manager) checked whether I could apply this myself before filing: no Coolify/Supabase MCP
tool exists in my toolset, no `service_role`/`SUPABASE_DB_URL`-equivalent credential is present in my
local environment, and the one CI-held Supabase credential this repo does use
(`SUPABASE_STAGING_DB_URL`, a GitHub Actions secret) is — by this team's own established convention —
reserved for read-only checks (`precheck-litellm-db-wall.yml`, `verify-litellm-db-isolation.yml`), never
DDL. The clearest precedent: `restart-freescout-regrant.yml` deliberately *prints* a GRANT command "for
founder" rather than executing it, even though that workflow already holds an equivalent owner-level
connection. Writing a new CI workflow to auto-apply this migration would defeat a mitigation ADR-0005
names explicitly, so I did not build one.

**What's needed (founder, via Supabase Dashboard → SQL Editor, as the project owner/`service_role`):**
1. Open the SQL Editor for project `yocoljutbiizdbfraapx` and run the full contents of
   `supabase/migrations/20260704010000_t58_agent_cost_eval_health.sql` (forward-only, idempotent-safe —
   creates 2 tables, 1 view, RLS policies, and grants; no destructive statements). Expected output:
   `CREATE TABLE` (x2), `CREATE INDEX` (x4), `CREATE VIEW`, `ALTER TABLE`/`CREATE POLICY` (RLS), `GRANT` —
   no errors, since QA already confirmed all three objects are absent (clean first apply, not a re-run).
2. **Verify** with: `SELECT relname FROM pg_class WHERE relname IN ('agent_cost_events','agent_cost_daily','eval_gate_runs');`
   — expect all 3 names back.
3. Reply here or in WORK.md once done — Production Manager will then dispatch the already-prepared
   `provision-agent-cost-sync-env.yml` workflow (sets `AGENT_COST_SYNC_ENABLED=true` on ops-hub-prod,
   UUID `sbke5gqru1n54rj7gssgca2y`, and redeploys) and hand back to QA Manager to re-run
   `t60-dashboard-rls-verify.yml` so Checks 1 & 3 go green and T-60/T-59 can close.

**Single-project note (documentary, not live-probed — no DSN was read or printed to avoid any secret
exposure):** ADR-0005 (`docs/adr/0005-prod-db-same-project.md`) records that staging and prod are the
**same physical Supabase project** (`yocoljutbiizdbfraapx`), with environment separation done entirely
via RLS-scoped rows (`tts`/`tts-prod` projects, distinct tenant UUIDs), not a separate schema or project.
A schema-level migration like this one is therefore project-wide — **one apply covers both environments.**
This is consistent with T-47's prod seed migration having applied cleanly against the same project with
no separate "prod migration" step.

**Recommendation:** Apply as written — no design decision needed, this is routine migration application
(same pattern as every prior migration in this repo, all "applied via SQL Editor, not tracked by Supabase
CLI" per CLAUDE.md). Recommend prioritizing given it's the sole blocker on the Sprint 6 dashboard-MVP
anchor.

---

## 🟡 FQ-60 — T-59 Ops Dashboard needs a Coolify deploy target (doesn't exist yet) — STAGING DONE, see FQ-63 for what's left

**Update 2026-07-06 (Production Manager, T-68):** staging deploy target created and working —
`ops-hub-dashboard-staging` (UUID `r14c3p7jzwo4wxyprd4yxyev`), all env vars set, a real 502 bug
found and fixed along the way (Next.js standalone bind-address, see WORK.md T-68 / DECISIONS.md
for the full writeup). **Only remaining action is FQ-63** (attach a real domain) — everything
else below is done. Prod (`ops-hub-prod`) deliberately not touched; this was staging-only per
this item's own recommendation.

## FQ-60 — T-59 Ops Dashboard needs a Coolify deploy target (doesn't exist yet)

**Filed:** 2026-07-05
**Filed by:** Frontend Engineer (T-59)
**Needs:** Authorization + infrastructure setup (Production Manager executes; founder authorizes + places one env value)
**Deadline:** Non-blocking for code review — the app is built, tested, and verified locally (see DECISIONS.md 2026-07-05 T-59). This is what's left to make it reachable.

**Context:** T-59 built the read-only Ops Dashboard as a new Next.js app at `web/` in this repo (new
pnpm workspace member). It runs, builds, and has been verified against a local Postgres seeded with
the real schema (see DECISIONS.md entry for exact steps and numbers). It does **not** have anywhere
to run in Coolify yet — unlike ops-hub's backend (`ops-hub-staging`/`ops-hub-prod`, already
provisioned), this is a genuinely new deploy target.

**What's needed:**
1. **A new Coolify application** (staging first; prod once T-60's RLS audit signs off) built from
   `web/Dockerfile` — note the build context is the **repo root**, not `web/`, because the app
   imports `src/metrics/*` directly (`docker build -f web/Dockerfile .`). Production Manager owns
   this per the team's infra-config handoff protocol.
2. **`OPS_HUB_APP_LOGIN_URL`** set on that new app — the same `ops_hub_app_login` DSN pattern
   already used by `ops-hub-staging`/`ops-hub-prod` (see `docs/engineering/t12-vault-runbook.md`).
   Not a new credential to generate — reuse the existing one for whichever environment (staging/prod)
   this points at.
3. **`POLLING_PROJECT_ID` / `POLLING_TENANT_ID`** — same values already set on the corresponding
   ops-hub environment (staging: `00000000-0000-0000-0000-000000000001` / `...0010`; prod:
   `00000000-0000-0000-0000-000000000003` / `...0030`), so the dashboard reads the same
   project/tenant scope as the backend it's reporting on.
4. **Optional health-check overrides** — `OPS_HUB_HEALTH_URL`, `LITELLM_HEALTH_URL`,
   `FREESCOUT_HEALTH_URL` — default to the staging FQDNs from CLAUDE.md if unset, so only prod
   needs these explicitly set.
5. **FQ-59's Traefik Basic Auth label + 401 verification** — this is FQ-59's existing content, not
   duplicated here. Once this app has a domain, FQ-59's Action 2/3 apply to it directly.

**Recommendation:** Stand up staging first, confirm T-60's RLS/tenant-scoping audit passes against
it, then promote to prod the same way ops-hub's backend was promoted (T-49). No new decision
needed — this is routine provisioning of an already-decided pattern, surfaced here only because the
deploy target itself doesn't exist yet.

---

## ✅ FQ-59 — T-57 Ops Dashboard auth: applied and verified live on staging (2026-07-06)

**Update 2026-07-06 (Production Manager, T-68):** Action 2 and Action 3 (the blocking
401/200 verification) are both done, on staging, against the app's current (temporary,
plain-HTTP) address. `curl` unauthenticated → **401**; `curl -u opsadmin:<password>` → **200**,
real dashboard content confirmed (no "failed to load" cards). The scratchpad credential file
was still present this session, so it was reused as-is — nothing was regenerated. One real,
worth-recording finding: the `$`-doubled ("`$$`") label variant this item's own note says to
use for "a raw Traefik label" did NOT work when applied via the Coolify API's `custom_labels`
field (401 even with the right password) — the plain, unescaped `user:hash` line is what
actually works through that specific path; recorded in DECISIONS.md 2026-07-06 T-68 so a future
session doesn't reapply the escaped form here. **Only remaining step:** once FQ-63's domain is
attached, re-run `apply-dashboard-basic-auth.yml` to re-gate the new address (already prepared,
idempotent, no founder action needed beyond FQ-63 itself).

## ✅ FQ-59 — T-57 Ops Dashboard auth: apply Traefik basic-auth label at T-59 deploy (credential ready in scratchpad)

**Filed:** 2026-07-04 | **Resolved:** 2026-07-06
**Filed by:** Tech Lead (T-57)
**Status:** RESOLVED — Basic Auth label applied and 401-verified on staging (T-59/T-69), then production (T-70, 2026-07-08, founder-confirmed live login). Heading was never updated with a resolved marker at the time — fixed retroactively 2026-07-08 while auditing queue accuracy, no new action needed.
**Needs:** Authorization + place one secret; Production Manager applies the Traefik label
**Deadline:** Non-blocking now — but is a HARD GATE on T-59: the dashboard must not be pointed at a public FQDN until this is applied and verified.

**Decision recorded:** DECISIONS.md 2026-07-04 (T-57). The Ops Dashboard (T-59) is gated by
Traefik/Coolify **HTTP Basic Auth** on its FQDN over the existing Let's Encrypt TLS — chosen over
app-level session auth because the dashboard is greenfield Next.js that doesn't exist yet, the
ops-hub runtime has no web-auth pattern to be consistent with, and basic auth is a reverse-proxy
boundary that needs zero app code and is trivially swapped for session auth when the Sprint-7
write area lands. Full threat model in DECISIONS.md.

**The credential is already generated** and waiting in a LOCAL scratchpad file (never committed,
never in chat, this FQ contains no secret material):

```
C:\Users\SACIT~1\AppData\Local\Temp\claude\C--projects-ops-hub\d4df90e8-0d7d-4dcc-9fc6-de5763b44131\scratchpad\T-57-dashboard-basic-auth-CREDENTIAL.txt
```

That file contains: the browser username+password, the `user:hash` line for Coolify (apr1/MD5,
Traefik-compatible), a `$`->`$$` label-escaped variant, and a regeneration command.

### Action 1 — DO THIS NOW (survives temp-file loss; T-59 deploy is ~a week out)
Open the scratchpad file above and copy **both** the plaintext username+password (for browser
login) **and** the `user:hash` line (for Coolify) into your password manager. The scratchpad is
session-temporary and will very likely be gone by the T-59 deploy. If it's already lost, regenerate
with the command in the file (`openssl passwd -apr1`) — any fresh value is fine, it just has to
match between browser and Coolify.

### Action 2 — AT T-59 DEPLOY TIME (Production Manager applies; founder places the secret)
When the dashboard Coolify app/route is created (T-59), before pointing it at a public FQDN:
- If Coolify exposes a dedicated **Basic Authentication** field for the app: paste the
  `user:hash` line AS-IS (no `$` doubling).
- If applying via a raw **Traefik label**: use the `$`->`$$`-escaped variant from the scratchpad
  file (docker-compose label escaping). Standard label shape:
  `traefik.http.middlewares.dashauth.basicauth.users=<user:hash>` +
  `traefik.http.routers.<router>.middlewares=dashauth` — exact router name per the T-59 app config;
  Production Manager confirms against the live Coolify/Traefik version, then tests (Action 3).

### Action 3 — BLOCKING VERIFICATION before go-live (do not skip — this is T-57's entire purpose)
From any machine, confirm the dashboard FQDN rejects unauthenticated requests:
```
curl -sS -o /dev/null -w '%{http_code}\n' https://<dashboard-fqdn>/
```
Expected: **401**. Then confirm the credential works (200 with `-u opsadmin:<password>`).
A 200 without credentials, or a login that never accepts the password, means the label/hash is
mis-applied (commonly the `$`->`$$` escaping) — fix before exposing the domain.

**Notify:** Tech Lead + Production Manager once the 401 check passes — T-59 is then cleared to go
live behind the gate. Security Lead already has substantive involvement scheduled at T-60
(RLS/tenant-scoping), so no separate sign-off is needed to land this perimeter gate.

---

## ✅ FQ-58 — T-61 Phase 1 blocked: litellm_db_user password no longer authenticates

**Filed:** 2026-07-04 | **Closed:** 2026-07-08
**Filed by:** Production Manager (T-61, Phase 1 canary pre-check)
**Status:** RESOLVED — founder ran `ALTER ROLE litellm_db_user WITH PASSWORD ...` in Supabase SQL Editor, `LITELLM_DB_USER_URL` GitHub secret updated to match. Precheck re-ran clean, full T-61 Phase 1 canary completed successfully (see WORK.md T-61) — `litellm-staging` now genuinely connects as the restricted `litellm_db_user` role, ADR-0004 wall restored on staging. Root cause of the original auth failure was never conclusively identified (unlogged password drift, same class of issue flagged as a risk in the deploy plan) but is moot now that the credential is confirmed working and current.

**Needs:** Information / Authorization
**Deadline:** Non-blocking overall (no live change was made; `DISABLE_SCHEMA_UPDATE=true` still holds the latent risk documented in FQ-57) — but blocks T-61 Phase 1 from proceeding.

**What happened:** Per the pre-deploy checklist in `docs/deploys/2026-07-04-litellm-db-wall-restoration.md` ("Canary rollout plan," Phase 1, step 1), a new read-only precheck workflow (`precheck-litellm-db-wall.yml`, added this session via PR #255/#256) was dispatched before touching anything live. It attempts `SELECT current_user;` against Supabase as `litellm_db_user`, using the `LITELLM_DB_USER_URL` GitHub secret (set 2026-06-26/27 per ADR-0004/FQ-45, unchanged since).

Result: **`FATAL: password authentication failed for user "litellm_db_user"`** (run [28722827915](https://github.com/admin-nutshell/ops-hub-00/actions/runs/28722827915), 2026-07-04 23:18 UTC). This is a genuine auth rejection, not the `ENOIDENTIFIER`/"tenant not found" error that would indicate a DSN-format problem (missing project-ref suffix) — the connection reached the password-check stage cleanly. The most likely explanation is the same class of drift flagged as a risk in the deploy plan itself: the role's password may have been changed on the Supabase side (directly or via some other rotation event) without the `LITELLM_DB_USER_URL` GitHub secret being updated to match. DECISIONS.md's only confirmed rotation on record (2026-06-29, FQ-49) was the `postgres` superuser role's password, not `litellm_db_user`'s — so if that's the cause, it was an unlogged side effect, not the documented event. Root mechanism is not confirmed; only the symptom (auth rejected) is.

**No live change was attempted or made.** The workflow is read-only by design (GET/psql-SELECT only) and is written to halt immediately on this exact failure rather than guess or retry with a different value. All later steps in the same job (baseline row-count capture, rollback-DSN stash) did not run — confirmed directly in the run log, they're gated behind the auth check succeeding.

**What's needed (pick one):**
- **Option A (if the password was intentionally rotated or is otherwise unknown/lost):** Run, as superuser in Supabase SQL Editor — same shape as the original `docs/engineering/litellm-db-isolation-runbook.md` Step 1 —
  ```sql
  ALTER ROLE litellm_db_user WITH PASSWORD '<new password>';
  ```
  Then update the GitHub secret `LITELLM_DB_USER_URL` with the matching new password (host/port/db/schema unchanged — only the password segment differs). Do NOT paste the password in chat or commit it anywhere; set it directly via `gh secret set LITELLM_DB_USER_URL` or the GitHub UI.
- **Option B (if the password was never actually changed and the secret is simply stale/wrong from setup):** Confirm the value that was originally set on 2026-06-26/27 and re-enter it into the `LITELLM_DB_USER_URL` secret if it differs from what's stored today.
- Either way, notify Production Manager once done — the precheck workflow will be re-run before anything further proceeds (per the deploy plan, nothing progresses to `fix-litellm-schema-isolation.yml apply-wall` until this passes clean).

**Impact if left open:** None beyond what FQ-57 already describes — `DISABLE_SCHEMA_UPDATE=true` is confirmed still set on both `litellm-staging` and `litellm-prod`, so the latent (not active) DB-isolation-wall gap continues exactly as before. This FQ only blocks the *restoration* work (T-61), not current service health.

**Notify:** Production Manager "FQ-58 done" — Phase 1 precheck will be re-dispatched immediately.

---

## ✅ FQ-53 — LiteLLM /model/new broken: fix Prisma migration before T-48

**Filed:** 2026-07-01 | **Closed:** 2026-07-04
**Filed by:** Tech Lead (T-46)
**Status:** RESOLVED (functionally) — root cause corrected below; **do not read this as "Prisma bug fixed"**

**What was actually wrong (confirmed via `diagnose-litellm-prisma.yml`, 2026-07-04):** the 500 was real, but by the time this was investigated the write path was already working again — `POST /model/new` returned HTTP 200 live, and a restart-then-recheck (`restart-verify-litellm-staging.yml`) confirmed all 3 aliases (`triage-model`, `fallback-model`, `meta/llama-3.3-70b-instruct`) persist across a restart, plus a live `triage-model` completion succeeded.

**The uncomfortable part — root cause identified precisely, and it was already sitting in DECISIONS.md:** the 2026-06-29 FQ-49 fix (LiteLLM crash-loop, `ENOIDENTIFIER`) deleted the duplicate `DATABASE_URL` rows and "re-entered `DATABASE_URL` once via Coolify UI with `postgres.yocoljutbiizdbfraapx` as username" — two days after FQ-45 had put `litellm_db_user.yocoljutbiizdbfraapx` in place. That FQ-49 fix was correct for the crash-loop (the missing Supavisor project-ref suffix) but used the **wrong username** — the plain superuser instead of the restricted role — which silently undid the ADR-0004 wall. It was never flagged at the time because the operator was focused on the crash-loop, not on preserving role identity, and the DECISIONS.md entry for FQ-49 doesn't call out the role downgrade. `DISABLE_SCHEMA_UPDATE=true` (from FQ-45's freeze step) then blocked Prisma from syncing whatever schema change the later `ANTHROPIC_API_KEY` addition needed — that's what actually produced the FQ-53 500, independent of which role was connecting. Whatever cleared that 500 between filing (07-01) and today (07-04) is not in DECISIONS.md either — but the role has been `postgres`, undetected, since 2026-06-29, through T-47/48/49/50/51/52/M6/T-56. **`litellm-prod` (T-48) has the identical posture** — also connects as `postgres`, also un-walled, confirmed via `verify-litellm-db-isolation.yml`. Current risk is latent, not active: `DISABLE_SCHEMA_UPDATE=true` is confirmed set on both, so no Prisma DDL is running today. Public tables confirmed intact via indirect evidence (T-51 e2e ticket + T-56 kb_articles write both succeeded today, 2026-07-04).

**Follow-up filed as FQ-57** (below) for the actual wall restoration, staged as a proper canary rollout per `docs/deploys/2026-07-04-litellm-db-wall-restoration.md` — not fixed live in this session on purpose (flipping `DISABLE_SCHEMA_UPDATE` back on to test the restricted role could take a live service down; prod additionally needs a **new**, prod-only restricted role that doesn't exist yet).

**Notify:** Tech Lead — T-48 is unaffected functionally (prod's aliases work today), but is now known to share the same isolation gap as staging.

---

## 🟡 FQ-57 — Restore LiteLLM DB isolation wall on staging + prod (new prod-only role needed)

**Filed:** 2026-07-04
**Filed by:** Production Manager
**Status:** Founder actions complete (2026-07-08) — role/schema created, secret set. Staging (T-61) fully done. Production (T-62): `apply-wall` done and verified, `freeze-schema` deliberately held for a 24-hour monitoring window per the plan — not fully closed yet. See WORK.md T-62 for the full account, including two real issues found and fixed live (model aliases lost on schema switch — production triage briefly degraded, now restored; a nonexistent `LITELLM_MASTER_KEY_PROD` secret two workflows incorrectly depended on, now fetched from Coolify instead).
**Needs:** One-time superuser SQL (new prod-only restricted role) + authorization for a staged canary rollout
**Deadline:** Non-blocking (latent risk, `DISABLE_SCHEMA_UPDATE=true` holds today) — but should not sit for long; the whole point of ADR-0004 was to make this impossible-by-construction, and right now it is possible again on both environments.

See `docs/deploys/2026-07-04-litellm-db-wall-restoration.md` for the full plan. Short version:

1. **Founder action (superuser SQL, ~5 min, same shape as the original `docs/engineering/litellm-db-isolation-runbook.md` Step 1):** create a **new**, prod-only restricted role `litellm_db_user_prod` owning a **new** schema `litellm_prod`, with zero rights on `public` and zero rights on the existing `litellm` schema (staging's). Reusing the existing `litellm_db_user` role for prod would NOT isolate prod from staging — that role's `search_path` is pinned to `litellm`, so prod's registrations would land in staging's schema.
2. **Founder action:** store the new DSN as GitHub secret `LITELLM_PROD_DB_USER_URL` (same masking/never-in-chat discipline as `LITELLM_DB_USER_URL`).
3. **Founder action (staging only, if needed):** confirm the existing `litellm_db_user` password (set 2026-06-27) still works — DECISIONS.md shows at least one unrelated Supabase password rotation in this project's history; Production Manager will pre-check this read-only before touching anything live.
4. Production Manager then runs the two-phase canary in the deploy plan (staging first, verify clean, then prod under a 24-hour monitoring window) and reports back here.

**Notify:** Production Manager once the SQL is run and the secret is set — Phase 1 (staging) can start immediately with what already exists; Phase 2 (prod) is gated on this.

---

## ✅ FQ-51 — T-46 Second LLM provider: add ANTHROPIC_API_KEY to LiteLLM staging

**Filed:** 2026-06-29 | **Closed:** 2026-07-01
**Filed by:** Tech Lead (T-46)
**Status:** RESOLVED

`ANTHROPIC_API_KEY` added to litellm-staging and container redeployed. T-45 suffix workflow updated LITELLM_URL after the redeploy (run #28495829624). LiteLLM `/health/readiness` confirmed healthy.

**New issue discovered post-redeploy:** LiteLLM `/model/new` API returning HTTP 500 "Failed to add model to db" — DB write broken. See FQ-53 for the workaround that completes T-46 without needing the alias API.

---

## ✅ FQ-50 — T-45 LiteLLM suffix automation: add SSH_PRIVATE_KEY + VPS_HOST GitHub secrets

**Filed:** 2026-06-29 | **Closed:** 2026-07-01
**Filed by:** Tech Lead (T-45)
**Status:** RESOLVED

T-45 builds a `workflow_dispatch` workflow that SSHs to the Coolify VPS, detects the current LiteLLM container suffix, and updates `LITELLM_URL` in ops-hub-app automatically. This eliminates the manual suffix-tracking step after every LiteLLM redeploy.

**Action (10 min):**

1. **Generate an SSH key pair** (if you don't already have one for CI):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-ops-hub" -f ~/.ssh/ops_hub_ci -N ""
   ```

2. **Add the public key to the VPS** (authorized_keys for the user that runs Docker commands — likely `root` or `coolify`):
   ```bash
   cat ~/.ssh/ops_hub_ci.pub >> ~/.ssh/authorized_keys
   ```
   Or paste it via your VPS provider's SSH key management UI.

3. **Add GitHub secrets** (repo Settings → Secrets and variables → Actions):
   - Name: `SSH_PRIVATE_KEY` — Value: contents of `~/.ssh/ops_hub_ci` (the private key)
   - Name: `VPS_HOST` — Value: `187.124.76.235` (Coolify VPS IP)

**Notify:** Tech Lead "FQ-50 complete" — T-45 workflow can be built and tested.

---

## ✅ FQ-48 — T-40 Backup verification: add SUPABASE_ACCESS_TOKEN secret — RESOLVED 2026-07-04

**Filed:** 2026-06-28 | **Resolved:** 2026-07-04
**Filed by:** Tech Lead (T-40)

`SUPABASE_ACCESS_TOKEN` GitHub secret added by founder. The workflow (renamed `verify-backup.yml` → `backup-verification.yml`, see T-40 in WORK.md) is correctly configured and will run automatically on its monthly schedule (1st of every month, 06:00 UTC — first real run 2026-08-01).

**Known unresolved side issue (not blocking):** the workflow's manual `workflow_dispatch` trigger cannot actually be invoked due to an apparent GitHub-side parsing quirk — tried a content nudge and a full rename (new workflow ID), neither fixed it. Full detail in WORK.md T-40. Doesn't affect the real monthly automated run.

**Notify:** PM "FQ-48 complete" — T-40 declared done once a manual run returns ✅.

---

## FQ-49 — T-41 DR drill: LiteLLM external URL unreachable

**Filed:** 2026-06-28 | **Closed:** 2026-06-29
**Filed by:** Production Manager (T-41 DR drill)
**Status:** RESOLVED

**Root cause (not a proxy issue):** LiteLLM was crash-looping with `FATAL: (ENOIDENTIFIER) no tenant identifier provided` from Supavisor. The `DATABASE_URL` username was `postgres` — missing the required project ref suffix. Supavisor requires `postgres.yocoljutbiizdbfraapx`. The bad value persisted because Coolify had accumulated 3 duplicate `DATABASE_URL` rows in its internal `environment_variables` table; the last row (with no project ref) always won on deploy.

**Resolution (2026-06-29):**
1. Connected to `coolify-db` Docker container: `docker exec -it coolify-db psql -U coolify -d coolify`
2. Deleted all 3 duplicate rows: `DELETE FROM environment_variables WHERE resourceable_id=4 AND key='DATABASE_URL'`
3. Re-entered `DATABASE_URL` once via Coolify UI with `postgres.yocoljutbiizdbfraapx` as username
4. Fixed P1000 auth failure (postgres password had been rotated): updated `DATABASE_URL`, `DB_PASSWORD`, and Supabase database password
5. LiteLLM reached `Application startup complete`

**Verification:** `https://litellm-staging.inatechshell.ca/health` returns HTTP 401 (correct — API key enforcement active). `https://ops-hub-staging.inatechshell.ca/health` returns `{"status":"ok"}`.

**Container suffix updated:** Full redeploy changed suffix to `170111887056`. `LITELLM_URL` in Coolify ops-hub-app and CLAUDE.md updated (PR #205).

---

## ✅ FQ-47 — T-38 Cstate status page: 4 founder actions to go live

**Filed:** 2026-06-28 | **Resolved:** 2026-07-08 (3 of 4; 4th deliberately deferred)
**Filed by:** Production Manager (T-38)
**Needs:** Authorization + 4 one-time setup actions
**Deadline:** July 7, 2026 (T-38 target) — missed by one day, closed 2026-07-08
**Status:** Actions 1–3 confirmed done (GitHub Pages on Actions source, DNS CNAME already correct, `GITHUB_STATUS_DISPATCH_TOKEN` confirmed set on the correct project — `ops-hub-staging`, not prod, verified explicitly given the known shared-app-name landmine). Action 4a (`STATUS_WEBHOOK_SECRET`) also already set. **Action 4b (UptimeRobot webhook → auto-populate incidents) deliberately NOT done** — UptimeRobot's webhook alert contacts require a Team/Enterprise plan upgrade on this account's current tier. Per CLAUDE.md's own free-tier-first standing constraint, recommended against upgrading for this — it's incident-automation convenience, not core functionality; a manually-updated status page is a common, acceptable pattern. Founder agreed. **Live-verified independently** (not just "should work"): `https://status.inatechshell.ca` → HTTP 200, real page title "ITS Platform Status," most recent `deploy-status.yml` run (2026-07-04) succeeded. T-38 can be declared done on this basis — incident automation can be revisited later if UptimeRobot usage ever justifies the paid tier.

Code is merged and the Hugo site is built and deployed by CI. Four actions are needed before `status.inatechshell.ca` is reachable and UptimeRobot alerts are automated:

**Action 1 — Enable GitHub Pages on the repo (2 min)**
Repo Settings → Pages → Source → "GitHub Actions". This is blocked on GitHub Team plan (already active). Without this, `deploy-status.yml` will fail.

**Action 2 — Add DNS CNAME record (5 min)**
In your DNS provider (for `inatechshell.ca`), add:
```
CNAME  status  admin-nutshell.github.io
```
After Pages is enabled, GitHub will also verify the custom domain. If prompted, confirm HTTPS enforcement.

**Action 3 — Create a GitHub fine-grained PAT for dispatch (5 min)**
Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
- Repository: `admin-nutshell/ops-hub-00`
- Permissions: **Actions → Read and Write** (only this — do NOT grant repo contents write)
- Set as Coolify env var `GITHUB_STATUS_DISPATCH_TOKEN` in the `ops-hub-staging` project

**Action 4 — Set secret + configure UptimeRobot webhook (10 min)**
a) Add a random secret string as Coolify env var `STATUS_WEBHOOK_SECRET` (e.g. 32-char random hex — `openssl rand -hex 16`)
b) In UptimeRobot, for each monitored URL (Ops Hub, LiteLLM, FreeScout), add an Alert Contact:
- Type: Webhook
- URL: `https://ops-hub-staging.inatechshell.ca/api/status/webhook?secret=<STATUS_WEBHOOK_SECRET>`
- POST Value (JSON): `{"monitorFriendlyName":"*friendlyname*","monitorURL":"*url*","alertType":*alerttype*}`

Note on secret-in-query-string: UptimeRobot free tier does not support custom HTTP request headers, so the shared secret rides in the URL query parameter rather than an Authorization header. The endpoint is HTTPS-only (TLS in transit), which prevents interception. This is a known limitation of the free tier; upgrading to UptimeRobot Pro would allow header-based auth.

**Notify:** PM "FQ-47 complete" — T-38 will be declared done once status page is confirmed live at `status.inatechshell.ca`.

---

## FQ-46 — Monthly Briefing #1: read and acknowledge

**Filed:** 2026-06-27
**Filed by:** PM (T-29)
**Needs:** Read only — no action required
**Deadline:** July 31, 2026

Monthly briefing #1 is ready: `docs/briefings/2026-07-31-m1-briefing.md`

Covers: M1 complete confirmation, what the platform does today, M2 status, key decisions made, open risks, and next 30 days.

**No founder action needed** — this is an informational briefing. Reading it closes M1 criterion #13 and unblocks T-34 (M2 close).

After reading: notify PM "T-29 read" and M1 #13 will be marked ✅.

---

## FQ-45 — ADR-0004 LiteLLM DB isolation: run Step 1 SQL + set GitHub secret

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** RESOLVED

- `litellm_db_user` role exists, owns `litellm` schema, zero access to `public.*` tables (verified)
- `LITELLM_DB_USER_URL` GitHub secret set
- `fix-litellm-schema-isolation.yml apply-wall` ran (run 28221261717 — DB swap succeeded; health-check timed out during LiteLLM restart but swap applied)
- `fix-litellm-schema-isolation.yml freeze-schema` ran and passed (run 28221681598)

ADR-0004 is fully in force. LiteLLM cannot wipe ops-hub tables on redeploy.

---

## FQ-44 — FREESCOUT_DB_URL: provision env var to activate draft delivery + SLA breach notes

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** RESOLVED

`FREESCOUT_DB_URL` confirmed present in Coolify ops-hub-app env vars. Ticket-respond draft delivery and SLA breach notes are active after PR #192 deploy.

---

## FQ-43 — M3 production go-live: two decisions needed before August infrastructure work begins

**Filed:** 2026-06-27 | **Closed:** 2026-06-27
**Status:** DEFERRED — founder decision

**Decision:** DNC production go-live is deferred indefinitely. Build the platform to full capability first; tenant production onboarding (DNC or any other) comes after. M3 scope is on hold until the platform is mature and the founder re-opens it.

**Impact:** T-33 scoping doc (`docs/planning/m3-dnc-production.md`) remains valid as a reference — no work needed on it now. Solutions Architect will revisit when founder signals readiness to onboard a tenant to production.

---

## ✅ FQ-42 — DNC onboarding: apply migration + update 2 Coolify env vars (T-27 / M1 #12) — RESOLVED 2026-06-27

**Filed:** 2026-06-27
**Resolved:** 2026-06-27 — Founder completed all 3 steps:
  - Migration applied in Supabase SQL Editor (TTS project + DNC tenant seeded)
  - `POLLING_PROJECT_ID` + `POLLING_TENANT_ID` set in Coolify ops-hub-app → redeployed
  - DNC test email sent → confirmed end-to-end: FreeScout → triage → respond → `state=responded`, `tenant_id=00…0020` in Supabase
**Filed by:** Tech Lead
**Was blocking:** T-27 (M1 criterion #12 — DNC tickets flowing through ops-hub)
**Priority:** HIGH — last step to close M1

### What was built

- Migration `supabase/migrations/20260627000000_t27_dnc_onboarding.sql` seeds TTS project + DNC tenant
- `projects/tts/config.json` + `projects/tts/tenants/dnc.json` — Project Context instance for DNC
- `freescout-poller.ts` now reads project/tenant IDs from `POLLING_PROJECT_ID` / `POLLING_TENANT_ID` env vars (with fallback to dev placeholders) — proves app-agnostic design

### Required founder actions (3 steps)

#### Step 1 — Apply migration in Supabase SQL Editor

Copy-paste this SQL into Supabase SQL Editor (project `yocoljutbiizdbfraapx`), run as postgres/service_role:

```sql
-- TTS project
INSERT INTO projects (id, name, context_schema)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'tts',
  '{"product":"Ticket Triage System","slug":"tts","support_email":"support@inatechshell.ca"}'
)
ON CONFLICT (name) DO NOTHING;

-- DNC tenant
INSERT INTO tenants (id, project_id, name, tier, sla_config)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000002',
  'Daily Needs Canada',
  'growth',
  '{"response_target_minutes":60,"escalation_threshold":"high","timezone":"America/Toronto"}'
)
ON CONFLICT (id) DO NOTHING;
```

Expected: `INSERT 0 1` for each statement (or `INSERT 0 0` if already applied — both are OK).

#### Step 2 — Update 2 env vars in Coolify

Go to: Coolify → `ops-hub-app` → Environment Variables

Add (or update) these two:

| Key | Value |
|---|---|
| `POLLING_PROJECT_ID` | `00000000-0000-0000-0000-000000000002` |
| `POLLING_TENANT_ID` | `00000000-0000-0000-0000-000000000020` |

Then click **Deploy** (not Restart — full redeploy to inject env vars).

#### Step 3 — Send a DNC test email + confirm

Send an email to **support@inatechshell.ca** with any DNC-relevant subject (e.g. "DNC: order not delivered" or "DNC: payment failed"). Within 5 minutes:

1. FreeScout: email appears in ITS Support inbox
2. Inngest: `ticket-triage` run shows `tenant_id = 00000000-0000-0000-0000-000000000020`
3. Supabase SQL Editor: verify

```sql
SELECT title, urgency, category, routing, state, tenant_id
FROM tickets
WHERE tenant_id = '00000000-0000-0000-0000-000000000020'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: a row with `state = 'responded'`, `tenant_id = '00000000-0000-0000-0000-000000000020'`

### After resolution

Notify Tech Lead: "FQ-42 done — DNC tenant_id confirmed in Supabase"

Tech Lead will close T-27 and mark M1 criterion #12 ✅.

---

## ✅ FQ-41 — FreeScout second DB reset recovery: GRANT + Gmail OAuth — RESOLVED 2026-06-27

**Filed:** 2026-06-26
**Resolved:** 2026-06-27 — `diagnose-freescout-imap.yml` run #28274619900 confirmed:
  - `ops_hub_app` SELECT GRANT: ✅ 2 rows (conversations + threads)
  - FreeScout conversations: 3 rows, threads: 8 rows — email fetch active
  - ops-hub `/health`: HTTP 200
  - **T-26 pre-flight: all items green — drill can proceed**
**Filed by:** Production Manager
**Was blocking:** T-22 (ticket-triage live validation), full Inngest pipeline, M1 criterion #10 re-verification

### What happened

The Supabase public schema was reset a second time. FreeScout detected an empty DB at startup (02:45 UTC 2026-06-26) and re-ran all migrations, recreating the admin user as `info@inatechshell.ca`. This wiped the `ops_hub_app` GRANT on `conversations` and `threads`.

Confirmed via three workflow runs:
- `diagnose-freescout-imap.yml` run #28215344117 (03:32 UTC): conversations = 0, GRANT = 0, cron IS running, no failed_jobs
- `check-freescout-mailboxes.yml` run #28215633753 (03:41 UTC): GRANT still 0, no OAuth table (tokens stored in mailboxes.meta)
- `check-freescout-mailboxes.yml` run #28215745025 (03:44 UTC): **mailbox IS configured** (1 row, id=1 "ITS Support", imap.gmail.com:993 SSL, created_at=02:48, updated_at=03:03 UTC). GRANT still 0.

The mailbox was re-configured by the founder at 02:48 UTC and updated again at 03:03 UTC (likely OAuth re-authorization). The mailbox OAuth may already be connected.

The only confirmed remaining blocker is the GRANT.

### Required founder actions (two steps — must both be done)

#### Step 1: Re-issue the GRANT + make it permanent (via SSH to Coolify VPS)

Run **both commands** on the VPS hosting the Coolify FreeScout container.

> **Why via SSH/artisan tinker:** The Supabase SQL Editor runs as `postgres`, which cannot
> alter default privileges for another role. `artisan tinker` connects as `freescout_user`
> (FreeScout's own DB user, who owns `conversations` and `threads`). Only the owner can set
> default privileges for that role. Running from Supabase SQL Editor will return
> `permission denied to change default privileges`.

**Command A — permanent fix (runs as freescout_user, sets default privileges):**
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan tinker \
  --execute="DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app');"
```

Expected output: `=> true`

This makes any future table FreeScout creates (via Laravel migrations on next restart) automatically grant SELECT to `ops_hub_app`. This is the permanent fix — once set, it survives all future FreeScout schema resets.

**Command B — apply grant to current tables:**
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan tinker \
  --execute="DB::statement('GRANT SELECT ON conversations, threads TO ops_hub_app');"
```

Expected output: `=> true`

If the container name lookup fails (`docker ps -qf` returns empty), find the container ID directly:
```bash
docker ps | grep sgnpza1r8jlq19f0dboqpzq6
# Then substitute <CONTAINER_ID> below:
docker exec <CONTAINER_ID> php artisan tinker --execute="DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app');"
docker exec <CONTAINER_ID> php artisan tinker --execute="DB::statement('GRANT SELECT ON conversations, threads TO ops_hub_app');"
```

**Verify the grant took effect** (run in Supabase SQL Editor):
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('conversations', 'threads')
  AND grantee = 'ops_hub_app';
```
Expect 2 rows (one SELECT grant per table).

#### Step 2: Verify Gmail OAuth connection in FreeScout UI

The mailbox row IS in the DB (confirmed from DB query, updated_at=03:03 UTC). The OAuth connection may already be active.

1. Go to: `https://freescout-staging.inatechshell.ca/mailboxes`
2. Find "ITS Support" mailbox and click Edit
3. Go to "Incoming Email" tab
4. Click "Test Connection" — confirm it says "Connection is successful"
5. If the test fails: click "Connect Google Account" and re-authorize the OAuth
6. Save the mailbox settings if any changes were made

#### Step 3 (optional — after steps 1+2): Manually trigger an email fetch

To verify emails start appearing without waiting for the cron:
```bash
docker exec $(docker ps -qf 'name=sgnpza1r8jlq19f0dboqpzq6') \
  php artisan freescout:fetch-emails
```

Note: the artisan binary is at `/www/html/artisan` inside the container (not `/var/www/html/artisan`). If `php artisan` doesn't resolve, use `php /www/html/artisan freescout:fetch-emails`.

### After resolution

Notify Production Manager: "GRANT re-issued + ALTER DEFAULT PRIVILEGES applied + Gmail OAuth reconnected in FreeScout"

Production Manager will:
1. Run `discover-freescout-schema.yml` to confirm conversations rows are appearing
2. Verify `pollFreeScout` is dispatching `ticket.triage` events in Inngest
3. Close FQ-41 and update T-22 status
4. Trigger `sweepNewTickets` sweep if conversations exist but are missed by the cron window

### Note on recurrence

This has happened twice. Root cause: GRANTs on FreeScout-owned tables are lost when FreeScout re-runs Laravel migrations (e.g. on DB reset). The permanent fix is `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ops_hub_app` — run once as `freescout_user` via artisan tinker (Step 1 above). After that, every table FreeScout creates will automatically carry the grant. **This fix must be run via artisan tinker, not Supabase SQL Editor** (Supabase SQL Editor connects as `postgres`, which returns `permission denied to change default privileges` for another role's defaults).

---

## ✅ FQ-40 — NVIDIA_API_KEY value rejected by NVIDIA NIM (401 Unauthorized) — RESOLVED 2026-06-27

**Filed:** 2026-06-26
**Resolved:** 2026-06-27 — bypassed NVIDIA entirely; gpt-4o-mini is now the sole triage-model provider
**Filed by:** Production Manager
**Was blocking:** T-22 (ticket-triage live validation), LiteLLM triage-model smoke test

**Resolution:** Created and merged PR #176 (`configure-litellm-openai-only.yml`), then triggered
`configure-litellm-openai-only` workflow (run #28274212266). All 9 steps passed:
- Purged all existing model registrations (NVIDIA aliases removed)
- Registered `gpt-4o-mini` as `triage-model` alias → HTTP 200 smoke test ✅
- Registered `gpt-4o-mini` as `meta/llama-3.3-70b-instruct` alias → HTTP 200 smoke test ✅
NVIDIA not used. OPENAI_API_KEY confirmed working. No founder action required.

**Original issue (archived for reference):**

### Current symptom (runs #28210294811 and #28210675694)

`configure-litellm-triage-model.yml` run #28210675694 failed at smoke test.
The user confirmed NVIDIA_API_KEY was "corrected" in Coolify and litellm-staging was fully redeployed
before this run. The 401 persists:
```
POST /chat/completions (model=triage-model) -> HTTP 401
litellm.AuthenticationError: OpenAIException - Error code: 401
{'status': 401, 'title': 'Unauthorized', 'detail': 'Authentication failed'}
Received Model Group=triage-model
Available Model Group Fallbacks=None
```

This is the third workflow run showing HTTP 401 from NVIDIA NIM (runs #28209902312,
#28210294811, #28210675694).

### What is confirmed working

- litellm-staging container is up and reachable (health check passed)
- Both `NVIDIA_API_KEY` and `OPENAI_API_KEY` key names are present in Coolify env config
- Container was fully redeployed (env injection confirmed)
- `OPENAI_API_KEY` is valid and injected: OpenAI probe (native gpt-4o-mini, no api_key field) → HTTP 200
- LiteLLM model registration for `triage-model` alias → HTTP 200 (registration itself succeeds)

### Root cause (updated)

The `NVIDIA_API_KEY` value stored in Coolify is being **rejected by the NVIDIA NIM API** with
HTTP 401. The previous hypothesis (restart vs redeploy) no longer applies — the full redeploy
confirmed that OPENAI_API_KEY is injected and working.

The NVIDIA_API_KEY is present in the running container (key name confirmed by Coolify API, and
the redeploy would have injected it), but when LiteLLM sends it to
`https://integrate.api.nvidia.com/v1` using `os.environ/NVIDIA_API_KEY`, NVIDIA returns 401.

Possible causes (founder to verify):
1. The key value was entered incorrectly in Coolify (truncated, extra whitespace, wrong copy)
2. The key is valid but not activated for `meta/llama-3.3-70b-instruct` model access in NVIDIA NIM
3. The key belongs to a different NVIDIA service (e.g., NIM Microservices vs integrate.api.nvidia.com)
4. The key was revoked or expired at NVIDIA's side after being generated

### Required action (founder)

1. Go to https://build.nvidia.com → API Keys and verify the key value character-for-character
2. Confirm the key has access to the NIM catalog model `meta/llama-3.3-70b-instruct` at
   `https://integrate.api.nvidia.com/v1`
3. If the key is wrong: update `NVIDIA_API_KEY` in Coolify UI → litellm-staging → Environment
   Variables, then click Deploy (full redeploy)
4. If the key is correct but still fails: generate a fresh key at https://build.nvidia.com,
   update Coolify, and redeploy
5. Notify Production Manager: "NVIDIA key updated and litellm-staging redeployed"

### What NOT to do

Do NOT click Restart after updating the key — only Deploy (full redeploy) injects updated env vars.

### Additional confirmed data point (run #28210675694)

The OpenAI probe in step 7 passed (HTTP 200) in both run #28210294811 and #28210675694.
This confirms `OPENAI_API_KEY` is live and valid in the running container. If NVIDIA cannot
be resolved, OpenAI can serve as the sole provider temporarily.

A ready-to-trigger workflow has been committed to unblock once NVIDIA is fixed:
`.github/workflows/register-litellm-openai-fallback.yml`

### After resolution

Production Manager action on receipt of notification:
1. Run: `gh workflow run configure-litellm-triage-model.yml --repo admin-nutshell/ops-hub-00`
2. Verify NVIDIA smoke test passes (HTTP 200)
3. On NVIDIA pass: `gh workflow run register-litellm-openai-fallback.yml --repo admin-nutshell/ops-hub-00`
4. Verify both NVIDIA and OpenAI final tests pass (HTTP 200 each)
5. Close FQ-40, update WORK.md T-22 status

---
