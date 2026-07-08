import { NextRequest, NextResponse } from "next/server";
import { writeModelRouting } from "../../../../lib/writeQueries";
import { originInfoFrom, parseJsonBody, errorResponse } from "../../../../lib/apiRoute";

// T-74, Surface 2 (ADR-0006) — per-function model-routing write.
// POST-only by construction (see sla/route.ts for the same note).
//
// Request body: { "functionKey": "triage" | "respond" | "kb_learn",
//                  "primaryModel": "<allowlisted alias>",
//                  "fallbackModel"?: "<allowlisted alias>" }
// fallbackModel is only accepted for functionKey === "triage"; both model
// values are validated against src/config/model-allowlist.ts (T-79) before
// anything is written — a value outside the curated allowlist is rejected,
// never persisted.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const result = await writeModelRouting(body, originInfoFrom(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
