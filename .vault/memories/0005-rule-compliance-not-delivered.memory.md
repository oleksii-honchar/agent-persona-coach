---
type: memory
title: "Rule Compliance Nudge Not Delivered After System Transform Removal"
createdAt: "2026-06-11T17:55:00+02:00"
updatedAt: "2026-06-11T17:55:00+02:00"
tags: [nudge, rule-compliance, delivery-gap, gotcha]
see_also:
  - "adrs/0004-remove-system-prompt-injection.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: Rule Compliance Nudge Not Delivered After System Transform Removal

## Fact

The `tool.execute.before` hook creates a rule compliance nudge via `onToolBefore()` but does NOT inject it into the conversation. The nudge is logged but never delivered to the LLM.

## Context

Before ADR-0004, the `tool.execute.before` hook stored the nudge in `lastNudges`, which was then injected into the system prompt by `experimental.chat.system.transform`. After removing system.transform, the `tool.execute.before` handler was updated to log the nudge but not inject it:

```typescript
"tool.execute.before": async (input, _output) => {
  const nudge = plugin.onToolBefore?.(...) ?? null;
  // Note: nudge is no longer injected into system prompt — only tracked for potential future use
  log.info(`${tool} → rules nudge triggered (session ${sessionID})`, { nudge });
},
```

The `onToolBefore()` method still exists in `AgentPersonaCoachPlugin` and still returns a nudge string, but there is no delivery mechanism. The nudge is NOT injected via `output.inject` (that's only in `tool.execute.after`).

## Impact

**Rule compliance checks are currently non-functional.** When a critical tool (write, bash, task, create) is about to execute, the nudge asking the agent to verify compliance with its rules is created but never shown to the LLM. The agent does NOT get the compliance reminder before making critical changes.

**Resolution needed:** Either inject the nudge via `output.inject` in `tool.execute.before`, or remove the dead code (`onToolBefore` + the entire `tool.execute.before` handler).
