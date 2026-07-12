import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  validateSlaPatch,
  updateSlaConfig,
  validateModelRoutingInput,
  upsertModelRouting,
  validateFeatureFlagInput,
  toggleFeatureFlag,
  ValidationError,
  NotFoundError,
  SchemaNotReadyError,
} from "../settingsWrite";
import { makeClient, makePool } from "../../inngest/__tests__/helpers";

const PROJECT_ID = "00000000-0000-0000-0000-000000000003";
const TENANT_ID = "00000000-0000-0000-0000-000000000030";

// A client whose query rejects with a chosen Postgres error code once it sees
// `matchSql` in the statement text, while every other statement (BEGIN,
// set_config, ROLLBACK, ...) succeeds. Mirrors
// src/inngest/__tests__/modelRouting.test.ts's makeRejectingClient.
function makeRejectingClient(
  matchSql: string,
  code: string
): { client: PoolClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes(matchSql)) {
      return Promise.reject(Object.assign(new Error(`pg error ${code}`), { code }));
    }
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return { client, query };
}

// ===========================================================================
// Surface 1 — SLA target write
// ===========================================================================

describe("validateSlaPatch", () => {
  it("accepts a bounded response_target_minutes value", () => {
    expect(validateSlaPatch({ response_target_minutes: 120 })).toEqual({
      response_target_minutes: 120,
    });
  });

  it("SLA_TIER — rejects a payload containing sla_tier even alongside a valid key (T-B3)", () => {
    expect(() => validateSlaPatch({ response_target_minutes: 60, sla_tier: "premium" })).toThrow(
      ValidationError
    );
    expect(() => validateSlaPatch({ sla_tier: "premium" })).toThrow(/sla_tier/);
  });

  it("rejects an unknown sla_config key", () => {
    expect(() => validateSlaPatch({ some_other_key: 1 })).toThrow(ValidationError);
  });

  it("rejects a non-integer value", () => {
    expect(() => validateSlaPatch({ response_target_minutes: 12.5 })).toThrow(ValidationError);
  });

  it("BOUNDS — rejects a value below the floor (non-positive)", () => {
    expect(() => validateSlaPatch({ response_target_minutes: 0 })).toThrow(ValidationError);
    expect(() => validateSlaPatch({ response_target_minutes: -5 })).toThrow(ValidationError);
  });

  it("BOUNDS — rejects a value above the ceiling", () => {
    expect(() => validateSlaPatch({ response_target_minutes: 999999 })).toThrow(ValidationError);
  });

  it("rejects a non-object / empty payload", () => {
    expect(() => validateSlaPatch(null)).toThrow(ValidationError);
    expect(() => validateSlaPatch([1, 2])).toThrow(ValidationError);
    expect(() => validateSlaPatch({})).toThrow(ValidationError);
  });
});

describe("updateSlaConfig", () => {
  it("writes via jsonb_set on the named key only, and emits the audit row in the SAME transaction", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [{ sla_config: { response_target_minutes: 240 } }] }, // before
      { rows: [{ sla_config: { response_target_minutes: 90 } }], rowCount: 1 }, // update RETURNING
      { rows: [] }, // audit insert
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const result = await updateSlaConfig(
      pool,
      { projectId: PROJECT_ID, tenantId: TENANT_ID },
      {
        response_target_minutes: 90,
      }
    );

    expect(result).toEqual({
      before: { response_target_minutes: 240 },
      after: { response_target_minutes: 90 },
    });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls[0][0]).toBe("BEGIN");

    const updateCall = calls.find(([sql]) => sql.includes("UPDATE tenants"))!;
    expect(updateCall[0]).toContain("jsonb_set(sla_config, '{response_target_minutes}'");
    // Never a blind blob overwrite: 'SET sla_config = jsonb_set(...)', not 'SET sla_config = $n'.
    expect(updateCall[0]).not.toMatch(/SET sla_config = \$\d+\s/);

    const auditCall = calls.find(([sql]) => sql.includes("INSERT INTO audit_log"))!;
    expect(auditCall[1]).toEqual([
      PROJECT_ID,
      TENANT_ID,
      "dashboard",
      TENANT_ID,
      JSON.stringify({
        before: { response_target_minutes: 240 },
        after: { response_target_minutes: 90 },
      }),
    ]);

    // Audit insert happens strictly between the UPDATE and COMMIT — same txn.
    const updateIdx = calls.findIndex(([sql]) => sql.includes("UPDATE tenants"));
    const auditIdx = calls.findIndex(([sql]) => sql.includes("INSERT INTO audit_log"));
    const commitIdx = calls.findIndex(([sql]) => sql === "COMMIT");
    expect(updateIdx).toBeLessThan(auditIdx);
    expect(auditIdx).toBeLessThan(commitIdx);
  });

  it("NOT FOUND — throws when the tenant is not visible in scope, before attempting any write", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [] }, // before SELECT → no tenant row
    ]);
    const pool = makePool(client);

    await expect(
      updateSlaConfig(
        pool,
        { projectId: PROJECT_ID, tenantId: TENANT_ID },
        { response_target_minutes: 90 }
      )
    ).rejects.toThrow(NotFoundError);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([sql]) => sql.includes("UPDATE tenants"))).toBe(false);
    expect(calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });

  it("FAIL-CLOSED (0 rows) — a 0-row UPDATE (RLS denied / T-72 not applied) is a clear error, not a silent no-op", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config tenant
      { rows: [] }, // set_config project
      { rows: [{ sla_config: {} }] }, // before
      { rows: [], rowCount: 0 }, // UPDATE affects nothing
    ]);
    const pool = makePool(client);

    await expect(
      updateSlaConfig(
        pool,
        { projectId: PROJECT_ID, tenantId: TENANT_ID },
        { response_target_minutes: 90 }
      )
    ).rejects.toThrow(SchemaNotReadyError);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([sql]) => sql.includes("INSERT INTO audit_log"))).toBe(false);
    expect(calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });

  it("ATOMICITY — rolls back (no partial commit) if the audit insert itself fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // set_config tenant
      .mockResolvedValueOnce({ rows: [] }) // set_config project
      .mockResolvedValueOnce({ rows: [{ sla_config: {} }] }) // before
      .mockResolvedValueOnce({
        rows: [{ sla_config: { response_target_minutes: 90 } }],
        rowCount: 1,
      }) // update
      .mockRejectedValueOnce(new Error("audit insert failed")) // audit
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = makePool(client);

    await expect(
      updateSlaConfig(
        pool,
        { projectId: PROJECT_ID, tenantId: TENANT_ID },
        { response_target_minutes: 90 }
      )
    ).rejects.toThrow("audit insert failed");

    expect(query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });
});

// ===========================================================================
// Surface 2 — Model-routing write
// ===========================================================================

describe("validateModelRoutingInput", () => {
  it("accepts a triage write with an allowlisted primary + fallback", () => {
    expect(
      validateModelRoutingInput({
        functionKey: "triage",
        primaryModel: "triage-model",
        fallbackModel: "fallback-model",
      })
    ).toEqual({
      functionKey: "triage",
      primaryModel: "triage-model",
      fallbackModel: "fallback-model",
    });
  });

  it("accepts a respond write with no fallback", () => {
    expect(
      validateModelRoutingInput({ functionKey: "respond", primaryModel: "triage-model" })
    ).toEqual({
      functionKey: "respond",
      primaryModel: "triage-model",
      fallbackModel: null,
    });
  });

  it("rejects an unknown functionKey", () => {
    expect(() =>
      validateModelRoutingInput({ functionKey: "bogus", primaryModel: "triage-model" })
    ).toThrow(ValidationError);
  });

  it("ALLOWLIST — rejects a primaryModel not in the curated allowlist (T-79)", () => {
    expect(() =>
      validateModelRoutingInput({ functionKey: "triage", primaryModel: "gpt-4-turbo-unvetted" })
    ).toThrow(ValidationError);
  });

  // T-100 note: `meta/llama-3.3-70b-instruct` is no longer a valid "excluded"
  // example — it cleared a recorded >95% live vetting eval for triage AND respond
  // (run 29199758667) and is now allowlisted for all three functions. The
  // protective invariant this test guards — registration is NOT allowlist
  // admission, and vetting is PER-FUNCTION — is now demonstrated with
  // `fallback-model`: a registered alias that IS allowlisted for triage but was
  // never vetted for respond, so it must still be rejected for respond.
  it("ALLOWLIST — rejects a registered alias not vetted for THIS function (fallback-model is allowlisted for triage, NOT for respond) — per-function gating, T-79/T-100", () => {
    expect(() =>
      validateModelRoutingInput({
        functionKey: "respond",
        primaryModel: "fallback-model",
      })
    ).toThrow(ValidationError);
  });

  // Positive companion: meta/llama IS now accepted for respond (T-100 vetted it
  // at 4/4 live). Pins the new post-T-100 behaviour so a future accidental
  // removal from the allowlist is caught here too.
  it("ALLOWLIST — accepts meta/llama for respond now that T-100 vetted it live (>95%)", () => {
    expect(() =>
      validateModelRoutingInput({
        functionKey: "respond",
        primaryModel: "meta/llama-3.3-70b-instruct",
      })
    ).not.toThrow();
  });

  it("FALLBACK SCOPE — rejects a fallbackModel for respond (primary-only this sprint)", () => {
    expect(() =>
      validateModelRoutingInput({
        functionKey: "respond",
        primaryModel: "triage-model",
        fallbackModel: "triage-model",
      })
    ).toThrow(ValidationError);
  });

  it("FALLBACK SCOPE — rejects a fallbackModel for kb_learn", () => {
    expect(() =>
      validateModelRoutingInput({
        functionKey: "kb_learn",
        primaryModel: "triage-model",
        fallbackModel: "triage-model",
      })
    ).toThrow(ValidationError);
  });

  // T-100 note: was `fallbackModel: "meta/llama-3.3-70b-instruct"`, which is now
  // allowlisted for triage (vetted live, run 29199758667) and would no longer
  // throw. Swapped to a plainly non-allowlisted alias so the intent — a
  // fallbackModel not on triage's list is rejected even though triage HAS a
  // fallback slot — is preserved.
  it("rejects a fallbackModel that is itself not allowlisted, even for triage", () => {
    expect(() =>
      validateModelRoutingInput({
        functionKey: "triage",
        primaryModel: "triage-model",
        fallbackModel: "gpt-4-turbo-unvetted",
      })
    ).toThrow(ValidationError);
  });
});

describe("upsertModelRouting", () => {
  it("upserts and emits a project-scoped, NULL-tenant audit row in the SAME transaction", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config project
      { rows: [] }, // before SELECT → no existing row
      {
        rows: [{ id: "amr-1", primary_model: "triage-model", fallback_model: "fallback-model" }],
        rowCount: 1,
      }, // INSERT ... RETURNING
      { rows: [] }, // audit insert
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const result = await upsertModelRouting(
      pool,
      { projectId: PROJECT_ID },
      { functionKey: "triage", primaryModel: "triage-model", fallbackModel: "fallback-model" }
    );

    expect(result.before).toBeNull();
    expect(result.after).toEqual({
      id: "amr-1",
      primary_model: "triage-model",
      fallback_model: "fallback-model",
    });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    const insertCall = calls.find(([sql]) => sql.includes("INSERT INTO agent_model_routing"))!;
    expect(insertCall[0]).toContain("ON CONFLICT (project_id, function_key)");
    expect(insertCall[0]).not.toMatch(/DELETE/i);

    const auditCall = calls.find(([sql]) => sql.includes("INSERT INTO audit_log"))!;
    expect(auditCall[0]).toContain("VALUES ($1, NULL, $2");
    expect(auditCall[1]?.[0]).toBe(PROJECT_ID);
    expect(auditCall[1]?.[1]).toBe("dashboard");
  });

  it("PRE-MIGRATION — a missing agent_model_routing table (T-72 not applied) is a clear SchemaNotReadyError, not a crash", async () => {
    const { client } = makeRejectingClient("INSERT INTO agent_model_routing", "42P01");
    const pool = makePool(client);

    await expect(
      upsertModelRouting(
        pool,
        { projectId: PROJECT_ID },
        { functionKey: "triage", primaryModel: "triage-model", fallbackModel: null }
      )
    ).rejects.toThrow(SchemaNotReadyError);
  });

  it("FAIL-CLOSED (0 rows) — RLS denying the write is a clear error, not a silent no-op", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config project
      { rows: [] }, // before
      { rows: [], rowCount: 0 }, // INSERT affects nothing
    ]);
    const pool = makePool(client);

    await expect(
      upsertModelRouting(
        pool,
        { projectId: PROJECT_ID },
        { functionKey: "respond", primaryModel: "triage-model", fallbackModel: null }
      )
    ).rejects.toThrow(SchemaNotReadyError);
  });
});

// ===========================================================================
// Surface 3 — Feature-flag toggle
// ===========================================================================

describe("validateFeatureFlagInput", () => {
  const VALID_ID = "11111111-2222-3333-4444-555555555555";

  it("accepts a well-formed toggle payload", () => {
    expect(
      validateFeatureFlagInput({ id: VALID_ID, enabled: true, rolloutPercentage: 50 })
    ).toEqual({
      id: VALID_ID,
      enabled: true,
      rolloutPercentage: 50,
    });
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      validateFeatureFlagInput({ id: "not-a-uuid", enabled: true, rolloutPercentage: 0 })
    ).toThrow(ValidationError);
  });

  it("rejects a non-boolean enabled", () => {
    expect(() =>
      validateFeatureFlagInput({ id: VALID_ID, enabled: "yes", rolloutPercentage: 0 })
    ).toThrow(ValidationError);
  });

  it("rejects an out-of-range rolloutPercentage", () => {
    expect(() =>
      validateFeatureFlagInput({ id: VALID_ID, enabled: true, rolloutPercentage: 101 })
    ).toThrow(ValidationError);
    expect(() =>
      validateFeatureFlagInput({ id: VALID_ID, enabled: true, rolloutPercentage: -1 })
    ).toThrow(ValidationError);
  });
});

describe("toggleFeatureFlag", () => {
  const FLAG_ID = "11111111-2222-3333-4444-555555555555";

  it("UPDATE-ONLY — updates an existing row and never issues INSERT/DELETE", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config project
      { rows: [{ id: FLAG_ID, enabled: false, rollout_percentage: 0 }] }, // before
      { rows: [{ id: FLAG_ID, enabled: true, rollout_percentage: 50 }], rowCount: 1 }, // UPDATE RETURNING
      { rows: [] }, // audit insert
      { rows: [] }, // COMMIT
    ]);
    const pool = makePool(client);

    const result = await toggleFeatureFlag(
      pool,
      { projectId: PROJECT_ID },
      { id: FLAG_ID, enabled: true, rolloutPercentage: 50 }
    );

    expect(result).toEqual({
      before: { id: FLAG_ID, enabled: false, rollout_percentage: 0 },
      after: { id: FLAG_ID, enabled: true, rollout_percentage: 50 },
    });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([sql]) => /INSERT INTO feature_flags/i.test(sql))).toBe(false);
    expect(calls.some(([sql]) => /DELETE FROM feature_flags/i.test(sql))).toBe(false);
    const updateCall = calls.find(([sql]) => sql.includes("UPDATE feature_flags"))!;
    expect(updateCall[0]).toContain("WHERE id = $3 AND project_id = $4");
  });

  it("NOT FOUND — an unknown/out-of-scope id is a 404, never a create", async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config project
      { rows: [] }, // before SELECT → no matching row
    ]);
    const pool = makePool(client);

    await expect(
      toggleFeatureFlag(
        pool,
        { projectId: PROJECT_ID },
        { id: FLAG_ID, enabled: true, rolloutPercentage: 10 }
      )
    ).rejects.toThrow(NotFoundError);

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    expect(calls.some(([sql]) => /UPDATE feature_flags/i.test(sql))).toBe(false);
    expect(calls.some(([sql]) => /INSERT INTO feature_flags/i.test(sql))).toBe(false);
  });
});
