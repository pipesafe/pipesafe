---
"@pipesafe/core": patch
---

Registry shape tidy-up: literal-dependent operators/accumulators now
declare their dependence by OMITTING `returns` from their
`ExpressionSpec`/`AccumulatorSpec` entry (previously they carried a
`returns: unknown` placeholder). `LiteralDependentOps` is derived from the
omission (pinned by `_DerivedLiteralDependentOps`), so the fixed-vs-
dependent split is declared exactly once, on the entry itself; a
dependent operator missing its `InferDependentExpression` arm now degrades
to `unknown` instead of the placeholder type. Type-level only — no
runtime or inference-result changes for existing operators.
