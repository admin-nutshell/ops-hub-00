import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { resolveModelRouting } from "../modelRouting";
import { makeClient } from "./helpers";

/**
 * T-73 — resolveModelRouting unit tests (ADR-0006 Decision A).
 *
 * Covers the full precedence ladder (table row → env default → alias literal),
 * the allowlist fail-closed backstop, the pre-migration (42P01) graceful
 * degradation, and fallback resolution for all three functions (T-121). All DB access is mocked via
 * the shared makeClient (positional query responses); no real DB.
 *
 * The resolver takes an already-open PoolClient (not a Pool) BY DESIGN — it
 * folds into the caller's existing GUC-scoped transaction and cannot open a
 * connection of its own. resolveModelRouting issues, per call:
 *   [0] SAVEPOINT amr_read
 *   [1] SELECT ... FROM agent_model_routing ...
 *   [2] RELEASE SAVEPOINT amr_read   (happy path)
 * so the routing SELECT is the 2nd query (index 1) in each mock array below.
 */

// A client whose routing SELECT rejects with a chosen Postgres error code,
// while SAVEPOINT / ROLLBACK TO succeed — models the pre-migration table state.
function makeRejectingClient(code: string): {
  client: PoolClient;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("agent_model_routing")) {
      return Promise.reject(Object.assign(new Error(`pg error ${code}`), { code }));
    }
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return { client, query };
}

describe("resolveModelRouting", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // No routing env vars set by default → tests that want env precedence stub
    // them explicitly; the rest exercise the literal floor.
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Precedence: table row wins
  // -------------------------------------------------------------------------
  it("PRECEDENCE 1 — uses the agent_model_routing row when present and allowlisted", async () => {
    // Both aliases are allowlisted for triage; swapped vs. the literals to prove
    // the row (not the default) is what is returned.
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [{ primary_model: "fallback-model", fallback_model: "triage-model" }] }, // SELECT
      { rows: [] }, // RELEASE
    ]);
    vi.stubEnv("LITELLM_TRIAGE_MODEL", "should-not-be-used");
    vi.stubEnv("LITELLM_FALLBACK_MODEL", "should-not-be-used");

    const routing = await resolveModelRouting(client, "proj-1", "triage");

    expect(routing).toEqual({ primary: "fallback-model", fallback: "triage-model" });

    // Read rode the passed client, scoped by project_id + function_key.
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    const select = calls.find(([q]) => q.includes("agent_model_routing"))!;
    expect(select[0]).toContain("FROM agent_model_routing");
    expect(select[1]).toEqual(["proj-1", "triage"]);
    // Folded into the caller's transaction via a SAVEPOINT (no third connection).
    expect(calls.some(([q]) => q.includes("SAVEPOINT amr_read"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Precedence: env default (no row)
  // -------------------------------------------------------------------------
  it("PRECEDENCE 2 — falls back to the per-function env default when no row exists", async () => {
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [] }, // SELECT → no row
      { rows: [] }, // RELEASE
    ]);
    // Env is a TRUSTED deploy-time path and is NOT allowlist-gated — a value not
    // in the allowlist is still honoured (proves env is used, not the literal).
    vi.stubEnv("LITELLM_TRIAGE_MODEL", "env-primary-alias");
    vi.stubEnv("LITELLM_FALLBACK_MODEL", "env-fallback-alias");

    const routing = await resolveModelRouting(client, "proj-1", "triage");

    expect(routing).toEqual({ primary: "env-primary-alias", fallback: "env-fallback-alias" });
  });

  // -------------------------------------------------------------------------
  // Precedence: alias literal (no row, no env)
  // -------------------------------------------------------------------------
  it("PRECEDENCE 3 — falls back to the registered alias literal when no row and no env", async () => {
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [] }, // SELECT → no row
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveModelRouting(client, "proj-1", "triage");

    // Literals are allowlisted by construction (T-79).
    expect(routing).toEqual({ primary: "triage-model", fallback: "fallback-model" });
  });

  // -------------------------------------------------------------------------
  // Fail-closed: out-of-allowlist table value is refused (does NOT take offline)
  // -------------------------------------------------------------------------
  it("FAIL-CLOSED — refuses an out-of-allowlist table value and falls through to the safe default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      // primary is out-of-allowlist (bad/forged write); fallback is allowed.
      { rows: [{ primary_model: "gpt-4-turbo-unvetted", fallback_model: "fallback-model" }] },
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveModelRouting(client, "proj-1", "triage");

    // The bad primary is dropped → literal floor; the good fallback is kept.
    // Crucially it does NOT throw (never takes the function offline — ADR-0006).
    expect(routing).toEqual({ primary: "triage-model", fallback: "fallback-model" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("out-of-allowlist");
  });

  it("FAIL-CLOSED — a table value not in respond's own list is refused too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      // 'fallback-model' is allowlisted for triage but NOT for respond.
      { rows: [{ primary_model: "fallback-model", fallback_model: null }] },
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveModelRouting(client, "proj-1", "respond");

    // Primary falls to its literal; fallback (no row value) falls to ITS OWN
    // literal default (T-121) — the two slots resolve independently.
    expect(routing).toEqual({ primary: "triage-model", fallback: "meta/llama-3.3-70b-instruct" });
    expect(warn).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Pre-migration safety: 42P01 undefined_table degrades to the default
  // -------------------------------------------------------------------------
  it("PRE-MIGRATION — degrades to the default (no throw) when the table does not exist yet (42P01)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, query } = makeRejectingClient("42P01");

    const routing = await resolveModelRouting(client, "proj-1", "triage");

    expect(routing).toEqual({ primary: "triage-model", fallback: "fallback-model" });
    // Rolled back to the savepoint so the caller's transaction stays usable.
    expect(query.mock.calls.some(([q]) => q === "ROLLBACK TO SAVEPOINT amr_read")).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("does not exist yet");
  });

  it("PRE-MIGRATION — respects env/literal precedence even while the table is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = makeRejectingClient("42P01");
    vi.stubEnv("LITELLM_KBLEARN_MODEL", "triage-model");

    const routing = await resolveModelRouting(client, "proj-1", "kb_learn");

    expect(routing).toEqual({ primary: "triage-model", fallback: "meta/llama-3.3-70b-instruct" });
  });

  it("PROPAGATES — a non-42P01 DB error is not swallowed", async () => {
    const { client } = makeRejectingClient("42703"); // undefined_column, e.g.
    await expect(resolveModelRouting(client, "proj-1", "triage")).rejects.toThrow("pg error 42703");
  });

  // -------------------------------------------------------------------------
  // Fallback resolution — all three functions carry a fallback (T-121,
  // DECISIONS.md 2026-07-15; supersedes the old Triage-only scope these two
  // tests used to pin).
  // -------------------------------------------------------------------------
  it("FALLBACK — respond honours an allowlisted row fallback (meta/llama, T-121)", async () => {
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [{ primary_model: "triage-model", fallback_model: "meta/llama-3.3-70b-instruct" }] },
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveModelRouting(client, "proj-1", "respond");

    expect(routing).toEqual({ primary: "triage-model", fallback: "meta/llama-3.3-70b-instruct" });
  });

  it("FALLBACK — respond falls through to the literal when the row's fallback is out-of-allowlist (fallback-model is triage-only)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      // 'fallback-model' (Anthropic) is allowlisted for triage but NOT respond.
      { rows: [{ primary_model: "triage-model", fallback_model: "fallback-model" }] },
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveModelRouting(client, "proj-1", "respond");

    expect(routing).toEqual({ primary: "triage-model", fallback: "meta/llama-3.3-70b-instruct" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("out-of-allowlist");
  });

  it("FALLBACK — kb_learn resolves to its own literal default when no row/env fallback is set (T-121)", async () => {
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [] }, // SELECT → no row
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveModelRouting(client, "proj-1", "kb_learn");

    expect(routing).toEqual({ primary: "triage-model", fallback: "meta/llama-3.3-70b-instruct" });
  });
});
