---
"@pipesafe/manifold": major
---

Check model databases at compile time instead of at run time.

- A model's `from` and join targets must have no database: a db-less `Collection` or a model without `materialize.db`. Anything else is a compile error.
- `materialize.db` is only allowed on collection models; views always live in the run's database. The run-time cross-database view check is removed.
- `Model` implements `Source<TOutput, ModelOutputDb<TMaterializeConfig>>`, with a literal `materialize.db` inferred as a literal.
