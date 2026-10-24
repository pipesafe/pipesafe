---
"@pipesafe/manifold": major
---

Address databases with core's `DbConfig` pairs and accept aggregate options.

- `Project.run({ db: { name, options? } })` replaces `databaseName`, and `new Project({ defaultDb: { name, options? } })` replaces `defaultDatabase`. Wherever a source or model sets no db of its own, the default db's name applies to reads, output targets and DDL, and its options to reads and DDL. Output write concern goes in `aggregateOptions`.
- Model outputs always target an explicit db, so downstream models read them from where they were written. `Model.buildPipeline(outputDb?)` takes that db name.
- A view whose source lives in another database fails `Project.run()` before any model runs.
- `Project.run({ aggregateOptions })` (driver `AggregateOptions`) applies to every collection-mode model's aggregation; its `session` also applies to view and time-series DDL.
- Model reads go through `Pipeline.execute()` with the run's client, applying a source `Collection`'s db/collection options as `aggregate().execute()` does.
- `Model` implements `Source.getOutputDb()` / `getOutputCollection()`; `getOutputDatabase()`, `getOutputCollectionName()`, `getSourceDatabase()` and `getSourceCollectionName()` are removed (use `getSource().getOutputDb()` etc.).
