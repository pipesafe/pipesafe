---
"@pipesafe/core": patch
---

Fix `.facet()` sub-pipelines failing to type-check on TypeScript 7. `merge` now takes its options through a generic constraint, so a `Pipeline` stays assignable to `Pipeline<Schema, Document>`, and terminal `.merge()` pipelines satisfy `InferOutputType` again. `$unset` of a nested path under an optional parent no longer adds an explicit `undefined` to that parent under `exactOptionalPropertyTypes`.
