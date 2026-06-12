---
type: adr
id: ADR-0009
title: "Move Rules Nudge from onToolBefore to onToolAfter"
status: accepted
createdAt: "2026-06-12T14:20:00Z"
updatedAt: "2026-06-12T14:20:00Z"
tags: [nudge, rule-compliance, persistence, delivery-path]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0008-restore-system-transform-init.adr.md"
  - "memories/0005-rule-compliance-not-delivered.memory.md"
  - "memories/0006-critical-permissions-discrepancy.memory.md"
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "specifications/0001-plugin-configuration.spec.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0009: Move Rules Nudge from onToolBefore to onToolAfter

## Context

Rules nudges go through `tool.execute.before` → `onToolBefore`. This hook's output type has no `inject` field — the core discards the return value. The nudge is logged then discarded. Identity/progress/references nudges go through `tool.execute.after` → `onToolAfter` → `output.inject` → `flushInjectedMessages()` → SQLite, which persists correctly.

**Persistence status before this ADR:**

| Category | Hook | Persists to DB? |
|----------|------|----------------|
| Identity | `tool.execute.after` | ✅ (via `output.inject`) |
| Rules | `tool.execute.before` | ❌ (no inject path) |
| References | `tool.execute.after` | ✅ (via `output.inject`) |
| Progress | `tool.execute.after` | ✅ (via `output.inject`) |

The `onToolBefore` method and `tool.execute.before` hook were leftover from the old system where rules nudges were injected via `system.transform`. After ADR-0004 removed `system.transform`, the `tool.execute.before` handler was updated to log the nudge but not inject it, creating dead code.

## Decision

Move rules nudge logic from `onToolBefore` (`tool.execute.before`) to `onToolAfter` (`tool.execute.after`). All four nudge categories now use the same pipeline:

```
onToolAfter → output.inject → flushInjectedMessages() → SQLite (synthetic: true)
```

**Specific changes:**
1. Remove `onToolBefore` method from `AgentPersonaCoachPlugin`
2. Add rules logic to `onToolAfter`: `isToolCritical` → `incrementCriticalToolCall` → `shouldInjectRuleCompliance` → `buildNudge`
3. Remove `"tool.execute.before"` from `Hooks` interface and `server.ts` hooks object
4. Update `isToolCritical` in `CoachStateManager` to work without `toolMetadata` (since `tool.execute.after` doesn't pass it)

**After:**
```
User Message → Tool executes → tool.execute.after
  └─ plugin.onToolAfter:
       ├─ stateManager.incrementToolCall(sessionID)
       ├─ identity? → buildNudge (existing)
       ├─ rules? → buildNudge (NEW — moved from onToolBefore)
       │    ├─ isToolCritical(toolName)
       │    ├─ incrementCriticalToolCall(sessionID)
       │    └─ shouldInjectRuleCompliance(state)
       ├─ references? → buildNudge (existing)
       ├─ progress? → buildNudge (existing)
       └─ returns string[] → output.inject → SQLite
```

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|-------------|
| **A — Move to after** (chosen) | Simplest, removes code, no orphan risk, consistent | — | Chosen |
| **B — Deferred injection** | Keeps before-hook semantic | Map<sessionId, string[]> coordination, orphan risk if after-hook never fires | Rejected: more complex, same outcome |
| **C — Flag + after** | Cleaner than B | Still requires Set<sessionId>, same orphan risk | Rejected: before-hook semantic already meaningless |

**Rationale for Option A:**
- **Simplest** — removes code instead of adding state coordination mechanisms
- **No orphan risk** — if `tool.execute.after` doesn't fire, no nudge is attempted (same as other categories)
- **Consistent** — all four categories use one hook, one pipeline, one logging point
- **Timing irrelevant** — the rules nudge was already NOT injected into current context; it persists to DB and is visible on next LLM turn (identical to existing categories)

## Consequences

- ✅ Rules nudges persist to SQLite as synthetic messages
- ✅ All four nudge categories use one pipeline — predictable behavior
- ✅ No orphan state risk
- ✅ Logging preserved — rules nudge content moves from removed `tool.execute.before` log to existing `tool.execute.after` log (alongside other categories)
- ⚠️ `onToolBefore` method removed — backwards-incompatible for any direct callers (none known, tests updated)
- ⚠️ `isToolCritical` updated for metadata-less calls — must check tool name against `criticalPermissions` directly (see D12)
- ⚠️ Sequence dependency: requires ADR-0008 (persona extraction fix) first — without it, no nudges of any category work
