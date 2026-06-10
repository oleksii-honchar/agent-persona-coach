---
type: container
title: "Agent Persona Coach — Plugin Container"
c4_level: container
system: agent-persona-coach
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-10T11:50:00Z"
tags: [plugin, c4, container]
see_also:
  - "architectures/agent-persona-coach/_index.md"
  - "concepts/0003-system-reminder-injection.concept.md"
  - "adrs/0003-per-user-message-identity-nudge.adr.md"
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
    Container(injector, "CoachInjector", "TypeScript", "Formats and injects nudges into system prompt")
    Container(flag, "pendingUserMessageIdentity Map", "TypeScript", "Per-session flag for user-message nudges")
  }

  System_Ext(model, "LLM Model", "Chat completion API")

  Rel(opencode, server, "Triggers hooks")
  Rel(server, core, "Delegates to")
  Rel(core, generator, "Generates questions via")
  Rel(core, cache, "Caches/retrieves via")
  Rel(core, state, "Tracks session state via")
  Rel(core, injector, "Formats nudges via")
  Rel(server, flag, "Sets flag from chat.message")
  Rel(flag, server, "Consumed in system.transform")
  Rel(generator, model, "Calls for question generation")
```

## Elements

| ID | Name | Type | Technology | Description |
|----|------|------|-----------|-------------|
| `server` | Server Entry | Container | TypeScript | `server.ts` — wires plugin to better-opencode hooks |
| `core` | Plugin Core | Container | TypeScript | `index.ts` — `AgentPersonaCoachPlugin` class coordinating all components |
| `generator` | CoachGenerator | Container | TypeScript | `generator.ts` — LLM call, JSON parsing, validation, fallback |
| `cache` | CoachQuestionsCache | Container | TypeScript | `cache.ts` — in-memory Map keyed by `agentName:SHA-256(personaText)` |
| `state` | CoachStateManager | Container | TypeScript | `state.ts` — per-session tool call and critical tool call counters |
| `injector` | CoachInjector | Container | TypeScript | `injector.ts` — `formatNudge()` and `injectNudge()` utilities |
| `flag` | `pendingUserMessageIdentity` Map | Container | TypeScript | `server.ts` — per-session boolean flag bridging `chat.message` to `system.transform` |

## Notes

All containers run in the same Node.js process (this is a plugin, not a distributed system). The cache is in-memory only — no external database. The generator calls the LLM synchronously during `initializeSession()` and caches the result.
