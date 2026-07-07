---
"@pipesafe/core": minor
---

Accumulator operand brands now fire at chained `.group()` call sites.
`{ $sum: "$stringField" }` previously compiled silently because
`GroupQuery`'s index signature suppresses per-value operand checks; the new
key-filtered `ValidateGroupQuery` intersection re-checks the inferred
literal and reports TS2322 at the offending value. Covers `$sum`/`$avg`
(numeric operands, including numeric-returning expressions like
`{ $size: ... }`) and `$min`/`$max` (BSON-comparable operands: number,
date, string, boolean). Compound `_id` patterns are unaffected;
unregistered accumulators ($stdDevPop, ...) keep compiling.
