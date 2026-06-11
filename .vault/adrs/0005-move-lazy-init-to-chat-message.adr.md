---
type: adr
id: ADR-0005
title: "Move Lazy Initialization from system.transform to chat.message"
status: accepted
createdAt: "2026-06-11T17:55:00+02:00"
updatedAt: "2026-06-11T17:55:00+02:00"
tags: [initialization, lifecycle, chat.message]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0004-remove-system-prompt-injection.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0005: Move Lazy Initialization from system.transform to chat.message

## Context

Removing the `experimental.chat.system.transform` hook (ADR-0004) eliminates the lazy initialization trigger that was embedded in it. The `initializeSession()` call was made on the first LLM request via `system.transform`. With that hook gone, we need a new trigger.

**Verified in live code:** The `chat.message` hook in `server.ts` now initializes the session on the first user message, tracking state via `sessionAgent` Map:

```typescript
"chat.message": async (input, _output) => {
  const { sessionID, agent } = input;
  if (!agent || !sessionID) return;
  const isFirstMessage = !sessionAgent.has(sessionID);
  sessionAgent.set(sessionID, agent);
  if (isFirstMessage) {
    await plugin.initializeSession?.(agent, { model });
  }
},
```

## Decision

Move the `initializeSession()` call to the `chat.message` hook, which fires on the first user message in a session. The timing is essentially the same — the first LLM request always follows the first user message — just slightly earlier.

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|-------------|
| Separate hook for initialization | Isolated logic | Unnecessary complexity | Rejected: no benefit over using existing `chat.message` |
| Initialize at session creation time | Earliest possible | Doesn't have access to agent's system prompt yet | Rejected: system prompt needed for persona extraction |

## Consequences

- **Positive:** Initialization still happens at the right time
- **Positive:** No change in observable behavior
- **Negative:** If there's an error in initialization, it's caught at the message hook level instead of the LLM request level
  - Mitigation: `initializeSession` is called with optional chaining (`?.`) and error handling via `.catch()` with log warning

## Implementation Notes

**Idempotency:** The `sessionAgent` Map tracks which sessions have been initialized. A second message for the same `sessionID` does NOT re-initialize. Verified in `server.test.ts` — test "should call initializeSession exactly once per session (idempotent)".

**Model passing:** The hook now passes `input.model` to `initializeSession()`, which was NOT available in the old `system.transform` path. This enables the generator to use the correct model for question generation. Verified in `server.test.ts` — test "should call initializeSession with model when model is provided".

**Error handling:** The hook handles three failure modes:
1. Missing `agent` or `sessionID` — returns early, no init
2. `initializeSession` throws — caught and logged as warning (verified in test "should handle initializeSession rejection gracefully")
3. `initializeSession` undefined — no crash, agent still tracked (verified in test "should still track agent when initializeSession is not defined on plugin")
