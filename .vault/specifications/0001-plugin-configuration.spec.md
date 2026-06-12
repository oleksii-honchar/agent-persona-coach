---
type: specification
title: "Plugin Configuration Schema"
kind: feature
status: active
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-12T14:20:00Z"
tags: [configuration, schema, plugin]
owner: ""
see_also:
  - "concepts/0002-reflection-categories.concept.md"
  - "memories/0002-config-defaults-discrepancy.memory.md"
  - "adrs/0003-per-user-message-identity-nudge.adr.md"
  - "adrs/0006-config-driven-prompts.adr.md"
  - "adrs/0007-deep-merge-config-overrides.adr.md"
  - "adrs/0008-restore-system-transform-init.adr.md"
  - "adrs/0009-move-rules-nudge-to-ontoolafter.adr.md"
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
- [x] `coachPrompt` — The LLM prompt template for generating reflection questions (moved from hard-coded `COACH_PROMPT` in `prompt.ts` to config)

## Behaviors

**Global enable/disable:**
- When `enabled: false`, the plugin initializes but all category checks return false — no nudges are injected.

**Category enable/disable:**
- When a category is disabled (`enabled: false`), its `shouldInject*` method returns false regardless of cadence.

**Cadence behavior:**
- Identity, Progress: inject when `toolCallCount > 0` AND `toolCallCount % cadence === 0`
- Rules: inject when `criticalToolCallCount > 0` AND `criticalToolCallCount % cadence === 0`
- References: inject once when `toolCallCount >= cadence` AND not yet injected

**Critical tool detection (after ADR-0009 — D12):**
1. `isToolCritical(toolName, toolMetadata?)` is called — from `onToolAfter` with metadata always undefined
2. `permissionName = toolMetadata?.requiresPermission ?? toolName` — falls back to tool name when metadata is absent
3. Check `criticalPermissions.includes(permissionName)` → if match, tool is critical
4. If no match, check `criticalTools.includes(toolName)` → fallback for custom/MCP tools
5. If neither matches, tool is NOT critical → `criticalToolCallCount` is NOT incremented

**Rule Compliance cadence mechanism:**
- Rule Compliance uses `criticalToolCallCount`, not `toolCallCount`. The counter is incremented inside `onToolAfter` only after `isToolCritical` returns true.
- Architecture elements:
  - `isToolCritical(toolName, toolMetadata?) → boolean` — checks permissions/tools without cadence
  - `incrementCriticalToolCall(sessionId) → CoachState` — increments the critical counter
  - Since `tool.execute.after` does NOT pass metadata (see ADR-0009), the tool name is checked directly against `criticalPermissions`
  - The `criticalPermissions` array effectively acts as a **tool-name whitelist** when called from `onToolAfter`

**Per-user-message identity injection:**
- When `categories.identity.afterEachUserMessage: true`, the plugin queues an identity nudge in `chat.message` and injects it in `experimental.chat.system.transform`
- The nudge is built via `buildIdentityNudge()` using cached identity questions
- If `categories.identity.enabled: false`, the per-user-message injection is also disabled
- The flag is consumed (deleted) on first check in `system.transform` to prevent duplicate injection

**Configuration merging:**
- User config is deep-merged with `DEFAULT_CONFIG` via `deepMerge(DEFAULT_CONFIG, userConfig)` in the plugin constructor
- Objects are merged recursively; arrays and primitives are replaced; `undefined` values are skipped
- This enables partial nested overrides — users can specify only the fields they want to change

## Risks

- **Risk:** RESOLVED — `deepMerge` replaced the shallow merge, enabling partial nested overrides without losing other category configurations. See [[adrs/0007-deep-merge-config-overrides.adr.md]] for design details.
- **Risk:** User provides prompt without `{personaText}` placeholder — LLM call works but persona text is missing from the prompt. *Mitigation:* Documented in README as a requirement.
- **Risk:** Empty/null `coachPrompt` — LLM receives empty user message. *Mitigation:* Guard in `initializeSession()` falls back to `DEFAULT_CONFIG.coachPrompt`.
## Defaults

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the plugin globally |
| `categories.identity.enabled` | `boolean` | `true` | Enable identity check nudges |
| `categories.identity.cadence` | `number` | `10` | Inject identity check every N tool calls |
| `categories.identity.afterEachUserMessage` | `boolean` | `true` | Inject identity check after every user message |
| `categories.rules.enabled` | `boolean` | `true` | Enable rule compliance nudges |
| `categories.rules.cadence` | `number` | `10` | Inject rule compliance nudge every N critical tool calls |
| `categories.rules.criticalPermissions` | `string[]` | `["bash", "edit", "task"]` | Tool/permission names triggering rule compliance. Since `isToolCritical` falls back to tool name (without metadata), each critical tool name must be in this array. The `write` tool maps to `edit` via EDIT_TOOLS but its tool name is `"write"` — add `"write"` explicitly if the write tool should be critical. |
| `categories.rules.criticalTools` | `string[]` | `[]` | Fallback tool names triggering rule compliance |
| `categories.references.enabled` | `boolean` | `true` | Enable reference check nudges |
| `categories.references.cadence` | `number` | `30` | Inject reference check once after N tool calls |
| `categories.progress.enabled` | `boolean` | `true` | Enable progress check nudges |
| `categories.progress.cadence` | `number` | `20` | Inject progress check every N tool calls |
| `coachPrompt` | `string` | `[full COACH_PROMPT text]` | The LLM prompt template for generating reflection questions; must contain `{personaText}` placeholder |

## Permission Reference

### Permission-to-Tool Mapping

The following table documents all built-in tool IDs, their config permission keys, and whether they are critical for rules nudges.

| Tool ID | Config Permission Key | Critical? | Notes |
|---------|----------------------|-----------|-------|
| `bash` | `bash` | ✅ Yes | Shell tool — tool ID is `"bash"` (not `"shell"`) for backward compat |
| `edit` | `edit` | ✅ Yes | Edit tool — covered by EDIT_TOOLS group |
| `write` | `edit` | ✅ Yes | Write tool — shares `edit` permission via EDIT_TOOLS group |
| `apply_patch` | `edit` | ✅ Yes | ApplyPatch tool — shares `edit` permission via EDIT_TOOLS group |
| `task` | `task` | ✅ Yes | Background task tool |
| `read` | `read` | No | Read only |
| `glob` | `glob` | No | File pattern matching |
| `grep` | `grep` | No | Content search |
| `lsp` | `lsp` | No | LSP operations |
| `webfetch` | `webfetch` | No | HTTP fetch |
| `websearch` | `websearch` | No | Web search |
| `skill` | `skill` | No | Skill loading |
| `question` | `question` | No | Question tool (Action type, not Rule) |
| `todowrite` | `todowrite` | No | Todo tool |
| `repo_clone` | `repo_clone` | No | Git clone |
| `repo_overview` | `repo_overview` | No | Repo overview |
| `external_directory` | `external_directory` | No | External directory access |
| `invalid` | — | No | Error/unknown tool |
| MCP tools | MCP tool name (custom) | Depends | Must be listed in `criticalTools` or `criticalPermissions` |

**EDIT_TOOLS group** (from `packages/core/src/permission.ts`):
```typescript
const EDIT_TOOLS = ["edit", "write", "apply_patch"]
```
All three tool IDs map to the `edit` permission for evaluation purposes. In permission config, `permission.edit` controls all three. For `criticalPermissions`, `"edit"` covers all three since `isToolCritical` checks the tool name (not the permission name) when metadata is undefined.

### Enforcement Chain

When a tool executes, the rules nudge enforcement chain is:

```
tool.execute.after fires for each tool
  → plugin.onToolAfter(sessionID, toolName, args, agentName, {})
    → stateManager.isToolCritical(toolName, undefined)
      → criticalPermissions.includes(toolName)           ← must contain the tool name
      → if false: criticalTools.includes(toolName)        ← fallback for custom tools
      → if both false: returns FALSE — NO RULES NUDGE
    → stateManager.incrementCriticalToolCall(sessionID)   ← only if isToolCritical returned true
    → stateManager.shouldInjectRuleCompliance(state, ...)
      → criticalToolCallCount > 0 && cadence check
    → buildNudge("rules", agentName, agentInfo)
```

### Known Config Pitfalls

- **Empty array = no rules nudges:** If `criticalPermissions: []`, `isToolCritical()` always returns false. `criticalToolCallCount` stays at 0. Rules nudges never fire.
- **`write` vs `edit`:** The `write` tool ID maps to the `edit` permission key, but its tool name is `"write"`. If you want `write` to be critical, add `"write"` to `criticalPermissions` explicitly — `"edit"` alone won't catch the `write` tool name.
- **Array replacement (deepMerge):** User config overrides REPLACE the default array entirely (see [[adrs/0007-deep-merge-config-overrides.adr.md]]). Setting `criticalPermissions: ["bash"]` replaces the default `["bash", "edit", "task"]` — it does NOT merge.

## Links

- [[0002-reflection-categories.concept.md]] — Detailed explanation of each category
- [[0003-per-user-message-identity-nudge.adr.md]] — Architecture decisions for per-user-message identity nudge
- [[adrs/0008-restore-system-transform-init.adr.md]] — Persona extraction regression fix (prerequisite for all nudge categories)
- [[adrs/0009-move-rules-nudge-to-ontoolafter.adr.md]] — Rules nudge move to onToolAfter (defines current enforcement chain)
