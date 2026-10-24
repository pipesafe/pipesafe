---
"@pipesafe/manifold": major
---

Address databases with core's `DbConfig` pairs and accept aggregate options.

- `Project.run({ db: { name, options? } })` replaces `databaseName`, and `new Project({ defaultDb: { name, options? } })` replaces `defaultDatabase`. The default db applies wherever a source or model sets no db of its own: model reads, output targets, and view and time-series DDL. Model outputs always target an explicit db, so downstream reads find them.
- `Project.run({ aggregateOptions })` (driver `AggregateOptions`) applies to every collection-mode model's aggregation; its `session` also applies to view and time-series DDL.
- Model reads go through `Pipeline.execute()`, so a source `Collection`'s db/collection options apply exactly as in `aggregate().execute()`.
- `Model` implements `Source.getOutputDb()` / `getOutputCollection()`; `getOutputDatabase()`, `getOutputCollectionName()`, `getSourceDatabase()` and `getSourceCollectionName()` are removed (use `getSource().getOutputDb()` etc.).
