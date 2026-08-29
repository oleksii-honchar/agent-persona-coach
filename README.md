# Agent Persona Coach

Generate and inject persona-specific reflection questions during agent sessions.

## Overview

Agent Persona Coach uses the agent's own model — **one call at session start** — to generate
persona-tuned reflection questions in 4 predefined categories (the **generative** categories).
Questions are cached per agent and injected at fixed cadences during the session.

It also ships an opt-in **Traversal-Nudge mode** (`categories.traversal`): a deterministic,
**zero-LLM** state machine that catches decision-tree traversal tool calls
(`getPersonaEntryNode`, `expandFileRelations`, `fetchFile`, `getPersonaStatus` — directly or
`meta_use`-wrapped), anchors the agent on its **last node**, and injects recurrent
`<system-reminder>` nudges to follow that node and step to the next one. Unlike the
generative categories, it **never calls a model** — it is pure observation + per-session
state delivered via `output.inject`.

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
        "cadence": 10,
        "afterEachUserMessage": true
      },
      "rules": {
        "enabled": true,
        "cadence": 10,
        "criticalPermissions": ["bash", "edit", "task"],
        "criticalTools": []
      },
      "references": {
        "enabled": true,
        "cadence": 30
      },
      "progress": {
        "enabled": true,
        "cadence": 20
      },
      "traversal": {
        "enabled": false,
        "toolPatterns": ["getPersonaEntryNode", "expandFileRelations", "fetchFile", "getPersonaStatus"],
        "nudgeAfter": 8,
        "recurrentEvery": 8,
        "maxRepeats": 3,
        "historyDepth": 5,
        "backtrackAfter": 3
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
| `categories.identity.cadence` | `number` | `10` | Inject identity check every N tool calls |
| `categories.identity.afterEachUserMessage` | `boolean` | `true` | Inject identity check after every user message |
| `categories.rules.enabled` | `boolean` | `true` | Enable rule compliance nudges |
| `categories.rules.cadence` | `number` | `10` | Inject rule compliance nudge every N critical tool calls |
| `categories.rules.criticalPermissions` | `string[]` | `["bash", "edit", "task"]` | MetaTool-compatible permission names that trigger rule compliance before execution |
| `categories.rules.criticalTools` | `string[]` | `[]` | Fallback tool names that trigger rule compliance (used when no permission metadata) |
| `categories.references.enabled` | `boolean` | `true` | Enable reference check nudges |
| `categories.references.cadence` | `number` | `30` | Inject reference check once after N tool calls |
| `categories.progress.enabled` | `boolean` | `true` | Enable progress check nudges |
| `categories.progress.cadence` | `number` | `20` | Inject progress check every N tool calls |
| `categories.traversal.enabled` | `boolean` | `false` | Enable Traversal-Nudge mode (opt-in) |
| `categories.traversal.toolPatterns` | `string[]` | `["getPersonaEntryNode", "expandFileRelations", "fetchFile", "getPersonaStatus"]` | Substring patterns identifying traversal tool calls (covers `bensyne_*` and `meta_use`-wrapped names) |
| `categories.traversal.nudgeAfter` | `number` | `8` | First traversal nudge after N non-traversal calls |
| `categories.traversal.recurrentEvery` | `number` | `8` | Re-nudge every N non-traversal calls after the first |
| `categories.traversal.maxRepeats` | `number` | `3` | Cap on nudges per anchor |
| `categories.traversal.historyDepth` | `number` | `5` | Path history size used in backtrack suggestions |
| `categories.traversal.backtrackAfter` | `number` | `3` | Same-node re-anchors before a backtrack nudge fires |
| `categories.traversal.wording` | `string` | `[see Default]` | Progress nudge template; must contain `{node}` placeholder |
| `categories.traversal.stuckWording` | `string` | `[see Default]` | Backtrack nudge template; must contain `{node}` placeholder |
| `coachPrompt` | `string` | `[see Default Prompt]` | Custom prompt template for generating reflection questions. Must contain `{personaText}` placeholder. |

> **Partial Config Override:** The plugin uses deep merge — only the fields you specify in your config are overridden. All other fields retain their default values. For example, setting `{ "categories": { "identity": { "cadence": 5 } } }` changes only the identity cadence; all other categories and fields remain at defaults.

### Traversal-Nudge Mode (zero LLM calls)

`categories.traversal` adds a **deterministic, zero-LLM** mode: it catches tool calls that
read the agent's persona decision tree, anchors the agent's **last node**, and keeps nudging
the agent to follow that node and traverse to the next one. It is **off by default**
(`enabled: false`).

**Traversal tool calls** are matched by substring against `toolPatterns` (default:
`getPersonaEntryNode`, `expandFileRelations`, `fetchFile`, `getPersonaStatus`). Substring
matching covers both direct `bensyne_*` tool names and `meta_use`-wrapped shapes (the
wrapped tool name lives in `args.name`).

**How it works:**

1. On a traversal call the engine **anchors** that node (node id from the `file_id` /
   `node_id` args, falling back to the tool name) and starts a fresh cadence.
2. While the agent keeps calling non-traversal tools, after `nudgeAfter` (8) calls a
   `<system-reminder>` is injected — "you are on node X, follow it, then traverse to the
   next node" — then re-nudged every `recurrentEvery` (8) calls and capped at `maxRepeats`
   (3) per anchor.
3. A new traversal call that anchors a **different** node — forward **or backward** —
   counts as advancement and resets the counters.
4. **Backtracking is first-class (labyrinth rule):** the tree is a labyrinth — an agent
   stuck in one branch must be able to jump back a few steps and try another branch.
   Re-anchoring the **same** node counts as cycling; after `backtrackAfter` (3) same-node
   re-anchors the engine injects a **Backtrack Check** nudge (using `stuckWording`) instead
   of forward pressure, suggesting re-expanding an ancestor node's edges or re-entering via
   `getPersonaEntryNode`. A small path history (`historyDepth: 5`) is attached as
   recent-anchor hints.
5. **Pause-node classification:** a node whose `fetchFile` result carries a non-empty
   `veto` in frontmatter is classified as a wait node (`anchorKind: "pause"`) — the nudge
   biases toward "do not proceed until the user answers; re-expand when direction is
   received".
6. A new user message (`chat.message`) resets the traversal state — the new task boundary.

**Zero-LLM guarantee:** the engine has no `ChatClient` and never calls a model. It is pure
observation + per-session state, delivered solely via `output.inject` as a synthetic user
message (per ADR-0004 — no system-prompt modification). Tests assert
`mockClient.calls.length === 0` in traversal-only flows.

**Examples:**

```jsonc
// Enable the mode with default cadence/patterns
{
  "agent-persona-coach": {
    "categories": {
      "traversal": { "enabled": true }
    }
  }
}
```

```jsonc
// Full override — unspecified traversal fields keep their defaults (deepMerge)
{
  "agent-persona-coach": {
    "categories": {
      "traversal": {
        "enabled": true,
        "toolPatterns": ["getPersonaEntryNode", "expandFileRelations"],
        "nudgeAfter": 5,
        "recurrentEvery": 10,
        "maxRepeats": 5,
        "backtrackAfter": 2,
        "wording": "You are on node {node}. Follow its instruction, then step to the next node.",
        "stuckWording": "You keep re-anchoring on node {node}. Jump back (re-expand an ancestor, or re-enter via getPersonaEntryNode) and try another branch."
      }
    }
  }
}
```

### Default Prompt

The default prompt template generates persona-specific reflection questions across 4 categories (Identity Check, Rule Compliance, Reference Check, Progress Check). It is defined in `DEFAULT_CONFIG.coachPrompt` in `src/types.ts`.

### Example: Custom Cadences

```jsonc
{
  "agent-persona-coach": {
    "categories": {
      "identity": { "enabled": true, "cadence": 5 },
      "rules": { "enabled": true, "cadence": 3, "criticalPermissions": ["write", "bash"], "criticalTools": ["git-commit"] },
      "references": { "enabled": true, "cadence": 15 },
      "progress": { "enabled": true, "cadence": 25 }
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

### Example: Custom Prompt

```jsonc
{
  "agent-persona-coach": {
    "coachPrompt": "You are a {personaText}. Generate 2 reflection questions per category: identity, rules, references, and progress."
  }
}
```

> **Note:** The `{personaText}` placeholder is **required** in custom prompts. Without it, the agent's persona text won't be injected into the prompt, resulting in an empty or incomplete LLM prompt.

## Categories

| Category | Injection Point | Cadence | Purpose |
|----------|----------------|---------|---------|
| Identity Check | After tool calls | Every N calls | "Am I still operating in my role? Have I drifted?" |
| Rule Compliance | Before critical tools | Every N critical tool calls | "Am I following my constraints before this action?" |
| Reference Check | After tool calls | Once, after N calls | "Have I read all reference files my persona mentions?" |
| Progress Check | After tool calls | Every N calls | "Am I making progress toward my goal? Is quality sufficient?" |
| Traversal Check | After tool calls | After `nudgeAfter` non-traversal calls | "I'm anchored on node X — follow it, then traverse to the next node" (zero LLM) |

## API

```typescript
// Classes
import { AgentPersonaCoachPlugin } from "agent-persona-coach";
import { CoachQuestionsCache, CoachGenerator, CoachStateManager } from "agent-persona-coach";
import { TraversalNudgeEngine } from "agent-persona-coach";

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
| `plugin.onToolAfter(sessionId, toolName, toolArgs, agentName, agentInfo)` | Post-tool nudges (Identity, Reference, Progress, Traversal) |
| `plugin.updateSystemPrompt(sessionId, systemPrompt, agentName, agentInfo)` | Inject nudge via system.transform |
| `plugin.invalidateCache(agentName)` | Invalidate cached questions for an agent |
| `plugin.resetTraversal(sessionId)` | Reset the traversal engine for a session (new task boundary) |
| `plugin.clearSession(sessionId)` | Clear session state |

## Architecture

```
AgentPersonaCoachPlugin
  ├── CoachGenerator      — Model call + JSON parsing + validation + fallback
  ├── CoachQuestionsCache — In-memory, content-hash keyed
  ├── CoachStateManager   — Per-session tool call tracking
  ├── CoachInjector       — formatNudge + injectNudge
  └── TraversalNudgeEngine — Deterministic traversal state machine (zero LLM calls; ADR-0010)
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

Traversal nudges (only when the mode is enabled) use the same `<system-reminder>` shape with
an explicit no-model-call notice, and a `Backtrack Check` variant when the agent is cycling:

```xml
<system-reminder>
  Traversal Check:
  - You are on decision-tree node 10-understand-10-identify-behaviors. Follow its instruction, then traverse to the next node (expandFileRelations / fetchFile).
  This is a deterministic reminder - no model call was made.
  Continue with your task.
</system-reminder>
```

### Token Impact

| Component | Tokens | Notes |
|-----------|--------|-------|
| Model call at session start | ~960 | One-time per unique agent (cached) |
| Per nudge injection | ~260 avg | 2-3 questions × ~40 chars + wrapper |
| Per-user-message identity nudge | ~260 | Every user message when `afterEachUserMessage: true` |
| Traversal nudges | 0 LLM tokens | Deterministic — pure observation + state, no model call; `output.inject` only |
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
