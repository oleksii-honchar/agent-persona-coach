---
type: concept
title: "Prompt Caching Sensitivity"
createdAt: "2026-06-11T17:55:00+02:00"
updatedAt: "2026-06-11T17:55:00+02:00"
tags: [cache, anthropic, performance, plugin, system-prompt]
see_also:
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "concepts/0003-system-reminder-injection.concept.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Concept: Prompt Caching Sensitivity

## What

LLM providers (Anthropic, OpenAI) cache prefixes of the conversation to avoid reprocessing unchanged content. Plugin hooks that modify the system prompt or inject messages into the conversation can invalidate these caches, forcing the provider to reprocess from scratch — a significant performance cost.

## Why

Understanding which plugin hooks affect which caches is critical for designing performant plugins. The agent-persona-coach's `experimental.chat.system.transform` hook was the primary cause of repeated cache invalidation, costing seconds per user message cycle.

## Key Details

**Anthropic prompt caching:**
- The system prompt is at the beginning of the conversation — part of the cache key
- ANY change to the system prompt (even appending a nudge) invalidates the system cache
- Anthropic caches prefixes up to `cache_control` breakpoints
- Inserting content AFTER a breakpoint preserves the cached prefix — only new content is processed
- From Anthropic docs: *"Think of each cache_control breakpoint as creating a stable checkpoint over the entire conversation prefix up to that message. As long as you don't change anything in that prefix, you are free to insert, remove, or change messages after it; the earlier checkpoint remains valid and will be reused."*

**Impact by modification type:**

| Modification | Cache Effect | Severity |
|--------------|-------------|----------|
| System prompt change | **Cache invalidated** — system prompt at beginning; reprocess from scratch | **High** |
| Message injection after breakpoint | **No prefix invalidation** — cached prefix reused; only new content processed | **Low** |
| Session compaction | **Cache invalidated** — fundamentally changes conversation content | **Medium** (expected, infrequent) |
| `experimental.chat.messages.transform` hook | **Cache invalidated** — modifies message array | **High** (no plugin uses this yet) |

**Observed invalidation rate (before fix):** 3-5 cache invalidations per user message cycle (with ~5 tool calls per user message and default cadences).

**Verified:** The `experimental.chat.system.transform` hook fires on every LLM request (confirmed in `packages/opencode/src/session/llm/request.ts:69` and `packages/opencode/src/agent/agent.ts:409`).

**General rule for plugin authors:** Avoid modifying the system prompt via `experimental.chat.system.transform` if the provider supports prompt caching. Use `output.inject` via `tool.execute.after` instead — it appends content after the cache breakpoint, preserving the cached prefix.
