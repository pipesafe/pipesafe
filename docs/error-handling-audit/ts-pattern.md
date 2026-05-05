# ts-pattern — Error DX Audit

## Metadata

- Repo: gvergnaud/ts-pattern
- Commit: see /tmp/audit-libs/ts-pattern (shallow clone)
- Domain similarity to pipesafe (1-5): 4 — both are chained builders with deep generic accumulation; ts-pattern's exhaustiveness checking maps directly onto pipesafe's stage-ordering and field-availability problems
- LOC of types audited: ~2400 (focused on Match.ts 288 lines, InvertPattern.ts 408 lines, FindSelected.ts 195 lines)

## Library Summary

ts-pattern v5 is a TypeScript pattern-matching library with sophisticated compile-time exhaustiveness checking. Unlike most libraries, ts-pattern invests heavily in type-level error reporting — its `.exhaustive()` method enforces compile-time exhaustiveness and produces highly targeted error messages when cases are missing.

## Search hit summary

| Pattern                  |          Hits | Notable files                                                                              |
| ------------------------ | ------------: | ------------------------------------------------------------------------------------------ |
| `Error<` / `*Error<`     |          high | src/types/Match.ts, src/types/FindSelected.ts                                              |
| `__error`                |           yes | src/types/FindSelected.ts (SeveralAnonymousSelectError, MixedNamedAndAnonymousSelectError) |
| `__nonExhaustive`        |           yes | src/types/Match.ts (NonExhaustiveError, TSPatternError)                                    |
| `unique symbol`          |           yes | src/types/symbols.ts                                                                       |
| `Prettify` / `Simplify`  | none observed | —                                                                                          |
| Template-literal parsers |          none | patterns are objects, not strings                                                          |

## Techniques found

### T4 — Conditional Return-Type Degradation via Interface Hack

- **Category**: T4 (Conditional Degradation)
- **File**: src/types/Match.ts:10-16
- **Snippet**:

  ```ts
  interface NonExhaustiveError<i> {
    __nonExhaustive: never;
  }

  interface TSPatternError<i> {
    __nonExhaustive: never;
  }
  ```

- **User-facing trigger**: When `.exhaustive()` is called and unhandled cases remain, the return type becomes `NonExhaustiveError<remainingCases>` instead of `Exhaustive<output, inferredOutput>`.
- **Resulting error message**: `Property '__nonExhaustive' is missing in type '...'` — but the IDE hover on `.exhaustive()` reveals `NonExhaustiveError<{ x: 'B' }>`, exposing the unhandled case.
- **Applicability to pipesafe**: 5 — Pipeline.ts: brand result of a finalizer like `.toJSON()` or `.run()` with `IncompletePipelineError<missingStages>` when required stages weren't added.

### T3 — State Machine with Finalizer Slot (Pattern Accumulation)

- **Category**: T3 (State Machine Error Finalization)
- **File**: src/types/Match.ts:22-150
- **Snippet** (paraphrased):
  ```ts
  type Match<i, o, handledCases extends any[] = [], inferredOutput = never> = {
    with<...>(pattern, handler): Match<
      Exclude<i, excluded>,
      o,
      [...handledCases, excluded],
      Union<inferredOutput, c>
    >;
    exhaustive: DeepExcludeAll<i, handledCases> extends infer remainingCases
      ? [remainingCases] extends [never]
        ? Exhaustive<o, inferredOutput>
        : NonExhaustiveError<remainingCases>
      : never;
  }
  ```
- **User-facing trigger**: Each `.with()` narrows the input and accumulates excluded cases. `.exhaustive()` reduces and reports residual.
- **Resulting error message**: Hover on `.exhaustive()` shows the residual union; calling it is rejected.
- **Applicability to pipesafe**: 5 — Pipeline.ts: thread `appliedStages` tuple through methods; finalizer reports missing required stages.

### T5 — Overload Ladders with Type Inference Recovery

- **Category**: T5
- **File**: src/types/Match.ts:34-130 (7 overloads of `.with()`)
- **Snippet** (one overload):
  ```ts
  with<const p extends Pattern<i>, c, value extends MatchedValue<i, InvertPattern<p, i>>>(
    pattern: IsNever<p> extends true ? Pattern<i> : p,
    handler: (selections: FindSelected<value, p>, value: value) => PickReturnValue<o, c>
  ): InvertPatternForExclude<p, value> extends infer excluded
    ? Match<Exclude<i, excluded>, o, [...handledCases, excluded], Union<inferredOutput, c>>
    : never;
  ```
- **User-facing trigger**: Authoring `.with(pattern1, pattern2, handler)` with multiple patterns or guards.
- **Resulting error message**: TS chooses the right overload; the `IsNever<p>` fallback widens to `Pattern<i>` so users still get reasonable autocomplete on a fresh `.with(`.
- **Applicability to pipesafe**: 4 — match.ts and Pipeline.ts: variadic operators and stage methods can use this to keep autocomplete useful even before the first arg is typed.

### T7 — Inference Capture via `InvertPattern`

- **Category**: T7 (Inference Capture)
- **File**: src/types/InvertPattern.ts:1-408
- **User-facing trigger**: Patterns get inverted to their matched value type so handlers receive a precisely-narrowed parameter; mismatches flag at the constraint.
- **Resulting error message**: Standard "not assignable" but with already-narrowed types so the message is readable.
- **Applicability to pipesafe**: 3 — fieldReference.ts: pattern-style invert could compute "what fields exist after this stage" rather than relying on pure recursion.

### T6 — Constraint-Side Validation

- **Category**: T6
- **File**: src/types/Match.ts:35-53
- **Snippet**:
  ```ts
  with<const p extends Pattern<i>, c, value extends MatchedValue<i, InvertPattern<p, i>>>(...)
  ```
- **User-facing trigger**: User passes a literal not in the input union.
- **Resulting error message**: TS error highlighted on the offending pattern argument with constraint context.
- **Applicability to pipesafe**: 4 — match.ts: constrain operator object so unknown ops are immediately flagged.

### T9 — Phantom-Parameter Error Messages via Selection Errors

- **Category**: T9
- **File**: src/types/FindSelected.ts:159-183
- **Snippet**:

  ```ts
  export type SeveralAnonymousSelectError<
    a =
      "You can only use a single anonymous selection (with `select()`) in your pattern. If you need to select multiple values, give them names with `select(<name>)` instead",
  > = { __error: never };

  export type MixedNamedAndAnonymousSelectError<
    a =
      'Mixing named selections (`select("name")`) and anonymous selections (`select()`) is forbiden. Please, only use named selections.',
  > = { __error: never };
  ```

- **User-facing trigger**: Misuse of `.select()` (multiple anonymous, mixed named/anonymous).
- **Resulting error message**: Handler's `selections` param becomes the error type; hovering shows the message default-arg as a phantom `a` type parameter.
- **Applicability to pipesafe**: 5 — set.ts: dotted-key conflict could become `DottedKeyConflictError<"a.b conflicts with a.b.c">` injected as the parameter type for `set()`.

### T13 — Error Accumulation via Short-Circuit Strategy

- **Category**: T13
- **File**: src/types/Match.ts:245-249
- **Snippet**:
  ```ts
  type DeepExcludeAll<a, tupleList extends any[]> =
    [a] extends [never] ? never
    : tupleList extends [infer excluded, ...infer tail] ?
      DeepExcludeAll<DeepExclude<a, excluded>, tail>
    : a;
  ```
- **User-facing trigger**: Many missing cases in `.exhaustive()`.
- **Resulting error message**: Reports first residual only — keeps IDE responsive on large unions.
- **Applicability to pipesafe**: 4 — group.ts/match.ts: report first invalid operand rather than all to keep error text small.

## Negative results

- T1 (typed error returns at top-level): not used — error is a branded interface, not a string-message type
- T2 (template-literal positional errors): not used — patterns are objects, not strings
- T8 (string-DSL parser): not used — pure object-literal patterns
- T10 (hover flatteners): no `Prettify`/`Simplify` observed in the audited files
- T11 (symbol brand markers as error markers): symbols exist but are used for selection bookkeeping, not error states
- T12 (JSDoc deprecation): no `@deprecated` annotations — stable API
- T14, T15: not applicable to pattern-matching domain

## Cross-references

- T3 accumulator pattern shared with Drizzle ORM's `excludedMethods` and tRPC's procedure builder
- T9 phantom-param error messages similar in spirit to TanStack Router's typed `to` prop errors
- T4 interface-with-`__error: never` predates and inspires similar techniques in type-plus and Drizzle's `DrizzleTypeError`

## Key insight for pipesafe

ts-pattern proves that **type-level exhaustiveness checking scales to complex nested structures** by threading a tuple of handled cases through a builder chain. Pipesafe can directly apply this:

1. `Pipeline<...stages>` carries an `appliedStages` tuple
2. Each `.match()`, `.set()`, `.group()` etc. appends its tag
3. A finalizer like `.toAggregation()` checks the tuple against required-stages constraints, returning `IncompletePipelineError<missingStages>` if violated
