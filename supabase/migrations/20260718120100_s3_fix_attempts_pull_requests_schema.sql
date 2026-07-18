-- Migration: 20260718120100_s3_fix_attempts_pull_requests_schema
-- Ops Hub product-domain reboot — Sprint S3: propose fixes as draft PRs
-- Author: Tech Lead  Date: 2026-07-18
-- Founder-approved reboot, S3 scope (per the plan file's roadmap): fix-author-
-- agent + ephemeral sandbox produces a fix_attempt; a separate trusted step
-- opens a DRAFT pull request from a passing attempt. No auto-merge path
-- exists yet (that's S4, gated behind autonomy_policies + the human-approval
-- gate). This migration is ADDITIVE ONLY — it does not touch tickets,
-- tenants, projects, audit_log, feature_flags, kb_articles, or any S1/S2
-- table's existing data.
--
-- Requires 20260718120000_s3_findings_composite_unique.sql applied first
-- (fix_attempts' composite FK to findings depends on that constraint).
--
-- RLS policies land in the companion migration
-- 20260718120200_s3_fix_attempts_pull_requests_rls_policies.sql, reviewed
-- together (*** SECURITY LEAD REVIEW REQUIRED *** — same precedent as every
-- prior S1/S2 schema+RLS pair).
--
-- THREAT MODEL NOTE (why diff_ref is a pointer, not inline content): a
-- fix_attempt's diff is AI-generated content produced by reading untrusted
-- finding.detail — storing the full diff inline in this table would make an
-- ordinary DB read of fix_attempts a second place prompt-injection-adjacent
-- content could surface unexpectedly. diff_ref instead points at the sandbox
-- run's own artifact (the ephemeral GH Actions run's output), keeping this
-- table itself lightweight metadata, same spirit as repo_connections never
-- holding a token.

-- ---------------------------------------------------------------------------
-- fix_attempts  (one sandboxed attempt at a finding) — product-scoped
-- ---------------------------------------------------------------------------
create table fix_attempts (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete restrict,
  finding_id       uuid not null,
  agent            text not null,
  model_alias      text not null,
  sandbox_run_id   text,                      -- the ephemeral GH Actions run's identifier;
                                               -- NULL until the sandbox is actually dispatched
                                               -- (a fix_attempts row is created first, in
                                               -- 'pending' status, then updated once dispatched).
  status           text not null default 'pending'
                     check (status in ('pending', 'running', 'completed', 'failed')),
  diff_ref         text,                      -- pointer to the sandbox run's diff artifact —
                                               -- NEVER the inline diff content (see file header).
                                               -- NULL until the sandbox run completes.
  eval_score       numeric,                   -- fix-quality rubric score (grader model !=
                                               -- author model, same discipline as the live
                                               -- eval gate); NULL until graded.
  cost_usd         numeric,                   -- NULL until the attempt completes and cost is
                                               -- known (mirrors agent_cost_events' own pattern
                                               -- of recording cost after the fact).
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Composite FK to findings(product_id, id): guarantees at the database
  -- level that this attempt's product_id matches its finding's real
  -- product_id — not just by application code. Requires
  -- findings_product_id_id_key (companion migration 20260718120000).
  foreign key (product_id, finding_id) references findings (product_id, id) on delete restrict,
  -- Enables a composite FK from pull_requests (product_id, fix_attempt_id) —
  -- same pattern as findings_product_id_id_key above, one level down.
  unique (product_id, id)
);

create index fix_attempts_finding_id_idx on fix_attempts (finding_id);
create index fix_attempts_status_idx     on fix_attempts (status);

comment on table fix_attempts is
  'One sandboxed attempt at fixing a finding (S3). The sandbox that produces diff_ref holds '
  'no secrets and no GitHub token (see the reboot plan''s threat model) — this row is '
  'written by a separate trusted Inngest step after the sandbox run completes, never by '
  'code running inside the sandbox itself. diff_ref is a pointer to the run''s artifact, '
  'never the inline diff (untrusted-content-surface minimization — see file header). A '
  'below-fix-quality-floor attempt (low eval_score) never gets a pull_requests row.';

-- ---------------------------------------------------------------------------
-- pull_requests  (a draft/open PR resulting from a passing fix_attempt) — product-scoped
-- ---------------------------------------------------------------------------
-- SECURITY INVARIANT (same class as repo_connections): this table NEVER
-- holds a token/credential column. The installation token used to push the
-- branch and open the PR is minted per-operation in a separate trusted
-- Inngest step (never inside sandbox code) and discarded immediately after
-- use — never persisted here or anywhere else.
create table pull_requests (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id) on delete restrict,
  fix_attempt_id     uuid not null,
  github_pr_number   integer not null,
  branch             text not null,
  state              text not null default 'draft'
                       check (state in (
                         'draft', 'open', 'checks_running', 'approved',
                         'merged', 'closed', 'reverted')),
  checks_status      text,                    -- mirrors GitHub's own checks-API vocabulary
                                               -- (pending/success/failure/neutral/etc.) —
                                               -- deliberately NOT a closed check constraint,
                                               -- same open-taxonomy rationale as
                                               -- autonomy_policies.change_type: GitHub's own
                                               -- set of conclusion values is not ours to fix.
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Composite FK to fix_attempts(product_id, id): guarantees at the database
  -- level that this PR's product_id matches its fix_attempt's real
  -- product_id — not just by application code.
  foreign key (product_id, fix_attempt_id) references fix_attempts (product_id, id) on delete restrict,
  -- One fix_attempt produces at most one PR.
  unique (fix_attempt_id),
  -- A PR number is only unique within its repo; today's one-repo-per-product
  -- invariant (S1) makes unique(product_id, github_pr_number) correct.
  -- Revisit if/when multi-repo-per-product ever lands (same caveat pattern
  -- as signal_sources' unique(product_id, kind)).
  unique (product_id, github_pr_number)
);

create index pull_requests_state_idx on pull_requests (state);

create trigger fix_attempts_set_updated_at
  before update on fix_attempts
  for each row execute function set_updated_at();

create trigger pull_requests_set_updated_at
  before update on pull_requests
  for each row execute function set_updated_at();

comment on table pull_requests is
  'A draft/open pull request resulting from a passing fix_attempt (S3 ships draft-only — '
  'state starts at draft and a human opens/merges manually; auto-merge is S4+, gated behind '
  'autonomy_policies). NEVER holds a token/credential — the installation token is minted '
  'per-operation in a separate trusted step and discarded, same invariant as '
  'repo_connections. unique(fix_attempt_id) — one PR per attempt.';
