---
type: component
title: "Agent Persona Coach — Internal Components"
c4_level: component
system: agent-persona-coach
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-10T10:00:00Z"
tags: [plugin, c4, component]
see_also:
  - "architectures/agent-persona-coach/containers/0001-plugin-container.container.md"
  - "specifications/0001-plugin-configuration.spec.md"
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
    Component(onToolBefore, "onToolBefore", "Method", "Pre-tool rule compliance check")
    Component(onToolAfter, "onToolAfter", "Method", "Post-tool cadence-based nudges")
    Component(updateSystemPrompt, "updateSystemPrompt", "Method", "Injects nudges into system prompt")
    Component(resolveAgentInfo, "resolveAgentInfo", "Method", "Fetches agent config from SDK client")
  }

  Component_Ext(cache, "CoachQuestionsCache", "Class", "In-memory question cache")
  Component_Ext(stateMgr, "CoachStateManager", "Class", "Per-session state tracking")
  Component_Ext(generator, "CoachGenerator", "Class", "LLM question generation")
  Component_Ext(injector, "formatNudge/injectNudge", "Functions", "Nudge formatting and injection")

  Rel(initialize, generator, "Calls for generation")
  Rel(initialize, cache, "Stores in cache")
  Rel(onToolBefore, stateMgr, "Increments critical count")
  Rel(onToolBefore, cache, "Retrieves rule questions")
  Rel(onToolAfter, stateMgr, "Increments tool count")
  Rel(onToolAfter, cache, "Retrieves identity/reference/progress questions")
  Rel(onToolAfter, injector, "Formats nudges")
  Rel(updateSystemPrompt, injector, "Appends to system prompt")
```

## Elements

| ID | Name | Type | Technology | Description |
|----|------|------|-----------|-------------|
| `initialize` | initializeSession | Component | TypeScript | Called at session start; triggers generation or cache retrieval |
| `onToolBefore` | onToolBefore | Component | TypeScript | Called before critical tools; increments critical count, checks cadence |
| `onToolAfter` | onToolAfter | Component | TypeScript | Called after each tool; increments tool count, checks all cadence categories |
| `updateSystemPrompt` | updateSystemPrompt | Component | TypeScript | Injects accumulated nudges into the last system prompt element |
| `resolveAgentInfo` | resolveAgentInfo | Component | TypeScript | Fetches full agent config from SDK client when agentInfo is empty |

## Notes

`onToolAfter` accumulates all matching nudges (not just the first) — this was a fix for the priority collision issue where identity checks were blocking progress checks. The `resolveAgentInfo` method handles both V1 (`prompt` field) and V2 (`system` field) agent info formats.
