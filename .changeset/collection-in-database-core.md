---
"@pipesafe/core": major
---

Split collections by whether they have a database, and check joins across databases at compile time.

- `Collection<Docs>` no longer has a database or direct driver commands. It is a pipeline source or join target that resolves in the database the pipeline runs in.
- `Database.collection()` returns the new `CollectionInDatabase<Docs, Db>`, which holds its `Database` and owns the direct commands (`find`, `insertMany`, indexes, …). Its `aggregate()` pipeline is bound to `Db` (`InDatabase<Db>` lookup mode): `lookup`, `graphLookup` and `unionWith` on a source in a different literal database is a compile error, and `execute()` cannot re-target `db`.
- `Database<Db>` and `pipesafe.db<const Db>(name)` carry the database name as a literal. A `string` name is unchecked.
- `Source<T, Db>` carries its database as a phantom type; `InferSourceDb`, `InDatabase`, `CollectionInDatabase` and `Database` are exported.
