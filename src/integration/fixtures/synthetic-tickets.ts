/**
 * T-24 — Synthetic test data for the full-pipeline integration suite.
 *
 * Deliberately app-agnostic (no TTS specifics): every payload is generic
 * support content so the same fixtures serve Project #2 with config only.
 *
 * Integration tests do NOT call the live classifier (LiteLLM is excluded from
 * the deterministic integration seam — see ticket-state-machine.test.ts header).
 * Instead each ticket carries the `expectedTriage` values the test itself
 * persists in the `new -> triaged` UPDATE, mirroring exactly what
 * `triageOneTicket` writes (state='triaged', urgency, category, routing).
 */

export type Urgency = "critical" | "high" | "normal" | "low";

export type SyntheticTicket = {
  title: string;
  body: string;
  severity: "P1" | "P2" | "P3";
  /** The classification a triage step would persist — supplied by the test, not the LLM. */
  expectedTriage: { urgency: Urgency; category: string; routing: string };
};

export const SYNTHETIC_TICKETS = {
  authOutage: {
    title: "Cannot log in — auth service returning 500",
    body: "Every login attempt fails with a 500. Multiple users blocked, no workaround.",
    severity: "P1",
    expectedTriage: { urgency: "high", category: "auth", routing: "engineering" },
  },
  billingQuestion: {
    title: "Was I charged twice this month?",
    body: "I see two identical charges on my statement. Please confirm and refund if duplicated.",
    severity: "P3",
    expectedTriage: { urgency: "normal", category: "billing", routing: "billing" },
  },
} satisfies Record<string, SyntheticTicket>;

/**
 * A globally-unique `freescout_conversation_id` (bigint UNIQUE on `tickets`).
 * Returned as a string so it is passed to Postgres with full precision and
 * cast `::bigint`. Timestamp-derived + random suffix puts it far above the
 * real staging conversation ids (6, 7 per WORK.md T-21) so the dedup probe
 * never collides with production-shaped rows.
 */
export function uniqueConversationId(): string {
  const suffix = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${Date.now()}${suffix}`;
}

/** Unique marker so concurrent/leftover runs never collide and orphaned fixture rows are identifiable. */
export function runTag(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
