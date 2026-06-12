---
type: adr
id: ADR-0008
title: "Restore system.transform Hook for Persona Extraction Only"
status: accepted
createdAt: "2026-06-12T14:20:00Z"
updatedAt: "2026-06-12T14:20:00Z"
tags: [initialization, lifecycle, regression, system.transform]
supersedes: ["ADR-0005"]
superseded_by: []
see_also:
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "adrs/0005-move-lazy-init-to-chat-message.adr.md"
  - "memories/0005-rule-compliance-not-delivered.memory.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0008: Restore system.transform Hook for Persona Extraction Only

## Context

Commit `9381514` ("refactor: remove system prompt injection logic and simplify session initialization") removed the `experimental.chat.system.transform` hook and moved session initialization from `system.transform` to `chat.message` (documented in ADR-0005). The `chat.message` hook receives `agent` (string) and `model` but NOT the system prompt.

`extractPersona({ model })` returns `""` because neither `prompt` nor `system` field exists in `{ model }`. The `agentPersonas` map is never populated → `buildNudge()` returns `null` for ALL categories → the entire plugin produces no nudges. Logged as:
```
WARN No persona text found for agent $agent. Skipping.
```

## Decision

Restore the `experimental.chat.system.transform` hook for **persona extraction + session initialization only** (no nudge injection). The `chat.message` hook no longer calls `initializeSession` — it only flags identity nudge injection for the next LLM call.

**New architecture:**
```
User sends message
  └─ chat.message:
       ├─ sessionAgent.set(sessionID, agent)
       └─ [identity flagged for next LLM call if afterEachUserMessage]

LLM request built (first call)
  └─ system.transform (only if !initializedSessions.has(sessionID)):
       ├─ extractPersonaFromSystem(output.system) → "You are a vault-keeper..."
       └─ plugin.initializeSession(agentName, { system: personaText, model })
            ├─ extractPersona({ system: personaText }) → persona text ✓
            ├─ agentPersonas.set(agentName, personaText)
            └─ cache.getOrGenerate(agentName, personaText, model)
```

Key differences from the old system.transform (ADR-0004 removal):
- **Only persona extraction + initialization** — no nudge injection (nudges go via `tool.execute.after` → `output.inject`)
- **`initializedSessions` Set** guards against re-initialization on subsequent LLM calls
- **Model mapped** from `input.model.id` → `modelID` for the generator

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|-------------|
| Keep init in `chat.message` | Simpler code | No access to system prompt | Rejected: `chat.message` cannot provide persona text without core opencode changes |
| Pass persona through config | Direct access | Duplicates data, manual config maintenance | Rejected: system prompt is the source of truth |
| Skip initialization entirely | — | Plugin never produces nudges | Not viable |
| Restore full old system.transform (incl. nudge injection) | Closer to original | Breaks cache optimization from ADR-0004 | Rejected: nudge injection via `output.inject` is superior (no cache invalidation) |

## Consequences

- ✅ Persona text correctly extracted from system prompt → all nudge categories work
- ✅ No nudge injection in `system.transform` — cache optimization from ADR-0004 preserved
- ✅ Prevents `"No persona text found for agent"` WARN messages
- ✅ ADR-0005 (move init to chat.message) is fully superseded
- ⚠️ Requires `initializedSessions` Set + `pendingUserMessageIdentity` Map in server.ts state
- ⚠️ Sequence dependency: Phase 0 must be implemented before rules persistence change (Phases 1-5)
