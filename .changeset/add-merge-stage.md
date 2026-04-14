---
"@pipesafe/core": minor
"@pipesafe/manifold": minor
---

Add typed `$merge` terminal stage to `Pipeline` (mirrors `.out()` semantics) and unify `Model.Mode.Upsert`/`Append` output construction in manifold to delegate to the new builder. `MergeOptions` now lives in `@pipesafe/core`; manifold re-exports it for back-compat.
