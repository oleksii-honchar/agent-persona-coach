---
type: adr
id: ADR-0007
title: "Deep Merge for Nested Config Overrides"
status: accepted
createdAt: "2026-06-12T12:10:00Z"
updatedAt: "2026-06-12T12:10:00Z"
tags: [configuration, merge, typescript]
supersedes: []
superseded_by: []
see_also:
  - "adrs/0006-config-driven-prompts.adr.md"
  - "specifications/0001-plugin-configuration.spec.md"
  - "concepts/0002-reflection-categories.concept.md"
deprecated:
  date: null
  reason: null
  superseded_by: null
---

# ADR-0007: Deep Merge for Nested Config Overrides

## Context

The plugin constructor used `{...DEFAULT_CONFIG, ...config}` — a shallow merge. When users provided partial nested config overrides (e.g., `{ categories: { identity: { cadence: 5 } } }`), the spread operator replaced the entire `categories` object, losing all other category configurations. This was a pre-existing bug documented in the vault spec (`0001-plugin-configuration.spec.md`) as a known risk.

With the addition of `coachPrompt` to `PluginConfig`, the shallow merge bug would also cause prompt config issues: a user providing a partial categories override and a custom prompt would lose the default `coachPrompt` value if they also provided a `categories` override. The fix became necessary for the config-driven prompts feature.

## Decision

**Implement a custom `deepMerge<T>(target, source)` function in `src/types.ts`.** Replace the shallow merge in the plugin constructor.

Merge semantics:
- Plain objects are merged recursively
- Arrays are **replaced** (not merged) — if user sets `criticalPermissions: ["bash"]`, only bash is critical
- Primitive values are replaced
- `undefined` values are skipped (preserve target value)
- The target object is not mutated (new object created via spread + recursion)

## Alternatives Considered

| Alternative | Pros | Cons | Why rejected |
|---|---|---|---|
| `lodash.merge` | Battle-tested, handles edge cases | ~6KB gzipped for one utility | Overkill for a 10-line function operating on simple config types |
| `structuredClone` + spread | No dependency | Doesn't deep merge; same bug with different syntax | Not a real alternative |
| `ramda.mergeDeepLeft` | Functional | Adds FP dependency for single use | Overkill |

## Consequences

- **Positive:** No new dependencies
- **Positive:** Explicit control over merge semantics (arrays replaced)
- **Positive:** All existing tests pass (deep merge is a superset of shallow merge for flat configs)
- **Positive:** The vault-documented risk "shallow merge means partial category overrides replace the entire category object" is now fixed
- **Positive:** `DeepPartial<T>` utility type provides accurate typing for partial config overrides (fixes the loose `Partial<PluginConfig>` constructor parameter)
- **Negative:** Users who relied on the old "replace entire category" behavior will get different results (bug fix, not breaking change)
