---
type: concept
title: "Traversal-Nudge Mode"
createdAt: "2026-08-29T20:21:00Z"
updatedAt: "2026-08-29T20:21:00Z"
tags: [nudge, traversal, decision-tree, deterministic, zero-llm]
see_also:
  - "adrs/0010-traversal-nudge.adr.md"
  - "concepts/0002-reflection-categories.concept.md"
  - "concepts/0004-prompt-caching-sensitivity.concept.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Concept: Traversal-Nudge Mode

## What

An opt-in (`categories.traversal.enabled: false` default) deterministic state machine in the
agent-persona-coach plugin that catches decision-tree traversal tool calls and injects
recurrent `<system-reminder>` nudges to keep following the tree — with **zero LLM calls**.
Implemented by `TraversalNudgeEngine` (`src/traversal.ts`).

## Why

Persona agents stop traversing their decision tree mid-task. Traversal nudges correct that
without model latency or token cost; delivery is only via `output.inject` as synthetic user
messages (ADR-0004 delivery path), keeping provider prompt caches intact.

## Key Details

- **Detection:** substring match against `toolPatterns` (`getPersonaEntryNode`,
  `expandFileRelations`, `fetchFile`, `getPersonaStatus`) — covers `bensyne_*` names and
  `meta_use`-wrapped shapes (the wrapped tool name lives in `args.name`).
- **Anchoring:** a traversal call anchors a node (`file_id`/`node_id` from args, falling back
  to the tool name). Non-traversal calls accrue a counter; after `nudgeAfter` a nudge fires,
  re-nudging every `recurrentEvery`, capped at `maxRepeats` per anchor.
- **Advancement vs cycling:** anchoring a *different* node — forward **or** backward — resets
  cycle counters (backtracking is never punished). Re-anchoring the *same* node increments
  `cycleCount`; at `backtrackAfter` a "Backtrack Check" nudge suggests re-expanding an ancestor
  node's edges or re-entering via `getPersonaEntryNode` (labyrinth rule).
- **Pause nodes:** a non-empty `veto` in a `fetchFile` result classifies the anchor as
  `pause` — the nudge says "do not proceed until the user answers" instead of forward pressure.
- **Reset:** a new `chat.message` resets traversal state — a new task boundary.
- **Zero-LLM guarantee:** no `ChatClient` / `ProviderChatClient` dependency; tests assert
  `mockClient.calls.length === 0` in traversal-only flows.
