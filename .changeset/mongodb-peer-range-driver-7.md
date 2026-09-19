---
"@pipesafe/core": minor
"@pipesafe/manifold": minor
---

Widen the `mongodb` peer range to `>=6.0.0` in both packages. The driver surface these touch — `MongoClient`, `Db`, `Collection.aggregate()` and the cursor it returns — has been unchanged since driver 6.0, and is unchanged in driver 7, so the packages already worked against both; only the declared range said otherwise, which made npm with strict peers refuse the install (#115).

No upper bound: a major that does break this surface will break it visibly, and pinning a ceiling only guarantees the same refusal again on the day driver 8 ships.
