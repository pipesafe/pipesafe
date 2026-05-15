---
"@pipesafe/core": patch
---

Internal perf: drop redundant `Prettify` wraps from `$set`/`$project`/
`$replaceRoot`/`$group` internal helpers (`MergeNested`, `FlattenDotSet`,
`MergeSetPlainObjects`, `ReorderKeysToMatchSchema`,
`InferNestedFieldReferenceObject`) and delete two unused exports
(`RemoveNever`, `FlattenToNested`). `ResolveSetOutput`,
`ResolveGroupOutput`, `ResolveReplaceRootOutput`,
`ResolveInclusionMode`/`ResolveExclusionMode` already apply `Prettify` at
their public boundary, so the inner wrappers were re-running the same
mapped-type pass on every recursion level. Measured ~5.5% reduction in
TypeScript registry entries owned by project source (43,291 → 40,901),
with `Prettify` itself dropping 22.5% (3,919 → 3,037) and
`ReorderKeysToMatchSchema` dropping 57% (1,096 → 466). Public types are
unchanged.
