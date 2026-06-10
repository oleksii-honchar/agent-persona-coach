---
type: specification
title: "Plugin Configuration Schema"
kind: feature
status: active
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-10T11:50:00Z"
tags: [configuration, schema, plugin]
owner: ""
see_also:
  - "concepts/0002-reflection-categories.concept.md"
  - "memories/0002-config-defaults-discrepancy.memory.md"
  - "adrs/0003-per-user-message-identity-nudge.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Specification: Plugin Configuration Schema

## Goal

Document the complete configuration schema for the Agent Persona Coach plugin, including all options, defaults, and behavior.

## Phases

### Phase 1 — Configuration Options

- [x] `enabled` — Global plugin enable/disable
- [x] `categories.identity.enabled` — Enable identity check nudges
- [x] `categories.identity.cadence` — Inject identity check every N tool calls
- [x] `categories.identity.afterEachUserMessage` — Inject identity check after every user message
- [x] `categories.rules.enabled` — Enable rule compliance nudges
- [x] `categories.rules.cadence` — Inject rule compliance every N critical tool calls
- [x] `categories.rules.criticalPermissions` — MetaTool-compatible permission names triggering rule compliance
- [x] `categories.rules.criticalTools` — Fallback tool names triggering rule compliance
- [x] `categories.references.enabled` — Enable reference check nudges
- [x] `categories.references.cadence` — Inject reference check once after N tool calls
- [x] `categories.progress.enabled` — Enable progress check nudges
- [x] `categories.progress.cadence` — Inject progress check every N tool calls

## Behaviors

**Global enable/disable:**
- When `enabled: false`, the plugin initializes but all category checks return false — no nudges are injected.

**Category enable/disable:**
- When a category is disabled (`enabled: false`), its `shouldInject*` method returns false regardless of cadence.

**Cadence behavior:**
- Identity, Progress: inject when `toolCallCount > 0` AND `toolCallCount % cadence === 0`
- Rules: inject when `criticalToolCallCount > 0` AND `criticalToolCallCount % cadence === 0`
- References: inject once when `toolCallCount >= cadence` AND not yet injected

**Critical tool detection:**
1. If tool metadata has `requiresPermission`, check against `criticalPermissions`
2. Else if `criticalTools` is non-empty, check tool name against `criticalTools`
3. Else, tool is not critical

**Rule Compliance cadence mechanism:**
- Rule Compliance uses `criticalToolCallCount`, not `toolCallCount`. The counter is incremented inside `onToolBefore` only after `isToolCritical` returns true.
- Architecture elements:
  - `isToolCritical(toolName, toolMetadata?) → boolean` — checks permissions/tools without cadence
  - `incrementCriticalToolCall(sessionId) → CoachState` — increments the critical counter

**Per-user-message identity injection:**
- When `categories.identity.afterEachUserMessage: true`, the plugin queues an identity nudge in `chat.message` and injects it in `experimental.chat.system.transform`
- The nudge is built via `buildIdentityNudge()` using cached identity questions
- If `categories.identity.enabled: false`, the per-user-message injection is also disabled
- The flag is consumed (deleted) on first check in `system.transform` to prevent duplicate injection

**Configuration merging:**
- User config is shallow-merged with `DEFAULT_CONFIG` via `{ ...DEFAULT_CONFIG, ...userConfig }`
- Only top-level keys are merged; nested category objects are NOT deep-merged

## Risks

- **Risk:** Shallow merge means partial category overrides replace the entire category object, not individual fields.
  - *Mitigation:* Users must provide complete category objects when overriding.
## Defaults

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the plugin globally |
| `categories.identity.enabled` | `boolean` | `true` | Enable identity check nudges |
| `categories.identity.cadence` | `number` | `10` | Inject identity check every N tool calls |
| `categories.identity.afterEachUserMessage` | `boolean` | `true` | Inject identity check after every user message |
| `categories.rules.enabled` | `boolean` | `true` | Enable rule compliance nudges |
| `categories.rules.cadence` | `number` | `10` | Inject rule compliance nudge every N critical tool calls |
| `categories.rules.criticalPermissions` | `string[]` | `["write","bash","task","create"]` | MetaTool-compatible permission names triggering rule compliance |
| `categories.rules.criticalTools` | `string[]` | `[]` | Fallback tool names triggering rule compliance |
| `categories.references.enabled` | `boolean` | `true` | Enable reference check nudges |
| `categories.references.cadence` | `number` | `30` | Inject reference check once after N tool calls |
| `categories.progress.enabled` | `boolean` | `true` | Enable progress check nudges |
| `categories.progress.cadence` | `number` | `20` | Inject progress check every N tool calls |

## Links

- [[0002-reflection-categories.concept.md]] — Detailed explanation of each category
- [[0003-per-user-message-identity-nudge.adr.md]] — Architecture decisions for per-user-message identity nudge
