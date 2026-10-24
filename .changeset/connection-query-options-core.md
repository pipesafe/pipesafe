---
"@pipesafe/core": major
---

Add connection and query option support, and address databases and collections with name/options pairs (`DbConfig` / `CollectionConfig`, both exported).

- `pipesafe.connect(url, options?)` accepts driver `MongoClientOptions`; PipeSafe's driver metadata is appended to any user-supplied `driverInfo` on mongodb >= 6.18.
- `new Database({ client, db: { name, options? } })` and `new Collection({ client, collection: { name, options? } })` replace the `databaseName` / `collectionName` arguments. `pipesafe.db(name, options?)` and `Database.collection(name, options?)` accept driver options.
- `Pipeline.execute()` accepts `aggregateOptions` (driver `AggregateOptions`, including `session`) and re-targets with the same `db` / `collection` pairs, each replacing that layer's inherited name and options.
- The `Source` interface exposes `getOutputCollection(): CollectionConfig`, replacing `getOutputCollectionName()`; `getOutputDatabase()` is removed.

Migrate `new Collection({ databaseName: "d", collectionName: "c" })` to `pipesafe.db("d").collection("c")` (or `new Collection({ collection: { name: "c" } })` for a db-less source), `new Database({ databaseName: "d" })` to `new Database({ db: { name: "d" } })`, and `execute({ databaseName: "d", collectionName: "c" })` to `execute({ db: { name: "d" }, collection: { name: "c" } })`.
