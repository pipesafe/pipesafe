---
"@pipesafe/core": patch
---

Internal perf: drop redundant `Prettify` wraps from `$set`-internal helpers
(`MergeNested`, `FlattenDotSet`, `MergeSetPlainObjects`,
`ReorderKeysToMatchSchema`). `ResolveSetOutput` already applies `Prettify` at
the public boundary, so the inner wrappers were running the same mapped-type
pass on every recursion level. Measured ~5% reduction in TypeScript registry
entries owned by project source on this codebase (43,291 → 41,051), with
`ReorderKeysToMatchSchema` dropping 57% (1,096 → 466 entries) and `Prettify`
itself dropping 19% (3,919 → 3,179 entries). Public types are unchanged.
