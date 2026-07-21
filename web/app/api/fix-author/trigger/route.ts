import { NextRequest, NextResponse } from "next/server";
import { triggerFixAuthorRequest } from "../../../../lib/writeQueries";
import { originInfoFrom, parseJsonBody, errorResponse } from "../../../../lib/apiRoute";

// S3 of the ops-hub reboot — dispatches ops-hub/fix.author.requested for one
// finding. Unlike repo-inspect/vuln-detect/trigger (whole-product, no body),
// this route takes a request body:
//   { "findingId": "<findings row uuid>" }
//
// A 200 here means Inngest Cloud ACCEPTED the event — not that a fix attempt
// was created. See src/metrics/fixAuthor.ts's triggerFixAuthor doc comment
// for the full list of server-side skip reasons this path can't surface.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const result = await triggerFixAuthorRequest(body, originInfoFrom(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
