// src/config/model-allowlist.ts
//
// CURATED MODEL-ROUTING ALLOWLIST — the single source of truth for which
// LiteLLM aliases the Ops Dashboard's per-function model-routing editor is
// allowed to select (ADR-0006 Decision A + T-B1; Sprint 7, T-79).
//
// WHY THIS FILE EXISTS
// --------------------
// Letting a human pick any model from the dashboard is a *runtime capability
// change that bypasses CI* — exactly what CLAUDE.md's standing "no capability
// change ships without passing the Promptfoo eval suite" constraint governs.
// Today that CI gate is schema-validation-only (WORK.md T-58), so there is no
// live model-quality gate to catch a bad runtime swap. ADR-0006 T-B1 resolves
// this WITHOUT waiting on a real live eval gate (option (a)): restrict the
// dropdown to a fixed allowlist, so a dashboard click can only ever *choose
// among* aliases already accepted in production — it can never *introduce* a
// new, unvetted model. The gate is enforced by freezing the choice-set, not by
// running evals live on every click.
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
// The ONE (2b) entry so far is `meta/llama-3.3-70b-instruct` on `kb_learn`: it
// does NOT run kb_learn in production, but it cleared evals/kb-learn.yaml LIVE at
// 4/4 (100%) against its real NVIDIA-backed target, judge=triage-model
// (grader != target, ADR-0007 §5.3), all T-91 calibration guards green — T-96 C7,
// DECISIONS.md 2026-07-12, run 29180466358. So the blanket "no alias has a live
// per-target-model pass" that used to sit here is now false for exactly that one
// (function, alias) pair, by design.
//
// `meta/llama-3.3-70b-instruct` is a registered standalone NVIDIA-NIM alias that
// runs NONE of the three functions in production. It stays EXCLUDED from `triage`
// and `respond`: no vetting eval has been run for it on those prompts, so exposing
// it there would be precisely the un-vetted runtime swap this file exists to
// prevent. It is INCLUDED for `kb_learn` ONLY, admitted via path (2b) above
// (T-96 C7 vetting, run 29180466358). Vetting is PER-FUNCTION and does not
// transfer — a separate recorded >95% eval is required before this alias may be
// added to `triage` or `respond`.
//
// PROCESS — ADDING A NEW SELECTABLE ALIAS REQUIRES AN EVAL PASS FIRST
// -------------------------------------------------------------------
// This list is append-controlled, not free-text. To make a new alias
// selectable for a function: (1) register the alias in LiteLLM; (2) run that
// function's promptfoo eval against THAT ALIAS'S TARGET MODEL (not just the
// pinned claude-sonnet-4-6 reference) and clear >95% — until the live
// multi-provider gate (ADR-0006 T-B1 option (b), deferred to Sprint 8) exists,
// this is a manual `promptfoo eval` run via LiteLLM/LiteLLM providers, recorded
// in DECISIONS.md; (3) only then add the alias here in the same PR that records
// the eval result. Removing an alias needs no eval. This keeps the standing
// eval-gate constraint enforced by construction.
//
// NOTE (T-93): the "live multi-provider gate" referenced above is now WIRED as a
// sibling CI workflow — .github/workflows/eval-gate-live.yml (path-filtered
// pull_request, grader != target, scoped LITELLM_EVAL_KEY only). It is not yet a
// required merge check (T-94) and is dormant while fallback-model is FQ-70-blocked;
// this PROCESS block is reconciled to point at it in T-95 once the gate enforces.
// (This comment also serves as the path-filtered trigger proving T-93's wiring.)
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
  // and is the only function with prompt-eval coverage of BOTH slots
  // (evals/ticket-triage.yaml exercises the primary contract;
  // ticket-triage.test.ts exercises the primary→fallback path). Both aliases
  // are selectable for either the primary or the fallback picker.
  triage: ["triage-model", "fallback-model"],

  // Respond runs `triage-model` today (ticket-respond.ts). Prompt-eval covered
  // by evals/ticket-respond.yaml. Primary-only this sprint (no fallback logic
  // for Respond — deferred to Sprint 8), so only the current production model
  // is offered.
  respond: ["triage-model"],

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
