---
"@pipesafe/core": minor
---

`$set` rejections are now clean branded errors instead of a union wall plus
a spurious statement-level TS2589. `ValidateSetQuery` re-checks
structurally-accepted `$`-shaped values at the call site: unknown field
references brand with `Field '...' is not on the schema.`, multi-operator
objects with the exactly-one-operator brand, unknown operators with
`Operator '...' is not a known expression operator.`, and invalid operands
report TS2322 at the offending value against the registry's expected
operand shape. Unknown-operator and multi-operator objects at `$set` top
level are now compile errors (previously accepted silently as literals).
