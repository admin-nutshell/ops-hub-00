import { describe, expect, it, vi } from "vitest";
import { getEvalHealth, recordEvalGateRun } from "../evalHealth";
import type { Pool } from "pg";

function makePoolWithRows(rows: Record<string, unknown>[]): Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

describe("getEvalHealth", () => {
  it("returns an explicit pending status — never a fabricated pass rate — when no llm_rubric run exists", async () => {
    const pool = makePoolWithRows([]);
    const result = await getEvalHealth(pool);
    expect(result.status).toBe("pending");
    if (result.status === "pending") {
      expect(result.message).toMatch(/pending real gate/i);
      expect(result.message).toMatch(/schema-validation/i);
    }
    // Confirm the query is scoped to run_type = 'llm_rubric' only — a
    // schema_validation row must never surface here even if one existed.
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("run_type = 'llm_rubric'");
  });

  it("returns the real pass rate when a graded run exists", async () => {
    const pool = makePoolWithRows([
      {
        status: "pass",
        pass_rate: "0.9700",
        total_cases: 33,
        passed_cases: 32,
        ci_run_at: "2026-07-04T10:00:00.000Z",
        git_sha: "abc1234",
        workflow_run_url: "https://github.com/admin-nutshell/ops-hub-00/actions/runs/1",
      },
    ]);
    const result = await getEvalHealth(pool);
    expect(result.status).toBe("pass");
    if (result.status !== "pending") {
      expect(result.passRate).toBe(0.97);
      expect(result.totalCases).toBe(33);
      expect(result.passedCases).toBe(32);
    }
  });
});

describe("recordEvalGateRun", () => {
  it("inserts a row with the given run_type and fields", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    await recordEvalGateRun(pool, {
      runType: "llm_rubric",
      status: "pass",
      totalCases: 33,
      passedCases: 32,
      gitSha: "abc1234",
      workflowRunUrl: "https://example.test/run/1",
      ciRunAt: "2026-07-04T10:00:00.000Z",
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO eval_gate_runs");
    expect(params).toEqual([
      null,
      "llm_rubric",
      "pass",
      33,
      32,
      "abc1234",
      "https://example.test/run/1",
      "2026-07-04T10:00:00.000Z",
      null,
    ]);
  });
});
