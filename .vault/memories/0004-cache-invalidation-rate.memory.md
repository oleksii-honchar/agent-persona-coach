---
type: memory
title: "3-5 Cache Invalidations Per User Message Cycle (Before Fix)"
createdAt: "2026-06-11T17:55:00+02:00"
updatedAt: "2026-06-11T17:55:00+02:00"
tags: [cache, performance, gotcha, anthropic]
see_also:
  - "adrs/0004-remove-system-prompt-injection.adr.md"
  - "concepts/0004-prompt-caching-sensitivity.concept.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: 3-5 Cache Invalidations Per User Message Cycle (Before Fix)

## Fact

With the default agent-persona-coach configuration and ~5 tool calls per user message, the Anthropic cache was invalidated 3-5 times per user message cycle — meaning the provider reprocessed the entire conversation history multiple times per user message.

## Context

The `experimental.chat.system.transform` hook modified the system prompt on every LLM request when nudges were pending. Combined with identity nudges after every user message (`afterEachUserMessage: true`) and cadence-based nudges (identity: 10, rules: 10, progress: 20, references: 30), the system prompt changed repeatedly during a single user message's tool-call cycle.

## Impact

Each cache invalidation forced Anthropic to reprocess the entire system prompt + conversation from scratch, adding seconds of latency per invalidation. With 3-5 invalidations per user message, this could add 10-30 seconds of unnecessary processing per user message.

**Resolution:** ADR-0004 removed the system transform path. Message injection preserves the cache prefix, reducing invalidations to near-zero.
