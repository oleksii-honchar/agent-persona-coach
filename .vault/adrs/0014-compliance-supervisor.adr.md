---
type: adr
id: ADR-0014
title: "Compliance Supervisor (opt-in, best-effort, sampled LLM classification)"
status: accepted
createdAt: "2026-09-11T11:50:00Z"
updatedAt: "2026-09-11T11:50:00Z"
tags: [traversal, supervisor, compliance, llm, opt-in, sampling, d7]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0010-traversal-nudge.adr.md"
  - "adrs/0013-hard-gate.adr.md"
  - "adrs/0011-realign-on-user-message.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0014: Compliance Supervisor

## Context

The user's requirement — "the coach's own small model sees it [a skipped
node] and starts punishing the agent to comply" — needs an LLM judgment of
whether the agent actually **reported** its current node and the target /
veto / conditions status for traversal. The deterministic nudge engine
(ADR-0010) applies pressure but cannot judge the *content* of the agent's
reply; only a model can decide "compliant / skip / evasive".

Constraints (D7):

- The deterministic engine is the guarantee: ADR-0010's traversal-nudge path
  must stay **zero-LLM** and deterministic. The supervisor is a separate,
  opt-in layer that must never block or alter the deterministic path.
- The LLM call is not free: it must be rate-limited
  (`maxCallsPerSession`) and sampled (`sampleEvery` user messages) so it
  stays off the hot path.
- Punishment must never be false-positive against an agent that *is*
  complying, and must never block a non-complying agent's tool path:
  classification failures fail open ("compliant") and are logged.
- Injected messages must survive compaction — the coach's synthetic-message
  injection (`tool.execute.after` → `output.inject`, spec
  `02-tool-execute-after-inject.md`) already provides this, so escalated
  ladder wording is injected as a durable synthetic message.

## Decision

Add an opt-in `ComplianceSupervisor` (`config.categories.traversal.supervisor`,
default `enabled: false`, D8):

- **`judge(sessionID, recentTurns)`** — a minimal prompt referencing the
  compliance expectation (report current node + target/veto/conditions
  status) with the recent turns; calls `plugin.createCompletion` with the
  configured small model (`supervisor.model`), JSON output parsed with the
  generator-style helper (`extractJsonFromMarkdown`, `generator.ts`).
  Returns `"compliant" | "skip" | "evasive"`.
  - Unrecognized / unparseable classifications map defensively to
    **"compliant"** (fail-open — never punish on an unverifiable signal;
    never throw).
  - Model-call errors log and resolve to **"compliant"** (best-effort,
    D7 — never block the tool path).
  - The supervisor owns its **`maxCallsPerSession`** counter (guards its own
    call budget regardless of the caller): once hit, `judge` returns
    `"compliant"` without invoking `createCompletion`. The counter counts
    call attempts so the LLM budget is bounded even under repeated failures.
- **`escalate(skipChain)`** — picks the ladder tier from
  `supervisor.ladderWording` (advisory → explicit → brutal): 0-1 skips →
  tier0, 2-3 → tier1, 4+ → tier2; unknown / longer lengths clamp to the
  LAST tier; ladders shorter than three entries clamp to their last entry.
- **Wiring (Task 8, out of scope here):** `chat.message` queues a
  classification when `supervisor.enabled` and the `sampleEvery` cadence
  says so; `tool.execute.after` runs the pending supervision and injects the
  escalated wording as a durable synthetic message. The wiring must keep the
  supervisor off the deterministic reading of ADR-0010: errors and cap
  exhaustion degrade to "no injection", never to a blocked tool.

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| **A — Opt-in LLM supervisor (chosen)** | Fulfils the "small model sees skips" requirement; rate-limited + sampled so cost stays bounded; fail-open so no false punishment | LLM calls add latency/cost and can misjudge | Chosen — matches D7 and the user's stated mechanism |
| **B — Deterministic-only judging (regex on node names)** | Zero LLM cost, fully deterministic | Cannot detect evasion content; abysmal at "did the agent report status" semantics | Rejected: the requirement is explicitly an LLM judgment |
| **C — Supervisor always-on, un-sampled** | Maximum pressure | Doubles LLM cost/heat-path; contradicts ADR-0010 zero-LLM determinism on the hot path | Rejected: default `enabled: false` + `sampleEvery` sampling keeps determinism parity (D8) |

## Consequences

- ✅ The user's "model judges and punishes" mechanism exists as an opt-in
  path, off the deterministic hot path (ADR-0010 preserved).
- ✅ Fail-open classification and failure handling guarantee the supervisor
  **never blocks** a tool call and never injects punishment on an
  unverifiable model answer.
- ✅ Escalation is durable: ladder wording is injected via the existing
  synthetic-message mechanism and survives compaction.
- ✅ Sampling (`sampleEvery` N user messages) + a per-session budget
  (`maxCallsPerSession`) bound LLM cost.
- ⚠️ LLM judgments can mis-classify (nuance, poisoned replies) — mitigated by
  failing open to "compliant" and by the deterministic nudge engine carrying
  the actual pressure.
- ⚠️ Rate limiting is split: the supervisor module enforces
  `maxCallsPerSession` itself (the caller cannot accidentally exceed the
  budget), while `sampleEvery` remains the caller's (Task 8) scheduling
  choice.