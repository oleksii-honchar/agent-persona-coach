---
type: adr
id: ADR-0015
title: "Dynamic Hard-Gate Wording for Persona Traversal"
status: accepted
createdAt: "2026-09-28T16:45:00Z"
updatedAt: "2026-09-28T16:45:00Z"
tags: [traversal, hard-gate, wording, dynamic, compliance, v5]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0014-hard-gate-v4-mid-turn-interruption.adr.md"
  - "adrs/0010-traversal-nudge.adr.md"
  - "adrs/0011-realign-on-user-message.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0015: Dynamic Hard-Gate Wording for Persona Traversal

## Context

ADR-0014 (Hard-Gate v4) established the mid-turn non-compliance interruption mechanism, delivering the hard-gate message as a synthetic user message via `tool.execute.after` `output.inject`. The delivery mechanism works, but the wording is static — the same template is used regardless of whether a decision-tree node is currently anchored.

The static wording ("Resume from your current decision node: `{node}`") is confusing when no node is anchored — `{node}` is empty, and the agent is told to "resume" when it should "enter" the decision tree. The fallback clause ("If you have no current node, re-enter via getPersonaEntryNode") appears at the end and is often overlooked.

This ADR documents the decision to make the hard-gate wording dynamic based on the agent's anchored state.

## Decision

Implement **dynamic wording selection** in the plugin code:

- **No node anchored:** Generate wording that instructs the agent to enter the decision tree: "Enter the decision tree: call getPersonaEntryNode to find your entry node, then expandFileRelations to traverse."
- **Node anchored:** Generate wording that instructs the agent to resume from the specific node: "Resume from your decision node `{node}`: fetch it via fetchFile (file_id from your anchor metadata) and follow its guidance."

The wording is generated in the plugin code (`formatDynamicHardGateMessage` function in `injector.ts`) based on the resolved node state. The config provides two optional wording fields (`wordingWithNode`, `wordingNoNode`) with a legacy `wording` field for backward compatibility.

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| **A — Static wording with fallback clause (current)** | Simple | Confusing when no node anchored; agent may not read the fallback | Rejected: proven ineffective |
| **B — Config template with conditionals** | User-customizable | Requires template parsing; adds complexity | Rejected: over-engineering |
| **C — Dynamic wording in plugin code (chosen)** | Clear, deterministic, zero-LLM | Requires plugin code change | Chosen: natural fit for state-based decision |

## Consequences

- ✅ Clear, context-aware instructions — the agent always receives the correct guidance based on its state
- ✅ Backward compatible — legacy `wording` field works when new fields are absent
- ✅ User-customizable — `wordingWithNode` and `wordingNoNode` can be overridden in config
- ✅ Deterministic and zero-LLM — `formatDynamicHardGateMessage` is a pure string function
- ✅ No delivery mechanism changes — reuses the `tool.execute.after` `output.inject` path from ADR-0014