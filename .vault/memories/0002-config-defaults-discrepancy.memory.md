---
type: memory
title: "Config Defaults Discrepancy: README vs Code (RESOLVED)"
createdAt: "2026-06-10T10:00:00Z"
updatedAt: "2026-06-10T10:00:00Z"
tags: [gotcha, configuration, discrepancy, documentation, resolved]
see_also:
  - "specifications/0001-plugin-configuration.spec.md"
  - "memories/0001-priority-collision-gotcha.memory.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: Config Defaults Discrepancy — README vs Code (RESOLVED)

## Fact

The `DEFAULT_CONFIG` in `src/types.ts` had different default cadence values than the README.md documentation:

| Category | `DEFAULT_CONFIG` (types.ts:34-37) | README.md (old) | Status |
|----------|-----------------------------------|-----------------|--------|
| Identity | 10 | 4 | ✅ Resolved |
| Rules | 10 | 2 | ✅ Resolved |
| References | 30 | 2 | ✅ Resolved |
| Progress | 20 | 8 | ✅ Resolved |

## Context

The README was written with the intended defaults in mind (more frequent nudges for better coaching), but the code was implemented with more conservative defaults (less frequent to reduce token overhead). The README also incorrectly documented `afterCalls` for references while the code uses `cadence` for all categories.

## Resolution

**2026-06-10:** README.md and all vault documentation were updated to use the actual code defaults from `DEFAULT_CONFIG`:
- `identity.cadence = 10`
- `rules.cadence = 10`
- `references.cadence = 30`
- `progress.cadence = 20`

The README `references` field now correctly uses `cadence` instead of `afterCalls`.

## Historical Impact (pre-resolution)

Users copying configuration from the old README would have expected different behavior than what the code provided by default, leading to:
- Confusion about why nudges appeared less frequently than documented
- Misconfiguration when users assumed the README values were the actual defaults
- Potential support burden from users reporting "plugin isn't working"
