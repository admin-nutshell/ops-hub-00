// src/config/model-allowlist.ts
//
// CURATED MODEL-ROUTING ALLOWLIST — the single source of truth for which
// LiteLLM aliases the Ops Dashboard's per-function model-routing editor is
// allowed to select (ADR-0006 Decision A + T-B1; Sprint 7, T-79).
//
// WHY THIS FILE EXISTS
// --------------------
// Letting a human pick any model from the dashboard is a *runtime capability
// change that bypasses CI* — exactly what CLAUDE.md's standing "no prompt or
// capability change ships without passing the eval gate" constraint governs.
// A live LLM-rubric eval gate now EXISTS (ADR-0007, `live-eval-gate`, live
// 2026-07-12) — but it is a PR-time check, so a runtime dashboard model-routing
// change never passes through it at all. This allowlist is therefore still
// load-bearing: ADR-0006 T-B1 restricts the dropdown to a fixed allowlist so a
// dashboard click can only ever *choose among* aliases already accepted in
// production — it can never *introduce* a new, unvetted model at runtime. The
// live gate is what ADMITS an alias to this list (see PROCESS below); the
// allowlist is what constrains selection between CI runs. Two layers, not one.
//
// WHAT "ALLOWED" ACTUALLY MEANS (read this before adding to the list)
// -------------------------------------------------------------------
// An alias is in a function's list iff (1) holds AND at least one of (2a)/(2b):
//   (1) it is a currently-registered LiteLLM alias (DECISIONS.md 2026-07-04:
//       `triage-model`, `fallback-model`, `meta/llama-3.3-70b-instruct` persist
//       across restart with a working completion), AND EITHER
//   (2a) it is the model that function ALREADY RUNS in production today
//       (verified call sites: ticket-triage.ts uses `triage-model` primary +
//       `fallback-model` fallback; ticket-respond.ts and kb-learn.ts both run
//       `triage-model`), OR
//   (2b) it has CLEARED a recorded >95% live per-target-model vetting eval for
//       THAT function — the PROCESS path below, recorded in DECISIONS.md. This is
//       the admission route T-79 always specified for widening a list beyond the
//       single current-production model; the live eval IS the vetting.
// Most entries qualify via (2a) ONLY, and for those this is deliberately NOT a
// claim that the alias "passed a live eval": the eval suite
// (evals/ticket-triage.yaml, evals/ticket-respond.yaml) pins the PROMPT CONTRACT
// against one reference model (anthropic:claude-sonnet-4-6), while these aliases
// route elsewhere inside LiteLLM (e.g. `triage-model` currently resolves to
// gpt-4o-mini). For (2a) entries the honest guarantee is narrower and truer: the
// allowlist freezes the production-accepted choice-set so the dashboard cannot
// EXPAND it to an un-vetted model. That is what T-B1 asks for.
// The (2b) entries are all `meta/llama-3.3-70b-instruct` — a registered standalone
// NVIDIA-NIM alias that runs NONE of the three functions in production, but has now
// cleared a recorded >95% live per-target-model vetting eval for each of the three
// functions, each recorded separately (vetting is PER-FUNCTION and does not transfer):
//   - kb_learn : evals/kb-learn.yaml LIVE 4/4 (100%), judge=triage-model,
//     grader != target (§5.3), T-91 guards green — T-96 C7, DECISIONS.md 2026-07-12,
//     run 29180466358.
//   - triage   : evals/ticket-triage.yaml LIVE 4/4 (100%), judge=fallback-model,
//     grader != target (§5.3), T-91 guards green (token-band [124,520], canaries 2/2)
//     — T-100, DECISIONS.md 2026-07-12, run 29199758667.
//   - respond  : evals/ticket-respond.yaml LIVE 4/4 (100%), judge=fallback-model,
//     grader != target (§5.3), T-91 guards green (token-band [191,943], canaries 2/2)
//     — T-100, DECISIONS.md 2026-07-12, run 29199758667.
// So the blanket "no alias has a live per-target-model pass" that used to sit here is
// now false for these (function, alias) pairs, by design.
//
// IMPORTANT — the per-function invariant still holds even though meta/llama is now
// listed for all three functions: each listing is backed by its OWN recorded eval,
// NOT auto-transferred from another function's pass. `meta/llama-3.3-70b-instruct`
// runs none of the functions in production; it is admitted to each list purely via
// path (2b). Had it passed triage but NOT respond, it would be listed for triage
// only — a model listed for one function is never auto-listed for another.
//
// PROCESS — ADDING A NEW SELECTABLE ALIAS REQUIRES AN EVAL PASS FIRST
// -------------------------------------------------------------------
// This list is append-controlled, not free-text. Admitting a new alias to a
// function's list requires a recorded >95% live eval pass (grader != target,
// ADR-0007 §5.3) for THAT (function, alias) pair first — the (2b) route above.
//
// PRIMARY ADMISSION PATH — the now-live LLM-rubric gate (T-95, ADR-0007 §8).
// The "real" live eval gate designed in ADR-0007 is BUILT and is a required,
// merge-blocking status check on `main` — `live-eval-gate`
// (.github/workflows/eval-gate-live.yml; T-89–T-94, live 2026-07-12). Its shared
// runner (scripts/eval/live-run.sh, T-89) with the T-91 calibration guards is now
// the automated vetting mechanism that REPLACES the old hand-run `promptfoo eval`.
// To make a new alias selectable for a function:
//   (1) register the alias in LiteLLM;
//   (2) vet it via the shared runner with THE NEW ALIAS AS TARGET — dispatch
//       eval-gate-live.yml (or run-*-eval.yml) with TARGET_ALIAS=<new alias> and a
//       JUDGE_ALIAS != target (grader != target), all T-91 guards green, clearing
//       >95%; the run persists to eval_gate_runs and is linked in DECISIONS.md.
//   (3) only then add the alias here in the same PR that records the eval result.
// IMPORTANT nuance (don't re-drift this): the gate's AUTO `pull_request` trigger
// runs each function's eval against the DEFAULT production target to catch
// REGRESSIONS in the existing prompts — it does NOT, by itself, evaluate a
// newly-added alias. A new alias needs the TARGETED dispatch in step (2).
// Worked example: T-96 (DECISIONS.md 2026-07-12) admitted
// `meta/llama-3.3-70b-instruct` to `kb_learn` by dispatching the shared runner at
// TARGET=meta/llama-3.3-70b-instruct, JUDGE=triage-model (grader != target),
// scoped LITELLM_EVAL_KEY (never the master key), 4/4 (100%), guards green
// (run 29180466358) — then adding it here in the same PR.
//
// FALLBACK (retained, not deleted — ADR-0007 §8 "coexist"): a fully-manual local
// `promptfoo eval` run against the alias's target model via LiteLLM, cleared >95%
// and hand-recorded in DECISIONS.md, then added here in the same PR. Kept only for
// a scheduling edge case where the CI gate/runner is unavailable; the automated
// path above is preferred.
//
// Removing an alias needs no eval. The gate AUTOMATES this admission step; it does
// NOT replace this allowlist, which remains the SELECTION constraint (ADR-0007 §8).
// This keeps the standing eval-gate constraint enforced by construction.
//
// SCOPE BOUNDARY: this allowlist constrains which aliases the dashboard may
// SELECT. It does not, and cannot, constrain what each alias RESOLVES TO inside
// LiteLLM — remapping an alias to a different provider is a LiteLLM master-key
// admin action, out of this surface's scope (ADR-0006 T-B4).
//
// CONSUMERS: T-73 backend `resolveModelRouting()` validates a persisted/edited
// value against this list; T-75 dashboard sources the dropdown from it and
// re-validates before submit. `web/` is a separate tsconfig — if it cannot
// import across the package boundary, it must MIRROR this file with a
// "source of truth: src/config/model-allowlist.ts" pointer, and both must be
// updated together.

/**
 * The three routable agent functions. Keys match the DB CHECK constraint on
 * `agent_model_routing.function_key` exactly (`'triage' | 'respond' | 'kb_learn'`,
 * T-72) so `MODEL_ROUTING_ALLOWLIST[functionKey]` indexes directly.
 */
export type RoutingFunctionKey = "triage" | "respond" | "kb_learn";

/**
 * Per-function curated allowlist of selectable LiteLLM alias strings.
 *
 * The list differs by function because the functions' production posture
 * differs (per ADR-0006): only Triage carries a fallback this sprint, so only
 * Triage may select `fallback-model`; Respond and KB Learn are primary-only.
 */
export const MODEL_ROUTING_ALLOWLIST: Readonly<Record<RoutingFunctionKey, readonly string[]>> = {
  // Triage runs `triage-model` (primary) + `fallback-model` (fallback) today
  // (both (2a) production entries) and is the only function with prompt-eval
  // coverage of BOTH slots (evals/ticket-triage.yaml exercises the primary
  // contract; ticket-triage.test.ts exercises the primary→fallback path). Both
  // production aliases are selectable for either the primary or the fallback
  // picker. `meta/llama-3.3-70b-instruct` is the (2b) entry: it runs NONE of
  // triage in production, but cleared evals/ticket-triage.yaml LIVE at 4/4
  // (100%) against its own NVIDIA-backed target, judge=fallback-model
  // (grader != target, §5.3), all T-91 guards green (token-band [124,520],
  // canaries 2/2) — T-100, DECISIONS.md 2026-07-12, run 29199758667. First
  // live-vetted (2b) alias for triage.
  triage: ["triage-model", "fallback-model", "meta/llama-3.3-70b-instruct"],

  // Respond runs `triage-model` today (ticket-respond.ts) — the (2a) entry.
  // Prompt-eval covered by evals/ticket-respond.yaml. Primary-only this sprint
  // (no fallback logic for Respond). `meta/llama-3.3-70b-instruct` is the (2b)
  // entry: it runs NONE of respond in production, but cleared
  // evals/ticket-respond.yaml LIVE at 4/4 (100%) against its own NVIDIA-backed
  // target, judge=fallback-model (grader != target, §5.3), all T-91 guards green
  // (token-band [191,943], canaries 2/2) — T-100, DECISIONS.md 2026-07-12,
  // run 29199758667. Its urgency-matched, non-fabricating draft replies passed
  // the behavioural rubric; the dashboard may now select either alias for respond.
  respond: ["triage-model", "meta/llama-3.3-70b-instruct"],

  // KB Learn runs `triage-model` today (kb-learn.ts) — the (2a) entry.
  // `meta/llama-3.3-70b-instruct` is the (2b) entry: the coverage gap that once
  // forced this list to a single pin is closed. evals/kb-learn.yaml now exists
  // (T-84/T-88, 100% twice on the prompt-contract reference) AND the candidate
  // cleared it LIVE against its own NVIDIA-backed target at 4/4 (100%),
  // judge=triage-model (grader != target), all T-91 guards green — T-96 C7,
  // DECISIONS.md 2026-07-12, run 29180466358. Two vetted aliases now; the
  // dashboard may select either for kb_learn. Any THIRD alias needs its own
  // recorded >95% run first, per the PROCESS section above.
  kb_learn: ["triage-model", "meta/llama-3.3-70b-instruct"],
} as const;

/**
 * True iff `alias` is allowed for `functionKey`. Backend (T-73) and UI (T-75)
 * both call this before persisting/submitting a routing value, so a typo or an
 * unvetted alias can never take a production function offline.
 */
export function isAllowedModel(functionKey: RoutingFunctionKey, alias: string): boolean {
  return MODEL_ROUTING_ALLOWLIST[functionKey]?.includes(alias) ?? false;
}
