---
type: memory
title: "ChatClient Silent Failure — Plugin Skips All Agents"
createdAt: "2026-06-10T11:30:00+02:00"
updatedAt: "2026-06-10T11:30:00+02:00"
tags: [gotcha, chatclient, provider, initialization, silent-failure]
see_also:
  - "runbooks/0001-debugging-persona-coach.runbook.md"
  - "concepts/0003-system-reminder-injection.concept.md"
  - "memories/0002-config-defaults-discrepancy.memory.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: ChatClient Silent Failure — Plugin Skips All Agents

## Fact

The plugin was active (hooks fired, sessions initialized) but **generated zero questions** for every agent, silently skipping all agents with:

```
[persona-coach] No persona text found for agent <name>. Skipping.
```

This was caused by **two independent gaps**:

1. **ChatClient never injected:** `setChatClient()` was never called by the host. The plugin entry point (`server.ts`) did not auto-inject a model client, so `CoachGenerator` had no way to call the LLM.

2. **Persona text never resolved:** `resolveAgentInfo()` looked up `agentName` in `client.config.get().agent[...]`, but custom framework agents (`researcher`, `session`, `vault-keeper`) are **not defined in opencode's config agent map**. The function returned `{}`, causing `extractPersona()` to return `""`.

## Context

The plugin was designed assuming:
- The host would call `setChatClient()` with a model client.
- Agent definitions live in opencode's `config.agent` map.

Both assumptions were false in production. The failure was **silent** — no errors were thrown; the plugin simply skipped question generation and continued.

## Fix

Two coordinated changes closed the gaps:

1. **ProviderChatClient adapter** (`src/provider-client.ts`):
   - Reads provider config from `PluginInput.client.config.get()`
   - Parses `config.model` as `providerID/modelID`
   - Calls the provider's OpenAI-compatible `/chat/completions` endpoint via `fetch()`
   - Caches config after first load; degrades gracefully on errors

2. **Persona extraction from system prompt** (`src/types.ts` → `extractPersonaFromSystem`):
   - Initialization moved from `chat.message` to `experimental.chat.system.transform`
   - Extracts persona text from `output.system` (the actual prompts sent to the LLM)
   - Filters out tool JSON schemas (`"type": "object"` + `"properties"`) and `<system-reminder>` blocks
   - Idempotent: only runs on the first call per session (`initializedSessions` Set)

3. **Obsolete code removed:**
   - `resolveAgentInfo()` removed from `index.ts` (no longer needed)
   - `setChatClient()` remains (now called internally by `server.ts`)

## Impact

- **Pre-fix:** 0% of agents received persona coaching. Plugin was effectively a no-op.
- **Post-fix:** 100% of agents receive coaching based on their actual system prompt text, with no external dependencies.
- **Test coverage:** 199 tests, 0 failures (including 15 ProviderChatClient tests, 10 extractPersonaFromSystem tests, 10 server hook tests).
