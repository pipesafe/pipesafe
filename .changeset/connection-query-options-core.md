---
"@pipesafe/core": minor
---

Add connection and query option support: `pipesafe.connect()` accepts driver `MongoClientOptions`, `pipesafe.db()` / `Database` / `Collection` accept driver `DbOptions` / `CollectionOptions`, and `Pipeline.execute()` accepts `AggregateOptions` (including `session`, for aggregations inside transactions). Options flow from the layer that configures them down to execution. The `Source` interface gains `getOutputDbOptions()` / `getOutputCollectionOptions()`.
