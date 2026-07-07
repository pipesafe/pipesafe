---
"@pipesafe/core": minor
---

Nested value validation at chained call sites. A shared kernel
(`ValidateNestedValue`) walks `$set`/`$project` values and group `_id`
literals at any depth: unknown field references, unknown or multi-key
operators, and invalid operands now brand at the call site (previously
nested `$`-shapes were accepted structurally, and `$project` value errors
only surfaced in the output schema). `$min`/`$max` group operands are
validated (numeric or date); `$`-keyed non-accumulator group values brand
as unknown accumulators. Registry operand fixes surfaced by the new
checks: `$size` and friends accept array-producing expressions
(`{ $size: { $filter: ... } }`) and `$filter.as` is optional, matching
MongoDB.
