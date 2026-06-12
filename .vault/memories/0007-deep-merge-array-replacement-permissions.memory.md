---
type: memory
title: "Deep Merge Replaces criticalPermissions Array (Not Merged)"
createdAt: "2026-06-12T12:12:00Z"
updatedAt: "2026-06-12T12:12:00Z"
tags: [gotcha, configuration, deep-merge, permissions, behavioral-change]
see_also:
  - "adrs/0007-deep-merge-config-overrides.adr.md"
  - "memories/0006-critical-permissions-discrepancy.memory.md"
  - "specifications/0001-plugin-configuration.spec.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: Deep Merge Replaces criticalPermissions Array (Not Merged)

## Fact

With the `deepMerge` utility ([[adrs/0007-deep-merge-config-overrides.adr.md]]) replacing the old shallow merge, arrays in user config are **replaced** entirely — not merged.

When a user sets `criticalPermissions: ["bash"]`, only `"bash"` becomes critical. The default values (`"edit"`, `"task"`) are lost. This is intentional (see ADR-0007) but surprising if users expect additive behavior.

## Context

**Before (shallow merge):** Setting `{ categories: { rules: { criticalPermissions: ["bash"] } } }` would lose the entire `categories.rules` object (the old shallow merge bug). This made any partial config override destructive — so users never bothered with partial overrides.

**After (deep merge):** Setting `{ categories: { rules: { criticalPermissions: ["bash"] } } }` correctly preserves other `rules` fields (`enabled`, `cadence`, `criticalTools`) — but `criticalPermissions` is replaced with just `["bash"]`.

## Impact

- Users who want to ADD one permission to the default list must copy the entire default list and append their addition
- Example: to add `"create"` while keeping defaults: `criticalPermissions: ["bash", "edit", "task", "create"]`
- This matches standard config merge behavior (Kubernetes Helm, Lodash, json-merger) — "what you set is what you get"
- The `criticalPermissions` default discrepancy ([[0006-critical-permissions-discrepancy.memory.md]]) is now resolved — both README and code agree on `["bash", "edit", "task"]`
