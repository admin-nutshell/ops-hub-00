import { NextRequest, NextResponse } from "next/server";
import { writeFeatureFlagToggle } from "../../../../lib/writeQueries";
import { originInfoFrom, parseJsonBody, errorResponse } from "../../../../lib/apiRoute";

// T-74, Surface 3 (ADR-0006) — feature-flag toggle.
// POST-only by construction (see sla/route.ts for the same note).
//
// Request body: { "id": "<feature_flags row uuid>", "enabled": boolean,
//                  "rolloutPercentage": <integer 0-100> }
// UPDATE on an EXISTING row only — this route can never create or delete a
// flag (no INSERT/DELETE statement exists on this path); an id that doesn't
// resolve to a row in the dashboard's project scope is a 404, not a create.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const result = await writeFeatureFlagToggle(body, originInfoFrom(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
