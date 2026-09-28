---
type: adr
id: ADR-0014
title: "Hard-Gate v4: Mid-Turn Non-Compliance Interruption via Synthetic User Message"
status: accepted
createdAt: "2026-09-28T10:00:00Z"
updatedAt: "2026-09-28T10:00:00Z"
tags: [traversal, hard-gate, enforcement, realign, mid-turn, injection, compliance, v4]
supersedes: ["adrs/0013-hard-gate.adr.md"]
superseded_by: []
see_also:
  - "adrs/0009-move-rules-nudge-to-ontoolafter.adr.md"
  - "adrs/0010-traversal-nudge.adr.md"
  - "adrs/0011-realign-on-user-message.adr.md"
  - "adrs/0013-hard-gate.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0014: Hard-Gate v4 — Mid-Turn Non-Compliance Interruption

## Context

ADR-0013 introduced a hard-gate mechanism that threw an error in the `tool.execute.before` hook when an anchored agent made a non-traversal tool call during the realignment window. The design rationale was sound — deterministic, zero-LLM blocking — but live behavior revealed a critical flaw.

The throw produces a **tool error part** in the conversation stream. To the LLM, a tool error is a recoverable result — it sees "this tool call failed" and continues reasoning, often retrying the same tool or proceeding with its plan. No wording change could fix this because the agent was correctly interpreting the error part: it's non-authoritative instruction, just a failed call.

**Root cause:** Delivery mechanism, not wording. The agent receives the message but treats it as a failed tool result, not an authoritative instruction to realign.

## Discovery: The Fork's Turn-Interruption Primitive

Investigation of better-opencode's runtime revealed a fork-specific feature: the `session.stopping` plugin hook. When the LLM loop is about to exit idle, this hook fires with an opportunity to inject a message as a fresh user turn via `{stop: false, message: "..."}`. The runtime's `flushInjectedMessages` creates a real user-role message mid-turn, which the agent must respond to before proceeding.

This is the industry-standard pattern for SOP enforcement — analogous to Claude Code's Stop hooks where "if a Stop hook exits with code 2, its stderr is injected as a prompt and the agent resumes."

## Decision

Replace the throw-based hard-gate with a **mid-turn non-compliance interruption** delivered as a fresh synthetic user message:

| Design Element | Implementation |
|----------------|----------------|
| **Trigger** | Agent receives a realign nudge, then makes another non-traversal tool call (ignores the nudge) |
| **Delivery** | `tool.execute.after` `output.inject` — same path as nudges, creates synthetic user message |
| **State** | New `nudgeSent` boolean in `TraversalSessionState` — set when nudge fires, cleared when agent realigns |
| **Wording** | Reuse existing `hardGate.wording` config and `formatHardGateMessage` |
| **Frequency** | One gate per realign window (prevents gate spam) |

The engine's `blockIfNeeded` method now checks `nudgeSent` — if true and the agent makes another non-traversal call, it returns the hard-gate wording. The existing server hook passes this to `output.inject`, which delivers it as a fresh user turn.

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| **A — Throw in before-hook (ADR-0013, previous)** | True enforcement, narrow condition set | Tool-error part is non-authoritative — agent ignores it | Rejected: proven ineffective in live behavior |
| **B — session.stopping hook (v3)** | Fork's proven turn-interruption primitive | Fires at turn exit — too late for mid-task interruption | Rejected: user explicitly wants mid-turn, not turn-exit |
| **C — system.transform injection** | Fires on every LLM call — highest visibility | System-prompt churn, not a real turn interruption | Rejected: belt-and-suspenders only, not primary |
| **D — output.inject synthetic user message (chosen)** | Real user turn, immediate, same path as nudges | Requires state tracking (nudgeSent) | **Chosen**: proven delivery channel, immediate, authoritative |

## Consequences

- ✅ **Agent compliance:** The hard-gate message appears as a fresh user turn — the highest-authority chat event. The agent must respond to it, stopping its current tool sequence.
- ✅ **Position-aware:** Reuses the v2 position-preserving wording with `{node}` templating — agent knows which decision node to follow.
- ✅ **Fail-open design:** Gate only fires when `nudgeSent` is true AND agent makes another non-traversal call. Un-anchored sessions, outside realignment window, or after agent realigns — all pass.
- ✅ **No server changes:** Reuses the existing `tool.execute.after` `output.inject` path. The distinction between nudge and gate is purely in the engine's decision logic.
- ✅ **Bounded:** One gate per realign window prevents spam. Window resets when user sends a new message.
- ⚠️ **State tracking added:** The `nudgeSent` flag is a new state field. Simple boolean, per-session, cleared on realign or window reset.
- ⚠️ **Still opt-in:** `hardGate.enabled` defaults `false` — no behavior change unless repo explicitly enables it.

## Rollout

Implementation complete and verified (428 tests pass). Gate remains off (`hardGate.enabled: false`) until human-owned rollout: restart server, manual mid-task smoke test, then flip to `true`.