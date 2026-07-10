import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { handleLitellmInternalHealth } from "../healthLitellmInternal";

/**
 * T-97 (FQ-69 follow-up) — live proof that `handleLitellmInternalHealth`
 * (the REAL handler code, not a mock) correctly maps a genuine rejection from
 * a real LiteLLM instance into the 503 `auth_rejected` alert-worthy response.
 *
 * WHY THIS EXISTS AS A LIVE INTEGRATION TEST, NOT JUST A UNIT TEST
 * -----------------------------------------------------------------
 * `healthLitellmInternal.test.ts` proves the handler's *logic* against a
 * mocked fetch. That is necessary but not sufficient: the advisor review for
 * this task flagged that mocking `resp.status === 401` only proves the
 * handler's branching is correct IF LiteLLM really does reject a bad key with
 * 401 — it does not prove that assumption is true. This test closes that gap
 * by running the real handler against the real litellm-staging instance
 * (network egress available in CI, per the existing `src/integration/`
 * convention — see rls-isolation.test.ts) with a deliberately-wrong bearer
 * token. No real credential is read, held, or mutated for this half of the
 * test — the bad key is a hardcoded, obviously-fake literal.
 *
 * The companion "good key" case proves the clean/authenticated path also
 * works end-to-end against a real instance, but that half needs the real
 * `LITELLM_MASTER_KEY` and self-skips (does not fail) when it is absent.
 *
 * WHY THIS WHOLE FILE SKIPS UNLESS EXPLICITLY OPTED IN (T97_LIVE_PROBE=1)
 * ------------------------------------------------------------------------
 * The bad-key case needs no secret, so an earlier version of this test ran
 * unconditionally under plain `vitest run` — which is what `pnpm test` runs.
 * `pnpm test` is not just the PR-check "Unit Tests" step; it is ALSO the gate
 * `main-deploy.yml` runs before building/pushing/deploying to staging (no
 * separate `pnpm test:integration` step exists there). A transient network
 * hiccup against the real litellm-staging instance turned a verification
 * test into a flaky deploy-blocking dependency the first time it ran in that
 * context (observed directly: "expected 'unreachable' to be 'auth_rejected'"
 * on a `main-deploy.yml` run immediately after merge). That is the opposite
 * of what a hardening task should add. So this file now self-skips by
 * default everywhere (same "skip, don't fail, when not configured to run"
 * convention as every other src/integration/ test), gated on the explicit
 * opt-in env var below rather than on secret presence, and is run
 * deliberately (via .github/workflows/verify-litellm-internal-health-handler.yml,
 * not automatically on every push) to produce the live proof — see
 * DECISIONS.md's T-97 entry for the run that observed both cases pass.
 */

const RUN_LIVE_PROBE = process.env.T97_LIVE_PROBE === "1";

const LITELLM_STAGING_EXTERNAL_URL = "https://litellm-staging.inatechshell.ca";
// Deliberately invalid — not a real secret, safe to hardcode. Its only job is
// to make LiteLLM's own auth check reject it, the same way it would reject a
// real app key that had drifted out of sync (FQ-69's actual root cause).
const DELIBERATELY_BAD_KEY = "sk-t97-deliberately-invalid-test-key-00000000";

const REAL_LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY;

function makeRes(): [http.ServerResponse, Promise<{ status: number; body: string }>] {
  let resolve!: (v: { status: number; body: string }) => void;
  const promise = new Promise<{ status: number; body: string }>((r) => {
    resolve = r;
  });
  let status = 200;
  let body = "";
  const res = {
    writeHead: (s: number) => {
      status = s;
    },
    end: (b?: string) => {
      body = b ?? "";
      resolve({ status, body });
    },
  } as unknown as http.ServerResponse;
  return [res, promise];
}

describe.skipIf(!RUN_LIVE_PROBE)(
  "handleLitellmInternalHealth — live against litellm-staging",
  () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // Runs only with T97_LIVE_PROBE=1 (see file header). Proves the REAL
    // handler code, hitting a REAL LiteLLM instance, with a wrong key,
    // produces the 503 auth_rejected response the T-97 monitor depends on.
    // No secret required — the opt-in gate above is what keeps this out of
    // the deploy hot path, not a missing-credential skip.
    it("returns 503 auth_rejected when the real litellm-staging instance rejects a deliberately-wrong key", async () => {
      vi.stubEnv("LITELLM_URL", LITELLM_STAGING_EXTERNAL_URL);
      vi.stubEnv("LITELLM_MASTER_KEY", DELIBERATELY_BAD_KEY);
      vi.stubEnv("LITELLM_TRIAGE_MODEL", "triage-model");

      const [res, done] = makeRes();
      void handleLitellmInternalHealth({} as http.IncomingMessage, res);
      const { status, body } = await done;

      expect(status).toBe(503);
      const parsed = JSON.parse(body) as { litellm_internal: string; httpStatus?: number };
      expect(parsed.litellm_internal).toBe("auth_rejected");
      expect(parsed.httpStatus).toBe(401);
    }, 15_000);

    // Self-skips without failing CI when LITELLM_MASTER_KEY is absent (pr-checks.yml's
    // hermetic pull_request trigger never sets it — same convention as every other
    // src/integration/ test). Run manually (workflow_dispatch with the secret) to
    // prove the clean/authenticated path also works end-to-end against a real
    // instance, not just a mock.
    it.skipIf(!REAL_LITELLM_MASTER_KEY)(
      "returns 200 reachable_and_authenticated with the real LITELLM_MASTER_KEY",
      async () => {
        vi.stubEnv("LITELLM_URL", LITELLM_STAGING_EXTERNAL_URL);
        vi.stubEnv("LITELLM_MASTER_KEY", REAL_LITELLM_MASTER_KEY as string);
        vi.stubEnv("LITELLM_TRIAGE_MODEL", "triage-model");

        const [res, done] = makeRes();
        void handleLitellmInternalHealth({} as http.IncomingMessage, res);
        const { status, body } = await done;

        expect(status).toBe(200);
        expect(JSON.parse(body)).toEqual({
          status: "ok",
          litellm_internal: "reachable_and_authenticated",
        });
      },
      15_000
    );

    if (!REAL_LITELLM_MASTER_KEY) {
      console.warn(
        "SKIPPED: no LITELLM_MASTER_KEY — the good-key half of the T-97 live proof " +
          "requires the real staging master key. Run with it set (e.g. via " +
          "workflow_dispatch secrets) to exercise the authenticated path live."
      );
    }
  }
);
