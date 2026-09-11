---
type: adr
id: ADR-0013
title: "Hard Gate: deterministic tool blocking during the realignment window (opt-in)"
status: accepted
createdAt: "2026-09-11T11:20:37Z"
updatedAt: "2026-09-11T11:20:37Z"
tags: [traversal, hard-gate, enforcement, realign, before-hook, compliance, d6]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0009-move-rules-nudge-to-ontoolafter.adr.md"
  - "adrs/0010-traversal-nudge.adr.md"
  - "adrs/0011-realign-on-user-message.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0013: Hard Gate — deterministic tool blocking during the realignment window

## Context

The deterministic traversal engine (ADR-0010) can only *nudge* an anchored agent —
it has no way to *stop* a non-traversal tool call when the agent is ignoring its
decision tree. ADR-0011 introduced the **realignment window** (`realignPending`):
after a user message the anchored agent must re-affirm by calling a traversal tool
(`getPersonaEntryNode` / `expandFileRelations` / `fetchFile` / `getPersonaStatus`),
and the first non-traversal call emits an immediate realign nudge. But a nudge is
advisory: an agent that skips it can keep working without ever re-entering the tree.

The user's requirement ("if it skips — the coach starts punishing the agent to
comply") needs one true enforcement lever. The better-opencode harness already
provides the seam: `tool.execute.before` triggers for every tool and a hook throw
propagates through `Plugin.trigger` (no try/catch) to abort the tool call. No fork
change is required (D1).

**This ADR is in deliberate tension with ADR-0009.** ADR-0009 moved the rules nudge
off `onToolBefore` because that hook has no `inject` path — its output was logged
then discarded, so a before-hook nudge could never reach the model. The lesson
recorded there is "nudges belong on `tool.execute.after`". That lesson stands for
*nudges*. The hard gate is **not** a nudge: it is a blocking decision whose *only*
job is to abort the tool call right now. A throw in the before-hook is precisely
the observable behavior a before-hook is for — there is nothing to persist, nothing
to inject. This ADR re-introduces a `tool.execute.before` hook as a **narrow,
opt-in exception**: it blocks only during the realignment window of an *already
anchored* session, never for general rule compliance, never for un-anchored
(first-time/bootstrap) sessions, and never unless a repo explicitly enables
`traversal.hardGate.enabled` (default `false`, D8).

## Decision

Add a deterministic, zero-LLM blocking method to the traversal engine
(`TraversalNudgeEngine.blockIfNeeded(sessionID, toolName, toolArgs?): string | null`)
that implements the D6 decision matrix:

| State | Tool | Result |
|---|---|---|
| `!config.enabled` or `!config.hardGate.enabled` | any | allow (`null`) — feature off |
| un-anchored (`hasAnchor()` false) | any | allow (`null`) — bootstrap path covers first-time sessions |
| anchored + `realignPending === false` | any | allow (`null`) — never block outside the realignment window |
| anchored + `realignPending === true` | traversal tool (`isTraversalTool`, incl. `meta_use`-wrapped shapes) | allow (`null`) |
| anchored + `realignPending === true` | tool in the effective allow-list (`toolPatterns ∪ hardGate.allowedTools`) | allow (`null`) |
| anchored + `realignPending === true` | any other tool | block: return `formatHardGateMessage(hardGate.wording)` |

The engine **only returns** the blocking message — it never throws. The server's
`tool.execute.before` hook (Task 6) throws the returned message, which propagates
through `Plugin.trigger` and aborts the tool call.

**Effective allow-list resolution:** `hardGate.allowedTools` defaults to
`config.toolPatterns` when not provided/empty; the effective allow-list is
`toolPatterns ∪ allowedTools`, exposed by the engine via the `hardGateAllowedTools`
getter (pure helper `resolveHardGateAllowList`). Traversal tools therefore pass
during the gate by default; repos may add extra tools they consider safe mid-
realignment.

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| **A — Before-hook throw, realignment-window-only (chosen)** | True enforcement; narrow condition set; opt-in; reuses an existing verified harness seam; zero LLM | Re-introduces a before-hook (ADR-0009 tension) | Chosen — the only lever that actually stops non-compliant tools |
| **B — Advisory after-hook only (ADR-0009 status quo + harder nudges)** | No ADR-0009 tension; consistent pipeline | Can be ignored; no enforcement; user requirement unmet | Rejected — this project exists because nudging alone failed |
| **C — Gate on every non-traversal call while anchored** | Simpler condition set | Breaks legitimate work; blocks normal task tooling constantly | Rejected: gate must be narrow — realignment window only (D6) |
| **D — Gate on un-anchored sessions too** | "Total" compliance | Punishes first-time/bootstrap sessions; blocks the traversal entry itself | Rejected: bootstrap nudge (Task 6) handles pre-anchor phases |

## Consequences

- ✅ True enforcement lever: during a pending realignment a non-traversal,
  non-allowed tool call is aborted with the hard-gate message — the agent cannot
  work around the decision tree.
- ✅ Narrow by design: un-anchored sessions and `realignPending === false` are
  never blocked; the bootstrap path covers first-time sessions (D6, spec §6).
- ✅ Opt-in only: `hardGate.enabled` defaults `false` (D8); a repo flips it in
  `opencode.jsonc` and can flip it back — independently reversible (D9).
- ✅ Deterministic and zero-LLM: `blockIfNeeded` is a pure state check — ADR-0010
  and the determinism guarantee are preserved.
- ✅ The engine stays throw-free: the throw lives in the server hook, so the
  engine remains a pure decision component, unit-testable without the harness
  (spec §11 — behavior assertions on the returned string, never logger calls).
- ⚠️ Re-introduces `tool.execute.before` — a deliberate, documented exception to
  ADR-0009. Scope guard: this hook exists for the hard gate ONLY; any future
  before-hook *nudge* must stay on `tool.execute.after` per ADR-0009.
- ⚠️ Blocked tool calls throw `Error(message)` — visible as a failed tool
  invocation in the client; the message wording (config `hardGate.wording`)
  explains the realignment requirement so the agent (and user) know why.