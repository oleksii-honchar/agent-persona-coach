---
type: specification
id: SPEC-0002
title: "Dynamic Hard-Gate Wording Implementation"
kind: feature
status: accepted
createdAt: "2026-09-28T16:45:00Z"
updatedAt: "2026-09-28T16:45:00Z"
tags: [traversal, hard-gate, wording, implementation]
see_also:
  - "adrs/0015-dynamic-hard-gate-wording.adr.md"
  - "adrs/0014-hard-gate-v4-mid-turn-interruption.adr.md"
---

# SPEC-0002: Dynamic Hard-Gate Wording Implementation

## Goal

Make the hard-gate wording dynamic based on whether a decision-tree node is currently anchored, providing clear, context-aware instructions to the agent.

## Architecture

```
blockIfNeeded(sessionID, toolName, toolArgs)
    └─ resolveGateNode(sessionID, state)  → node?: string
        └─ formatDynamicHardGateMessage(node, config)  → string
            ├─ if node is defined: use config.hardGate.wordingWithNode (with {node} replacement)
            └─ if node is undefined: use config.hardGate.wordingNoNode
```

## Implementation Details

### Config Changes

Two new optional fields in `hardGate` config:
- `wordingWithNode` — template for when a node is anchored (includes `{node}` placeholder)
- `wordingNoNode` — template for when no node is anchored

The legacy `wording` field is preserved for backward compatibility. If `wordingWithNode`/`wordingNoNode` are not present, the plugin uses `wording` for both cases.

### Code Changes

- `src/traversal.ts` — `blockIfNeeded` calls `formatDynamicHardGateMessage` instead of `formatHardGateMessage`
- `src/injector.ts` — New `formatDynamicHardGateMessage` function that selects wording based on node state
- `src/types.ts` — New `wordingWithNode` and `wordingNoNode` fields in `HardGateConfig`
- `opencode.jsonc` — Updated config with both wording fields

### Testing

- 9 unit tests for `formatDynamicHardGateMessage` covering all branches
- 2 unit tests for `blockIfNeeded` integration with dynamic wording
- Backward compatibility tests ensuring legacy `wording` field works
- Edge case: `isNodeIdLabel` filtering prevents tool-name fallbacks from being interpolated

## Rollout

1. Plugin code change (traversal.ts, injector.ts, types.ts)
2. Config update (opencode.jsonc) — add `wordingNoNode` field
3. Manual smoke test: trigger hard-gate with and without anchored node
4. Verify agent reacts correctly to both wordings