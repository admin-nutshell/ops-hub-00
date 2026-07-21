import { NextRequest, NextResponse } from "next/server";
import { triggerVulnDetectRequest } from "../../../../lib/writeQueries";
import { originInfoFrom, errorResponse } from "../../../../lib/apiRoute";

// S2 of the ops-hub reboot — dispatches ops-hub/vuln.detect.requested for
// the dashboard's one configured pilot product. POST-only by construction
// (see repo-inspect/trigger/route.ts for the same note); no request body
// (the product id is server-pinned server-side, never client-supplied, so
// there is nothing for a caller to submit).
//
// A 200 here means Inngest Cloud ACCEPTED the event — not that detection has
// run, and NOT that it didn't skip (e.g. no active repo connection, or a
// suspended signal source). See src/metrics/vulnDetect.ts's triggerVulnDetect
// doc comment for why a skip result can't be surfaced on this path.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await triggerVulnDetectRequest(originInfoFrom(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
