---
"@pipesafe/core": major
---

`Collection`, `Database` and `Pipeline.execute()` address databases and collections with name/options pairs (`DbConfig` / `CollectionConfig`, both exported): `db: { name, options? }` and `collection: { name, options? }` replace `databaseName` / `collectionName` (and the `dbOptions` / `collectionOptions` / `options` arguments). In `execute()`, each pair replaces that layer's inherited name and options.

Migrate `new Collection({ databaseName: "d", collectionName: "c" })` to `new Collection({ db: { name: "d" }, collection: { name: "c" } })`, `new Database({ databaseName: "d" })` to `new Database({ db: { name: "d" } })`, and `execute({ databaseName: "d", collectionName: "c" })` to `execute({ db: { name: "d" }, collection: { name: "c" } })`.
