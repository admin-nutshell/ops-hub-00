# DECISIONS.md — Decision Log

> Append-only. Every meaningful decision gets one line + (optionally) a link to a detailed ADR in `docs/adr/`.

---

## Format

```
YYYY-MM-DD [Agent or Founder] Decision summary → optional link
```

For substantial decisions, include `→ ADR-NNNN` pointing to the full record in `docs/adr/NNNN-title.md`.

---

## Decisions

### 2026-06-18 — Planning phase

```
2026-06-18 [Founder] Locked Ops Hub as app-agnostic platform; TTS is Project #1, not the product itself
2026-06-18 [Founder] Locked free-tier-first as standing tool selection rule
2026-06-18 [Founder] Locked provider-neutral via BYOK as standing architecture rule
2026-06-18 [Founder] Approved Pricing Option D: basic agent support in all TTS tiers; Premium SLA add-on at +$200 CAD/mo
2026-06-18 [Founder] Approved Pre-Seed target: $150K–$300K CAD
2026-06-18 [Founder] Approved tool stack: Inngest + LangFuse + LiteLLM + Supabase Vault + Promptfoo + FreeScout + Cstate
2026-06-18 [Founder] Locked Plan v0.8 — all 9 dimensions complete + master plan synthesis
2026-06-18 [PM] Ready to plan Sprint 1 from Milestone M1 in 09_delivery.md
2026-06-18 [PM] Sprint 1 planned: June 23–July 4, 2026 — goal: M1 Workspace + Foundation; 20 tasks across 4 tracks; 2 blocking founder items in FOUNDER_QUEUE
2026-06-18 [PM] Handed off Sprint 1 Track A (ADRs + schema + CI/CD spec) to Tech Lead → WORK.md T-01 through T-05
```

### 2026-06-18 — Sprint 1 Track A (Tech Lead)

```
2026-06-18 [Tech Lead] 3 environments per project (dev local / staging / prod) on shared Hostinger+Coolify VPS; dev = local ephemeral Claude Code context, not a hosted env; VPS sizing review concludes no upgrade needed for M1 (70% util trigger escalates resize to founder) → ADR-0001
2026-06-18 [Tech Lead] Tool stack rationale recorded — Inngest, LangFuse, LiteLLM, Supabase (DB+Vault+vector), Promptfoo, FreeScout, Cstate; each free-tier/self-host with documented fallback trigger; no >12mo lock-in → ADR-0002
2026-06-18 [Tech Lead] Ops Hub Supabase schema designed (6 tables) with fail-closed RLS tenant isolation; enforcement model = ops_hub_app non-superuser role + app.current_tenant GUC for agent paths, JWT claim for portal paths, service_role reserved for migrations/platform ops (bypasses RLS by design). Pending Security Lead sign-off → docs/engineering/database-schema.md + supabase/migrations/2026061812*
2026-06-18 [Tech Lead] CI/CD toolchain locked: Node 20 + TypeScript (pnpm) primary, Python 3.12 secondary; ESLint+Prettier+tsc lint, Vitest tests, Promptfoo eval gate at >95%, staging auto-deploy on merge to main via Coolify webhook, prod manual promotion only (workflow_dispatch); 4 required PR status checks → docs/engineering/ci-cd-pipeline.md
```

---

*All future decisions appended below this line. Format: one line per decision, optionally followed by ADR link. Never edit historical entries — supersede with new entries instead.*
