---
type: memory
title: "Traversal Tool Detection Is Substring-Based — No Tool-Catalog Guard"
createdAt: "2026-08-29T20:21:00Z"
updatedAt: "2026-08-29T20:21:00Z"
tags: [gotcha, traversal, detection, toolPatterns]
see_also:
  - "adrs/0010-traversal-nudge.adr.md"
  - "concepts/0005-traversal-nudge-mode.concept.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# Memory: Traversal Tool Detection Is Substring-Based — No Tool-Catalog Guard

## Fact

`TraversalNudgeEngine` detects traversal calls by substring match on `toolPatterns` (covers
`bensyne_*` and `meta_use` `args.name`). A traversal tool whose name is absent from the
patterns is **not** recognized — no tool-catalog guard exists.

## Context

Verified in `src/traversal.ts` (`isTraversalTool`) and ADR-0010 (ADR-8 consequences). Caught
while reviewing the Traversal-Nudge feature (2026-08-29).

## Impact

The engine silently ignores unrecognized traversal tools; users/extenders must extend
`toolPatterns` (or the detection logic) when adding new decision-tree tools. Detection is
heuristic, not schema-driven — a possible future `tool-catalog` upgrade path.
