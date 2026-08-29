---
type: component
title: "Agent Persona Coach — Internal Components"
c4_level: component
system: agent-persona-coach
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-08-29T20:21:00Z"
tags: [plugin, c4, component]
see_also:
  - "architectures/agent-persona-coach/containers/0001-plugin-container.container.md"
  - "specifications/0001-plugin-configuration.spec.md"
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "adrs/0006-config-driven-prompts.adr.md"
  - "adrs/0007-deep-merge-config-overrides.adr.md"
  - "adrs/0009-move-rules-nudge-to-ontoolafter.adr.md"
  - "adrs/0010-traversal-nudge.adr.md"
linked_elements: []
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Component: Agent Persona Coach — Internal Components

## Diagram

```mermaid
C4Component
  title Agent Persona Coach — Plugin Core Components

  Container(core, "Plugin Core", "TypeScript", "AgentPersonaCoachPlugin class")

  Boundary(core, "Plugin Core Components", "Boundary") {
    Component(initialize, "initializeSession", "Method", "Generates or retrieves cached questions")
    Component(onToolAfter, "onToolAfter", "Method", "Post-tool cadence-based + traversal nudges")
  }

  Component_Ext(cache, "CoachQuestionsCache", "Class", "In-memory question cache")
  Component_Ext(stateMgr, "CoachStateManager", "Class", "Per-session state tracking")
  Component_Ext(generator, "CoachGenerator", "Class", "LLM question generation")
  Component_Ext(injector, "formatNudge / formatTraversalNudge / formatBacktrackNudge", "Function", "Nudge formatting (injectNudge removed)")
  Component_Ext(traversal, "TraversalNudgeEngine", "Class", "Deterministic zero-LLM traversal state machine")

  Rel(initialize, generator, "Calls for generation")
  Rel(initialize, cache, "Stores in cache")
  Rel(onToolAfter, stateMgr, "Increments tool count & critical count")
  Rel(onToolAfter, traversal, "Feeds observed tool calls")
  Rel(onToolAfter, cache, "Retrieves identity/reference/progress questions")
  Rel(onToolAfter, injector, "Formats nudges")
```

## Elements

| ID | Name | Type | Technology | Description |
|----|------|------|-----------|-------------|
| `initialize` | initializeSession | Component | TypeScript | Called at session start; triggers generation or cache retrieval |
| `onToolAfter` | onToolAfter | Component | TypeScript | Called after each tool; increments tool count, checks all cadence categories, feeds traversal engine |
| `traversal` | TraversalNudgeEngine | Component_Ext | TypeScript | Deterministic zero-LLM state machine anchoring decision-tree nodes and emitting traversal/backtrack nudges |

## Removed Components

The following components were removed per [[adrs/0004-remove-system-prompt-injection.adr.md]] and [[adrs/0009-move-rules-nudge-to-ontoolafter.adr.md]]:

- **`onToolBefore`** — Pre-tool rule compliance check. Removed per ADR-0009; rules nudge logic moved to `onToolAfter`.
- **`updateSystemPrompt`** — Injected accumulated nudges into the last system prompt element. Dead code after system.transform removal.
- **`resolveAgentInfo`** — Fetched full agent config from SDK client when agentInfo was empty. Dead code; removed.
- **`buildIdentityNudge`** — Built identity nudge on demand using cached questions; used by server for per-user-message injection via system.transform. Dead code; removed.

## Notes

`onToolAfter` accumulates all matching nudges (not just the first) — this was a fix for the priority collision issue where identity checks were blocking progress checks. The `resolveAgentInfo` method was removed along with the system.transform path. The `buildIdentityNudge` method was a focused public API that allowed the server hook to format identity nudges without exposing internal `buildNudge` implementation details; it is no longer needed because initialization is now handled in `chat.message` per [[adrs/0005-move-lazy-init-to-chat-message.adr.md]].

**Traversal engine (per [[adrs/0010-traversal-nudge.adr.md]]):** `TraversalNudgeEngine` (`src/traversal.ts`) is a deterministic, zero-LLM state machine. `onToolAfter` feeds it observed tool calls (`observeTool`); traversal tools anchor nodes and reset counters, non-traversal calls accrue toward the nudge cadence. Nudges are formatted by `formatTraversalNudge`/`formatBacktrackNudge` (`src/injector.ts`) and delivered via `output.inject`. A new `chat.message` resets traversal state via `resetTraversal`.

**Config-driven prompts (per [[adrs/0006-config-driven-prompts.adr.md]]):** The `initializeSession` method now forwards `this.config.coachPrompt` through the call chain: `initializeSession` → `cache.getOrGenerate(agentName, personaText, modelOverride, promptTemplate, generate)` → `generator.generate(agentName, personaText, promptTemplate, modelOverride)` → `buildCoachPrompt(personaText, promptTemplate)`. The prompt template flows alongside persona text through the cache/generator chain. This is an additive change — the component relationships remain the same; only the method signatures accept an additional `promptTemplate` parameter.
