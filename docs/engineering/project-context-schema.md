# Project Context Schema — TTS v1

> The structured document every agent receives at the start of a task. It tells the agent **which project and tenant it is operating for**, **what integrations are connected**, and **what operating constraints apply**.

- **Status:** Draft (T-04) — pending Tech Lead review
- **Owner:** Solutions Architect
- **Schema version:** `1.0.0`
- **Applies to:** TTS (Ticket Triage System), the first ITS project. Designed to be project-agnostic so future projects reuse it unchanged.

---

## 1. Overview

The **Project Context** is a single JSON object injected into an agent's working context at task start. It is the agent's answer to "who am I working for right now, and what am I allowed to do?"

| Aspect | Detail |
|---|---|
| **Who produces it** | The Ops Hub runtime (Module A). It assembles the context per task by reading the `projects` registry, the target `tenants` row, and the project's `projects/<name>/config.json`. |
| **Where it is persisted** | The canonical per-project skeleton lives in `projects/<name>/config.json`. The runtime mirror is stored in `projects.context_schema` (jsonb) in Supabase so the runtime can assemble a context without a filesystem read. The per-tenant payload defined here is the **assembled, runtime-resolved** form of that data. |
| **Who consumes it** | Every agent (triage, fix, deploy, etc.). Agents read it but never write it. |
| **Trust boundary** | The context is **trusted, system-generated** input. It must never contain raw secrets — only **references** (`*_ref`) the runtime resolves against Supabase Vault. Tenant-supplied free text (e.g. ticket bodies) is **not** part of this document and remains untrusted. |
| **Identity** | `project_id` references `projects.id`; `tenant_id` references `tenants.id`. Together they scope every downstream query (RLS, KB namespace, audit stamping). |

### Portability note

Nothing in this schema is hardcoded to TTS. A new project (e.g. DNC, or Project #2) plugs in by supplying its own `project_id`, `project_slug`, integration block, and constraints. Agents that read the context must rely **only** on these fields — never on a project name literal — so onboarding a new project requires zero agent code changes.

---

## 2. JSON Schema (draft-07)

```json
{
  "$schema": "https://json-schema.org/draft-07/schema",
  "$id": "https://opshub.its/schemas/project-context/1.0.0.json",
  "title": "ProjectContext",
  "description": "Per-task, per-tenant operating context injected into every Ops Hub agent.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "project_id",
    "tenant_id",
    "project_name",
    "project_slug",
    "metadata"
  ],
  "properties": {
    "project_id": {
      "type": "string",
      "format": "uuid",
      "description": "References projects.id. Scopes KB namespace, feature flags, audit stamping."
    },
    "tenant_id": {
      "type": "string",
      "format": "uuid",
      "description": "References tenants.id. Scopes RLS and SLA resolution."
    },
    "project_name": {
      "type": "string",
      "minLength": 1,
      "description": "Human-readable project name, e.g. 'Ticket Triage System'."
    },
    "project_slug": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$",
      "description": "URL/namespace-safe project identifier, e.g. 'tts'."
    },
    "integrations": {
      "type": "object",
      "description": "Connected tools for this project/tenant. All credentials are references, never raw secrets.",
      "additionalProperties": false,
      "properties": {
        "freescout": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "url": {
              "type": "string",
              "format": "uri",
              "description": "Base URL of the FreeScout instance (ticket intake)."
            },
            "api_key_ref": {
              "type": "string",
              "description": "Vault reference to the FreeScout API key. NOT the key itself."
            }
          },
          "required": ["url", "api_key_ref"]
        },
        "litellm": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "endpoint": {
              "type": "string",
              "format": "uri",
              "description": "LiteLLM proxy endpoint used for all model calls."
            },
            "model_aliases": {
              "type": "object",
              "description": "Logical-to-concrete model alias map, e.g. { \"fast\": \"gpt-4o-mini\" }.",
              "additionalProperties": { "type": "string" }
            }
          },
          "required": ["endpoint"]
        },
        "langfuse": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "project_id": {
              "type": "string",
              "description": "LangFuse project identifier for trace grouping."
            },
            "public_key_ref": {
              "type": "string",
              "description": "Vault reference to the LangFuse public key. NOT the key itself."
            }
          },
          "required": ["project_id", "public_key_ref"]
        }
      }
    },
    "feature_flags": {
      "type": "object",
      "description": "Resolved active feature flags for this tenant. Key = flag_key, value = effective boolean.",
      "additionalProperties": { "type": "boolean" }
    },
    "constraints": {
      "type": "object",
      "description": "Operating limits the agent must respect for this project/tenant.",
      "additionalProperties": false,
      "properties": {
        "max_tokens_per_request": {
          "type": "integer",
          "minimum": 1,
          "description": "Upper bound on tokens per model request."
        },
        "allowed_models": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Whitelist of model aliases/names the agent may invoke."
        },
        "pii_redaction_enabled": {
          "type": "boolean",
          "description": "When true, the agent must run PII redaction before logging or model calls."
        }
      }
    },
    "metadata": {
      "type": "object",
      "description": "Document provenance and versioning.",
      "additionalProperties": false,
      "required": ["schema_version"],
      "properties": {
        "created_at": {
          "type": "string",
          "format": "date-time",
          "description": "When this context instance was assembled (ISO 8601)."
        },
        "schema_version": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$",
          "description": "Semantic version of the schema this instance conforms to, e.g. '1.0.0'."
        }
      }
    }
  }
}
```

---

## 3. Required fields

A valid Project Context **must** contain:

| Field | Why it is required |
|---|---|
| `project_id` | Without it, no project-scoped resource (KB, flags, audit) resolves. |
| `tenant_id` | Without it, RLS and SLA resolution are undefined. |
| `project_name` | Human-facing labelling in agent output and audit entries. |
| `project_slug` | Stable, namespace-safe key used in paths and references. |
| `metadata.schema_version` | The consuming agent must know which schema contract it is reading so version-aware handling works. Expressed in draft-07 by requiring `metadata` at the top level and requiring `schema_version` inside the `metadata` subschema. |

All other fields (`integrations`, `feature_flags`, `constraints`, `metadata.created_at`) are optional. An absent block means "no integrations / no flags / no extra constraints configured for this tenant" — agents must treat absence as empty, not as an error.

---

## 4. Example instance

A concrete, valid Project Context for a TTS tenant. All credential fields are **Vault references**, not secrets.

```json
{
  "project_id": "9b2e4f7a-1c3d-4e8a-9f0b-2d6c5a8e1f4b",
  "tenant_id": "3f7c1a90-8b2e-4d65-a1c3-7e9f0b2d6c5a",
  "project_name": "Ticket Triage System",
  "project_slug": "tts",
  "integrations": {
    "freescout": {
      "url": "https://support.tts.opshub.its",
      "api_key_ref": "vault://tts/dnc/freescout/api_key"
    },
    "litellm": {
      "endpoint": "http://litellm-staging.internal:4000",
      "model_aliases": {
        "fast": "gpt-4o-mini",
        "reasoning": "claude-sonnet"
      }
    },
    "langfuse": {
      "project_id": "tts-dnc",
      "public_key_ref": "vault://tts/dnc/langfuse/public_key"
    }
  },
  "feature_flags": {
    "enable_auto_resolve": true,
    "enable_byok_tenant": false
  },
  "constraints": {
    "max_tokens_per_request": 8192,
    "allowed_models": ["fast", "reasoning"],
    "pii_redaction_enabled": true
  },
  "metadata": {
    "created_at": "2026-06-21T14:30:00Z",
    "schema_version": "1.0.0"
  }
}
```

---

## 5. Evolution notes

The schema is versioned with **semantic versioning** (`MAJOR.MINOR.PATCH`), surfaced in every instance via `metadata.schema_version`.

| Change type | Version bump | Rule |
|---|---|---|
| **Additive** — new optional field, new optional integration, new constraint with a safe default | **MINOR** (`1.0.0` → `1.1.0`) | Always prefer this. Old instances remain valid; old agents ignore the new field. |
| **Clarifying** — description/doc fix, tightened validation that all existing valid instances already satisfy | **PATCH** (`1.0.0` → `1.0.1`) | No behavioural change for producers or consumers. |
| **Breaking** — renamed/removed field, new required field, narrowed type that invalidates existing instances | **MAJOR** (`1.0.0` → `2.0.0`) | Requires a migration plan and Tech Lead sign-off. Avoid. |

Operating principles:

1. **Additive-only by default.** New capabilities are added as optional fields with safe defaults so no existing tenant context breaks. A MAJOR bump is an explicit, reviewed event — not an accident.
2. **Consumers tolerate the unknown.** Agents must ignore fields they do not recognise rather than erroring, so a producer on `1.1.0` can safely feed an agent still coded against `1.0.0`.
3. **Producers stamp the version they wrote.** The runtime sets `metadata.schema_version` to the schema it assembled against, never blank.
4. **Migrations are documented here.** When a MAJOR bump lands, this file gains a "Migration from vN" subsection describing the field-by-field transformation and the cutover window.
5. **Secrets never leak in.** Any field that touches credentials is a `*_ref` reference resolved at runtime against Supabase Vault. A schema change that would put a raw secret in the context is rejected at review.
