import { NextRequest, NextResponse } from "next/server";
import { triggerRepoInspectRequest } from "../../../../lib/writeQueries";
import { originInfoFrom, errorResponse } from "../../../../lib/apiRoute";

// S1 of the ops-hub reboot — dispatches ops-hub/repo.inspect.requested for
// the dashboard's one configured pilot product. POST-only by construction
// (see settings/sla/route.ts for the same note); no request body (the
// product id is server-pinned server-side, never client-supplied, so there
// is nothing for a caller to submit).
//
// A 200 here means Inngest Cloud ACCEPTED the event — not that the
// inspection has run or even that a backend process is listening for it. See
// src/metrics/repoInspect.ts's triggerRepoInspect doc comment.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await triggerRepoInspectRequest(originInfoFrom(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
