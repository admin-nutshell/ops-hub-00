import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { SettingsWriteError, type RequestOriginInfo } from "./writeQueries";

// Shared plumbing for the three settings write routes
// (web/app/api/settings/**/route.ts) — everything actually load-bearing
// (validation, scoping, CSRF/Origin check, the DB write + audit) lives in
// src/ and web/lib/writeQueries.ts; this file is pure request/response glue
// so each route.ts stays a 15-line adapter.

export function originInfoFrom(request: NextRequest): RequestOriginInfo {
  return {
    originHeader: request.headers.get("origin"),
    refererHeader: request.headers.get("referer"),
    requestHost: request.headers.get("host"),
  };
}

export async function parseJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SettingsWriteError("invalid JSON request body", 400);
  }
}

/** Map any thrown error to a JSON NextResponse. Never leaks a raw stack/DSN. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof SettingsWriteError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.httpStatus });
  }
  // Server-side only — never reaches the response body.
  console.error("[api/settings] unexpected write error", err);
  return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
}
