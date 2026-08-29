---
type: adr
id: ADR-0010
title: "Traversal-Nudge Mode (deterministic, zero LLM calls)"
status: accepted
createdAt: "2026-08-29T19:30:01Z"
updatedAt: "2026-08-29T19:30:01Z"
tags: [traversal, nudge, decision-tree, deterministic, zero-llm]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0009-move-rules-nudge-to-ontoolafter.adr.md"
  - "adrs/0004-remove-system-prompt-injection.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0010: Traversal-Nudge Mode (deterministic, zero LLM calls)

## Context

Discovery 8 (decision-tree compliance audit, 2026-08-28) found a recurring failure mode:
persona agents stop traversing the decision tree mid-task. One observed case was an agent
resuming work inside a node after the user answered, without advancing to the next node.

The user asked the `agent-persona-coach` plugin to keep nudging agents to follow the tree,
with a hard requirement: **recurrent nudges with zero LLM calls**. The existing generative
categories (identity, rules, references, progress) use one model call at session start; the
new mode must not use a model at all.

The plugin already runs one `tool.execute.after` pipeline (`onToolAfter`, ADR-0009). All
nudges are delivered as synthetic user messages via `output.inject` (ADR-0004,
message-injection-only). The new mode must fit inside that pipeline.

## Decision

Introduce a deterministic **TraversalNudgeEngine** (`src/traversal.ts`): a per-session
state machine driven by observed tool-call arguments and state. **It has no `ChatClient`
and never calls `CoachGenerator` or `ProviderChatClient`** (AD-7).

**Detection (AD-8).** A tool call is a traversal call when its name — or the wrapped name
inside `meta_use` `args` — substring-matches a configured `toolPatterns` pattern:
`getPersonaEntryNode`, `expandFileRelations`, `fetchFile`, `getPersonaStatus`. This covers
direct `bensyne_*` names and `meta_use`-wrapped shapes.

**Anchor the last node (AD-8).** A traversal call anchors the node (id from `file_id` /
`node_id` args, falling back to the tool name) and resets the counters. Non-traversal calls
accumulate a counter; when it reaches `nudgeAfter`, the engine injects a
`<system-reminder>` "Traversal Check" nudge. Re-nudging happens every `recurrentEvery`,
capped at `maxRepeats` per anchor. A new user message (`chat.message`) resets the state —
a new task boundary.

**Backtracking is first-class (AD-12, labyrinth rule).** The tree is a labyrinth: an agent
stuck in one branch must be able to jump back and try another branch. Any traversal call
anchoring a node **different** from the current anchor — forward **or backward** — is
legitimate advancement (resets `cycleCount`). Only re-anchoring the **same** node
increments `cycleCount`; at `backtrackAfter` the engine emits a "Backtrack Check" nudge
(`stuckWording`) instead of forward-pressure, suggesting re-expanding an ancestor node's
edges or re-entering via `getPersonaEntryNode`, backed by a bounded path history
(`historyDepth`).

**Node identity = frontmatter `id` (AD-13).** The anchor is the node's stable, unique
frontmatter id, surfaced by the traversal tools as `file_id` / `node_id`. `title` is used
for wording only. A non-empty `veto` in a `fetchFile` result classifies the anchor as a
**pause/wait node** (`anchorKind: "pause"`); the nudge then waits — "do not proceed until
the user answers; re-expand when direction is received". The `veto` is best-effort
semantics, never an identifier.

**Delivery (AD-9).** Only via `output.inject` as a synthetic user message (ADR-0004): no
`system.transform`, no system-prompt modification, no new hooks.

**Config / opt-in (AD-10).** `categories.traversal` lives in `DEFAULT_CONFIG` with
`enabled: false`. Overrides merge via `deepMerge` (ADR-0007). `wording` and `stuckWording`
carry a `{node}` placeholder.

**Tests (AD-11).** node:test covers detection, anchoring, cadence, caps, reset,
forward/backward advancement (AD-12) and cycle detection (AD-12). A negative assertion
`mockClient.calls.length === 0` proves zero LLM calls in traversal-only flows; the engine
file has no `ChatClient` / `createCompletion` import (rg-verifiable).

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| **A — Generative categories for traversal nudges** | Reuses the existing model pipeline | Every nudge needs an LLM call | Rejected: violates the zero-LLM requirement (AD-7) |
| **B — Inject into the system prompt** | Always visible | Contradicts ADR-0004; invalidates provider caches | Rejected: re-introduces the removed `system.transform` path |
| **C — Deterministic engine + `output.inject` (chosen)** | Zero LLM, deterministic, reuses the ADR-0009 pipeline | Nudges persist as synthetic messages in the session DB | Chosen |

## Consequences

- ✅ **Near-zero-cost deterministic nudges** — pure observation + state; no model calls, no
  latency, no provider tokens (AD-7, AD-11).
- ✅ **Opt-in** — `categories.traversal.enabled: false` by default; no behavior change on
  existing installs (AD-10).
- ✅ **Cache-friendly delivery** — only via `output.inject` (ADR-0004) as synthetic user
  messages, persisted to SQLite and visible on the next LLM turn, like every other category.
- ✅ **Backtracking is never punished (AD-12)** — forward AND backward node changes count
  as advancement; only same-node cycling triggers the backtrack nudge.
- ✅ **Pause-node awareness (AD-13)** — `veto`-carrying nodes receive a wait-biased nudge,
  not forward pressure.
- ⚠️ **No tool-catalog guard** — detection is substring-based (`toolPatterns`); a
  traversal tool missing from the patterns is not recognized. Users can extend
  `toolPatterns`.
- ⚠️ Pause-node classification is best-effort from `fetchFile` output (OQ11) — falls back
  to "normal" when the frontmatter `veto` is not observable.