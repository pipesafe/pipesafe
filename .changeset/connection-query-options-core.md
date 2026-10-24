---
"@pipesafe/core": major
---

Add connection and query option support, and address databases and collections with name/options pairs (`DbConfig` / `CollectionConfig`, both exported).

- `pipesafe.connect(url, options?)` accepts driver `MongoClientOptions`; PipeSafe's driver metadata is appended to any user-supplied `driverInfo`.
- `new Database({ client, db: { name, options? } })` and `new Collection({ client, db?: { name, options? }, collection: { name, options? } })` replace the `databaseName` / `collectionName` arguments. `pipesafe.db(name, options?)` and `Database.collection(name, options?)` accept driver options.
- `Pipeline.execute()` accepts `aggregateOptions` (driver `AggregateOptions`, including `session`) and re-targets with the same `db` / `collection` pairs, each replacing that layer's inherited name and options.
- The `Source` interface exposes `getOutputDb(): DbConfig | undefined` and `getOutputCollection(): CollectionConfig`, replacing `getOutputDatabase()` / `getOutputCollectionName()`. `Collection.getOutputCollectionName()` / `getOutputDatabase()` are removed with them.

Migrate `new Collection({ databaseName: "d", collectionName: "c" })` to `new Collection({ db: { name: "d" }, collection: { name: "c" } })`, `new Database({ databaseName: "d" })` to `new Database({ db: { name: "d" } })`, and `execute({ databaseName: "d", collectionName: "c" })` to `execute({ db: { name: "d" }, collection: { name: "c" } })`.
