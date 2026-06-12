---
type: adr
id: ADR-0006
title: "Config-Driven Prompts (Single Composite Prompt)"
status: accepted
createdAt: "2026-06-12T12:10:00Z"
updatedAt: "2026-06-12T12:10:00Z"
tags: [configuration, prompts, plugin]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0007-deep-merge-config-overrides.adr.md"
  - "specifications/0001-plugin-configuration.spec.md"
  - "adrs/0001-plugin-design-decisions.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0006: Config-Driven Prompts (Single Composite Prompt)

## Context

The `COACH_PROMPT` template in `src/prompt.ts` was hard-coded as an `export const` — immutable source code rather than configurable data. Users had no way to customize the reflection questions prompt without editing the plugin source. The user requested that prompts become configurable via external config, with partial overrides merging on top of defaults.

The generator makes a single LLM call that generates questions for all 4 categories (identity, rules, references, progress) simultaneously. Per-category prompts would require 4 separate LLM calls or a fundamentally different generator design.

## Decision

**Move `COACH_PROMPT` from `src/prompt.ts` into `DEFAULT_CONFIG.coachPrompt` in `src/types.ts` as a single composite prompt string.** Users can override the entire prompt template via external config. Empty/null `coachPrompt` gracefully falls back to the default.

Key design choices:
1. **Single composite prompt** — Not per-category. Preserves the current 1-call architecture, latency, and token costs.
2. **`{personaText}` placeholder** — Must be present in custom prompts or persona won't be injected (documented in README).
3. **Empty/null guard** — Falsy `coachPrompt` values fall back to `DEFAULT_CONFIG.coachPrompt` in `initializeSession()`.
4. **`buildCoachPrompt(personaText, promptTemplate)`** — Updated signature accepts the template as a parameter instead of using a hard-coded constant.
5. **Cache key unchanged** — Still `agentName:SHA256(personaText)`. Prompt changes are deployment-time events (in-memory cache restarts).

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|---|---|---|---|
| Per-category prompts (`identityPrompt`, etc.) | Maximum flexibility per category | 4x LLM calls, 4x latency/cost, complex template assembly | Overkill for MVP; single prompt satisfies current use case |
| Template section markers with per-category override slots | Partial overrides within single prompt | Harder to read default prompt, section boundary logic complexity | Deferred — no user demand yet; can be added later without breaking changes |

## Consequences

- **Positive:** Minimal code change (one field in `PluginConfig`, one string moved to `DEFAULT_CONFIG`)
- **Positive:** Current test structure largely preserved
- **Positive:** Users can fully customize the reflection prompt
- **Negative:** Users who want to customize one section must copy the full prompt and edit one section
- **Negative:** `{personaText}` placeholder must be present in custom prompts (documented in README)
