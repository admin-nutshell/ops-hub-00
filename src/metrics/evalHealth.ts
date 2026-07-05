import type { Pool } from "pg";

// Query layer for the ops dashboard's "eval health" pillar (T-58 → T-59).
//
// WHY THIS FILE EXISTS AND IS DELIBERATELY SIMPLE: T-17's `Eval Gate` CI job
// runs `promptfoo validate` — schema validation only, no LLM-rubric grading,
// no pass-rate against real agent behavior. The `eval_gate_runs` table
// (migration 20260704010000_t58_agent_cost_eval_health.sql) is READY to store
// real graded runs (run_type='llm_rubric') but nothing writes to it yet — that
// real gate is Evals Lead / Tech Lead follow-up work, out of scope for this
// task (Data Engineer owns the storage/query layer, not eval design; see
// CLAUDE.md team boundaries). Building this query function so it returns a
// fabricated or schema-check-derived "pass rate" when the table is empty would
// be actively misleading to the founder reading the dashboard — the charter's
// KPI is a real behavioral pass rate, not "did the YAML parse." So: this
// function returns an explicit PENDING status with no numbers attached
// whenever no llm_rubric row exists, and only ever returns a rate once a real
// graded run has been recorded.

export type EvalHealthResult =
  | {
      status: "pending";
      message: string;
    }
  | {
      status: "pass" | "fail";
      passRate: number | null;
      totalCases: number | null;
      passedCases: number | null;
      ciRunAt: string;
      gitSha: string | null;
      workflowRunUrl: string | null;
    };

type EvalGateRunRow = {
  status: "pass" | "fail";
  pass_rate: string | null; // numeric columns come back as strings from `pg`
  total_cases: number | null;
  passed_cases: number | null;
  ci_run_at: string;
  git_sha: string | null;
  workflow_run_url: string | null;
};

// Reads the most recent REAL quality-graded eval-gate run (run_type =
// 'llm_rubric' only — schema_validation rows, if any ever exist, are never
// read by this function). project_id is nullable/platform-wide in the schema
// (see migration), so no tenant/project GUC is required for this query: it is
// not tenant data, it's CI health data shared across the whole platform.
export async function getEvalHealth(pool: Pool): Promise<EvalHealthResult> {
  const { rows } = await pool.query<EvalGateRunRow>(
    `SELECT status, pass_rate, total_cases, passed_cases, ci_run_at, git_sha, workflow_run_url
       FROM eval_gate_runs
      WHERE run_type = 'llm_rubric'
      ORDER BY ci_run_at DESC
      LIMIT 1`
  );

  const latest = rows[0];
  if (!latest) {
    return {
      status: "pending",
      message:
        "No eval-quality runs yet — pending real gate. T-17's Eval Gate is schema-validation " +
        "only (promptfoo validate); it does not measure agent behavior and is not surfaced here.",
    };
  }

  return {
    status: latest.status,
    passRate: latest.pass_rate !== null ? Number(latest.pass_rate) : null,
    totalCases: latest.total_cases,
    passedCases: latest.passed_cases,
    ciRunAt: latest.ci_run_at,
    gitSha: latest.git_sha,
    workflowRunUrl: latest.workflow_run_url,
  };
}

export type EvalGateRunRecord = {
  projectId?: string | null;
  runType: "schema_validation" | "llm_rubric";
  status: "pass" | "fail";
  totalCases?: number | null;
  passedCases?: number | null;
  gitSha?: string | null;
  workflowRunUrl?: string | null;
  ciRunAt: string;
  notes?: string | null;
};

// Writer, provided now so the day the real LLM-rubric gate exists it has
// somewhere to write to without a schema change. NOT called from CI today —
// wiring it up needs a scoped DB credential in CI (a new GitHub secret) and is
// Evals Lead/Tech Lead's call once the real gate is built, not this task's.
export async function recordEvalGateRun(pool: Pool, run: EvalGateRunRecord): Promise<void> {
  await pool.query(
    `INSERT INTO eval_gate_runs
       (project_id, run_type, status, total_cases, passed_cases, git_sha, workflow_run_url, ci_run_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      run.projectId ?? null,
      run.runType,
      run.status,
      run.totalCases ?? null,
      run.passedCases ?? null,
      run.gitSha ?? null,
      run.workflowRunUrl ?? null,
      run.ciRunAt,
      run.notes ?? null,
    ]
  );
}
