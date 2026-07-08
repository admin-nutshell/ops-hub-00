// Client-safe fetch wrapper for the settings write forms (T-75). Deliberately
// NOT "server-only" — this runs in the browser. No SQL, no secrets: it only
// knows how to POST JSON to one of T-74's `web/app/api/settings/**` routes
// and turn the response into a discriminated result the forms can render
// honestly (ADR-0006: "honesty over polish" — every write shows real
// success/error feedback, never an optimistic UI).
//
// Route responses are always `{ ok: true, ... }` or `{ ok: false, error }`
// (see web/lib/apiRoute.ts's errorResponse / each route's NextResponse.json),
// with the HTTP status carrying the real error class (400 validation, 403
// origin-rejected, 404 not-found, 503 schema-not-ready). This wrapper surfaces
// both the status and the message so callers can pick a friendlier line for
// the well-known cases (see friendlyWriteError below) while still showing the
// raw server message for anything unexpected.

export type WriteSuccess<T> = { ok: true; status: number; data: T };
export type WriteFailure = { ok: false; status: number; error: string };
export type WriteResult<T> = WriteSuccess<T> | WriteFailure;

export async function postSettings<T = unknown>(
  path: string,
  body: unknown
): Promise<WriteResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Network failure — never reached the server at all.
    return { ok: false, status: 0, error: "network error — could not reach the server" };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, status: res.status, error: `unexpected response (HTTP ${res.status})` };
  }

  const parsed = json as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (res.ok && parsed.ok) {
    return { ok: true, status: res.status, data: json as T };
  }
  return {
    ok: false,
    status: res.status,
    error: typeof parsed.error === "string" ? parsed.error : `request failed (HTTP ${res.status})`,
  };
}

/**
 * Map a status/message pair to a friendlier line for the well-known error
 * classes ADR-0006/T-74 defines, while still showing the server's own message
 * underneath — never hide the real error, just front it with plain language.
 */
export function friendlyWriteError(status: number, error: string): string {
  switch (status) {
    case 503:
      return "Settings aren't available yet — the database change this needs (T-72) hasn't been applied to this environment yet.";
    case 403:
      return "This save was blocked as untrusted (origin check failed). Try reloading the page and saving again.";
    case 404:
      return "That record couldn't be found in scope — it may have been changed elsewhere. Reload and try again.";
    case 400:
      return error; // validation messages are already written for a human.
    case 0:
      return "Couldn't reach the server — check your connection and try again.";
    default:
      return error;
  }
}
