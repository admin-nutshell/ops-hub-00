import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { resolveAgentModelRouting } from "../agent-model-routing";
import { makeClient } from "./helpers";

/**
 * S3 — resolveAgentModelRouting unit tests, the product-domain analogue of
 * modelRouting.test.ts. Covers the same precedence ladder, allowlist
 * fail-closed backstop, and pre-migration (42P01) graceful degradation.
 * All DB access is mocked via the shared makeClient; no real DB.
 */

function makeRejectingClient(code: string): {
  client: PoolClient;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockImplementation((sql: string) => {
    // Match only the actual SELECT, not the "agent_routing_read" savepoint
    // name (which also contains the substring "agent_routing").
    if (sql.includes("FROM agent_routing")) {
      return Promise.reject(Object.assign(new Error(`pg error ${code}`), { code }));
    }
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return { client, query };
}

describe("resolveAgentModelRouting", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("PRECEDENCE 1 — uses the agent_routing row when present and allowlisted", async () => {
    // fix_author's allowlist is empty today (no eval has passed yet), so no
    // table value can ever win PRECEDENCE 1 until one is admitted — this test
    // documents that current reality rather than asserting a false pass.
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [{ primary_model: "triage-model" }] }, // SELECT — allowlisted? no, empty list
      { rows: [] }, // RELEASE
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const routing = await resolveAgentModelRouting(client, "prod-1", "fix_author");

    // Falls through to the literal since fix_author's allowlist is empty.
    expect(routing).toEqual({ primary: "triage-model", fallback: null });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("out-of-allowlist");
  });

  it("PRECEDENCE 2 — falls back to the per-role env default when no row exists", async () => {
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [] }, // SELECT → no row
      { rows: [] }, // RELEASE
    ]);
    vi.stubEnv("LITELLM_FIX_AUTHOR_MODEL", "env-fix-author-alias");

    const routing = await resolveAgentModelRouting(client, "prod-1", "fix_author");

    expect(routing).toEqual({ primary: "env-fix-author-alias", fallback: null });
  });

  it("PRECEDENCE 3 — falls back to the registered alias literal when no row and no env", async () => {
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [] }, // SELECT → no row
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveAgentModelRouting(client, "prod-1", "fix_author");

    expect(routing).toEqual({ primary: "triage-model", fallback: null });
  });

  it("FAIL-CLOSED — refuses any table value while fix_author's allowlist is empty, never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeClient([
      { rows: [] }, // SAVEPOINT
      { rows: [{ primary_model: "gpt-4-turbo-unvetted" }] },
      { rows: [] }, // RELEASE
    ]);

    const routing = await resolveAgentModelRouting(client, "prod-1", "fix_author");

    expect(routing).toEqual({ primary: "triage-model", fallback: null });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("out-of-allowlist");
  });

  it("reads via the passed client, scoped by product_id + agent_role, folded into a SAVEPOINT", async () => {
    const client = makeClient([{ rows: [] }, { rows: [] }, { rows: [] }]);

    await resolveAgentModelRouting(client, "prod-1", "fix_author");

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    const select = calls.find(([q]) => q.includes("FROM agent_routing"))!;
    expect(select[0]).toContain("FROM agent_routing");
    expect(select[1]).toEqual(["prod-1", "fix_author"]);
    expect(calls.some(([q]) => q.includes("SAVEPOINT agent_routing_read"))).toBe(true);
  });

  it("PRE-MIGRATION — degrades to the default (no throw) when the table does not exist yet (42P01)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, query } = makeRejectingClient("42P01");

    const routing = await resolveAgentModelRouting(client, "prod-1", "fix_author");

    expect(routing).toEqual({ primary: "triage-model", fallback: null });
    expect(query.mock.calls.some(([q]) => q === "ROLLBACK TO SAVEPOINT agent_routing_read")).toBe(
      true
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("does not exist yet");
  });

  it("PRE-MIGRATION — respects env/literal precedence even while the table is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = makeRejectingClient("42P01");
    vi.stubEnv("LITELLM_FIX_AUTHOR_MODEL", "env-fix-author-alias");

    const routing = await resolveAgentModelRouting(client, "prod-1", "fix_author");

    expect(routing).toEqual({ primary: "env-fix-author-alias", fallback: null });
  });

  it("PROPAGATES — a non-42P01 DB error is not swallowed", async () => {
    const { client } = makeRejectingClient("42703"); // undefined_column, e.g.
    await expect(resolveAgentModelRouting(client, "prod-1", "fix_author")).rejects.toThrow(
      "pg error 42703"
    );
  });
});
