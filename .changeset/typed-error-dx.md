---
"@pipesafe/core": minor
---

Add typed compile-time error DX based on the 16-library audit in `docs/error-handling-audit/`.

- New `PipeSafeError<Msg>` primitive in `utils/core.ts` — a single-parameter branded interface whose literal `Msg` is the entire surface area. Dynamic context (operator names, key names, path segments) is templated into the message so the hover shows just the message string, not a wide schema dump.
- `IsPipeSafeError<T>` predicate and `PassThrough<T, Result>` short-circuit helper for chaining.
- `AssertPipeSafeError<Actual, ExpectedMsg>` test helper for type-level assertions in `*.typeAssertions.ts`.
- `match.ts` `ComparatorMatchers<T>` rewritten so each operator returns a `PipeSafeError` with a literal message when used against an incompatible field type (e.g. `$gte` on `string[]` now hovers as `PipeSafeError<"Operator '$gte' is not allowed on this field (numeric/date only)">`).
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

Call-site brand surfacing (Round 3):

The brands added in Rounds 1-2 fire at the type-level (proven by `*.typeAssertions.ts` tests) but mostly didn't surface at chained Pipeline call sites because the `<const X extends Q>($q: X)` generic-constraint pattern suppresses excess-property checking and hides per-key value brands behind index signatures. This round changes the Pipeline method signatures to make the brands fire at the call site so `pipeline.sort({ naem: 1 })` produces a useful compile error rather than silently passing.

- `Pipeline.sort($sort: SortQuery<Schema>)` — direct typing surfaces TS2353 on typo'd field names. SortQuery's mapped type over a finite key union allows excess-property checking once the generic is dropped.
- `Pipeline.match` keeps its `<const M extends MatchQuery<Schema>>(\$match: M)` signature unchanged. Inner-operator brands (e.g. `$gte` against a string field) continue to fire from `ComparatorMatchers`. A `ValidateMatchQuery` wrapper that also branded typo'd top-level keys was tried, but the resulting error type was verbose (intersection of the user's literal with the brand) without much extra value — kept the surface focused on the inner-operator brand, which is the higher-impact case.
- Match operand helpers (`NumericOperand`, `SizeOperand`, etc.) switched from naked-conditional distribution to `[T] extends [...]` so a field typed as a union (e.g. `status: 'pending' | 'shipped' | 'delivered'`) is rejected with one error rather than producing a union of per-branch outcomes.
- `Pipeline.project` switches to `<const P>($project: ValidateProjectQuery<Schema, P>)`. The new `ValidateProjectQuery` mapped type catches two previously-silent failures at the call site:
  - Inclusion of an unknown key — `project({ name: 1, unknownKey: 1 })` now hovers as `PipeSafeError<"Cannot include field 'unknownKey' — not on schema">`. New-field-creation values (field references, expressions, nested objects) on unknown keys still pass because that's the legitimate "rename / compute new field" pattern.
  - Mixed inclusion (1/true) and exclusion (0/false) on non-`_id` fields — `project({ name: 1, age: 0 })` is now rejected at compile time with the literal "Cannot mix..." message. Excluding `_id` from an otherwise-inclusion projection is still permitted (it's MongoDB's documented exception).
- `Pipeline.callSite.typeAssertions.ts` (new) is a permanent regression guard: each Pipeline stage method has at least one `@ts-expect-error` case pinning the desired call-site rejection, so future signature regressions can't silently re-introduce the gap.

Perf: validation-mapped types add ~3,600 instantiations (~0.4%) to the baseline package typecheck and zero per-stage cost for valid inputs (TS folds the mapping when its result shape matches the input).

Known limitation: `Pipeline.group`'s call-site brand surfacing for `$sum`/`$avg` operand mismatches is left as a follow-up. Wrapping group's parameter in a validation type interferes with TS's resolution of legitimate compound-`_id` patterns (e.g. `_id: { date: { $dateToString: ... } }`). The brand still fires when assigning the literal to a `GroupQuery<Schema>`-typed variable directly; only the chained call site is silent. Tracked in a follow-up PR.

Examples updated: two pre-existing latent bugs in `examples/analytics-dashboard.ts` and `examples/user-management.ts` (project keys not on the previous-stage schema) were uncovered by this change and removed; both lines were already commented as "would use additional stages".

No runtime behaviour changes; all 56 existing runtime tests and 22 type-assertion files still pass.
