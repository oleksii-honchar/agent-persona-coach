---
type: adr
id: ADR-0002
title: "Rule Compliance Cadence — Every N Critical Tool Calls"
status: accepted
createdAt: "2026-06-10T11:30:00+02:00"
updatedAt: "2026-06-10T11:30:00+02:00"
tags: [plugin, cadence, rules, coaching]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0001-plugin-design-decisions.adr.md"
  - "concepts/0002-reflection-categories.concept.md"
  - "memories/0001-priority-collision-gotcha.memory.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0002: Rule Compliance Cadence — Every N Critical Tool Calls

## Context

The Agent Persona Coach plugin originally injected Rule Compliance nudges **before every critical tool call** (write, bash, task, create). In a typical 40-call session with ~25% critical calls (~10 calls), this produced 10 rule compliance nudges — deemed noisy and unproductive by the user.

## Decision

**Rule Compliance will use a cadence of every N critical tool calls, with N configurable via `categories.rules.cadence`.**

- The counter tracks **only critical tool calls** (`criticalToolCallCount`), not total tool calls.
- The counter is incremented **before** the cadence check (so call 2 has count=2, 2%2=0 → inject).
- Non-critical tools do **not** advance the counter.
- The existing `shouldInjectRuleCompliance` method now accepts `CoachState` and combines criticality + cadence checks.
- A new public `isToolCritical()` method extracts the criticality check for reuse in `onToolBefore`.

## Rationale

1. **Noise reduction**: 10 critical calls → ~5 nudges at cadence 2 (50% reduction).
2. **Consistency**: Mirrors the cadence pattern already used by Identity, Progress, and Reference checks.
3. **Domain-specific counting**: Critical-only counting prevents dilution in read-heavy sessions.
4. **Backward compatibility**: Setting `cadence: 1` restores the old "every call" behavior.

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| Reuse `toolCallCount` modulo | Cadence becomes unpredictable based on read/write ratio |
| Count inside `shouldInjectRuleCompliance` | Violates read-only convention of `should*` methods |
| Remove Rules category entirely | Identity checks role drift, not constraint compliance — different concerns |
| Time-based mute period | Call-count cadence is more predictable than time suppression |

## Consequences

**Positive:**
- 50% reduction in rule nudge frequency at default cadence
- Configurable per agent
- Minimal code change (~15 LOC + tests)
- No breaking changes (configurable)

**Negative:**
- Adds one field to `CoachState` (`criticalToolCallCount`)
- Splits `shouldInjectRuleCompliance` into two concerns (`isToolCritical` + cadence)
- Default behavior changes from "every call" to "every other call" unless user sets `cadence: 1`
