---
type: concept
title: "Persona Drift"
createdAt: "2026-06-09T00:00:00+02:00"
updatedAt: "2026-06-09T00:00:00+02:00"
tags: [persona, drift, coaching, metacognition]
see_also:
  - "adrs/0001-plugin-design-decisions.adr.md"
  - "memories/0001-priority-collision-gotcha.memory.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Concept: Persona Drift

## What

Persona drift is the tendency of LLM agents to deviate from their defined role and constraints during long execution sessions. An architect starts implementing code. A developer starts designing architecture. An agent forgets to read its reference files.

Persona drift is caused by three interacting factors:

1. **Proactive interference (Wang & Sun, 2025):** When semantically similar instructions compete in the agent's context, retrieval accuracy declines log-linearly toward zero. For sub-30B models, even 125 semantically similar instructions causes near-total retrieval failure. Model size — not context length — predicts interference resistance.

2. **Ambiguity in natural language definitions (Hu et al., 2025):** Agent persona definitions are written in natural language with inherent ambiguities (missing concepts in latent space). Even 70B models default to single interpretations without concept injection. No deterministic parser can reliably extract rules.

3. **Working memory decay over long context:** As conversation history grows, the agent's attention naturally shifts toward recent context. The persona definition, loaded at the start of the session, gradually loses influence.

## Why

Persona drift is the fundamental problem that persona coaching plugins solve. Without mitigation, agents become unreliable in long sessions — they make mistakes that violate their own rules, skip prerequisite checks, and produce outputs outside their scope.

The severity of persona drift scales with:
- **Session length** — more tool calls = more drift risk
- **Persona complexity** — more rules = more proactive interference
- **Model size** — smaller models have weaker metacognitive control (40-60% of 70B+ effects per Ji-An et al., 2025)

## Key Details

- **Dual-process theory maps to LLMs (Ziabari et al., 2025):** System 1 (fast, intuitive) is the agent's default mode. System 2 (deliberate, reflective) can be triggered by injected reflection prompts. The transition is continuous (r² > 0.9), not discrete.
- **Structured reflection improves performance by 18-25% (Renze & Guven, 2024):** But only structured reflection — unstructured reflection is ignored by LLMs.
- **Metacognition is bounded in sub-30B models (Ji-An et al., 2025):** LLMs can report and control only a subset of internal activations.
- **Human coaching models provide effective nudge patterns:** Pomodoro Technique (timed check-ins), OODA Loop (Orient step prevents acting on stale assumptions), Boxing Coach (repeated short reminders of key rules).
