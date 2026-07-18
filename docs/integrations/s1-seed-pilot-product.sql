-- S1 seed: register the TTS pilot product + its GitHub repo connection
--
-- Written by: Production Manager — Sprint S1 of the ops-hub reboot
-- Date: 2026-07-17
--
-- WHY YOU HAVE TO RUN THIS (not an agent): `products` was deliberately built
-- with NO insert policy for the `ops_hub_app` runtime role at all (see
-- supabase/migrations/20260717120100_s1_product_domain_rls_policies.sql) —
-- only `service_role` can insert a product row. (`repo_connections` does
-- have an ops_hub_app insert policy, scoped by product_id, but that's moot
-- here since it can't be used until the product row from Step 1 exists.)
-- Per this project's standing rule (CLAUDE.md non-negotiable #3 —
-- "service_role key: migrations ONLY, no agent ever holds it at runtime"),
-- no agent is ever handed that key. So this is a one-time, human-run seed —
-- same pattern as every prior migration/seed step in this project.
--
-- WHAT YOU'LL NEED: the Supabase SQL Editor for project `yocoljutbiizdbfraapx`
-- (Canada Central), logged in as yourself. That editor runs as service_role
-- automatically — you don't need to paste any key in.
--
-- HOW TO RUN IT — two steps, in order, because the second statement needs a
-- value the first one generates:
--
-- STEP 1 — Insert the product row.
--   Copy ONLY the first `insert` statement below (the one that ends in
--   `returning id;`) into the SQL Editor and run it.
--   WHAT YOU'LL SEE: a one-row result with a single `id` column containing a
--   UUID, e.g. `a1b2c3d4-....`. Copy that UUID — you need it for Step 2.
--
-- STEP 2 — Insert the repo connection row.
--   Copy the second `insert` statement, paste the UUID you copied from
--   Step 1 in place of `<paste-the-id-from-above>` (keep the surrounding
--   single quotes), double-check the `default_branch` value against the
--   note below, and run it.
--   WHAT YOU'LL SEE: "Success. No rows returned" (this statement has no
--   `returning` clause) — that's the expected, correct outcome.
--
-- ---------------------------------------------------------------------------
-- Default branch note: verified 2026-07-17 via `gh api
-- repos/admin-nutshell/web-app-tns-06 --jq .default_branch` (authenticated —
-- the repo is private, so this can't be checked anonymously). Result: `main`.
-- If that has changed by the time you run this, correct the value below
-- before running Step 2.
-- ---------------------------------------------------------------------------

-- STEP 1
insert into products (name, slug, autonomy_default)
values ('TTS', 'tts', 'off')
returning id;

-- STEP 2 — replace <paste-the-id-from-above> with the UUID Step 1 returned,
-- then run:
insert into repo_connections (product_id, github_installation_id, repo_full_name, default_branch, status)
values ('<paste-the-id-from-above>', 147237377, 'admin-nutshell/web-app-tns-06', 'main', 'active');
