---
"@pipesafe/core": major
"@pipesafe/manifold": major
---

Type-system standardisation. Every stage now follows one convention —
`XxxQuery` (acceptance) / `ValidateXxxQuery` (rejection, where needed) /
`ResolveXxxOutput` (output schema), Schema-first, with `PassThrough` error
forwarding on every non-terminal resolver — backed by an operator-key
dispatch kernel, a single expression/accumulator registry
(`ExpressionSpec` / `AccumulatorSpec`), and a shared operand kernel.

New validation at chained call sites: unknown field references, malformed
expression objects, invalid operands of registered operators, and
operator/accumulator names outside the registry + explicit allow-lists
(`UnimplementedExpressionOps`, `UnimplementedAccumulators`) all brand with
a `PipeSafeError` at the offending value — including `$set`/`$project`
values at any literal depth, `$group` `_id` and accumulator operands
(`$sum`/`$avg` numeric; `$min`/`$max` BSON-comparable), and typo'd
operator names. Valid-but-unmodeled MongoDB stays accepted (allow-listed
by name, `unknown` inference), as do `$$`-system variables and widened
values; expression values inside generic-schema pipeline helpers now
compile.

Fixes: `$count` forwards upstream error schemas; `{_id: 1, name: 0}`
projections no longer falsely brand as mixed-mode; `$cond` no longer
strips `null`/`undefined` from branches; the `$unwind` brand fires at
chained call sites; `$`-keyed objects no longer pass as object literals;
`$set` rejections no longer emit a spurious TS2589; `as const` operands
type-check (readonly operand positions); dotted `$lookup` `as` paths nest
in the output schema.

Breaking: `@pipesafe/manifold` now requires `@pipesafe/core` 2.x
(peer dependency `>=2.0.0 <3.0.0`); `ResolveCountOutput` gained a `Schema`
first type parameter;
`MergeOptions` is deprecated in favor of `MergeQuery` (alias retained in
`compat.ts`); several internal type names changed (deprecated aliases
retained where signatures allow). Whole-project type instantiations drop
~40% for equivalent pipelines; a CI budget gate
(`bun run budget:check`) now guards type-level performance.
