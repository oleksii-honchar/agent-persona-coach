---
type: runbook
title: "Debugging Agent Persona Coach"
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-12T14:20:00Z"
tags: [debugging, troubleshooting, plugin]
see_also:
  - "concepts/0003-system-reminder-injection.concept.md"
  - "memories/0001-priority-collision-gotcha.memory.md"
  - "memories/0002-config-defaults-discrepancy.memory.md"
  - "memories/0003-chatclient-silent-failure.memory.md"
  - "memories/0006-critical-permissions-discrepancy.memory.md"
  - "adrs/0003-per-user-message-identity-nudge.adr.md"
  - "adrs/0009-move-rules-nudge-to-ontoolafter.adr.md"
  - "specifications/0001-plugin-configuration.spec.md"
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
INFO  YYYY-MM-DDTHH:mm:ss identity (1 nudge)
INFO  YYYY-MM-DDTHH:mm:ss identity, rules (2 nudges)
```

**If no nudges appear:**
- Check cadence configuration (defaults: identity=10, rules=10, references=30, progress=20)
- Verify tool calls are being made; nudges only fire after tools execute
- Check if category is disabled in config

### 3b. Verify Per-User-Message Identity Nudge

**Check logs for:**
```
DEBUG YYYY-MM-DDTHH:mm:ss Identity nudge queued for session {sessionId}
INFO  YYYY-MM-DDTHH:mm:ss identity (user-message) nudge injected (session {sessionId})
```

**If no per-user-message nudges appear:**
- Check `categories.identity.afterEachUserMessage` is `true` (default: `true`)
- Check `categories.identity.enabled` is `true` — if the identity category is disabled, per-user-message injection is also disabled
- Verify the session is initialized — `buildIdentityNudge` returns `null` if questions are not cached
- Check if `chat.message` hook is firing — look for `Session {id} initialized for agent {name}` in logs

**If nudge appears twice in the same turn:**
- This is expected when both `afterEachUserMessage` and cadence fire together
- Both nudges are redundant but harmless; no deduplication is performed

### 3c. Debug Rules Nudge Not Firing

**Symptom:** Identity/progress/reference nudges appear but rules nudges never fire.

**Enforcement chain (debug in this order):**

```
tool.execute.after fires for each tool
  → plugin.onToolAfter(sessionID, toolName, args, agentName, {})
    → stateManager.isToolCritical(toolName, undefined)
      → criticalPermissions.includes(toolName)    ← VERIFY: tool name in array?
      → if false: criticalTools.includes(toolName) ← VERIFY: fallback list?
      → if both false: returns FALSE — NO RULES NUDGE
    → stateManager.incrementCriticalToolCall(sessionID)
      ← only if isToolCritical returned TRUE
    → stateManager.shouldInjectRuleCompliance(state, toolName)
      → criticalToolCallCount > 0 && cadence check
    → buildNudge("rules", agentName, agentInfo)
```

**Check 1 — criticalPermissions is populated:**
```bash
# Both sources must have non-empty criticalPermissions:
grep -A2 'criticalPermissions' ~/.config/opencode/opencode.jsonc
grep -A2 'criticalPermissions' ./src/types.ts  # from repo root
```

Minimum expected value: `["bash", "edit", "task"]`. Add `"write"` if the `write` tool should be explicitly critical.

**Check 2 — Plugin was rebuilt after config change:**
```bash
cd ~/www/misc/agent-persona-coach
npm run build  # rebuilds dist/ from source
```
The registered plugin runs from `dist/`, not from `src/`. Changes to `DEFAULT_CONFIG` in `types.ts` require a rebuild.

**Check 3 — Tool calls are critical:**
```bash
# In DB, check which tools were used in the session
sqlite3 ~/.local/share/opencode/opencode-local.db \
  "SELECT json_extract(data, '$.tool') as tool,
          json_extract(data, '$.session_id') as sessionId,
          count(*) as calls
   FROM part
   WHERE json_extract(data, '$.session_id') = 'SES_ID'
     AND json_extract(data, '$.tool') IS NOT NULL
   GROUP BY json_extract(data, '$.tool')"
```
Critical tools: bash, edit/write/apply_patch, task. Tools like read/glob/grep/skill are NOT critical by default.

**Check 4 — Logs show rules nudge injection:**
```
INFO  ... rules, identity (2 nudges)  ← at tool.execute.after L137
```
Rules nudge now appears alongside other categories in the after-hook log (after ADR-0009).

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
