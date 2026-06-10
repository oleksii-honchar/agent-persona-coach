---
type: concept
title: "System-Reminder Injection"
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-10T10:00:00Z"
tags: [injection, system-reminder, nudge, prompting]
see_also:
  - "concepts/0002-reflection-categories.concept.md"
  - "architectures/agent-persona-coach/components/0001-internal-components.component.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Concept: System-Reminder Injection

## What

The plugin injects reflection nudges as XML `<system-reminder>` blocks. This format is recognized by the LLM as a system-level instruction that doesn't interfere with conversation context. The injection happens via two mechanisms:

1. **`output.inject`** (synthetic system message) — Used by `tool.execute.after` to inject nudges as additional system messages in the chat output.
2. **`experimental.chat.system.transform`** — Used to append nudges to the last element of the system prompt array, wrapping them inside any existing `<system-reminder>` block.

## Why

System-level instructions have higher authority than user messages in LLM attention mechanisms. By formatting nudges as `<system-reminder>` blocks, the plugin ensures the agent treats them as authoritative guidance rather than conversational content. This maximizes the probability of behavioral adjustment.

## Key Details

**Format:**
```xml
<system-reminder>
  Identity Check:
  - Am I implementing code as a developer, or have I drifted into system architecture?
  - Have I stayed focused on the implementation task at hand?
  Please reflect on these questions and adjust your behavior accordingly.
  Continue with your task.
</system-reminder>
```

**Injection strategy (`injectNudge`):**
- If the system prompt already ends with a `</system-reminder>` tag, insert the new nudge before the last closing tag.
- Otherwise, append the nudge at the end of the system prompt.

This strategy ensures multiple nudges (e.g., identity + progress at call 8) are coalesced into a single `<system-reminder>` block rather than creating multiple separate blocks.

**Hook flow:**
1. `tool.execute.before` → `onToolBefore()` → builds rule nudge → stores in `lastNudges`
2. `tool.execute.after` → `onToolAfter()` → builds cadence nudges → stores in `lastNudges`
3. `experimental.chat.system.transform` → injects `lastNudges` into last system prompt element
