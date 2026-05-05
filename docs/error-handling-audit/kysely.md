# Kysely — Error DX Audit

## Metadata

- Repo: kysely-org/kysely
- Commit: d13d90b724bfdee3eb40ef5144d9d063701af973
- Domain similarity to pipesafe (1-5): 5 (Kysely is a typed query builder with deeply generic column reference and filtering systems; nearly identical problem domain to pipesafe's field references and stage composition)
- LOC of types audited: ~41,200 total; ~7,000+ in type-utils.ts, parser/, and query-builder/

## Search hit summary

| Pattern                                 | Hits            | Notable files                                                                                          |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `Error<` (KyselyTypeError<)             | 27              | type-error.ts, type-utils.ts, query-builder/\*, function-module.ts, case-builder.ts                    |
| `extends \`` (template-literal parsing) | 35              | select-parser.ts, reference-parser.ts, table-parser.ts, with-parser.ts                                 |
| `@deprecated`                           | 36              | order-by-parser.ts, select-query-builder.ts, delete-query-builder.ts, expression-builder.ts            |
| `unique symbol`                         | 7               | type-utils.ts (NotNull tracking), kysely.ts, dialect drivers                                           |
| `Simplify`/`Prettify`                   | 72+             | helpers/\*, query results, type-utils.ts                                                               |
| Overload ladders                        | 5+              | select-query-builder.ts (select<>, distinctOn<>), case-builder.ts (when<>), function-module.ts (any<>) |
| Invalid column / never resolution       | 4 core patterns | reference-parser.ts, binary-operation-parser.ts, select-parser.ts                                      |

## Techniques found

### T1: Branded Type Error Returns (KyselyTypeError)

- **Category**: T1 (Typed Error Returns)
- **File**: src/util/type-error.ts:1
- **Snippet**:

```typescript
export interface KyselyTypeError<E extends string> {
  readonly __kyselyTypeError__: E;
}
```

- **User-facing trigger**: Passing wrong arguments to `case().when()`, `$asTuple()`, `.any()`, `.jsonPath()`, `.narrowType()`, or using a filter object when no table context exists
- **Resulting error message**: "when(lhs, op, rhs) is not supported when using case(value)" | "$asTuple() call failed: All selected columns must be provided as arguments" | "there are no tables in query context, so a filter object cannot be defined"
- **Applicability to pipesafe**: 5 — Direct parallel to pipesafe's match.ts and fieldReference.ts; using a branded interface like `__kyselyTypeError__` would replace pipesafe's current implicit `never` resolution with explicit error signals for invalid operators or invalid paths

### T2: Template-Literal Column Reference Parsing (extends `...`)

- **Category**: T2 (Template-Literal Positional Errors) / T8 (String DSL Parser)
- **File**: src/parser/reference-parser.ts:82–156, src/parser/select-parser.ts:91–156
- **Snippet**:

```typescript
export type ExtractTypeFromStringReference<
  DB,
  TB extends keyof DB,
  RE extends string,
  DV = unknown,
> =
  RE extends `${infer SC}.${infer T}.${infer C}` ?
    `${SC}.${T}` extends TB ?
      C extends keyof DB[`${SC}.${T}`] ?
        DB[`${SC}.${T}`][C]
      : never // ← Invalid column name resolves to never
    : never
  : RE extends `${infer T}.${infer C}` ?
    T extends TB ?
      C extends keyof DB[T] ?
        DB[T][C]
      : never
    : never
  : RE extends AnyColumn<DB, TB> ? ExtractColumnType<DB, TB, RE>
  : DV;
```

- **User-facing trigger**: Passing `'invalid.column.name'` to `.select()`, `.where()`, or `.orderBy()` with a string reference
- **Resulting error message**: Column resolves to `never`; IDE shows type mismatch when assigning result
- **Applicability to pipesafe**: 5 (CRITICAL) — This is the **exact pattern** pipesafe needs for fieldReference.ts. Kysely parses dotted paths at the type level with template literals to extract schema, table, and column names, returning `never` for invalid paths. Pipesafe should adopt the same multi-level template-literal parsing for `$path.to.field` validation instead of current implicit-never behavior

### T3: Conditional Degradation via Never Checks (IsNever<TB>)

- **Category**: T4 (Conditional Return-Type Degradation)
- **File**: src/parser/binary-operation-parser.ts:67–76
- **Snippet**:

```typescript
export type FilterObject<DB, TB extends keyof DB> =
  IsNever<TB> extends true ?
    KyselyTypeError<"there are no tables in query context, so a filter object cannot be defined. try passing an array instead.">
  : {
      [R in StringReference<DB, TB>]?: ValueExpressionOrList<
        DB,
        TB,
        SelectType<ExtractTypeFromStringReference<DB, TB, R>>
      >;
    };
```

- **User-facing trigger**: Calling `.where({...})` with a filter object when `selectFrom()` has no table context
- **Resulting error message**: "there are no tables in query context, so a filter object cannot be defined. try passing an array instead."
- **Applicability to pipesafe**: 3 — Applicable to Pipeline.ts and group.ts stage-ordering validation; `IsNever<>` checks can detect when stage composition has lost critical context (e.g., groupBy called before select) and return a branded error type instead of silent `never`

### T4: Overload Ladders for Arity Escalation & Error Injection

- **Category**: T5 (Overload Ladders with Type Inference Recovery)
- **File**: src/query-builder/select-query-builder.ts:373–383, src/query-builder/case-builder.ts:32–49, 115–132, 221–248
- **Snippet**:

```typescript
// Three overloads to handle array, callback, or single selection
select<SE extends SelectExpression<DB, TB>>(
  selections: ReadonlyArray<SE>,
): SelectQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>

select<CB extends SelectCallback<DB, TB>>(
  callback: CB,
): SelectQueryBuilder<DB, TB, O & CallbackSelection<DB, TB, CB>>

select<SE extends SelectExpression<DB, TB>>(
  selection: SE,
): SelectQueryBuilder<DB, TB, O & Selection<DB, TB, SE>>
```

Combined with case().when() example:

```typescript
when<RE extends ReferenceExpression<DB, TB>, VE extends OperandValueExpressionOrList<DB, TB, RE>>(
  lhs: unknown extends W
    ? RE
    : KyselyTypeError<'when(lhs, op, rhs) is not supported when using case(value)'>,
  op: ComparisonOperatorExpression,
  rhs: VE,
): CaseThenBuilder<DB, TB, W, O>
```

- **User-facing trigger**: Calling `.case().when(lhs, op, rhs)` when case(value) was used (W is not unknown) or calling `.case(value).when(value)` when case() was used (W is unknown)
- **Resulting error message**: "when(lhs, op, rhs) is not supported when using case(value)" or "when(value) is only supported when using case(value)"
- **Applicability to pipesafe**: 4 — The conditional parameter injection pattern is powerful for pipesafe's match.ts (restrict operators based on prior operator selection) and set.ts (restrict dotted-key assignments based on schema context). Overload ladders also improve IDE autocomplete for multi-step building

### T5: Type-Safe Column Narrowing via Branded Symbol (NotNull)

- **Category**: T11 (Branded/Phantom Symbols for Tracking)
- **File**: src/util/type-utils.ts:185, 156–168
- **Snippet**:

```typescript
export type NotNull = { readonly __notNull__: unique symbol };

export type NarrowPartial<O, T> = DrainOuterGeneric<
  T extends object ?
    {
      [K in keyof O & string]: K extends keyof T ?
        T[K] extends NotNull ? Exclude<O[K], null>
        : T[K] extends O[K] ? T[K]
        : KyselyTypeError<`$narrowType() call failed: passed type does not exist in '${K}'s type union`>
      : O[K];
    }
  : never
>;
```

- **User-facing trigger**: Calling `.$narrowType<{ nullable_column: NotNull }>()` after `.where('nullable_column', 'is not', null)`
- **Resulting error message**: "passed type does not exist in 'K's type union"
- **Applicability to pipesafe**: 3 — The `NotNull` brand pattern could extend pipesafe's type narrowing in complex aggregation pipelines; instead of runtime null checks, types could be marked as narrowed post-$match

### T6: Hover-Flattening via Simplify<T> for Result Readability

- **Category**: T10 (Hover-Flattening)
- **File**: src/util/type-utils.ts:126, helpers/postgres.ts:61, helpers/mysql.ts:63
- **Snippet**:

```typescript
export type Simplify<T> = DrainOuterGeneric<{ [K in keyof T]: T[K] } & {}>

// Applied in helpers:
): RawBuilder<Simplify<ShallowDehydrateObject<O>>[]> {
```

- **User-facing trigger**: Hovering over result types in `sql()` helpers or raw result building
- **Resulting error message**: Displays flattened object type instead of nested intersections (e.g., `{ id: number; name: string }` instead of `{ id: number } & { name: string }`)
- **Applicability to pipesafe**: 2 — Lower priority for pipesafe, but `Simplify<>` and `DrainOuterGeneric<>` would improve IDE hover readability for complex accumulated stage types in Pipeline.ts

### T7: Deprecation Markers with Compile-Time Warnings

- **Category**: T12 (JSDoc Deprecation Markers)
- **File**: src/query-builder/select-query-builder.ts:1098, delete-query-builder.ts:727–747, order-by-parser.ts:44, 52, 58
- **Snippet**:

```typescript
/**
 * @deprecated It does ~2-2.6x more compile-time instantiations compared to multiple chained `orderBy(expr, modifiers?)` calls
 */
orderByUsingAll<R extends ReadonlyArray<OrderByItem<any>>>(
  items: R,
): ...
```

- **User-facing trigger**: Using old `orderByUsingAll()` or array-based ordering APIs
- **Resulting error message**: IDE shows strikethrough, deprecation warning, and hover tooltip with migration guidance
- **Applicability to pipesafe**: 2 — Useful for guiding users away from slow aggregation patterns (e.g., deprecated baggy $set patterns in favor of strict dotted-key updates)

## Negative results

- **No `never &` tricks**: Kysely does not use tuple-error patterns like `[never, "error"]` or intersection errors (`never & {message}`). It favors explicit `KyselyTypeError<>` interfaces.
- **No State Machine with Finalizer Slot (T3)**: Unlike ArkType, Kysely has no runtime+compile-time state machine for DSL parsing; template literals handle all column/table/alias parsing without a separate finalizer tracking mechanism.
- **No `r extends infer _ ? _ : never` forcing**: Kysely's overloads use direct conditional type narrowing without the aggressive inference-forcing technique.
- **No custom zero-width sentinel**: Unlike ArkType's `ZeroWidthSpace` (U+200B), Kysely embeds errors in branded interface `__kyselyTypeError__` key, which is simpler and avoids string-collision risks.

## Cross-references

**Kysely patterns that directly map to pipesafe pain points:**

- **fieldReference.ts** (invalid `$path.to.field` resolves to `never`): → Use Kysely's template-literal column parsing (T2) with multi-stage path extraction + branded `KyselyTypeError<>` returns instead of silent `never`
- **match.ts** (ComparatorMatchers swallows wrong operators in huge unions): → Use Kysely's conditional overload parameter injection (T4) to restrict operator choices based on prior match-stage state
- **set.ts** (dotted-key conflicts merge silently): → Combine T2 template-literal parsing with T1 branded error types to validate dotted-key assignments against schema and reject duplicates at compile-time
- **group.ts** (wrong aggregator operand type produces full-union mismatch): → Apply conditional degradation (T3) to check aggregator function constraints and return `KyselyTypeError<>` instead of giant union fallback
- **Pipeline.ts** (stage-ordering cryptic): → Use deprecation markers (T7) + branded error overloads to guide users toward correct stage sequences (select before where before groupBy, etc.)

**Kysely's strongest DX wins:**

1. **Branded error interface** (`KyselyTypeError<E extends string>`) — simple, portable, composable
2. **Multi-level template-literal parsing** for column/table/schema reference validation — exact fit for pipesafe's `$path.to.field` problem
3. **Overload ladders with conditional parameter injection** — powerful for context-aware method signatures (case()/case(value) duality mirrors operator mode toggles)
4. **Simplify<> / DrainOuterGeneric<>** for hover readability — low-cost, high-impact for complex deeply-nested generic types
