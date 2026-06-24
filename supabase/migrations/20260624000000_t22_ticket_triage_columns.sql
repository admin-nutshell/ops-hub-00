-- Migration: 20260624000000_t22_ticket_triage_columns
-- T-22 ticket-triage: add urgency, category, routing columns populated by the triage function.
-- Author: Tech Lead  Date: 2026-06-24
-- Forward-only. Requires 20260623180000_t21_freescout_intake.sql applied first.
-- IF NOT EXISTS guards make this idempotent (safe to re-run).

-- urgency replaces P1/P2/P3 severity labels with human-readable words.
alter table tickets add column if not exists urgency text
  check (urgency in ('critical', 'high', 'normal', 'low'));

-- category: coarse topic bucket set by the classifier (e.g. auth, billing, performance).
alter table tickets add column if not exists category text;

-- routing: team/queue the ticket should be directed to (e.g. engineering, support, billing).
alter table tickets add column if not exists routing text;

create index if not exists tickets_urgency_idx on tickets (urgency);
