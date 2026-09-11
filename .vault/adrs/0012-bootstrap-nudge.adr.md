---
type: adr
id: ADR-0012
title: "Bootstrap Nudge: single-shot queue for fresh, un-anchored sessions"
status: accepted
createdAt: "2026-09-11T11:40:00Z"
updatedAt: "2026-09-11T11:40:00Z"
tags: [traversal, bootstrap, queue, chat-message, inject, compliance, d2]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0003-per-user-message-identity-nudge.adr.md"
  - "adrs/0010-traversal-nudge.adr.md"
  - "adrs/0011-realign-on-user-message.adr.md"
  - "adrs/0013-hard-gate.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0012: Bootstrap Nudge — single-shot queue for fresh, un-anchored sessions

## Context

The deterministic traversal engine (ADR-0010) only produces nudges for an
**anchored** session: `observeNonTraversal` returns `[]` while `state.pending`
is false, and the first traversal call is the anchor itself, which returns no
nudge either (traversal.ts). A fresh session that has not yet entered its
persona decision tree therefore receives **zero** traversal reminders — the
agent can run the whole first turn without ever calling
`getPersonaEntryNode`/`expandFileRelations`. That is the exact gap the user
wants closed: the coach must remind the agent to enter the tree before its
first tool call, so that traversal pressure starts at turn one, not after the
first anchor.

The nudge must be **single-shot**: unlike the cadence nudges (recurring) it is
a one-time bootstrap reminder. It must also compose with the existing
`tool.execute.after` inject pipeline — the same hook that carries identity /
reference / progress / traversal nudges in `output.inject`.

## Decision

Reuse the proven **identity-nudge queue pattern** (ADR-0003,
`pendingUserMessageIdentity` in server.ts): a per-session set flags "needs
bootstrap", and the first `tool.execute.after` consumes it.

**Server wiring (`src/server.ts`, Task 6):**

- New per-session queue `pendingTraversal = new Set<string>()`.
- `chat.message` (server.ts:88): when `config.categories.traversal.enabled`
  **and** `traversalEngine.hasAnchor(sessionID) === false` →
  `pendingTraversal.add(sessionID)`. Anchored sessions never re-queue.
- `tool.execute.after` (server.ts:114): **before** any category handling, if
  `pendingTraversal.has(sessionID)` → prepend
  `output.inject = [{ role: "system", text: formatBootstrapNudge(bootstrapWording) }, ...output.inject]`
  and delete the flag. The bootstrap is a **system-role** inject, prepended
  before existing (user-role) category nudges.

**Plugin surface (`src/index.ts`, Task 6):** `hasTraversalAnchor(sessionID)`
exposes the engine's pure anchor check to the server so the queue decision
reads engine state directly.

**Wording:** `categories.traversal.bootstrapWording` (default carries the
compliance-status clause — report current node + status of target, veto, and
conditions — per spec §5.1/D5).

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| **A — chat.message queue + first tool.execute.after inject (chosen)** | Mirrors the proven ADR-0003 identity pattern; zero new seams; composes with the existing inject pipeline; deterministic, zero-LLM (ADR-0010) | Requires server wiring (a new per-session set) | Chosen — the plan's D2 explicitly points at this path |
| **B — Inject bootstrap in `experimental.chat.system.transform`** | Reaches the model before any tool runs | That hook has no inject path (it mutates `output.system`); session-identity gating makes it fire on LLM calls, not tool calls; mixes init with nudging | Rejected — different concern; system.transform is initialization-only |
| **C — Nudge in `tool.execute.before`** | Fires before the first tool | Before-hook output is logged then discarded (ADR-0009 lesson) — the nudge would never reach the model; also pre-dates the hard-gate exception (ADR-0013) | Rejected — nudges belong on `tool.execute.after` |
| **D — Let the engine emit the bootstrap from `observeTool`** | Keeps logic in the engine | The engine only sees *tool calls after the fact*; an un-anchored session's `observeTool` has no "first call" concept and would need its own flag anyway; coupling nudge *scheduling* to the observation path duplicates the queue | Rejected — the queue belongs at the wiring layer |
| **E — System-prompt injection at init** | Highest visibility | Removed by ADR-0004 (system prompt stays clean); not repeatable per session | Rejected — settled decision |

## Consequences

- ✅ Fresh, un-anchored sessions get exactly **one** bootstrap nudge before
  their first `tool.execute.after` payload — traversal pressure starts at turn
  one (spec §3).
- ✅ Single-shot by construction: the flag is deleted on first consumption;
  later calls never re-inject (verified by integration tests in
  `server.test.ts`).
- ✅ Composes with cadence nudges: identity + bootstrap both fire on the first
  call, bootstrap first (`role: "system"`), identity second
  (`role: "user"`) — ordering asserted in `server.test.ts`.
- ✅ Anchored sessions are never re-bootstrapped: the queue condition checks
  `hasAnchor` and ADR-0011's realign flow (anchor kept) does not re-queue.
- ✅ Zero-LLM and deterministic: no model call, pure per-session flag + fixed
  wording (ADR-0010 / AD-7 preserved).
- ⚠️ A session whose first tool call happens before any `chat.message`
  (e.g. hooks wired mid-turn) never queues — by design the queue is driven by
  user messages, which is the only place the plugin knows a turn started.
- ⚠️ The bootstrap is advisory (a nudge); enforcement for skipping the tree
  after a user message is the **hard gate** (ADR-0013), which is opt-in and
  only blocks inside the realignment window of an anchored session.