---
type: runbook
title: "Debugging Agent Persona Coach"
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-10T11:50:00Z"
tags: [debugging, troubleshooting, plugin]
see_also:
  - "concepts/0003-system-reminder-injection.concept.md"
  - "memories/0001-priority-collision-gotcha.memory.md"
  - "memories/0002-config-defaults-discrepancy.memory.md"
  - "memories/0003-chatclient-silent-failure.memory.md"
  - "adrs/0003-per-user-message-identity-nudge.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Runbook: Debugging Agent Persona Coach

## Prerequisites

- Plugin installed and enabled in `opencode.jsonc`
- Access to `--server-logs` output or the log file (`~/Library/Application Support/opencode/log/dev.log` on macOS)
- Basic understanding of the 4 reflection categories and their cadences

## Steps

### 1. Verify Plugin Initialization

**Check logs for:**
```
INFO  YYYY-MM-DDTHH:mm:ss Plugin started
INFO  YYYY-MM-DDTHH:mm:ss Session {sessionId} initialized for agent {agentName}
```

**If missing:**
- Check that the plugin path is correct in `opencode.jsonc`
- Verify `enabled: true` in plugin configuration
- Check for `No persona text found for agent {name}` warning (agent has no prompt/system field)

### 1b. Check ChatClient Injection

**Check logs for:**
```
INFO  ProviderChatClient ready: provider/model
```

**If missing:**
- The plugin cannot reach the LLM provider. Verify `model` is set in `opencode.jsonc`.
- Check provider config has `baseURL` and `apiKey`.
- Look for `WARN  ProviderChatClient: missing baseURL or apiKey` in logs.

### 2. Check Question Generation

**Check logs for:**
```
INFO  YYYY-MM-DDTHH:mm:ss Session initialized for agent {name} with N questions
```

**If 0 questions or warning:**
- The model call may have failed; check for `WARN  Failed to generate questions` in logs
- If `No persona text found for agent {name}` appears, the plugin failed to extract persona from the system prompt. Check that the agent's system prompt contains non-schema, non-reminder text.
- If `ProviderChatClient: failed to load config` appears, the SDK client is unavailable or the provider config is malformed.

### 3. Verify Nudge Injection

**Check logs for:**
```
DEBUG YYYY-MM-DDTHH:mm:ss identity (1 nudge)
DEBUG YYYY-MM-DDTHH:mm:ss system prompt updated with 1 nudge (session {id})
```

**If no nudges appear:**
- Check cadence configuration (defaults: identity=10, rules=10, references=30, progress=20)
- Verify tool calls are being made; nudges only fire after/before tools
- Check if category is disabled in config

### 3b. Verify Per-User-Message Identity Nudge

**Check logs for:**
```
DEBUG YYYY-MM-DDTHH:mm:ss Identity nudge queued for session {sessionId}
DEBUG YYYY-MM-DDTHH:mm:ss identity (user-message) nudge injected (session {sessionId})
```

**If no per-user-message nudges appear:**
- Check `categories.identity.afterEachUserMessage` is `true` (default: `true`)
- Check `categories.identity.enabled` is `true` — if the identity category is disabled, per-user-message injection is also disabled
- Verify the session is initialized — `buildIdentityNudge` returns `null` if questions are not cached
- Check if `chat.message` hook is firing — look for `Session {id} initialized for agent {name}` in logs

**If nudge appears twice in the same turn:**
- This is expected when both `afterEachUserMessage` and cadence fire together
- Both nudges are redundant but harmless; no deduplication is performed

### 4. Investigate Missing Progress Checks

**Symptom:** Identity checks fire but progress checks never appear.

**Cause:** Priority collision at calls 8, 16, 24… where identity and progress overlap. This was fixed in the current code by accumulating all applicable nudges. If running an older version, upgrade.

**Verify:** Check `onToolAfter` returns multiple nudges at call 8.

### 5. Check Cache Invalidation

**To force question regeneration:**
- Change the agent's persona text (even slightly) → hash changes → cache miss
- Or call `plugin.invalidateCache(agentName)` programmatically

### 6. Enable Debug Logging

Set log level to DEBUG for verbose output:
```typescript
import { setLevel } from "agent-persona-coach/logger";
setLevel("DEBUG");
```

## Verification

After debugging, confirm:
- [ ] Plugin initializes without errors
- [ ] Questions are generated (non-zero count)
- [ ] Nudges appear in logs at expected cadences
- [ ] Per-user-message identity nudges appear after each user message (when enabled)
- [ ] System prompt contains `<system-reminder>` blocks

## Rollback

To disable the plugin entirely:
```jsonc
{
  "agent-persona-coach": {
    "enabled": false
  }
}
```

No state is persisted to disk; disabling clears all in-memory state.
