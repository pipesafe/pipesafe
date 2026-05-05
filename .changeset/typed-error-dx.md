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

No runtime behaviour changes; all 56 existing runtime tests and 21 type-assertion files still pass.
