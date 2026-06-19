# Feature Flags

> How we ship code safely without long-lived branches and without exposing half-finished work.

---

## Approach for v1: simple Supabase config table

We don't need a dedicated feature-flag platform (Flagsmith, LaunchDarkly, Unleash) for v1. A `feature_flags` table in Supabase + a tiny helper function is enough — and stays at $0/mo.

### Schema

```sql
create table feature_flags (
  id uuid primary key default uuid_generate_v4(),
  project text not null,           -- 'ops_hub', 'tts', etc.
  environment text not null,       -- 'dev', 'staging', 'prod'
  flag_key text not null,          -- 'enable_byok_tenant'
  enabled boolean default false,
  rollout_percentage int default 0, -- 0–100, for gradual rollout
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  sunset_date date,                -- when this flag should be removed
  unique (project, environment, flag_key)
);
```

### Helper function

```typescript
async function isFeatureEnabled(
  project: string,
  flagKey: string,
  context?: { tenantId?: string; userId?: string }
): Promise<boolean> {
  const flag = await supabase
    .from('feature_flags')
    .select('enabled, rollout_percentage')
    .eq('project', project)
    .eq('environment', process.env.ENVIRONMENT)
    .eq('flag_key', flagKey)
    .single();
  
  if (!flag.data?.enabled) return false;
  if (flag.data.rollout_percentage === 100) return true;
  
  // Deterministic rollout based on tenantId or userId
  const seed = context?.tenantId || context?.userId || 'global';
  const hash = simpleHash(seed + flagKey);
  return (hash % 100) < flag.data.rollout_percentage;
}
```

---

## When to use a feature flag

| Use case | Flag justified? |
|---|---|
| Gradual rollout of a new agent capability | ✅ Yes |
| Kill switch for a risky integration | ✅ Yes (mandatory) |
| A/B test of two prompt versions | ✅ Yes |
| Hiding incomplete work shipped to `main` | ✅ Yes |
| Per-tenant beta access (e.g., A-Mart trying a new feature first) | ✅ Yes |
| Tiny low-risk change | ❌ No — just ship it |
| Change that's hard to test in staging | ❌ Use better staging tests instead |

---

## Flag discipline (non-negotiable)

Every feature flag must have:

| Field | Required value |
|---|---|
| `description` | Why this flag exists, in plain English |
| `sunset_date` | When this flag will be removed (max 90 days out for temp flags) |
| ADR in `docs/adr/` | For any flag affecting tenant data, billing, or auth |
| Owner agent | Recorded in flag description |

### Sunset discipline

Tech Lead reviews `feature_flags` table monthly:

- Flags past their `sunset_date` → remove them (delete code AND flag)
- Permanent flags (kill switches, etc.) → mark `sunset_date = null` with rationale

Long-lived flags rot. They become dead code that the team is afraid to remove. Treat every flag as temporary unless explicitly classified as permanent.

---

## Flag categories

| Category | Purpose | Sunset policy |
|---|---|---|
| **Release** | Hide unfinished work | Remove within 30 days of ship |
| **Experiment** | A/B test prompts or behaviors | Remove within 60 days of test conclusion |
| **Rollout** | Gradual percentage rollout | Remove once at 100% for 7 days |
| **Ops kill switch** | Emergency disable of a feature | Permanent |
| **Per-tenant access** | Beta access for specific tenants | Remove once feature is GA |

---

## Reading flags in different layers

| Layer | How |
|---|---|
| TypeScript/JS app code | `isFeatureEnabled(project, flagKey, context)` helper |
| Operator agents (Inngest workflows) | Inngest step reads flag at workflow start, branches accordingly |
| LiteLLM routing (Model Router) | Project Context schema includes flag-aware routing rules |
| KB content visibility | `feature_flags` filter on KB articles tagged with flag keys |

---

## Flag changes

| Action | Who can do it |
|---|---|
| Create a new flag | Tech Lead (with ADR for sensitive flags) |
| Toggle a flag in dev | Anyone |
| Toggle a flag in staging | Tech Lead, Production Manager |
| Toggle a flag in prod | Production Manager (with founder approval for tenant-facing flags) |
| Delete a flag | Tech Lead (after sunset check) |

All flag changes in staging or prod logged to `DECISIONS.md`.

---

## When to upgrade to a dedicated flag platform

We move from the Supabase table to a dedicated tool (Flagsmith self-hosted is the leading free option) when:

- We have > 50 active flags simultaneously
- We need percentage rollout broken out by tenant cohort, geography, or other dimensions
- We need flag audit logs beyond what Supabase change history gives us

For v1 and the foreseeable future, the simple table is sufficient.

---

## How this policy is used

- Tech Lead references this doc when designing any change that warrants a flag
- Production Manager references it during deploys (which flags are toggled with this deploy?)
- Solutions Architect references it when onboarding new tenants (per-tenant access flags)
