# HotScript — Error DX Audit

## Metadata

- Repo: gvergnaud/hotscript
- Commit: 0bc205286bd5eea0b89fa903c411df9aca95923c
- Domain similarity to pipesafe (1-5): 4 — Both deeply nested generics with function composition and type-level operations; HotScript's `Fn` and `Pipe` directly mirror pipesafe's aggregation pipeline composability.
- LOC of types audited: ~5075

## Search hit summary

| Pattern                                          | Hits | Notable files                                |
| ------------------------------------------------ | ---- | -------------------------------------------- |
| Type-error names (`Error<`, `Invalid_`, etc.)    | 0    | —                                            |
| Brand markers (`__brand`, `unique symbol`)       | 3    | src/internals/core/Core.ts                   |
| Tuple/intersection error tricks                  | 0    | —                                            |
| Template-literal parsers (`extends \``, `infer`) | 25   | src/internals/strings/impl/\*.ts             |
| IDE hints (`@deprecated`, `@hidden`, etc.)       | 0    | —                                            |
| Hover flatteners (`Prettify`, `Simplify`)        | 10   | src/internals/helpers.ts, objects/Objects.ts |
| HKT-specific (`Fn`, `Apply`, `Pipe`)             | 384  | All core modules                             |

## Techniques found

### T4: Constraint Degradation via Fn.arg<N, Constraint>

- **Category**: T4
- **File**: src/internals/core/Core.ts:52-56
- **Snippet**:

```typescript
export interface arg<Index extends number, Constraint = unknown> extends Fn {
  return: this["args"][Index] extends infer arg extends Constraint ? arg
  : never;
}
```

- **User-facing trigger**: User provides wrong type to a function parameter in `Match<pattern, [With<...>]>` where pattern uses `arg<0, SomeType>`.
- **Resulting error message**: Return type becomes `never` when the passed argument doesn't match the constraint. IDE shows "Type X is not assignable to expected type at this parameter position" in the pattern match context.
- **Applicability to pipesafe**: 5 — Pipesafe's `match.ts` stage patterns need similar constraint-based validation for field references. The `arg<N, Constraint>` pattern directly maps to validating that a field accessor receives the correct document shape.

---

### T11: Unique Symbols for HKT Tracking

- **Category**: T11
- **File**: src/internals/core/Core.ts:4-5, 39-50
- **Snippet**:

```typescript
declare const rawArgs: unique symbol;
type rawArgs = typeof rawArgs;

declare const unset: unique symbol;
declare const _: unique symbol;

export type unset = typeof unset;
export type _ = typeof _;
```

- **User-facing trigger**: User composes functions with `Pipe<value, fns>` or `Call<fn, arg0, arg1, ...>` using partial application with `_` placeholder.
- **Resulting error message**: If placeholders are mixed incorrectly (e.g., `Call<Numbers.Add<_>, "not a number">`), the `MergeArgs` type fails with `never` because the constraint `number | bigint` is violated. Hover shows constraint mismatch.
- **Applicability to pipesafe**: 4 — Pipesafe's stage parameter slots (`group`, `match`, `set`) use similar nominal symbols to distinguish placeholder contexts. The `unset` pattern prevents accidental arg elision in aggregation pipelines.

---

### T5: Overload Ladders + Constraint Short-Circuit

- **Category**: T5
- **File**: src/internals/core/Core.ts:99-107
- **Snippet**:

```typescript
export type Call<
  fn extends Fn,
  arg0 = _,
  arg1 = _,
  arg2 = _,
  arg3 = _,
> = (fn & {
  [rawArgs]: ExcludePlaceholders<[arg0, arg1, arg2, arg3]>;
})["return"];
```

- **User-facing trigger**: User chains functions with `Call<Fn, ...args>`. If a function's internal `Fn.return` computes to `never` (constraint violated), that `never` propagates back as the type of the entire expression.
- **Resulting error message**: "Type X is not assignable to type Y" where Y is the expected return type, but the actual is `never` due to a prior constraint failure in the called function.
- **Applicability to pipesafe**: 5 — Pipesafe's `Pipeline.ts` uses similar variadic generics for stage chaining. Adding constraint checks at each stage boundary would catch malformed field references or document structure mismatches early.

---

### T2: Template-Literal String Parsing with Position Awareness

- **Category**: T2
- **File**: src/internals/strings/impl/split.ts:28-36
- **Snippet**:

```typescript
export type Split<Str, Sep extends string, Seps = H.UnionToTuple<Sep>> =
  Seps extends string[] ?
    Str extends string ?
      SplitManySep<Str, Seps>
    : []
  : [];
```

- **User-facing trigger**: User calls `Strings.Split<"a.b.c", ".">` or a composition like `Pipe<"a.b.c", [Strings.Split<".">, ...]>`.
- **Resulting error message**: If the first parameter is not a string, the type returns `[]` (empty tuple). IDE hovers show the type narrowing decision and why an empty result was inferred.
- **Applicability to pipesafe**: 3 — Pipesafe's `fieldReference.ts` parses dot-notation paths like `"user.address.city"`. A similar template-literal FSM could capture position of parse errors (e.g., "Invalid reference after index 5 in 'user.address..city'").

---

### T10: Prettify for Result Flattening

- **Category**: T10
- **File**: src/internals/helpers.ts:41
- **Snippet**:

```typescript
export type Prettify<T> = { [K in keyof T]: T[K] } | never;
```

- **User-facing trigger**: Operations like `Objects.Assign<[objA, objB, objC]>` or `Tuples.GroupBy` that accumulate object intersections.
- **Resulting error message**: Hover on the result shows flattened object with all keys visible instead of nested intersections. If merging conflicting keys, the last one wins and is shown in the pretty form.
- **Applicability to pipesafe**: 3 — Pipesafe's `group.ts` and `set.ts` accumulate nested object shapes. A `Prettify` pass would make hover tooltips on accumulated stage outputs far more readable, improving DX for large pipelines.

---

## Negative results

- **No explicit error message types** (like ArkType's `ErrorMessage<msg>` sentinel): HotScript relies entirely on constraint failures (returning `never`) rather than typed error strings. This makes errors less context-aware.
- **No state machine with finalizer slot** (like ArkType's `StaticState`): String operations use plain template literals without positional error accumulation.
- **No JSDoc deprecation markers** (@deprecated, @hidden): All APIs are current; no soft migration path is documented.
- **No declared/inferred mismatch objects** (like T15): No introspection of what was inferred vs. declared by users.

## Cross-references

- HotScript's type-level error strategy is **minimalist**: rely on the TypeScript compiler's constraint checking rather than custom error types. This trades rich error messages for simplicity and faster compilation.
- The **`Fn` interface with `rawArgs` symbol** (T11) is the centerpiece. All error propagation flows through `Fn.return` becoming `never` on constraint violation.
- **Pipe type safety** is implicit: if stage N outputs type X but stage N+1 expects type Y, the call to `Apply<stageN+1, [X]>` fails constraint checking silently, yielding `never`.
- **Lack of position tracking** in string operations (T2) means error messages don't pinpoint where in a path or pattern the problem occurred—just that the overall parse failed.
- For **pipesafe integration**: the `arg<N, Constraint>` pattern is immediately applicable to match/group/set stages, and Prettify should wrap all stage accumulation results.
