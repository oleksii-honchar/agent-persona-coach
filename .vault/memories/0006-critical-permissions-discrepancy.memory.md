---
type: memory
title: "CriticalPermissions Defaults Discrepancy: README vs Code (RESOLVED)"
createdAt: "2026-06-12T12:12:00Z"
updatedAt: "2026-06-12T14:20:00Z"
tags: [gotcha, configuration, discrepancy, documentation, resolved]
see_also:
  - "specifications/0001-plugin-configuration.spec.md"
  - "memories/0002-config-defaults-discrepancy.memory.md"
  - "adrs/0007-deep-merge-config-overrides.adr.md"
  - "adrs/0009-move-rules-nudge-to-ontoolafter.adr.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: CriticalPermissions Defaults Discrepancy — README vs Code (RESOLVED)

## Fact

The `DEFAULT_CONFIG.categories.rules.criticalPermissions` in `src/types.ts` lists `["bash", "edit", "task"]`, but the README.md used to document `["write", "bash", "task", "create"]`. This discrepancy pre-existed the config-driven prompts feature and was **RESOLVED on 2026-06-12** by aligning the README to code values in the same session that introduced config-driven prompts and deep merge.

| Source | Original (Pre-fix) | After Fix |
|--------|-------------------|-----------|
| `DEFAULT_CONFIG` (types.ts) | `["bash", "edit", "task"]` | `["bash", "edit", "task"]` (unchanged) |
| README.md (config example) | `["write", "bash", "task", "create"]` | `["bash", "edit", "task"]` |
| README.md (options table) | `["write", "bash", "task", "create"]` | `["bash", "edit", "task"]` |

## Context

Note: This is a **separate discrepancy** from the one documented in [[0002-config-defaults-discrepancy.memory.md]], which covers cadence values only (identity=10, rules=10, references=30, progress=20) — those were resolved earlier. The `criticalPermissions` values were not part of that fix.

With the introduction of `deepMerge` ([[adrs/0007-deep-merge-config-overrides.adr.md]]), arrays are now **replaced** (not merged) in user config overrides. This means:
- If a user copies old README values into their config, they get `["write", "bash", "task", "create"]` — but the actual defaults are `["bash", "edit", "task"]`.
- If a user sets `criticalPermissions: ["write"]` expecting to add to the defaults, they actually REPLACE the defaults (due to deep merge array-replacement semantics).

## Historical Impact (pre-resolution)

Before the fix, users copying configuration from the README would have different `criticalPermissions` than the actual code defaults, leading to:
- "write" and "create" would unexpectedly be treated as critical permissions
- `"edit"` would NOT be treated as critical (but should have been per code defaults)
- Possible confusion when the plugin flagged `"write"` calls but not `"edit"` calls

## Regression: Commit 661349d Emptied criticalPermissions (2026-06-11)

Commit `661349d` ("fix: default config", Jun 11 20:36) **removed** the criticalPermissions
values from DEFAULT_CONFIG:

```diff
- criticalPermissions: ["write", "bash", "task", "create"]
+ criticalPermissions: []
```

This broke rules nudges for all sessions running code built after this commit.
The deployment on 2026-06-11 had `criticalToolCallCount` stuck at 0 because
`isToolCritical()` always returned false — no tool was classified as critical.
This led to zero rules nudges despite 20+ tool calls in a typical session.

**Fix:** DEFAULT_CONFIG criticalPermissions restored to `["bash", "edit", "task"]`
(aligned with the README fix from the same session). Tests updated across 4 test files
(types.test.ts, state.test.ts, index.test.ts, server.test.ts). The runtime config in
`opencode.jsonc` also needed the same fix. Plugin must be rebuilt (`npm run build`)
after updating `src/types.ts`.
