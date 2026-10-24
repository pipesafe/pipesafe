---
"@pipesafe/manifold": major
---

Address databases with core's `DbConfig` pairs and accept aggregate options.

- `Project.run({ db: { name, options? } })` replaces `databaseName`, and `new Project({ defaultDb: { name, options? } })` replaces `defaultDatabase`. The run's db name applies to reads, views and any output without `materialize.db`, and its options to reads and DDL. Output write concern goes in `aggregateOptions`.
- Model outputs always target an explicit db. `Model.buildPipeline(outputDb?)` takes that db name.
- `Project.run({ aggregateOptions })` (driver `AggregateOptions`) applies to every collection-mode model's aggregation; its `session` also applies to view and time-series DDL.
- Model reads go through `Pipeline.execute()` with the run's client, applying a source `Collection`'s collection options as `aggregate().execute()` does.
- `Model` exposes `getOutputDb()` and implements `Source.getOutputCollection()`; `getOutputDatabase()`, `getOutputCollectionName()`, `getSourceDatabase()` and `getSourceCollectionName()` are removed.
