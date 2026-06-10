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

Under the default cadence configuration, the progress check (every 20 tool calls) could be blocked because the identity check (every 10 tool calls) is evaluated first at the same hook (`tool.execute.after`). In the original implementation, `onToolAfter` returned immediately after the first matching nudge, so only identity would fire at call 20.

## Context

Both the identity check and progress check fire at `tool.execute.after`. The `onToolAfter` method checks categories in order: identity → references → progress. When `toolCallCount` is a multiple of 20 (20, 40, 60, …), both the identity check and progress check would fire, but in the original code the identity check was checked first and the method returned immediately.

**Cadence overlap timeline (default config):**
```
Call 1-29:  (no nudges, or occasional identity at 10)
Call 10:    Identity Check (cadence=10)
Call 20:    Identity Check (cadence=10) — Progress Check BLOCKED (original bug)
Call 30:    Identity Check (cadence=10) + Reference Check (cadence=30)
Call 40:    Identity Check (cadence=10) — Progress Check BLOCKED (original bug)
```

## Impact

Progress checks are silently skipped in production. The plugin still provides value (identity, rules, and reference checks work correctly), but the "am I making progress?" question is never asked at the configured cadence.

**Fix:** Accumulate all applicable nudges in `onToolAfter` and inject them together instead of returning on the first match. This is a non-breaking change — just requires accumulating nudges in an array and formatting them as a single `<system-reminder>` block with multiple categories.

**Test gap:** The test "should inject progress check at call 8" (in `state.test.ts`) actually verifies identity injection, not progress injection — it was misleadingly named. The test passes because the identity check fires at call 8, but the test name implies it's testing the progress check.
