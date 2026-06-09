# Agent Persona Coach

Generate and inject persona-specific reflection questions during agent sessions.

## Overview

Agent Persona Coach uses the agent's own model — **one call at session start** — to generate
persona-tuned reflection questions in 4 predefined categories. Questions are cached per
agent and injected at fixed cadences during the session.

**No coach model. No new hooks. No stream interception.**

## Installation

### npm

```bash
npm install agent-persona-coach
```

### As a local plugin

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugins": [
    "file:///path/to/agent-persona-coach"
  ]
}
```

## Configuration

The plugin accepts a configuration object via `AgentPersonaCoachPlugin` constructor or through `DEFAULT_CONFIG`:

```jsonc
{
  "agent-persona-coach": {
    "enabled": true,
    "categories": {
      "identity": {
        "enabled": true,
        "cadence": 4
      },
      "rules": {
        "enabled": true,
        "criticalPermissions": ["write", "bash", "task", "create"],
        "criticalTools": []
      },
      "references": {
        "enabled": true,
        "afterCalls": 2
      },
      "progress": {
        "enabled": true,
        "cadence": 8
      }
    }
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the plugin |
| `categories.identity.enabled` | `boolean` | `true` | Enable identity check nudges |
| `categories.identity.cadence` | `number` | `4` | Inject identity check every N tool calls |
| `categories.rules.enabled` | `boolean` | `true` | Enable rule compliance nudges |
| `categories.rules.criticalPermissions` | `string[]` | `["write", "bash", "task", "create"]` | MetaTool-compatible permission names that trigger rule compliance before execution |
| `categories.rules.criticalTools` | `string[] | `[]` | Fallback tool names that trigger rule compliance (used when no permission metadata) |
| `categories.references.enabled` | `boolean` | `true` | Enable reference check nudges |
| `categories.references.afterCalls` | `number` | `2` | Inject reference check once after N tool calls |
| `categories.progress.enabled` | `boolean` | `true` | Enable progress check nudges |
| `categories.progress.cadence` | `number` | `8` | Inject progress check every N tool calls |

### Example: Custom Cadences

```jsonc
{
  "agent-persona-coach": {
    "categories": {
      "identity": { "enabled": true, "cadence": 5 },
      "rules": { "enabled": true, "criticalPermissions": ["write", "bash"], "criticalTools": ["git-commit"] },
      "references": { "enabled": true, "afterCalls": 3 },
      "progress": { "enabled": true, "cadence": 10 }
    }
  }
}
```

### Example: Disable a Category

```jsonc
{
  "agent-persona-coach": {
    "categories": {
      "progress": { "enabled": false }
    }
  }
}
```

## Categories

| Category | Injection Point | Cadence | Purpose |
|----------|----------------|---------|---------|
| Identity Check | After tool calls | Every N calls | "Am I still operating in my role? Have I drifted?" |
| Rule Compliance | Before critical tools | Before write/edit/bash/task | "Am I following my constraints before this action?" |
| Reference Check | After tool calls | Once, after N calls | "Have I read all reference files my persona mentions?" |
| Progress Check | After tool calls | Every N calls | "Am I making progress toward my goal? Is quality sufficient?" |

## API

```typescript
// Classes
import { AgentPersonaCoachPlugin } from "agent-persona-coach";
import { CoachQuestionsCache, CoachGenerator, CoachStateManager } from "agent-persona-coach";

// Utility functions
import { extractJsonFromMarkdown, formatNudge, injectNudge, extractPersona } from "agent-persona-coach";

// Types
import type { CoachQuestions, CoachState, PluginConfig, ChatClient } from "agent-persona-coach";
```

### Public Methods

| Method | Description |
|--------|-------------|
| `plugin.initializeSession(agentName, agentInfo)` | Generate and cache questions for an agent |
| `plugin.onToolBefore(sessionId, toolName, toolMetadata, agentName, agentInfo)` | Pre-tool nudge (Rule Compliance) |
| `plugin.onToolAfter(sessionId, toolName, toolArgs, agentName, agentInfo)` | Post-tool nudges (Identity, Reference, Progress) |
| `plugin.updateSystemPrompt(sessionId, systemPrompt, agentName, agentInfo)` | Inject nudge via system.transform |
| `plugin.invalidateCache(agentName)` | Invalidate cached questions for an agent |
| `plugin.clearSession(sessionId)` | Clear session state |

## Architecture

```
AgentPersonaCoachPlugin
  ├── CoachGenerator      — Model call + JSON parsing + validation + fallback
  ├── CoachQuestionsCache — In-memory, content-hash keyed
  ├── CoachStateManager   — Per-session tool call tracking
  └── CoachInjector       — formatNudge + injectNudge
```

### Cache Design

Questions are cached per agent using a content hash of the persona text:

- **Key:** `agentName + SHA-256(personaText)` truncated to 16 hex chars
- **Invalidation:** Persona text changes → hash changes → cache miss → regenerate
- **Manual:** `invalidate(agentName)` removes all entries for that agent

### Nudge Format

Nudges are injected as `<system-reminder>` blocks:

```xml
<system-reminder>
  Identity Check:
  - Am I implementing code as a developer, or have I drifted into system architecture?
  - Have I stayed focused on the implementation task at hand?
  Please reflect on these questions and adjust your behavior accordingly.
  Continue with your task.
</system-reminder>
```

### Token Impact

| Component | Tokens | Notes |
|-----------|--------|-------|
| Model call at session start | ~960 | One-time per unique agent (cached) |
| Per nudge injection | ~260 avg | 2-3 questions × ~40 chars + wrapper |
| Typical 40-call session | ~6,240 | 8 identity + 1 reference + ~15 rules |

## Error Handling

| Scenario | Behavior |
|----------|---------|
| Model call fails | Log warning, return empty questions, continue without nudges |
| No persona text | Log warning, skip initialization |
| Questions >80 chars | Truncate to 79 + "…", log warning |
| Category has no questions | Skip that category |

## License

MIT
