---
title: "ADRs"
createdAt: "2026-06-09T00:00:00+02:00"
updatedAt: "2026-06-11T17:55:00+02:00"
---

# ADRs

Architecture decisions for the agent-persona-coach plugin.

- [[0001-plugin-design-decisions.adr.md]] — Plugin design: agent's own model, content-hash caching, 4 categories, zero new hooks
- [[0002-rule-compliance-cadence.adr.md]] — Rule Compliance cadence: every N critical tool calls with dedicated counter
- [[0003-per-user-message-identity-nudge.adr.md]] — Per-user-message identity nudge: boolean toggle, flag bridge pattern, public API
- [[0004-remove-system-prompt-injection.adr.md]] — Remove system.transform hook; deliver all nudges via output.inject only
- [[0005-move-lazy-init-to-chat-message.adr.md]] — Move initializeSession from system.transform to chat.message hook
