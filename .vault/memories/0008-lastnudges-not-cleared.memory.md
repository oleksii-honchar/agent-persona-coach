---
type: memory
title: "lastNudges Map Never Cleared After Injection"
createdAt: "2026-06-12T14:20:00Z"
updatedAt: "2026-06-12T14:20:00Z"
tags: [gotcha, cadence, injection, over-injection]
see_also:
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "concepts/0002-reflection-categories.concept.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: lastNudges Map Never Cleared After Injection

## Fact

The `lastNudges` Map (session → string[]) in `server.ts` is populated when nudges are generated
but is **never cleared** after injection. If the old `system.transform` delivery path were still
active, this would cause over-injection — the same nudges would be re-injected on every subsequent
LLM call.

## Context

`lastNudges` was originally used in the old `system.transform` hook (before ADR-0004) to store
nudges from `tool.execute.before`/`tool.execute.after` and then inject them into the system prompt
when the next LLM request was built. After removing `system.transform`, the Map was retained but
its only remaining usage is logging in the `chat.message` hook (L93-96):

```typescript
// Over-inject check (defensive — lastNudges should be empty after injection)
const lastNudges = this.lastNudges.get(sessionID);
if (lastNudges?.length) {
  log.warn(`Found ${lastNudges.length} un-injected nudges for session ${sessionID}`);
}
```

Since `lastNudges` is never cleared, this warning fires on every user message after the first
nudge injection. The warning is defensive but never actionable — nothing injects from `lastNudges`
anymore.

## Impact

- **Low severity** — `lastNudges` is no longer used for injection (all nudges go via `output.inject`
  in `tool.execute.after`). The stale data in the Map has no effect on behavior.
- **Minor noise** — The defensive WARN log at L93-96 fires on every user message after the first
  nudge injection, showing an increasing count of "un-injected" nudges.
- **Cleanup opportunity** — Either remove `lastNudges` entirely (no functional impact since
  ADR-0004 removed `system.transform`) or clear it after injection in `tool.execute.after`.
