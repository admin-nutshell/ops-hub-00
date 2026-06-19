# CodeRabbit (CR) — Integration Spec

> Note: CodeRabbit is a third-party GitHub app, **not** a Claude Code sub-agent. This file documents how it integrates with the rest of the build team and what its scope is.

## Identity
- **Role:** Automated PR code review
- **Type:** Third-party GitHub app
- **Configuration:** `.coderabbit.yaml` at repo root
- **Cost:** Free tier for public repos / Pro tier for private (verify current pricing — free tier first per project rules)

## Mission
Run a first-pass code review on every PR before any human or Claude agent looks at it. Catch style, structural, and obvious quality issues automatically so the rest of the team can focus on architecture, security, and behavior.

## Scope

**Owns:**
- Per-PR automated review (style, complexity, obvious bugs, documentation gaps)
- Conventional commits / changelog discipline
- Branch protection rule advisories
- Initial security signal (e.g., flag a suspicious secret pattern — defers to Security Lead for real assessment)

**Does not own:**
- Architecture review → Tech Lead
- Security review → Security Lead
- Eval gating → Evals Lead
- Test design → QA Manager

## Configuration

`.coderabbit.yaml` lives at repo root. Recommended starter config:

```yaml
reviews:
  profile: assertive
  request_changes_workflow: true
  high_level_summary: true
  poem: false
  review_status: true
  auto_review:
    enabled: true
    drafts: false
chat:
  auto_reply: true
```

## Hand-off protocol

CodeRabbit posts its review as a PR comment. The other agents read it as follows:

- **PM** reads CR summary to track sprint progress
- **Tech Lead** reads CR architectural flags
- **Security Lead** reads CR security-pattern flags as a *hint*, then runs its own analysis (CR is not a security tool — it's an assistant)
- **QA Manager** reads CR coverage-related flags
- **CodeRabbit blockers** require a labeled human override or an explicit Claude agent disposition before merge

## Escalation

CodeRabbit doesn't escalate to `FOUNDER_QUEUE.md` directly. If a Claude agent (typically Tech Lead or Security Lead) cannot resolve a CR-flagged issue without business-logic input, that agent escalates.

## Cost discipline

Per project rules: start on the free tier. Move to Pro only if (a) the feature is crucial and (b) it demonstrably saves time or improves quality. Track this decision in `DECISIONS.md` if the move is made.
