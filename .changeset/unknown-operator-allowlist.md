---
"@pipesafe/core": minor
---

Typo'd operators and accumulators are now rejected at chained call sites.
Operator names in `$set`/`$project`/`$group` literals are checked against
the expression registry plus an explicit by-name allow-list of
valid-but-unmodeled MongoDB operators (`UnimplementedExpressionOps`,
`UnimplementedAccumulators`): allow-listed names keep compiling with no
operand validation (inference degrades to `unknown`), while anything else
brands with `UnknownOperatorError` / `UnknownAccumulatorError` (previously
any unregistered `$`-key was silently accepted, so typos compiled).
Expression values inside generic-schema pipeline helpers now also compile
for schema-independent operands (a schema-free fast-accept arm mirrors the
group accumulator one).
