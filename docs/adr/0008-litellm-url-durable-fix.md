# ADR-0008 — Durable Fix for the `LITELLM_URL` Redeploy-Orphan Class: Design of Record (build deferred to Sprint 12)

- **Status:** Accepted (Tech Lead architecture author + independent Production Manager review appended — see the review section; verdict: approved as the design-of-record, with the Option-1 feasibility spike as build-task #1 and Option 2 as the pre-committed fallback). Build deferred to Sprint 12 (ADR-then-build precedent, same as ADR-0007). Build is out of scope — this ADR is the decision-of-record the Sprint 12 build is sized from.
- **Date:** 2026-07-12
- **Author:** Tech Lead (Architecture)
- **Deciders:** Tech Lead (design of record, option selection — author); Production Manager (Coolify network-model feasibility + the concrete re-pin/restart execution — independent review appended below); Security Lead (only a lightweight no-new-secret-surface confirmation at build time — see §4; the chosen option deliberately touches no credential); Founder (only if the feasibility spike forces a paid Coolify tier or a vendor commitment > 12 months — none anticipated by this design).
- **Supersedes:** none. **Retires in steady state:** the manual re-align ritual of `fix-ops-hub-prod-litellm-url.yml` and `update-litellm-suffix.yml` (T-45) as the *routine* answer — they remain as break-glass tools.
- **Related:** T-71 (first instance — 100%-triage-failure on a stale suffix), FQ-69's URL sub-issue (second instance — stale `LITELLM_URL` stacked under the master-key rejection, DECISIONS.md 2026-07-09), FQ-76 (third instance — DECISIONS.md 2026-07-12 "Root-caused the T-97 third-day trigger"), ADR-0007 (the ADR-then-build precedent this follows), ADR-0001 (environment topology), ADR-0004 (LiteLLM restricted-role / schema isolation). Code: `src/inngest/ticket-triage.ts` `resolveLitellmTarget()` (the single place `LITELLM_URL` is read), `src/healthLitellmInternal.ts` (`/health/litellm-internal`, the real verification endpoint — T-97), `.github/workflows/monitor-litellm-internal-auth.yml` (the T-97 monitor whose auto-resolve is the second half of the all-clear), `.github/workflows/fix-ops-hub-prod-litellm-url.yml` + `.github/workflows/update-litellm-suffix.yml` (the two existing manual re-align workflows this supersedes in steady state). CLAUDE.md standing constraints: app-agnostic, provider-neutral, "No sslip.io as `LITELLM_BASE_URL`," and the tech-stack table's "**Suffix changes on every LiteLLM redeploy** — check `docker ps` after each deploy" footgun that this ADR exists to eliminate. Non-negotiables #1/#4 (no secrets in repo / secrets in Coolify or Vault), #5 (never push to main).

---

## Context

### The failure class, stated once

ops-hub-prod reaches litellm-prod over the internal Docker network. The address is pinned in a single env var, `LITELLM_URL`, of the form `http://<service-uuid-prefix>-<numeric-suffix>:4000`. The **UUID prefix is stable** per service (`hlik1d96uvkkjzpbxa3azhcv` for litellm-prod); the **numeric suffix rotates on every Coolify redeploy** of litellm-prod. The pinned pointer is not re-synced when the suffix rotates, so:

```
litellm-prod redeploy → container renamed <prefix>-<NEW suffix>
  → ops-hub-prod's LITELLM_URL still names <prefix>-<OLD suffix>
  → old container gone → getaddrinfo fails → fetch() throws
  → /health/litellm-internal returns 503 "unreachable"
  → the NEXT ticket to arrive sticks (classifyTicket → resolveLitellmTarget → throws)
```

This is a **DNS/addressing** failure, not a credential failure. It presents as `healthLitellmInternal.ts`'s catch-block `{"litellm_internal":"unreachable"}` (fetch threw), which is diagnostically distinct from FQ-69's `auth_rejected` (401 `token_not_found`) master-key-rejection signature.

### Three instances — the band-aid ceiling is reached

| # | Where | Trigger | Fixed by |
|---|---|---|---|
| 1 | T-71 | a litellm redeploy/restart rotated the suffix | manual re-align |
| 2 | FQ-69 (URL sub-issue) | stale suffix stacked under the master-key rejection | `fix-ops-hub-prod-litellm-url.yml` |
| 3 | FQ-76 | FQ-70's founder redeploy (Anthropic-key swap) rotated `-132650269773` → `-140935289661`; monitor red ~1 min later | `fix-ops-hub-prod-litellm-url.yml` (founder-authorized) |

Each fix was a hand re-align of the pointer. The third time, the T-97 monitor caught it **pre-impact** (0 tickets stuck vs. FQ-69's 3.6 undetected days) — the monitoring investment worked exactly as designed. But catching a recurring break faster is not the same as ending it. **Re-aligning by hand a fourth time is not the answer.** The Tech Lead's FQ-76 diagnosis explicitly declared the band-aid ceiling reached and named three candidate durable fixes; this ADR selects among them.

### Scope — this ADR is the URL-suffix class ONLY

This ADR addresses the **`LITELLM_URL` suffix-rotation / redeploy-orphan class (T-71)** and nothing else. The **provider-credential-divergence class** (how litellm-prod's master key / Anthropic key rotate without propagating — FQ-69's 401 master-key-rejection signature) is a **distinct, still-open, uncommitted carry** (WORK.md line 21) whose trigger has not fired. FQ-76 was briefly mis-tagged as that class's "third instance"; it is not. Do not fold that class into this design — a redeploy-orphaned URL (`fetch` throws → 503 "unreachable") and a rejected key (401 `token_not_found`) are different failures with different fixes.

### Constraints that bound the design

- **App-agnostic / provider-neutral** (CLAUDE.md): nothing hardcoded to TTS or to litellm-prod's specific UUID. The fix must be a *recipe* any future project's LiteLLM (or any internal service ops-hub calls) inherits with config only.
- **Free-tier-first** (CLAUDE.md): no new paid service; no vendor commitment > 12 months without a founder FQ.
- **No new standing credential surface if avoidable** (non-negotiables #1/#4, Sprint 9 §5.1 norm): an automated re-sync job that holds an SSH key + Coolify API token is a real, ongoing secret surface; a config-only fix that holds no secret is strictly preferable.
- **Verification is the REAL path** (standing norm, reaffirmed 3×): the all-clear is `/health/litellm-internal` → 200 **and** the T-97 monitor auto-resolving its own incident — never the generic `/health`.
- **Never push to main; all PRs** (non-negotiable #5).

---

## Decision

**Adopt Option 1 — a stable internal address for litellm-prod (a persistent Coolify network alias / fixed internal hostname), with `LITELLM_URL` pinned once to that stable name and never re-synced again.** This eliminates the failure class at its source: the suffix may still rotate on the ephemeral container name, but ops-hub-prod resolves litellm-prod by a name that does *not* rotate, so a redeploy can no longer orphan the pointer.

**One load-bearing fact is not yet verified and is made build-task #1: that this Coolify instance can assign litellm-prod a network alias / fixed internal hostname that persists across redeploys.** Docker DNS resolves full container names and explicit network aliases — *not* the stable UUID *prefix* — so "the prefix is stable" is not by itself a resolvable address. The three-incident history plus CLAUDE.md's still-standing "check `docker ps` after each deploy" guidance are weak evidence that a persistent alias is not already a trivially-available checkbox. **The design is therefore Option 1 contingent on a feasibility spike, with Option 2 (an automated post-redeploy re-sync hook) as the pre-committed fallback** if — and only if — the spike shows Coolify cannot provide a redeploy-surviving internal alias on this instance. Option 3 is not the fallback: its only acceptable form depends on the same stable name Option 1 provides (see below).

The Production Manager independent review (appended) owns confirming the feasibility fact, because they own the Coolify network/env model. The Tech Lead does not poke the prod-scoped Coolify API directly (ownership boundary; the token is a prod Actions secret).

### 1. Problem statement

See Context. In one line: **`LITELLM_URL` pins an address whose suffix rotates on every litellm-prod redeploy; the pin is not re-synced; the app's internal LiteLLM hop breaks until a human re-aligns it — three times and counting. Pin to a name that does not rotate.**

### 2. Options considered

#### Option 0 — Do nothing (keep hand-re-aligning `fix-ops-hub-prod-litellm-url.yml`)

Run the existing manual re-align workflow on each recurrence. **Rejected.** This is the status quo whose ceiling FQ-76 declared reached at 3 instances. It depends on a monitor catching the break, an agent diagnosing it, an FQ being filed, and the founder authorizing a dispatch — a multi-step human loop the app is broken throughout. It is the "stated invariant the system does not actually enforce" anti-pattern (the internal hop is *supposed* to always work; nothing makes it so). Kept only as a break-glass tool.

#### Option 1 — Stable internal address (persistent Coolify network alias / fixed hostname) — **CHOSEN**

Give litellm-prod a persistent network alias (e.g. `litellm-prod` on the shared Coolify network) that Coolify re-assigns on every deploy, and pin `LITELLM_URL=http://litellm-prod:4000` once. The ephemeral container name keeps rotating; ops-hub-prod stops caring because it resolves the alias, not the container id.

- **Pro:** kills the class at the source — suffix rotation becomes irrelevant, not merely faster-detected. Simplest steady state: **no moving parts** — no automation to maintain, no SSH key, no re-sync job that can itself fail silently (no "who monitors the re-sync monitor?" regress). **Touches no credential** (a network-address config, not a secret). Provider-neutral by construction: "give the internal service a stable alias, pin the app to it" is a one-paragraph recipe any Project #2 LiteLLM inherits. Directly retires the CLAUDE.md "check `docker ps` after each deploy" footgun.
- **Con / risk:** rests on the **unverified feasibility fact** — that Coolify assigns a redeploy-surviving alias on this instance. This is the whole reason the decision is contingent (build-task #1). Requires a one-time config change to litellm-prod + a re-pin + a restart (a Production Manager task).

#### Option 2 — Automated post-redeploy re-sync hook — **PRE-COMMITTED FALLBACK**

Make `update-litellm-suffix.yml` (T-45, today manual + staging-only) automatic and prod-aware: on a litellm-prod redeploy, detect the new suffix (SSH + `docker ps --filter name=<prefix>`) and rewrite ops-hub-prod's `LITELLM_URL`, then restart.

- **Pro:** reuses proven machinery — T-45 already detects the suffix and patches Coolify correctly. Does not depend on Coolify supporting a persistent alias, so it is the natural fallback if the Option 1 spike fails.
- **Con:** it is the **band-aid, automated** — it treats the symptom (re-align the pointer) not the cause (the pointer should not need re-aligning). It is **reactive**: there is an unavoidable window between the redeploy and the re-sync during which the app is broken (the exact FQ-76 window), unless it can be reliably triggered *by* the redeploy — and Coolify does not obviously emit a redeploy webhook the job can subscribe to, so the realistic trigger is a poll (which reintroduces a detection lag) or a manual chained dispatch (which reintroduces the human-must-remember fragility ADR-0007 criticized). It holds a **standing credential surface** — an SSH private key + Coolify API token in an automated job — which is exactly the kind of ongoing secret surface Sprint 9 §5.1 wants to avoid and which would itself require a fresh Security Lead review. It is a new moving part that can fail silently. **Rejected as primary, retained as the pre-committed fallback** for the narrow case where Option 1 is infeasible.

#### Option 3 — App-side resolution by service name — **REJECTED**

Have the app resolve litellm by a stable service name at runtime instead of a pinned suffix.

- **Why it collapses:** its acceptable form *still requires a stable resolvable name to exist* — i.e. it depends on Option 1's alias, at which point pinning `LITELLM_URL` to that alias (Option 1) already achieves it with zero app change. Option 3's only *independent* value would come from the app doing active service discovery — querying the Docker API / socket from inside the app container, or embedding Coolify-API calls in the runtime. **Both are unacceptable:** mounting `docker.sock` into the app container is a serious privilege escalation (container-escape-equivalent), and coupling business-logic runtime to the Coolify API breaks the app-agnostic / provider-neutral constraint (the app would know about its own deploy platform). **Rejected.** It shares Option 1's feasibility dependency without adding safe value, which is precisely why **Option 2, not Option 3, is the fallback.**

### 3. Verification — the all-clear is the REAL path (exit criterion, not prose)

The chosen design is verified as fixed **if and only if** both hold after a *deliberate litellm-prod redeploy* (the spike must prove it survives the actual trigger, not just a steady state):

1. `GET https://ops-hub-prod.inatechshell.ca/health/litellm-internal` → **HTTP 200** `{"status":"ok","litellm_internal":"reachable_and_authenticated"}` — this is the endpoint that makes a **real completion call over the internal `LITELLM_URL`** via the same `resolveLitellmTarget()` the ticket path uses (`src/healthLitellmInternal.ts`).
2. The **T-97 monitor** (`monitor-litellm-internal-auth.yml`) auto-resolves its own incident on its next scheduled run (i.e. the paging system agrees, not just a one-off curl).

**Explicitly NOT the generic `/health`.** This is a standing norm reaffirmed three times (FQ-69's blind spot, then FQ-76). It bears a concrete callout here: **both existing re-align workflows verify against the wrong endpoint** — `fix-ops-hub-prod-litellm-url.yml` (step "Wait for restart + verify health") and `update-litellm-suffix.yml` (step "Verify ops-hub-app health") both poll the generic `/health`, which cannot detect an internal-hop break. FQ-76's own diagnosis flagged this ("the fix workflow only polls `/health` post-restart — insufficient as the all-clear; re-probe `/health/litellm-internal` explicitly"). **The Sprint 12 build MUST verify via `/health/litellm-internal` + T-97 auto-resolve, and should correct the verify step of whichever workflow it retains as break-glass.** A green generic `/health` is not acceptance.

### 4. Credential / secret gate (exit criterion)

**Option 1 touches no credential and adds no new secret surface.** A network alias is a network-address config, not a secret; `LITELLM_URL` is a non-secret env var (an internal hostname). This is a deliberate point in Option 1's favor: it is specifically the option that avoids the standing credential surface Option 2 would introduce (an automated job holding an SSH key + Coolify token).

Because Option 1 touches no secret store, the Sprint 9 §5.1 "fresh Security Lead review of the concrete payload/scope BEFORE implementation" hard-gate **does not strictly fire** for it. Two honest caveats, both named as **Sprint-12 build gates, not work to do now**:

- **(a) If the fallback (Option 2) is taken,** it introduces a standing credential surface (SSH key + Coolify token in an automated job) → the §5.1 Security Lead review of the concrete key scope **is a hard blocker on that path**, before implementation.
- **(b) Even for Option 1,** the build still uses the *existing* Coolify API token (the same one every current fix workflow uses) to set the alias config and re-pin `LITELLM_URL`. That is "no *new* secret surface," not "no token." The build should get a **lightweight Security Lead confirmation** that the alias approach introduces no new secret surface and that the one-time config change is scoped — a readback, not a full credential review.

### 5. Provider-neutral / app-agnostic (exit criterion)

The design is a **recipe, not a litellm-prod-specific patch**:

- Nothing in the app changes for Option 1 — `resolveLitellmTarget()` keeps reading `LITELLM_URL` from env; only the *value* changes from a rotating container name to a stable alias. No TTS-specific or litellm-prod-UUID-specific logic enters the codebase.
- For **Project #2**: its LiteLLM (or any internal service ops-hub calls) gets the identical treatment — assign a persistent network alias, point the app's `<SERVICE>_URL` at it. The recipe is one paragraph and carries no ITS/TTS coupling.
- It respects "No sslip.io as `LITELLM_BASE_URL`" (the alias is an internal Docker-network name, not an external sslip.io fallback) and does not introduce vendor lock-in beyond the Coolify dependency the whole stack already has — and even that is soft: the app only ever sees a hostname, so a move off Coolify changes *how the alias is provisioned*, not the app.

### 6. Sprint 12 build scope — sized, named, scheduled (exit criterion)

**Small-to-Medium. A focused mini-track, not a research project.** Ordered so the feasibility gate resolves before any prod change:

1. **Feasibility spike (build-task #1, S).** Production Manager: determine whether this Coolify instance can assign litellm-prod a persistent network alias / fixed internal hostname that survives redeploy (custom network alias, `container_name`, compose service name, or predefined-network hostname — whichever the instance supports). **Decision gate:** confirmed → proceed Option 1; not confirmed → switch to the Option 2 fallback and its §4(a) Security Lead review. This spike is the one real unknown; everything downstream is mechanical.
2. **Option 1 path (if confirmed):** (a) configure the persistent alias on litellm-prod (Production Manager, Coolify, **S**); (b) re-pin `LITELLM_URL=http://<alias>:4000` on ops-hub-prod, deleting all duplicate rows first (the known Coolify append-not-upsert footgun — reuse the delete-all-then-post pattern already in `fix-ops-hub-prod-litellm-url.yml`), restart (**S**); (c) **verify by deliberately redeploying litellm-prod and confirming `/health/litellm-internal` → 200 + T-97 auto-resolve** — the §3 exit criterion, proven against the real trigger, not just steady state (**S**); (d) correct the verify step of the retained break-glass workflow to probe `/health/litellm-internal` (§3) and update the CLAUDE.md "check `docker ps` after each deploy" note to reflect the durable fix (**S**).
3. **Option 2 fallback path (only if the spike fails):** promote `update-litellm-suffix.yml` to prod-aware + auto-triggered, resolve the trigger mechanism (webhook vs. poll), pass the §4(a) Security Lead review of the SSH-key + Coolify-token scope, prove it on a deliberate redeploy against `/health/litellm-internal` + T-97 (**M** — larger than Option 1 because of the trigger design + the credential review).
4. **Lightweight Security Lead confirmation** for the chosen path (§4): readback for Option 1, full §5.1 review for Option 2.

No new database schema. No new external service. No new paid tier anticipated (if the spike surfaces a paid-Coolify-tier requirement for persistent aliases, that is a founder FQ — free-tier-first — not a silent commitment). The novel surface is exactly one fact (the feasibility spike); the rest reuses machinery already in the repo.

### 6.1 Build conditions carried from the independent review

The appended Production Manager review adds the following as **Sprint-12 build line items** (none change the Decision or option ranking — they harden the build):

- **Staging-first spike (finding 2):** prove the alias survives a deliberate **litellm-staging** redeploy *before* touching litellm-prod — a free, lower-blast-radius canary (the `fix-litellm-network.yml` machinery already exists on staging). Insert as build-step 6.1.5, ahead of §6.2.
- **Prior art to read first (finding 1):** `fix-litellm-network.yml` already attempted the bare-UUID/stable-name form on staging and wrapped it in a 5-candidate connectivity probe *because* the stable name wasn't confirmed — and every prod fix since re-pinned to the full suffixed name, never a bare alias. Budget for the alias possibly needing the Coolify Compose-customization / labels surface (not a plain REST field).
- **Shared-network pre-check (finding 7):** confirm both ops-hub-prod and litellm-prod are joined to the shared `coolify` network before assuming alias resolution works.
- **Explicit written rollback (finding 6):** the rollback for a failed alias verification is re-running break-glass `fix-ops-hub-prod-litellm-url.yml` with the current suffix — write it as an explicit one-line step (PRODUCTION.md "no deploy without a written rollback path"), not implicit.
- **T-102 resolve-threshold recheck (finding 5):** re-read T-102's shipped consecutive-fail threshold before treating §3's "auto-resolves on its next scheduled run" literally — a symmetric resolve-side threshold could make the all-clear take 2–3 clean polls (30–45 min), not one.
- **T-97 wait sizing (finding 4):** the monitor is a 15-min cron; size the §6.2c verification as up to one poll cycle, not a same-minute check.
- **Alias-apply likely needs a redeploy, not a restart (finding 8):** §6.2a (configure alias) and §6.2c (deliberate verification redeploy) may collapse into a single litellm-prod redeploy event — one prod touch, not two.

---

## Consequences

- **Positive:** the failure class ends at its source rather than being detected faster — a litellm-prod redeploy can no longer orphan ops-hub-prod's pointer, so the fourth (and Nth) manual re-align never happens. The chosen path adds **no moving parts and no standing credential surface**, retires the CLAUDE.md "check `docker ps` after each deploy" footgun, and is provider-neutral as a one-paragraph recipe Project #2 inherits. Verification is bound to the real internal path (`/health/litellm-internal` + T-97), and the ADR fixes a latent second bug on the way — both existing re-align workflows verify against the wrong (`/health`) endpoint.
- **Negative / accepted:** the decision **rests on an unverified feasibility fact** (persistent Coolify alias), deliberately made build-task #1 with Option 2 pre-committed as the fallback — this is an honest contingency, not a hidden assumption. If the spike fails, the fallback (Option 2) is the band-aid automated, with its reactive break-then-resync window and a real credential surface + Security Lead review — strictly worse than Option 1 but strictly better than Option 0's human loop. One more sprint of deferral (build → Sprint 12), accepted deliberately per the ADR-0007 ADR-then-build precedent and Sprint 11's overcommit discipline.
- **Explicitly out of scope:** the provider-credential-divergence class (§Context) — a distinct, still-open carry; not folded in here. The `LITELLM_URL` Coolify duplicate-row dedup (cosmetic) is subsumed by the re-pin step (2b) if Option 1 lands.
- **Open item that resolves at build time (Sprint 12):** the feasibility spike (§6.1) is the single load-bearing unknown; its outcome picks Option 1 vs. the Option 2 fallback and is owned by the Production Manager.

---

## Production Manager Review (Coolify Feasibility / Deployability)

- **Reviewer:** Production Manager (independent review, ADR-0007 author+reviewer precedent)
- **Date:** 2026-07-12
- **Scope:** (1) the load-bearing feasibility fact behind Option 1; (2) deployability/architecture soundness of the option ranking and Sprint 12 build sizing. Read-only — no dispatch, no prod/staging mutation, no live redeploy performed for this review.
- **Verdict:** **Approved as the design-of-record.** The Option-1-contingent-on-spike / Option-2-fallback structure is the correct shape given what can and cannot be confirmed from the repo today. Findings below are Sprint-12 build obligations, not blockers to acceptance.

### Findings

**1. The feasibility fact is genuinely unconfirmable from static evidence — and existing prior art leans toward "not yet proven," which supports the ADR's contingency structure rather than undermining it.**

I cannot confirm from the Coolify model or repo evidence that a redeploy-surviving persistent internal alias is available on this instance, and I want to be explicit that "the spike is required" is the honest answer here, not a hedge. Concrete grounding:

- `.github/workflows/fix-litellm-network.yml` is prior art for *exactly this idea*, run against litellm-staging. Its own comment states the hypothesis plainly: "Coolify v4 `generateApplicationContainerName()` returns the app UUID as the container name. After network connect, Docker DNS resolves it on 'coolify'." That is effectively Option 1's bare-UUID-prefix form. But the team did **not** trust that hypothesis outright — they built a 5-candidate connectivity probe (`/debug/litellm-connectivity`) plus an auto-correct-if-winner-differs step specifically *because* the guessed stable name wasn't confirmed to be the one Docker DNS actually resolves. That defensive machinery is itself evidence the hypothesis was uncertain even at authorship time.
- More tellingly: **every subsequent prod incident (T-71, FQ-69, FQ-76) was fixed by re-pinning `LITELLM_URL` to the current full `<uuid-prefix>-<numeric-suffix>` container name — never to a bare alias.** If the staging alias experiment had proven durable, I'd expect it to have been carried forward as the prod pattern by the third recurrence. It wasn't. That's circumstantial but real evidence the bare-name/predefined-network-hostname route either failed to persist or was never load-bearing for prod.
- Across every Coolify-touching workflow in this repo (`fix-litellm-network.yml`, `fix-ops-hub-prod-litellm-url.yml`, `update-litellm-suffix.yml`), the only application-level network fields ever exercised against the Coolify API are `connect_to_docker_network` (bool) and `docker_network` (string) — both control *which* network a container joins, not what hostname/alias it answers to on that network. **No workflow, config, or doc in this repo has ever successfully set a custom Docker network alias via the Coolify API.** That's not proof Coolify v4 lacks the capability (v4's compose-based model plausibly supports a `networks: <net>: aliases: [...]` override via the "Advanced"/custom-labels surface in the UI, from general Coolify architecture knowledge) — but it means build-task #1 should budget for the possibility that the alias has to be set via the Docker Compose customization / labels surface in the Coolify UI, not a simple REST PATCH, which is a different (and slightly larger) mechanic than "call an API field."

**Conclusion: say it plainly per your own ask — this cannot be confirmed without a live redeploy.** The ADR's Option-1-pending-spike / Option-2-fallback structure is the right shape precisely because of this. I'd go one step further than the ADR currently does:

**2. Build-time recommendation: prove the spike on litellm-staging first, not litellm-prod.** `fix-litellm-network.yml` already ran a version of this experiment on staging, and staging has the identical UUID-prefix/suffix-rotation mechanics (`h12xz8887fxvbvjts2hac8if`) plus its own `/health/litellm-internal`-equivalent surface and the T-45 tooling already scoped to staging. §6.2 of the ADR goes straight to configuring the alias on litellm-prod. Given this is genuinely the one unverified fact in the design, staging is a free, lower-blast-radius canary target that the ADR doesn't currently call out — I'd add "prove the alias survives a deliberate litellm-**staging** redeploy first" as 6.1.5 before touching prod. This is squarely a Production Manager canary-doctrine fit (PRODUCTION.md: canary target identified before any prod change) and costs nothing since the machinery already exists.

**3. Ranking (Option 1 > 2 > 0) and Option 3's rejection are both sound from a deploy/rollback/operability standpoint.** Option 1 is the only one of the three that adds zero standing moving parts and zero new credential surface — that's the correct axis to rank on for an ops platform whose stated quality bar is mean-rollback-time < 15 min and zero-deploys-without-rollback-path; a design with no automation to fail is trivially easier to reason about during an incident than Option 2's webhook-vs-poll-triggered re-sync job. Option 3's rejection is correct and for the right reason: mounting `docker.sock` into the app container is a real container-escape-equivalent risk, and I'd have flagged it myself as a hard no from a deploy-security posture even setting aside the app-agnostic argument the ADR already makes.

**4. Sprint 12 build sizing (§6) is realistic for the mechanical steps, with one real time-cost gap: the T-97 wait is not instant.** `monitor-litellm-internal-auth.yml` runs on a 15-minute cron (`*/15 * * * *`). §6.2c's "verify by deliberately redeploying and confirming... T-97 auto-resolve" step should be sized assuming a wait of up to ~15 minutes for the next scheduled run to pick up the fix, not treated as a same-minute check — worth an explicit note in the runbook so whoever executes it doesn't false-alarm on a redeploy that's fine but hasn't hit the next poll yet.

**5. Cross-cutting interaction with T-102 (in-flight Sprint 11 work) that the ADR should not assume away.** T-102 is shipping a 2–3-consecutive-fail threshold for this same monitor this sprint (per FQ-76's own recommendation, which the ADR cites). If that threshold logic is symmetric (N consecutive good polls to auto-resolve, mirroring N consecutive bad polls to open), then §3's exit criterion "the T-97 monitor auto-resolves on its next scheduled run" may no longer hold verbatim by the time Sprint 12 build starts — it could require 2–3 consecutive clean polls (30–45 min), not one. This isn't a design flaw, just a wording dependency: **Sprint 12 build should re-read T-102's shipped implementation before treating §3 literally**, and update the exit-criterion prose if the resolve-side threshold changed.

**6. Rollback path is implied but not written down — should be explicit before the Option 1 build starts** (per PRODUCTION.md's "zero deploys without a written rollback path"). If the alias is configured and pinned but the deliberate-redeploy verification (§6.2c) fails, the rollback is trivial and cheap: re-run the existing break-glass `fix-ops-hub-prod-litellm-url.yml` with the current (post-redeploy) suffixed container name, exactly as it's used today. That should be written as an explicit one-line rollback step in the Sprint 12 build task, not left implicit — it's a 2-minute addition and keeps this build compliant with the mean-rollback-time-<15-min bar the ADR is implicitly relying on.

**7. One dependency worth a build-time confirmation check, not a redesign: both apps must already share the "coolify" network.** `fix-litellm-network.yml` shows that in its (staging) episode, *both* litellm and ops-hub-app had to be explicitly joined to the shared network (`connect_to_docker_network: true` on each) before any name — bare or suffixed — would resolve between them. Since prod's *current* suffixed-name resolution already works today (that's the entire reason the failure mode is "orphaned pointer" rather than "never connects"), both ops-hub-prod and litellm-prod are almost certainly already on the shared network. I'd still make "confirm both prod apps show `connect_to_docker_network: true` (or equivalent) before assuming the alias just works" an explicit pre-check in build-task #1 rather than an assumption — cheap insurance, given this exact prerequisite bit a prior (staging) attempt.

**8. Applying the alias to litellm-prod likely itself requires a redeploy (not just a restart) of litellm-prod — which can be combined with, not run in addition to, the §6.2c deliberate-redeploy verification step.** Network/compose-level config changes in Coolify typically apply on redeploy, not on a simple restart. If so, step 6.2a ("configure the persistent alias") and step 6.2c ("verify by deliberately redeploying litellm-prod") may collapse into a single redeploy event rather than two separate prod touches — worth calling out in the build runbook so it isn't sized or scheduled as two separate windows.

### Conditions / residuals carried to Sprint 12 build

- Feasibility spike (build-task #1) proven on **litellm-staging first**, then litellm-prod, before the app-side re-pin.
- Confirm both ops-hub-prod and litellm-prod are already joined to the shared Coolify network before assuming alias resolution "just works."
- Write the rollback step explicitly (fall back to `fix-ops-hub-prod-litellm-url.yml` with the current suffix) as part of the Option 1 build task, not left implicit.
- Re-check §3's exit criterion against T-102's actual shipped resolve-threshold behavior before treating "next scheduled run" literally.
- Size the T-97-wait as up to one 15-minute poll cycle, not instantaneous.
- Lightweight Security Lead readback (§4b) still applies as the ADR states — unaffected by these findings, since none of the above introduce a new credential surface.

### Handoff

Design-of-record approved; Sprint 12 build should open with the staging-first spike (finding 2) and carry findings 4–8 as build-task line items — no change requested to the ADR's Decision or option ranking.
