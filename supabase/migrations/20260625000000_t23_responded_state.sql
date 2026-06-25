-- Migration: 20260625000000_t23_responded_state
-- T-23 ticket-respond: add 'responded' to the tickets.state CHECK constraint.
-- Author: Tech Lead  Date: 2026-06-25
-- Forward-only. Requires 20260618120000_initial_schema.sql applied first.
-- Run via Supabase SQL Editor as service_role (same pattern as the T-11 runbook).
--
-- WHY: ticket-respond advances a ticket 'triaged' -> 'responded' after it drafts
-- and delivers a reply note. 'responded' was not in the original state enum
-- (20260618120000 lines 69-73), so without this the UPDATE throws a
-- check_violation in real Postgres. Unit tests mock the pg Pool and never hit
-- the constraint, so this gap is invisible to CI — it must be applied to
-- staging/prod before T-23 runs against a live database.
--
-- Idempotent: drop-if-exists then re-add. The constraint's auto-generated name
-- for an inline column CHECK is 'tickets_state_check'.

alter table tickets drop constraint if exists tickets_state_check;

alter table tickets add constraint tickets_state_check
  check (state in (
    'new','triaged','responded','investigating','in_progress','blocked',
    'in_review','staged','deploying','verifying','resolved',
    'closed','reopened','wont_fix','duplicate'));
