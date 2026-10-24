---
"@pipesafe/core": patch
---

Fix `.facet()` sub-pipelines failing to type-check on TypeScript 7. `merge` now takes its options through a generic constraint, so a `Pipeline` stays assignable to `Pipeline<Schema, Document>`, and terminal `.merge()` pipelines satisfy `InferOutputType` again; unknown `$merge` option keys are rejected with a `PipeSafeError`. `$unset` of nested paths keeps each parent's optionality and declared `undefined` exactly under `exactOptionalPropertyTypes`, and the array form now removes nested fields under optional parents.
