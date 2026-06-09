---
type: memory
title: "Priority Collision: Progress Check Never Fires"
createdAt: "2026-06-09T00:00:00+02:00"
updatedAt: "2026-06-09T00:00:00+02:00"
tags: [gotcha, cadence, priority, bug]
see_also:
  - "concepts/0001-persona-drift.concept.md"
  - "adrs/0001-plugin-design-decisions.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: Priority Collision — Progress Check Never Fires

## Fact

Under the default cadence configuration, the progress check (every 8 tool calls) never fires because the identity check (every 4 tool calls) is evaluated first at the same hook (`tool.execute.after`) and `onToolAfter` returns immediately after the first matching nudge.

## Context

Both the identity check and progress check fire at `tool.execute.after`. The `onToolAfter` method checks categories in order: identity → references → progress. When `toolCallCount` is a multiple of 8 (8, 16, 24, …), both the identity check and progress check would fire, but the identity check is checked first and the method returns immediately.

**Cadence overlap timeline (default config):**
```
Call 1-2: (no nudges)
Call 2:   Reference Check (afterCalls=2)
Call 4:   Identity Check (cadence=4)
Call 8:   Identity Check (cadence=4) — Progress Check BLOCKED
Call 12:  Identity Check (cadence=4)
Call 16:  Identity Check (cadence=4) — Progress Check BLOCKED
Call 20:  Identity Check (cadence=4)
Call 24:  Identity Check (cadence=4) — Progress Check BLOCKED
```

## Impact

Progress checks are silently skipped in production. The plugin still provides value (identity, rules, and reference checks work correctly), but the "am I making progress?" question is never asked at the configured cadence.

**Fix:** Accumulate all applicable nudges in `onToolAfter` and inject them together instead of returning on the first match. This is a non-breaking change — just requires accumulating nudges in an array and formatting them as a single `<system-reminder>` block with multiple categories.

**Test gap:** The test "should inject progress check at call 8" (in `state.test.ts`) actually verifies identity injection, not progress injection — it was misleadingly named. The test passes because the identity check fires at call 8, but the test name implies it's testing the progress check.
