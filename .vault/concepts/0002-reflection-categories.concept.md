---
type: concept
title: "Reflection Categories"
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-10T11:50:00Z"
tags: [coaching, categories, identity, rules, references, progress]
see_also:
  - "concepts/0001-persona-drift.concept.md"
  - "specifications/0001-plugin-configuration.spec.md"
  - "memories/0001-priority-collision-gotcha.memory.md"
  - "adrs/0002-rule-compliance-cadence.adr.md"
  - "adrs/0003-per-user-message-identity-nudge.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Concept: Reflection Categories

## What

Agent Persona Coach defines 4 predefined categories of reflection questions, each targeting a different aspect of persona maintenance:

1. **Identity Check** — "Am I still operating in my correct role?"
2. **Rule Compliance** — "Am I following my constraints before this critical action?"
3. **Reference Check** — "Have I read all reference files my persona mentions?"
4. **Progress Check** — "Am I making progress toward my goal? Is quality sufficient?"

## Why

These categories map to proven human coaching patterns (Pomodoro Technique, OODA Loop, Boxing Coach) and address the three causes of persona drift: proactive interference, ambiguity in natural language definitions, and working memory decay. Each category fires at a different cadence to maximize relevance without overwhelming the agent.

## Key Details

- **Identity Check** fires in two modes:
  - **Cadence mode**: at `tool.execute.after` every N tool calls (default: 10). It verifies the agent hasn't drifted from its role.
  - **Per-user-message mode**: at `experimental.chat.system.transform` after every user message (when `afterEachUserMessage: true`, default: `true`)
- **Rule Compliance** fires at `tool.execute.before` every N **critical** tool calls (default: 10). Uses a dedicated `criticalToolCallCount` counter that only increments on critical tools. Critical tools are determined by `criticalPermissions` (MetaTool-compatible) or `criticalTools` (fallback by name).
- **Reference Check** fires once at `tool.execute.after` after N tool calls (default: 30). It's a one-time check because reading references is typically a session-start activity.
- **Progress Check** fires at `tool.execute.after` every N tool calls (default: 20). It assesses whether the agent is on track.

**Dual-mode identity:** Both Identity Check modes can be enabled simultaneously. The per-user-message mode reinforces identity at every turn boundary (user message → model response), while the cadence mode provides periodic checks during long tool-heavy sessions. When both fire in the same turn, both nudges are injected (no deduplication) — this is rare and harmless.

**Cadence overlap:** At calls 8, 16, 24… both Identity and Progress would fire. The plugin now accumulates all applicable nudges (not just the first), so both are injected together. See [[0001-priority-collision-gotcha.memory.md]] for the historical issue.

**Cadence mechanism:** Rule Compliance uses a separate `criticalToolCallCount` counter that only increments on critical tools. This prevents the cadence from being diluted by read-heavy workloads.

**Token impact:**
- Model call at session start: ~960 tokens (one-time per unique agent, cached)
- Per nudge injection: ~260 tokens average
- Per-user-message identity nudge: ~260 tokens per turn (when `afterEachUserMessage: true`)
- Typical 40-call session with 20 user messages: ~11,440 tokens total (including per-user-message nudges)
