---
"@pipesafe/core": minor
---

`$set` rejections are now clean branded errors instead of a union wall plus
a spurious statement-level TS2589. `ValidateSetQuery` re-checks
structurally-accepted `$`-shaped values at the call site: unknown field
references brand with `Field '...' is not on the schema.`, and malformed
expression objects (multiple operator keys, or operator keys mixed with
plain keys) brand with the exactly-one-operator message. Invalid operands
of registered operators report TS2322 at the offending value against the
registry's expected operand shape. (Unregistered operators are deliberately
NOT branded — see the nested-value-validation entry.)
