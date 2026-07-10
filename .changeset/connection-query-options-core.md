---
"@pipesafe/core": minor
---

Add connection and query option support: `pipesafe.connect()` now accepts driver `MongoClientOptions` (custom timeouts, pool sizing, etc.), `pipesafe.db()` / `Database` / `Collection` accept driver `DbOptions` / `CollectionOptions` (read/write concern, read preference), and `Pipeline.execute()` accepts `AggregateOptions` — including `session`, enabling aggregations inside transactions. Execute-level `dbOptions` / `collectionOptions` are merged per key over options inherited from the source.
