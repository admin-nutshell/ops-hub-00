import { NextRequest, NextResponse } from "next/server";
import { writeSlaConfig } from "../../../../lib/writeQueries";
import { originInfoFrom, parseJsonBody, errorResponse } from "../../../../lib/apiRoute";

// T-74, Surface 1 (ADR-0006) — SLA target write.
// POST-only by construction: no other HTTP method is exported here, so
// Next.js's App Router returns 405 for GET/PUT/DELETE/etc. automatically —
// "no state change reachable via GET" is enforced by the file shape, not a
// runtime check.
//
// Request body: { "response_target_minutes": <bounded positive integer> }
// (only sla_config keys — sla_tier is rejected even if present).
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const result = await writeSlaConfig(body, originInfoFrom(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
