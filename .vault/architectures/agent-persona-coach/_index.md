---
type: architecture
title: "Agent Persona Coach — System Context"
c4_level: system_context
system: agent-persona-coach
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-08-29T20:21:00Z"
tags: [plugin, c4, system-context]
see_also:
  - "adrs/0001-plugin-design-decisions.adr.md"
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "adrs/0005-move-lazy-init-to-chat-message.adr.md"
  - "concepts/0004-prompt-caching-sensitivity.concept.md"
  - "concepts/0001-persona-drift.concept.md"
  - "adrs/0010-traversal-nudge.adr.md"
  - "concepts/0005-traversal-nudge-mode.concept.md"
linked_elements: []
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# System Context: Agent Persona Coach

## Diagram

```mermaid
C4Context
  title Agent Persona Coach — System Context

  Person(user, "User", "Interacts with the agent via chat")
  System(opencode, "better-opencode", "Agent execution framework")
  System(plugin, "Agent Persona Coach", "Plugin that generates and injects reflection questions")
  System_Ext(model, "LLM Model", "Provides chat completions for question generation")

  Rel(user, opencode, "Sends messages to")
  Rel(opencode, plugin, "Loads as plugin via hooks")
  Rel(plugin, model, "Calls once per unique agent to generate questions")
  Rel(plugin, opencode, "Injects nudges via synthetic user messages")
```

## Elements

| ID | Name | Type | Description |
|----|------|------|-------------|
| `user` | User | Person | End user interacting with the agent |
| `opencode` | better-opencode | System | Agent execution framework that loads plugins |
| `plugin` | Agent Persona Coach | System | Plugin generating and injecting reflection questions |
| `model` | LLM Model | System_Ext | External model used for one-time question generation |

## Notes

The plugin integrates with better-opencode via 3 hooks: `chat.message` (session init + traversal reset), `tool.execute.before` (rule compliance), and `tool.execute.after` (cadence nudges + traversal observation). The LLM is only called once per unique agent persona (cached), making it a low-cost dependency. Nudges are delivered exclusively via `output.inject` (synthetic user messages) — the `system.transform` path was removed to preserve Anthropic's prompt cache per [[adrs/0004-remove-system-prompt-injection.adr.md]]. Since ADR-0009 the rules nudge also flows through `tool.execute.after`; ADR-0010 adds an opt-in deterministic `TraversalNudgeEngine` fed from `onToolAfter`.
