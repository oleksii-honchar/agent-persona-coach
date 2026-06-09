---
type: adr
id: ADR-0001
title: "Plugin Design Decisions"
status: accepted
createdAt: "2026-06-09T00:00:00+02:00"
updatedAt: "2026-06-09T00:00:00+02:00"
tags: [plugin, architecture, design]
supersedes: []
superseded_by: []
see_also:
  - "concepts/0001-persona-drift.concept.md"
  - "memories/0001-priority-collision-gotcha.memory.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0001: Plugin Design Decisions

## Context

The agent-persona-coach plugin needed to solve persona drift at minimal cost. The key question was: how to generate and inject persona-specific reflection questions without adding heavy infrastructure?

## Decision

**Use the agent's own model — one call at session start — to generate persona-specific reflection questions.** No separate coach model, no new hooks, no stream interception.

Specific design decisions:

1. **Agent's own model for question generation** — No separate coach model. The agent's model is already loaded; calling it once at session start is cheap (~$0.002/unique agent). This eliminates the coach model dependency entirely.

2. **Content-hash-based caching** — Questions are cached per agent keyed by `agentName + SHA-256(personaText)`. If persona text changes, the hash changes → cache miss → questions are regenerated. No manual invalidation needed.

3. **4 predefined categories with fixed cadences:**
   - Identity Check: every 4 tool calls (verify agent is still in role)
   - Rule Compliance: before critical tools (write, bash, task, create)
   - Reference Check: once, after 2 calls (have I read reference files?)
   - Progress Check: every 8 calls (am I making progress?)

4. **`<system-reminder>` block formatting** — Nudges are formatted as XML `<system-reminder>` blocks. This format is recognized by the LLM as a system-level instruction and doesn't interfere with conversation context.

5. **Zero new hooks** — The plugin uses only existing better-opencode hooks: `chat.message`, `tool.execute.before`, `tool.execute.after`, and `experimental.chat.system.transform`.

## Rationale

1. **Cost-benefit asymmetry** — A separate coach model (COW approach) costs ~$0.07/session and adds 1-2s latency. The agent's own model costs ~$0.002/unique agent (one-time, cached).
2. **Reliability > features** — No coach model dependency, no stream interception, no new hooks. If the model call at session start fails, questions default to empty and the plugin continues without nudges.
3. **Research-backed cadence** — Pomodoro Technique (timed check-ins), OODA Loop (Orient step), and Boxing Coach (repeated short reminders) are proven human coaching patterns that map to the 4 categories.

## Alternatives Considered

| Alternative | Rejected Because |
|------------|------------------|
| Separate coach model (COW) | Overkill; adds cost, latency, and dependency |
| Deterministic regex parsing | Research proves deterministic parsing of natural language persona definitions is impossible (Hu et al., 2025) |
| Stream interception | Complex, fragile, requires understanding LLM internals |
| Pre-written template questions | Not persona-specific; lower effectiveness |

## Consequences

**Positive:**
- **Immediate value:** 140 tests, 0 failures, approved
- **Cost efficiency:** ~95% of sessions cost $0 extra (cached)
- **Reliability:** System works even if model is unavailable
- **No new hooks:** Zero integration friction with better-opencode

**Negative:**
- **No enforcement:** Plugin only reminds — can't block bad actions
- **Priority collision (known issue):** Progress check never fires at call 8/16/24/… because identity check is evaluated first at the same hook. See [[0001-priority-collision-gotcha.memory.md]].
- **No phase-relevant injection:** Same questions throughout the session

**Neutral:**
- **Server entry point (server.ts)** is a standalone module — not a class. It wires the plugin to better-opencode hooks and requires production integration to fetch full agent config from SDK client.
