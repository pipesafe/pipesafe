---
"@pipesafe/core": major
---

`Pipeline.execute()` re-targets with name/options pairs: `databaseName` and `collectionName` are replaced by `db: { name, options? }` and `collection: { name, options? }`. Each pair replaces that layer's inherited name and options. Migrate `execute({ databaseName: "d", collectionName: "c" })` to `execute({ db: { name: "d" }, collection: { name: "c" } })`.
