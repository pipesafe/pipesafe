---
"@pipesafe/manifold": minor
---

`Project.run()` now accepts `aggregateOptions` (driver `AggregateOptions`, e.g. `maxTimeMS`, `allowDiskUse`, `comment`) applied to every collection-mode model's aggregation. Model reads also honor the driver `DbOptions` / `CollectionOptions` configured on a source `Collection`, matching the behavior of `aggregate().execute()` on the same collection.
