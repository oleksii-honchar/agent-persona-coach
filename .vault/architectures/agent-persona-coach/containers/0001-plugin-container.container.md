---
type: container
title: "Agent Persona Coach — Plugin Container"
c4_level: container
system: agent-persona-coach
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-08-29T20:21:00Z"
tags: [plugin, c4, container]
see_also:
  - "architectures/agent-persona-coach/_index.md"
  - "concepts/0003-system-reminder-injection.concept.md"
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "adrs/0005-move-lazy-init-to-chat-message.adr.md"
  - "adrs/0010-traversal-nudge.adr.md"
  - "concepts/0005-traversal-nudge-mode.concept.md"
linked_elements: []
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Container: Agent Persona Coach — Plugin Container

## Diagram

```mermaid
C4Container
  title Agent Persona Coach — Plugin Container

  System(opencode, "better-opencode", "Agent execution framework")

  Boundary(plugin, "Agent Persona Coach", "Plugin") {
    Container(server, "Server Entry", "TypeScript", "Wires plugin to better-opencode hooks")
    Container(core, "Plugin Core", "TypeScript", "Main plugin class coordinating all components")
    Container(generator, "CoachGenerator", "TypeScript", "Generates persona-specific questions via LLM")
    Container(cache, "CoachQuestionsCache", "TypeScript", "In-memory cache keyed by content hash")
    Container(state, "CoachStateManager", "TypeScript", "Per-session tool call tracking")
    Container(injector, "CoachInjector", "TypeScript", "Formats nudges via formatNudge() / formatTraversalNudge()")
    Container(traversal, "TraversalNudgeEngine", "TypeScript", "Deterministic zero-LLM decision-tree traversal state machine (traversal.ts)")
  }

  System_Ext(model, "LLM Model", "Chat completion API")

  Rel(opencode, server, "Triggers hooks")
  Rel(server, core, "Delegates to")
  Rel(core, generator, "Generates questions via")
  Rel(core, cache, "Caches/retrieves via")
  Rel(core, state, "Tracks session state via")
  Rel(core, injector, "Formats nudges via")
  Rel(core, traversal, "Feeds observed tool calls via onToolAfter; resets on chat.message")
  Rel(generator, model, "Calls for question generation")
```

## Elements

| ID | Name | Type | Technology | Description |
|----|------|------|-----------|-------------|
| `server` | Server Entry | Container | TypeScript | `server.ts` — wires plugin to better-opencode hooks (chat.message, tool.execute.before, tool.execute.after) |
| `core` | Plugin Core | Container | TypeScript | `index.ts` — `AgentPersonaCoachPlugin` class coordinating all components |
| `generator` | CoachGenerator | Container | TypeScript | `generator.ts` — LLM call, JSON parsing, validation, fallback |
| `cache` | CoachQuestionsCache | Container | TypeScript | `cache.ts` — in-memory Map keyed by `agentName:SHA-256(personaText)` |
| `state` | CoachStateManager | Container | TypeScript | `state.ts` — per-session tool call and critical tool call counters |
| `injector` | CoachInjector | Container | TypeScript | `injector.ts` — `formatNudge()`, `formatTraversalNudge()`, `formatBacktrackNudge()` (injectNudge removed with system.transform path) |
| `traversal` | TraversalNudgeEngine | Container | TypeScript | `traversal.ts` — deterministic zero-LLM state machine: observes tool calls per session, anchors decision-tree nodes, emits traversal/backtrack nudges |

## Removed Containers

The following containers were removed per [[adrs/0004-remove-system-prompt-injection.adr.md]]:

- **`pendingUserMessageIdentity` Map** — Per-session flag bridging `chat.message` to `system.transform`. Removed because the system.transform path was eliminated.
- **`injectNudge()`** — Function in `injector.ts` that appended a nudge into the system prompt text. Dead code after system.transform removal.

## Notes

All containers run in the same Node.js process (this is a plugin, not a distributed system). The cache is in-memory only — no external database. The generator calls the LLM synchronously during `initializeSession()` and caches the result. The plugin now uses 3 hooks (was 4) — `system.transform` was removed, initialization moved to `chat.message` per [[adrs/0005-move-lazy-init-to-chat-message.adr.md]], and the deterministic `TraversalNudgeEngine` ([[adrs/0010-traversal-nudge.adr.md]]) was added as an opt-in, zero-LLM container fed from `onToolAfter` and reset on `chat.message`.
