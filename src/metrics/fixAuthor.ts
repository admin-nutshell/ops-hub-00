import { inngest } from "../inngest/client";
import { SettingsWriteError, ValidationError } from "./settingsWrite";

// Dashboard trigger surface for the product-domain reboot's S3 "propose
// fixes as draft PRs" feature (src/inngest/fix-author.ts). Same own-file,
// trigger-only convention as vulnDetect.ts's trigger half — no DB access at
// all here; the actual read/write happens inside fix-author.ts's own
// transaction, in its own product-scoped GUC.
//
// UNLIKE repo-inspect/vuln-detect (whole-product triggers, zero client
// input), this trigger needs ONE piece of client input: which finding to
// propose a fix for. It is the first trigger surface in this reboot that
// validates a request body at all — everything else so far either wrote no
// body (these two triggers) or wrote settings via T-74's existing
// validate*Input functions in settingsWrite.ts.
//
// THIS IS THE MISSING PIECE OF S3: PRs #548/#551/#554/#555/#557/#559/#560/
// #563/#568 built the full author -> sandbox -> reconcile -> draft-PR chain,
// but nothing anywhere in the codebase ever dispatched
// `ops-hub/fix.author.requested` — S1 and S2 each shipped a dashboard
// trigger button (`/api/repo-inspect/trigger`, `/api/vuln-detect/trigger`);
// S3 never got the equivalent. Without this, the chain has no entry point at
// all, even with every downstream flag enabled and staging running. This
// file + its route/component are that missing entry point.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FixAuthorTriggerInput = { findingId: string };

/**
 * Validate a raw JSON request body for a fix-author dispatch. findingId is
 * the client-submitted record key (same ADR-0006 "client submits only the
 * record key, never a tenant/product id" convention as
 * validateFeatureFlagInput in settingsWrite.ts) — product scope is still
 * applied server-side (resolveProductWriteScope), and authorFixForFinding
 * itself re-checks the finding actually belongs to that product before doing
 * anything. A forged or unrelated finding id is therefore a no-op skip
 * inside the Inngest function (finding_not_found), never a cross-product
 * read/write reachable from this route.
 */
export function validateFixAuthorTriggerInput(payload: unknown): FixAuthorTriggerInput {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("payload must be a JSON object");
  }
  const obj = payload as Record<string, unknown>;
  const findingId = obj.findingId;
  if (typeof findingId !== "string" || !UUID_RE.test(findingId)) {
    throw new ValidationError("findingId must be a valid findings row uuid");
  }
  return { findingId };
}

export class FixAuthorDispatchError extends SettingsWriteError {
  constructor(message: string) {
    super(message, 503);
    this.name = "FixAuthorDispatchError";
  }
}

/**
 * Send the `ops-hub/fix.author.requested` event for one finding.
 *
 * IMPORTANT — a successful dispatch here does NOT mean a fix attempt was
 * created. authorFixForFinding (src/inngest/fix-author.ts) can skip for
 * several reasons — finding not found in scope, already shipped/dismissed
 * (TERMINAL_FINDING_STATES), an attempt already in progress
 * (fix_attempts.status IN ('pending','running')), or no active repo
 * connection — none of which are visible on this path. inngest.send() only
 * confirms Inngest Cloud accepted the event over HTTP. Same discipline as
 * triggerVulnDetect/triggerRepoInspect: the dashboard polls the finding's own
 * `state` afterward specifically because dispatch success is not proof of
 * anything having actually started.
 *
 * Throws FixAuthorDispatchError (503) — not a raw 500 — if the SDK itself
 * refuses to send (e.g. INNGEST_EVENT_KEY unset in this process).
 */
export async function triggerFixAuthor(
  productId: string,
  findingId: string
): Promise<{ dispatched: true }> {
  try {
    await inngest.send({
      name: "ops-hub/fix.author.requested",
      data: { product_id: productId, finding_id: findingId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FixAuthorDispatchError(
      `Could not dispatch the fix-author event — is INNGEST_EVENT_KEY provisioned on the ` +
        `dashboard app? — ${message}`
    );
  }
  return { dispatched: true };
}
