---
"@pipesafe/core": minor
---

Widen the `mongodb` peer range to `^6.17.0 || ^7.0.0`. The driver surface core touches — `MongoClient`, `Db`, `Collection.aggregate()` and the cursor it returns — is unchanged in driver 7, so the package already worked against it; only the declared range said otherwise, which made npm with strict peers refuse the install (#115).
