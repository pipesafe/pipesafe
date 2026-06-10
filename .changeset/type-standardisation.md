---
"@pipesafe/core": minor
"@pipesafe/manifold": minor
---

Type-system standardization (docs/type-standardisation-plan.md):

- Stage trio convention: `XxxQuery<Schema>` / `ValidateXxxQuery<Schema, Q>` /
  `ResolveXxxOutput<Schema, Q>` with Schema-first parameter order everywhere.
- New operand kernel (`FieldOperand`/`ExpressionOperand`) and operator-key
  dispatch (`OperatorKeyOf`, `NotAnExpression` sentinel); expression inference
  is now forgiving — malformed operands keep the operator's result kind while
  the operand brand reports at the input position. Multi-operator expression
  objects now brand with "Expression objects must have exactly one operator."
- Expression and accumulator registries (`ExpressionSpec`, `AccumulatorSpec`):
  per-operator types and unions are derived; adding an operator is one entry.
- `$unwind`'s branded error now surfaces at chained call sites; `$count` now
  forwards upstream `PipeSafeError` schemas; `{_id: 1, name: 0}` projections
  are no longer falsely rejected as mixed-mode.
- Whole-project type instantiations reduced ~34% (990k → 652k on the
  benchmark suite) via early-exit dispatch, dead-type removal, and
  computation hoisting.
- RENAMED: `MergeOptions` → `MergeQuery` (deprecated `MergeOptions` alias
  remains until v1.0.0).
- BREAKING (pre-1.0): exported `ResolveCountOutput` gained a `Schema` first
  parameter (`ResolveCountOutput<Schema, FieldName>`) — required for the
  PassThrough fix; a same-name compat alias for an arity change is not
  possible.
