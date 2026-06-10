---
type: adr
id: ADR-0003
title: "Per-User-Message Identity Nudge"
status: accepted
createdAt: "2026-06-10T11:50:00Z"
updatedAt: "2026-06-10T11:50:00Z"
tags: [plugin, identity, cadence, user-message, coaching]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0001-plugin-design-decisions.adr.md"
  - "concepts/0002-reflection-categories.concept.md"
  - "concepts/0003-system-reminder-injection.concept.md"
  - "specifications/0001-plugin-configuration.spec.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0003: Per-User-Message Identity Nudge

## Context

The session agent loses its identity between user messages and begins processing requests directly instead of routing them to the appropriate agent. The existing cadence-based identity check (every N tool calls) is too coarse to prevent this drift because it only fires after multiple tool executions, not at the boundary between user messages and model responses.

## Decision

**Add `afterEachUserMessage: boolean` (default `true`) to the identity category configuration.** When enabled, an identity-check nudge is injected into the system prompt after every user message, before the model responds. This is implemented via a per-session flag bridge between the `chat.message` and `experimental.chat.system.transform` hooks.

### Sub-decisions

1. **Boolean toggle vs. numeric cadence** — Use a boolean (`afterEachUserMessage`) rather than a numeric cadence. The user explicitly requested "after each user message," and a boolean is the simplest control knob that matches this mental model.

2. **Per-session flag bridge pattern** — Use a `Map<string, boolean>` (`pendingUserMessageIdentity`) in `server.ts` to bridge `chat.message` (sets flag) and `system.transform` (checks and clears flag). This requires zero framework changes.

3. **No deduplication between user-message and cadence nudges** — If both mechanisms fire in the same turn, both nudges are injected. The overlap is rare and harmless (redundant but not conflicting).

4. **Expose `config` and `buildIdentityNudge` publicly** — `config` is made `public readonly` on `AgentPersonaCoachPlugin`, and a new `buildIdentityNudge(agentName, agentInfo)` public method is added so `server.ts` can read configuration and format nudges.

5. **Default `afterEachUserMessage: true`** — The feature is active by default because it directly addresses the core problem (session agent losing identity). Users who don't want it can explicitly set it to `false`.

6. **Clear flag even if nudge build fails** — The flag is deleted on first check in `system.transform` even if `buildIdentityNudge` returns `null` (cache miss). This prevents wasteful retries and stale flags.

7. **Lazy initialization moved to `system.transform`** — Session initialization (question generation) was moved from `chat.message` to `system.transform` to extract persona text reliably from `output.system` rather than relying on `agentInfo` from `chat.message`.

## Rationale

1. **Boundary reinforcement** — Identity drift happens at turn boundaries (user message → model response). Reinforcing identity at this boundary is more effective than waiting for N tool calls.
2. **Low cost** — No additional LLM calls; the nudge uses cached questions. Token cost is ~260 tokens per user message.
3. **Zero framework changes** — The flag bridge pattern works entirely within existing hook signatures.
4. **Backward compatible** — Existing cadence mechanism is preserved and can coexist with the new feature.

## Alternatives Considered

| Alternative | Rejected Because |
|------------|------------------|
| Numeric cadence for user messages (`userMessageCadence: number`) | User explicitly wants every message; adds complexity without value |
| Store flag in `CoachState` | `CoachState` is count-oriented; mixing event flags would violate separation of concerns |
| Use `lastNudges` to store user-message nudge | `lastNudges` is populated by tool hooks; mixing would create timing confusion |
| Modify framework to pass user-message info to `system.transform` | Out of scope; plugin should work within existing hook signatures |
| Default `false` | User wants the feature active by default to solve the routing problem |

## Consequences

**Positive:**
- Identity is reinforced at every turn boundary, reducing persona drift for routing-critical agents
- Token cost is predictable (~260 tokens per turn)
- No additional LLM calls (uses cached questions)
- 207 tests pass with 100% success rate

**Negative:**
- Higher token usage per session (~260 tokens × number of user messages)
- Existing users upgrading will see increased token usage unless they explicitly disable the feature
- Occasional double nudge when user-message and cadence fire in the same turn (~520 tokens)

**Neutral:**
- New public API surface (`config`, `buildIdentityNudge`)
- New Map to manage in `server.ts`
