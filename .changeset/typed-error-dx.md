---
"@pipesafe/core": minor
---

Add typed compile-time error DX based on the 16-library audit in `docs/error-handling-audit/`.

- New `PipeSafeError<Msg, Ctx>` primitive in `utils/core.ts` carrying a literal error message that surfaces in IDE hovers.
- `IsPipeSafeError<T>` predicate and `PassThrough<T, Result>` short-circuit helper for chaining.
- `AssertPipeSafeError<Actual, ExpectedMsg>` test helper for type-level assertions in `*.typeAssertions.ts`.
- `match.ts` `ComparatorMatchers<T>` rewritten so each operator returns a `PipeSafeError` with a literal message when used against an incompatible field type (e.g. `$gte` on `string[]` now hovers as `PipeSafeError<"Operator '$gte' is not allowed on this field (numeric/date only)", string[]>`).
- `fieldReference.ts` `GetFieldTypeWithoutArrays` now returns a branded `SegmentMissError` at the leaf when invoked unconstrained, instead of falling through to `never`. The error names the failed segment and the full path. `InferFieldReference` retains its `FieldReference<Schema>` constraint so user-facing call sites still flag invalid paths at the input layer.
- All stage `Resolve<Stage>Output` types are wrapped in `PassThrough<Schema, ...>`, so once any stage produces an error, downstream stages preserve it verbatim instead of producing a fresh "is not assignable" cascade. `Prettify` is now applied to `match`, `set`, and `group._id` outputs (other stages already used it).

Round 2 (Phases A, C1-C4, D, E, F):

- `group.ts` aggregators (`$sum`, `$avg`, `$min`, `$max`) now report a literal message when given a wrong-typed operand (e.g. `$sum: '$stringField'`).
- `expressions.ts` arithmetic operators (`$add`, `$subtract`, `$multiply`, `$divide`, `$mod`, `$toDate`), the `$concat` string operator, the four date operators (`$dateToString`, `$dateTrunc`, `$dateAdd`, `$dateSubtract`), and the four array operators (`$size`, `$concatArrays`, `$arrayElemAt`, `$filter`) all surface per-operator branded errors instead of degrading silently to `never`.
- `project.ts` flags two previously-silent failure modes: including a key that doesn't exist on the schema (`{ unknownKey: 1 }`) and supplying an invalid projection value (anything other than 0/1/ref/expr/object). The `HasInclusions`/`HasExclusions` helpers were also fixed to detect mixed-mode queries correctly.
- `unwind.ts` `UnwindPath<Schema>` now brands non-array field references so `pipeline.unwind('$scalar')` hovers with a literal message.
- `sort.ts` `SortQuery<Schema>` no longer accepts arbitrary string keys via a permissive index signature — typos like `pipeline.sort({ naem: 1 })` are now flagged at compile time. Minor behavior change.

Infrastructure:

- `packages/core/tsconfig.json` no longer excludes `**/*.typeAssertions.ts`, so the root `tsc --noEmit` now covers all 21 type-assertion files via project references. Previously they were only checked by IDE LSP, letting real errors slip through CI.
- `packages/core/tsconfig.benchmark.json` overrides `rootDir` to the package root so the benchmark suite type-checks `examples/`, `benchmarking/`, and `benchmarks/` instead of failing fast with TS6059. Fixes the `Instantiations: 0` readout the diagnostic parser was producing.

No runtime behaviour changes; all 56 existing runtime tests and 21 type-assertion files still pass.
