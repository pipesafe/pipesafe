---
"@pipesafe/core": minor
---

Accumulator operand brands now fire at chained `.group()` call sites.
`{ $sum: "$stringField" }` previously compiled silently because
`GroupQuery`'s index signature suppresses per-value operand checks; the new
key-filtered `ValidateGroupQuery` intersection re-checks the inferred
literal and reports `Accumulator '$sum' requires a numeric operand.` at the
offending value (TS2322). Compound `_id` patterns
(`_id: { date: { $dateToString: ... } }`) are unaffected. Covers `$sum` and
`$avg`.
