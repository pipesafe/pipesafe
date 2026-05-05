# Effect — Error DX Audit

## Metadata

- Repo: Effect-TS/effect
- Commit: 70ce155cd73a3b4cd723fe955454b5837b428f76
- Domain similarity to pipesafe (1-5): 4 — Effect's `Effect<A, E, R>` three-channel encoding and Schema validation errors directly parallel pipesafe's aggregation pipeline constraints and error propagation
- LOC of types audited: ~187,839 (packages/effect/src)

## Search hit summary

| Pattern                                                    | Hits | Notable files                                           |
| ---------------------------------------------------------- | ---: | ------------------------------------------------------- |
| `Error<`                                                   |   88 | Effect.ts, Request.ts, ParseResult.ts, LayerMap.ts      |
| `Invalid_` / `Invalid<`                                    |    0 | —                                                       |
| `[never,`                                                  |    0 | —                                                       |
| `& { __`                                                   |    0 | —                                                       |
| `extends \`Error`                                          |    0 | —                                                       |
| `@deprecated`                                              |   29 | Multiple files                                          |
| Mismatch/Failed/Failure/TypeError/Conflict/NotAssignable   |   20 | FiberRef.ts, Layer.ts                                   |
| `__brand` / `__tag` / `_tag:` / `__type` / `unique symbol` | 1285 | FiberMap.ts, Request.ts, List.ts, Context.ts, Schema.ts |
| `, never]`                                                 |    0 | —                                                       |
| `: never &` / `never & {`                                  |    0 | —                                                       |
| `extends \``                                               |    3 | Schema.ts                                               |
| `Prettify` / `Simplify` / `Compute` / `Expand`             |  103 | Schema.ts, Struct.ts, HashSet.ts                        |

## Techniques found

### Symbol-Based Type Tracking via `unique symbol` Identifiers

- **Category**: T11 (Symbol-Based Tracking)
- **File**: packages/effect/src/Context.ts:24, packages/effect/src/Effect.ts:81, packages/effect/src/Unify.ts:10
- **Snippet**:

  ```ts
  export const EffectTypeId: unique symbol = core.EffectTypeId;
  export type EffectTypeId = typeof EffectTypeId;

  export interface Effect<out A, out E = never, out R = never>
    extends Effect.Variance<A, E, R>, Pipeable {
    readonly [Unify.typeSymbol]?: unknown;
    readonly [Unify.unifySymbol]?: EffectUnify<this>;
    readonly [Unify.ignoreSymbol]?: EffectUnifyIgnore;
  }
  ```

- **User-facing trigger**: When an Effect type flows through type inference in a complex union/intersection context, the `typeSymbol` and `unifySymbol` properties guide TypeScript to normalize the result type without showing intermediate intersections.
- **Resulting error message**: IDE hovers show a unified `Effect<A, E, R>` instead of nested `Effect<...> & Effect<...> & ...`
- **Applicability to pipesafe**: 5 — Pipeline.ts aggregation stages are deeply nested generics where this symbol-based unification would eliminate `never` phantom branches and surface only valid stage configurations in IDE.

### Multipart Error Surface via Tagged Union + Position Info

- **Category**: T13 (Error Accumulation vs. Short-Circuit) + T2 (Template-Literal Positional Errors)
- **File**: packages/effect/src/ParseResult.ts:29-40, 57-66
- **Snippet**:

  ```ts
  export type ParseIssue =
    | Type
    | Missing
    | Unexpected
    | Forbidden
    | Pointer
    | Refinement
    | Transformation
    | Composite;

  export class Pointer {
    readonly _tag = "Pointer";
    constructor(
      readonly path: Path,
      readonly actual: unknown,
      readonly issue: ParseIssue
    ) {}
  }
  ```

- **User-facing trigger**: When a Schema parse/decode fails, the error is a tree of `ParseIssue` variants tagged by `_tag`, with `Pointer` wrapping nested issues at specific paths (e.g., `data.field[0].nestedProp`).
- **Resulting error message**: TreeFormatter renders a hierarchical error tree showing path + type mismatch at each level, e.g. `data.field: Expected string, got number`
- **Applicability to pipesafe**: 4 — match.ts and fieldReference.ts both accumulate path-based errors (e.g., `$field[0].nested`); this pattern would allow reporting multiple stage violations in a single tree instead of short-circuiting at the first.

### Inference Extraction via Constraint Equality Check

- **Category**: T7 (Inference Capture and Mismatch Detection)
- **File**: packages/effect/src/Types.ts:144-147
- **Snippet**:
  ```ts
  export type Equals<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true
    : false;
  ```
- **User-facing trigger**: Used internally in Effect to compare inferred generic parameters against declared constraints; if inferred ≠ declared, the type system fails the constraint.
- **Resulting error message**: TS compiler: "Type 'InferredType' is not assignable to 'DeclaredType'"
- **Applicability to pipesafe**: 5 — set.ts dotted-key merge conflicts and group.ts operand type mismatches involve comparing a computed union against an allowed schema. This pattern enables silent detection of divergence before runtime.

### Hover Flattening via Intersection Normalization (`Simplify`)

- **Category**: T10 (Hover-Flattening via `show<T>`)
- **File**: packages/effect/src/Schema.ts:59, packages/effect/src/Types.ts:126-128
- **Snippet**:

  ```ts
  export type Simplify<A> = { [K in keyof A]: A[K] } & {};

  export type SimplifyMutable<A> =
    {
      -readonly [K in keyof A]: A[K];
    } extends infer B ?
      B
    : never;
  ```

- **User-facing trigger**: When a `Schema<T>` is constructed from multiple composable fields or intersections, `Simplify` normalizes the result so IDE hovers display `{ a: number; b: string }` instead of `{ a: number } & { b: string }`.
- **Resulting error message**: Clean, flattened object display in IDE without intersection artifacts.
- **Applicability to pipesafe**: 4 — Pipeline.ts stage types accumulate constraints from multiple `andThen` / `match` calls; applying `Simplify` would make hover tooltips show the full computed stage type rather than deeply nested intersections.

### Type Extraction via Conditional Inference Ladder

- **Category**: T6 (Constraint-Side Validation)
- **File**: packages/effect/src/Effect.ts:252, packages/effect/src/Request.ts:69, 77, 85
- **Snippet**:

  ```ts
  export type Error<T extends Effect<any, any, any>> =
    [T] extends [Effect<infer _A, infer _E, infer _R>] ? _E : never;

  export type Success<T extends Request<any, any>> =
    [T] extends [Request<infer _A, infer _E>] ? _A : never;
  ```

- **User-facing trigger**: When a function returns `Effect<string, MyError, never>`, calling `Effect.Error<typeof result>` extracts `MyError` at the type level; if the input is not an Effect, the type is `never`.
- **Resulting error message**: If user tries to extract Error from a non-Effect type, TS shows "Type 'never' is not assignable to 'E'" in context.
- **Applicability to pipesafe**: 5 — fieldReference.ts path resolution and group.ts stage output type inference both need to extract intermediate types from deeply nested generics; this ladder pattern is essential for preserving type channel information through composition.

### Variant-Driven Error Constructors with Phantom Parameter Validation

- **Category**: T4 (Conditional Return-Type Degradation) + T1 (Typed Error Returns)
- **File**: packages/effect/src/Data.ts:580-590
- **Snippet**:
  ```ts
  export const TaggedError = <Tag extends string>(
    tag: Tag
  ): new <A extends Record<string, any> = {}>(
    args: Types.VoidIfEmpty<{
      readonly [P in keyof A as P extends "_tag" ? never : P]: A[P];
    }>
  ) => Cause.YieldableError & { readonly _tag: Tag } & Readonly<A> => {
    const O = {
      BaseEffectError: class extends Error<{}> {
        readonly _tag = tag;
      },
    };
    (O.BaseEffectError.prototype as any).name = tag;
    return O.BaseEffectError as any;
  };
  ```
- **User-facing trigger**: When a user constructs a custom error via `class MyError extends TaggedError("MyError")<{ data: string }>`, TypeScript validates that the object fields are legal (non-`_tag`) and creates a constructor with the right signature.
- **Resulting error message**: If fields collide with `_tag`, TS shows "Cannot use '\_tag' in error constructor".
- **Applicability to pipesafe**: 3 — pipeline stage errors (in Pipeline.ts) could use `TaggedError` to encode stage name + error payload; less critical than field/group errors but improves error composability.

## Negative results

- **`Invalid_` / `Invalid<`** — Effect does not use explicit "Invalid" error type naming; instead favors union types over string-tagged errors.
- **`[never,` / `, never]`** — No tuple-based error encoding in Effect's type-level validation; errors flow through `E` channel of `Effect<A, E, R>`.
- **`& { __`** — No phantom underscore-prefixed intersection members; Effect prefers symbol-keyed interfaces for branding.
- **`extends \`Error`** — No template-literal parsing at the type level for error schemas; Effect's Schema is AST-based, not string-DSL parsed.
- **Parse<> / Tokenize<>** — No recursive string parser in types; ParseResult uses runtime classes + formatter, not compile-time state machine.

## Cross-references

- Effect's **Error** extraction pattern (T6) is nearly identical to how ArkType extracts parse errors from recursive state machines, but Effect applies it to the three-channel `Effect<A, E, R>` encoding rather than string parsing.
- **Simplify** (T10) mirrors ArkType's `show<T>` utility for normalizing intersections; both libraries use `{ [K in keyof A]: A[K] } & {}` to flatten display.
- **TaggedError** and `_tag: string` pattern (T11) is shared across TypeScript ecosystem (zod, io-ts, ArkType); Effect's variant is a factory function that generates constructor types dynamically.
- **ParseIssue tree** (T13) resembles Zod's `ZodIssue[]` accumulation, but Effect's recursive `Pointer` wrapper is more compositional for deep path encoding.

---

## Summary

Effect excels at **three-channel type encoding** (`Effect<A, E, R>`) and **symbol-based unification** to avoid phantom type cruft in IDEs. Its Schema system uses **runtime + type-level error forests** (ParseIssue trees) to report nested validation failures with precise paths, rather than short-circuiting on the first error. The **Equals** constraint check and type extraction ladders are foundational for generic inference—critical for pipesafe's Pipeline composition where stage output types must flow into next-stage input constraints without user-facing errors from type incompatibility.

**Top 3 techniques for pipesafe:**

1. **Symbol-based Unification (T11)** — Use in Pipeline.ts to hide intermediate never-branches and show only valid stage chains in IDE hovers.
2. **Type Extraction via Conditional Inference (T6)** — Apply in fieldReference.ts and set.ts to extract intermediate path types through nested generics; enables type-safe `$field` resolution.
3. **Inference Equality Check (T7)** — Implement in match.ts ComparatorMatcher to validate operand types at constraint time, catching union mismatches before inference.
