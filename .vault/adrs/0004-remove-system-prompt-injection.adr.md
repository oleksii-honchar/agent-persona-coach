---
type: adr
id: ADR-0004
title: "Remove System Prompt Injection — Message Injection Only"
status: accepted
createdAt: "2026-06-11T17:55:00+02:00"
updatedAt: "2026-06-11T17:55:00+02:00"
tags: [cache, injection, system-prompt, delivery-path, performance]
supersedes: []
superseded_by: []
see_also:
  - "concepts/0004-prompt-caching-sensitivity.concept.md"
  - "concepts/0003-system-reminder-injection.concept.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0004: Remove System Prompt Injection — Message Injection Only

## Context

The agent-persona-coach plugin delivered nudges through two mechanisms: (1) `experimental.chat.system.transform` modified the system prompt by appending `<system-reminder>` blocks, and (2) `tool.execute.after` injected synthetic user messages via `output.inject`. Both fired for the same nudge events.

**Cache impact (confirmed by Anthropic docs):** The system prompt is part of the cache key — ANY change to it forces the provider to reprocess the system prompt from scratch. This was the PRIMARY cache invalidation problem, causing 3-5 cache invalidations per user message cycle. By contrast, message injection via `output.inject` appends content AFTER the cache breakpoint — the cached prefix remains valid and is reused.

**Verified against codebase:**
- `experimental.chat.system.transform` hook fires at `packages/opencode/src/session/llm/request.ts:69` and `packages/opencode/src/agent/agent.ts:409`
- The hook handler was at `server.ts` (lines ~184-218, now removed)
- `injectNudge()` was at `injector.ts:30-47` (now removed)

## Decision

Remove the `experimental.chat.system.transform` hook entirely. Deliver ALL nudges exclusively via `output.inject` (synthetic user messages).

**Implementation (verified in live code):**
- `experimental.chat.system.transform` handler removed from `createServerHooks()` in `server.ts`
- `lastNudges`, `initializedSessions`, `pendingUserMessageIdentity` maps removed
- `injectNudge()` removed from `injector.ts` (only `formatNudge()` remains)
- `updateSystemPrompt()`, `buildIdentityNudge()`, `resolveAgentInfo()` removed from `AgentPersonaCoachPlugin`
- `Hooks` interface now has 3 entries (was 4)
- `tool.execute.after` handler remains unchanged — the sole delivery path

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|-------------|
| Keep both paths | — | Doubles cache invalidation with no benefit | Rejected: system prompt modification is the primary problem |
| Remove message injection, keep system prompt | Simple | System cache invalidated on every nudge | Rejected: system prompt modification is the primary problem |
| Accumulator pattern to defer system prompt changes | Fewer invalidations | Complex, overkill | Rejected: removing system path entirely solves the problem |
| Use tool output text for nudges | No system prompt change | Tool outputs are transient; may not persist across LLM calls | Rejected |

## Consequences

- **Positive:** ~80-90% fewer cache invalidations (eliminates the primary problem)
- **Positive:** Simpler, single delivery path
- **Positive:** System prompt remains stable — defines agent's identity and should not change between LLM calls
- **Positive:** No need for accumulator pattern or complex delivery gating
- **Negative:** Nudges now appear as separate messages in the conversation (synthetic user messages with `synthetic: true`)
  - Mitigation: the `<system-reminder>` tag format in the nudge text ensures the LLM processes them as instructions, not user input
- **Negative:** Rule compliance nudges from `tool.execute.before` are no longer delivered (see [[memories/0005-rule-compliance-not-delivered.memory.md]])
