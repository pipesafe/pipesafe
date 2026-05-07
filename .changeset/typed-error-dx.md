---
"@pipesafe/core": major
---

Add typed compile-time error messages across the pipeline builder. Invalid pipeline shapes that previously produced "is not assignable to never" cascades now hover with literal `PipeSafeError<Msg>` messages naming the operator, accumulator, stage, or field that's wrong.

Covers `$match` operators (`$gte` on string fields, `$size` on non-arrays, etc.), `$group` accumulator operands (`$sum`/`$avg`/`$min`/`$max` against wrong-typed fields), `$project` (unknown-key inclusion, mixed inclusion/exclusion), `$unwind` on scalar fields, expression operands (`$add`/`$concat`/`$dateToString`/`$concatArrays` etc.), invalid field-reference paths, and a strict `SortQuery` that flags typo'd field names.

The `Pipeline` method signatures were tuned (direct typing for `sort`, validation-mapped wrapper for `project`) so the brands surface at the chained call site rather than only when the literal is assigned to a typed variable.

See `CLAUDE.md` for the brand format conventions, signature patterns, and known limitations.

Behaviour changes:

- `SortQuery<Schema>` no longer accepts arbitrary string keys via a permissive index signature — typos like `pipeline.sort({ naem: 1 })` are now flagged.
- `Pipeline.project` now rejects mixed inclusion (1/true) and exclusion (0/false) on non-`_id` fields at compile time (MongoDB rejects this at runtime).

No runtime behaviour changes; all existing runtime tests and type-assertion files still pass.
