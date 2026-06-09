# Agent Persona Coach

Generate and inject persona-specific reflection questions during agent sessions.

## Overview

Agent Persona Coach uses the agent's own model — **one call at session start** — to generate
persona-tuned reflection questions in 4 predefined categories. Questions are cached per
agent and injected at fixed cadences during the session.

**No coach model. No new hooks. No stream interception.**

## Categories

| Category | Injection Point | Cadence |
|----------|----------------|---------|
| Identity Check | After tool calls | Every 4 calls |
| Rule Compliance | Before critical tools | Before write/edit/bash/task |
| Reference Check | After tool calls | Once, after 2 calls |
| Progress Check | After tool calls | Every 8 calls |

## Quick Start

```typescript
import { AgentPersonaCoachPlugin } from "agent-persona-coach";

// Initialize plugin
const plugin = new AgentPersonaCoachPlugin();

// Set the model client (your AI provider)
plugin.setChatClient({
  async createCompletion(request) {
    // Your model call here
    return { text: JSON.stringify({ identity: ["Am I in my role?"] }) };
  },
});

// At session start
await plugin.initializeSession("developer", agentInfo);

// During session
// After each tool call:
const nudgeAfter = plugin.onToolAfter(sessionId, toolName, toolArgs, "developer", agentInfo);
systemPrompt = plugin.updateSystemPrompt(systemPrompt, nudgeAfter);

// Before each tool call:
const nudgeBefore = plugin.onToolBefore(sessionId, toolName, toolMetadata, "developer", agentInfo);
systemPrompt = plugin.updateSystemPrompt(systemPrompt, nudgeBefore);
```

## Costs

- **Model calls:** 1 per unique agent (cached across sessions)
- **Cost:** ~$0.002 per unique agent (one-time, then $0)
- **Token overhead:** ~1,040 tokens/session

## Comparison with COW

| Dimension | COW | Agent Persona Coach |
|-----------|-----|---------------|
| Coach model | 27B-35B | Agent's own model |
| LOC | ~2,500-3,500 | ~400-600 |
| Cost/session | ~$0.07 | ~$0.002 |
| New hooks | 1 | 0 |
| Stream interception | Yes | No |
| Implementation | 3-4 weeks | 1-2 weeks |

## License

MIT
