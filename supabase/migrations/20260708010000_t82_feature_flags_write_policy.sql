-- Migration: 20260708010000_t82_feature_flags_write_policy
-- Sprint 7 / T-82: Re-create the missing `feature_flags_write` RLS policy on the live DB.
-- Author: Tech Lead  Date: 2026-07-08
--
-- *** SECURITY LEAD REVIEW REQUIRED — GATES the apply ***
-- Forward-only. Applied via Supabase SQL Editor as service_role AFTER Security Lead sign-off
-- (same gate as T-72/T-76 earlier this sprint). Agents never hold service_role at runtime
-- (CLAUDE.md non-negotiable #3). Do NOT self-apply — this migration changes nothing until a
-- founder runs it and its verification block below returns both expected policies.
--
-- WHY THIS MIGRATION EXISTS (brief — full account in WORK.md T-78/T-82):
--   QA's live write-path verification (T-78) found feature-flag writes silently broken on the
--   live database. A read-only pg_policy catalog dump (dispatched diagnostic, run 28984439224)
--   confirmed the live DB carries ONLY a `feature_flags_select` policy on `feature_flags` — the
--   `feature_flags_write FOR ALL to ops_hub_app` policy defined by
--   20260618120100_enable_rls_policies.sql (lines ~147-150) DOES NOT EXIST live, despite T-11's
--   WORK.md row claiming that migration was fully applied on 2026-06-22 (and T-72 assuming this
--   policy "already exists ... no DB change here by design"). Table-level grants for ops_hub_app
--   (INSERT/SELECT/UPDATE/DELETE) ARE present and RLS IS enabled — so with no write policy,
--   every INSERT/UPDATE/DELETE default-denies (fail-closed: no data leak, but feature-flag
--   writes have never actually worked).
--
-- WHAT THIS MIGRATION DOES:
--   Re-creates EXACTLY the policy 20260618120100 already defines — nothing new is designed here.
--   Re-applied as its own dated, forward-only migration so the fix does not silently depend on
--   the original (apparently-never-actually-applied) migration ever being retroactively fixed.
--   Idempotent / safe to re-run: `drop policy if exists` before `create policy`.
--
-- SCOPE — deliberately narrow (policy-only):
--   * Touches ONLY the `feature_flags_write` policy on `feature_flags`.
--   * Does NOT touch grants — table-level grants for ops_hub_app are confirmed present live.
--   * Does NOT touch `feature_flags_select` — it is working and is left alone.
--   * `alter table feature_flags enable row level security` is NOT repeated here: RLS is already
--     confirmed enabled live (that is precisely why the missing write policy fails closed).

drop policy if exists feature_flags_write on feature_flags;
create policy feature_flags_write on feature_flags
  for all to ops_hub_app
  using (project_id = current_project_id())
  with check (project_id = current_project_id());

-- ===========================================================================
-- POST-APPLY VERIFICATION (run manually as service_role after applying):
--   -- both policies must come back — feature_flags_select (unchanged) AND
--   -- feature_flags_write (re-created by this migration):
--   select polname from pg_policy where polrelid = 'feature_flags'::regclass;
--     -- expect: feature_flags_select, feature_flags_write
-- ===========================================================================
