---
type: concept
title: "System-Reminder Injection"
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-11T17:55:00+02:00"
tags: [injection, system-reminder, nudge, prompting]
see_also:
  - "concepts/0002-reflection-categories.concept.md"
  - "concepts/0004-prompt-caching-sensitivity.concept.md"
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "adrs/0005-move-lazy-init-to-chat-message.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Concept: System-Reminder Injection

## What

The plugin injects reflection nudges as XML `<system-reminder>` blocks via a single delivery mechanism:

1. **`output.inject`** (synthetic user message) — Used by `tool.execute.after` to inject nudges as user messages containing `<system-reminder>` blocks in the text content.

The `<system-reminder>` format is recognized by the LLM as a system-level instruction that doesn't interfere with conversation context, even when delivered as a synthetic user message.

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

**Current hook flow:**
1. `chat.message` → `initializeSession()` on first message (ADR-0005)
2. `tool.execute.before` → `onToolBefore()` → rule nudge (logged, NOT injected — see [[memories/0005-rule-compliance-not-delivered.memory.md]])
3. `tool.execute.after` → `onToolAfter()` → identity/reference/progress nudges → `output.inject`

**Delivery path:** Nudges are mapped to `output.inject = nudges.map(text => ({ role: "user", text }))` in `server.ts`. Each nudge becomes a separate synthetic user message containing a `<system-reminder>` block. The LLM processes these as instructions due to the XML format, not as user input.

**Cache-friendly:** Message injection via `output.inject` appends content AFTER the Anthropic cache breakpoint — the cached prefix remains valid. Only the new content is processed. See [[concepts/0004-prompt-caching-sensitivity.concept.md]].

## Removed Mechanisms

The following injection mechanisms were removed per [[adrs/0004-remove-system-prompt-injection.adr.md]]:

- **`experimental.chat.system.transform`** — Modified the system prompt on every LLM request, invalidating the Anthropic system cache. Removed because system prompt modification is the primary cache invalidation problem.
- **`pendingUserMessageIdentity` flag** — Used by `chat.message` to signal `system.transform` to inject an identity nudge. Removed with the system.transform path.
- **`injectNudge()`** — Function that appended a nudge into the system prompt text (in `injector.ts`). Dead code after system.transform removal; removed.
- **`updateSystemPrompt()`** — Method in `AgentPersonaCoachPlugin` that called `injectNudge()`. Dead code; removed.
- **`buildIdentityNudge()`** — Method for on-demand identity nudge formatting via `system.transform`. Dead code; removed.
