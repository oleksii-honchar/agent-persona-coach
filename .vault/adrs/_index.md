---
title: "ADRs"
createdAt: "2026-06-09T00:00:00+02:00"
updatedAt: "2026-09-28T16:45:00Z"
---

# ADRs

Architecture decisions for the agent-persona-coach plugin.

- [[0001-plugin-design-decisions.adr.md]] — Plugin design: agent's own model, content-hash caching, 4 categories, zero new hooks
- [[0002-rule-compliance-cadence.adr.md]] — Rule Compliance cadence: every N critical tool calls with dedicated counter
- [[0003-per-user-message-identity-nudge.adr.md]] — Per-user-message identity nudge: boolean toggle, flag bridge pattern, public API
- [[0004-remove-system-prompt-injection.adr.md]] — Remove system.transform hook; deliver all nudges via output.inject only
- [[0005-move-lazy-init-to-chat-message.adr.md]] — Move initializeSession from system.transform to chat.message hook
- [[0006-config-driven-prompts.adr.md]] — Config-Driven Prompts: single composite prompt moved to DEFAULT_CONFIG
- [[0007-deep-merge-config-overrides.adr.md]] — Deep Merge for Nested Config Overrides: custom deepMerge utility
- [[0008-restore-system-transform-init.adr.md]] — Restore system.transform for persona extraction only (supersedes ADR-0005)
- [[0009-move-rules-nudge-to-ontoolafter.adr.md]] — Move rules nudge from onToolBefore to onToolAfter (resolves memory-0005)
- [[0010-traversal-nudge.adr.md]] — Traversal-Nudge Mode: deterministic, zero-LLM state machine (anchoring, backtracking, pause nodes)
- [[0013-hard-gate.adr.md]] — Hard Gate: deterministic tool blocking during the realignment window (opt-in) — **superseded by ADR-0014**
- [[0014-hard-gate-v4-mid-turn-interruption.adr.md]] — Hard-Gate v4: Mid-Turn Non-Compliance Interruption via Synthetic User Message
- [[0015-dynamic-hard-gate-wording.adr.md]] — Dynamic Hard-Gate Wording for Persona Traversal (state-aware messaging)
