---
"@pipesafe/manifold": major
---

Require `@pipesafe/core` 2.x: the peer dependency is now `>=2.0.0 <3.0.0`. Core 2.0 standardises the type system and adds call-site validation (see the `@pipesafe/core` 2.0.0 changelog), so pipelines passed to a `Model` may now surface `PipeSafeError` brands that 1.x accepted silently.

Breaking: the `MergeOptions` type re-export is REMOVED — import `MergeQuery` instead (also re-exported from `@pipesafe/manifold`).
