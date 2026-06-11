---
title: "Memories"
createdAt: "2026-06-09T00:00:00+02:00"
updatedAt: "2026-06-11T17:55:00+02:00"
---

# Memories

Gotchas and lessons learned from working with agent-persona-coach.

- [[0001-priority-collision-gotcha.memory.md]] — Progress check never fires at call 8/16/24 due to identity check priority collision
- [[0002-config-defaults-discrepancy.memory.md]] — README defaults discrepancy (RESOLVED: all docs now aligned with `DEFAULT_CONFIG`)
- [[0003-chatclient-silent-failure.memory.md]] — ChatClient silent failure: plugin skips all agents when ChatClient is not injected and persona cannot be resolved from config
- [[0004-cache-invalidation-rate.memory.md]] — 3-5 cache invalidations per user message cycle before removing system.transform
- [[0005-rule-compliance-not-delivered.memory.md]] — Rule compliance nudge created but not injected after system.transform removal
