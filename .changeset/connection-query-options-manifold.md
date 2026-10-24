---
"@pipesafe/manifold": major
---

Address databases with core's `DbConfig` pairs and accept aggregate options.

- `Project.run({ db: { name, options? } })` replaces `databaseName`, and `new Project({ defaultDb: { name, options? } })` replaces `defaultDatabase`. The db options apply to model reads and to view and time-series DDL.
- `Project.run({ aggregateOptions })` (driver `AggregateOptions`) applies to every collection-mode model's aggregation; its `session` also applies to view and time-series DDL.
- Model reads go through `Pipeline.execute()`, so a source `Collection`'s db/collection options apply exactly as in `aggregate().execute()`.
- `Model` implements `Source.getOutputDb()` / `getOutputCollection()`; `getOutputDatabase()`, `getOutputCollectionName()`, `getSourceDatabase()` and `getSourceCollectionName()` are removed (use `getSource().getOutputDb()` etc.).
