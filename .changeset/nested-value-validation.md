---
"@pipesafe/core": minor
---

Nested value validation at chained call sites. A shared kernel
(`ValidateNestedValue`) walks `$set`/`$project` values and group `_id`
literals at any depth — including array elements: unknown field references,
malformed expression objects (multiple operator keys, or operator keys
mixed with plain keys), and invalid operands of REGISTERED operators now
brand at the call site (previously nested `$`-shapes were accepted
structurally, and `$project` value errors only surfaced in the output
schema). Validation is deliberately forgiving where the registry is
incomplete: unregistered operators and accumulators ($toUpper, $switch,
$stdDevPop, ...) are valid MongoDB and keep compiling, as do `$$`-system
variables ($$NOW, $$ROOT). Operand semantics were corrected along the way:
$min/$max accept BSON-comparable operands (number, date, string, or
boolean —
`$min: "$name"` is valid), numeric accumulators accept any
numeric-returning registry expression (`$sum: { $size: ... }`), `$size`
and friends accept array-producing expressions, `$concatArrays` infers
element types through expression items instead of dropping them, and
`$filter.as` is optional, matching MongoDB. Plain string values are
accepted in `$project` (valid literal assignment).
