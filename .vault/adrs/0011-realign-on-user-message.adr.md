---
type: adr
id: ADR-0011
title: "Realign, not Reset, on User Message (per-user-message compliance pressure)"
status: accepted
createdAt: "2026-09-11T11:16:11Z"
updatedAt: "2026-09-11T11:16:11Z"
tags: [traversal, realign, user-message, decision-tree, compliance, d3]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0010-traversal-nudge.adr.md"
  - "specifications/0001-plugin-configuration.spec.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0011: Realign, not Reset, on User Message

## Context

The traversal engine anchors the agent on a decision-tree node and nudges it to
follow the node and traverse to the next one (ADR-0010). Since AD-8, a new user
message (`chat.message` → `resetTraversal` → `engine.reset`, server.ts:106) has
been treated as a **new task boundary**: the anchor, path, and all counters are
wiped. ADR-0010 records the same rule ("A new user message (`chat.message`)
resets the state — a new task boundary").

This wipe is the documented reason **nudges die after every user message**: the
agent re-anchors only when it happens to call a traversal tool again, so the
compliance pressure resets every turn. In the coach's target use — a single
ongoing decision-tree task per session — the "stale anchor" risk that motivated
the strict boundary (anchored work carrying across unrelated tasks) is low, while
the cost of losing per-message pressure is high: the user explicitly wants each
new user message to force the agent to re-evaluate its current node and re-affirm
compliance.

Architecture decision **D3** in the session decisions (ses_f707d83abffeamdW4sffrmRWyM)
therefore changes AD-8's semantics: `onUserMessage: "realign"` (default) replaces
the wipe with a **realign** that keeps the anchor and re-opens a compliance
window; `onUserMessage: "reset"` preserves the old AD-8 strict task-boundary
behavior as a per-repo escape hatch.

## Decision

Add a `realignPending` flag to the traversal session state and a `realign()`
engine method for the default `onUserMessage: "realign"` path. `reset()`
**keeps** its current wipe semantics and remains the escape hatch for
`onUserMessage: "reset"`.

**Realign** (`realign(sessionID)`):
- Keeps `anchorNode`, `anchorKind`, `path` (the anchored work carries across the
  user message).
- Sets `realignPending = true`.
- Zeroes `nonTraversalCalls`, `repeats`, `cycleCount` (cadence restarts clean).

**Observation rules:**
- `observeTraversal`: ANY traversal call — first-anchor, advancement, or
  same-node re-anchor — sets `realignPending = false`. The agent has re-affirmed
  / aligned.
- `observeNonTraversal`: when `realignPending` is true, the **first**
  non-traversal call emits a **realign nudge immediately** (before the
  `nudgeAfter` cadence) via `formatRealignNudge(realignWording, anchorNode)`
  ("A new user message arrived. Re-evaluate whether node {node} still matches
  user intent; ..."). The flag is consumed by that nudge — subsequent calls
  follow the normal cadence and ladder.
- `buildProgressNudge`: branches on `realignPending` → realign wording;
  otherwise the normal ladder path applies.

**New surface:** `hasAnchor(sessionID): boolean` →
`pending === true && anchorNode !== undefined` — pure engine state, used by the
bootstrap wiring (Task 6) to decide whether a session needs the enter-the-tree
bootstrap nudge. Realign keeps `hasAnchor()` true; reset makes it false.

**Config:** `TraversalConfig.onUserMessage: "reset" | "realign"`, default
`"realign"` (D8). The plugin's `resetTraversal` dispatches to `realign` /
`reset` based on this key (wired in Task 6); no `server.ts` change is required
for the engine part.

**ADR-0008 file is unrelated.** The vault file
`0008-restore-system-transform-init.adr.md` is about restoring the
`system.transform` hook for persona extraction — it does **not** describe the
reset-on-user-message semantics, so it is untouched. The AD-8 semantics change
(reset→realign) is recorded by THIS ADR and by an append-only change note under
D3 in the session DECISIONS file.

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| **A — Realign (chosen)** | Nudges survive user messages; per-message compliance pressure; keeps anchored-work context; enables the hard gate (§6) | Slight stale-anchor risk across genuinely unrelated tasks | Chosen — matches D3 and the user's requirement |
| **B — Keep reset (AD-8 as-is)** | Strict task isolation, zero stale-anchor risk | Nudges die every message; no per-message pressure; contradicts the requirement | Rejected: the documented failure this project fixes |
| **C — Realign unconditionally (no escape hatch)** | Simplest config | Repo cannot opt back into strict task boundaries | Rejected: keep `onUserMessage: "reset"` as a per-repo escape hatch |

## Consequences

- ✅ Nudges keep firing across user messages for anchored sessions — the agent
  must re-affirm current node + target/veto/conditions status.
- ✅ First non-traversal call after a user message gets an immediate, dedicated
  realign nudge — pressure is applied even before the normal `nudgeAfter`
  cadence.
- ✅ `reset` remains available per-repo (`onUserMessage: "reset"`) with the old
  AD-8 semantics — independently reversible via config (D8, D9).
- ✅ `hasAnchor()` gives the Task 6 bootstrap wiring a pure-state signal.
- ✅ Realign's pending window is the exact condition set the hard gate keys on
  (D6) — realign makes enforcement possible.
- ⚠️ Default behavior changes for existing traversal users (`reset` → `realign`)
  — mitigated by D8 defaults: `traversal.enabled` stays `false` by default, so
  only opted-in repos observe the change.
- ⚠️ A realign window with no traversal re-affirmation relies on nudge pressure
  alone until `realignPending` is consumed by a non-traversal nudge or an
  alignment traversal call.