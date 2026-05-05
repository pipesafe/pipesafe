# Drizzle ORM — Error DX Audit

## Metadata
- Repo: drizzle-team/drizzle-orm
- Commit: latest (audited drizzle-orm/src/ directory)
- Domain similarity to pipesafe (1-5): 5 (Drizzle is a typed query builder with deeply nested generic relational query inference; the `db.query.users.findMany({ with: { posts: true }})` pattern and column validation directly parallel pipesafe's fieldReference and match composition)
- LOC of types audited: ~12,500 in core utils.ts, query-builders/, relations.ts, sql/, sqlite-core/query-builders/

## Search hit summary
| Pattern | Hits | Notable files |
|---------|------|----------------|
| `DrizzleTypeError<` | 25 | utils.ts, sqlite-core/query-builders/*, gel-core/query-builders/*, select.types.ts |
| `@deprecated` | 519+ | sql/sql.ts, sqlite-core/table.ts, column-builder.ts, primary-keys.ts, foreign-keys.ts |
| `Simplify`/`SimplifyMappedType` | 33 | utils.ts, relations.ts, select.types.ts, table.ts |
| Brand markers (`brand: 'Column'`, `$brand: 'Relation'`) | 10 core patterns | column.ts, relations.ts, sql/sql.ts, subquery.ts, table.ts |
| Union detection (IsUnion, IsNever) | 6 core patterns | utils.ts, select.types.ts (used in FromSingleKeyObject, SingleKeyObject) |
| Template-literal resolution (never fallback) | 4 core patterns | select.types.ts (BuildSubquerySelection), query-builders/ |
| Overload method hoisting (excludedMethods) | 8+ patterns | gel-core/query-builders/delete.ts, update.ts, insert.ts |

## Techniques found

### T1: Branded Type Error Returns (DrizzleTypeError)
- **Category**: T1 (Typed Error Returns)
- **File**: src/utils.ts:174–176, 244–247
- **Snippet**:
```typescript
export interface DrizzleTypeError<T extends string> {
  $drizzleTypeError: T;
}

// Usage in ValidateShape:
export type ValidateShape<T, ValidShape, TResult = T> = T extends ValidShape
  ? Exclude<keyof T, keyof ValidShape> extends never ? TResult
  : DrizzleTypeError<
      `Invalid key(s): ${Exclude<(keyof T) & (string | number | bigint | boolean | null | undefined), keyof ValidShape>}`
    >
  : never;
```
- **User-facing trigger**: Passing invalid keys to config objects (e.g., config shapes with unknown keys; misspelled `.returning()` alternative method names)
- **Resulting error message**: "Invalid key(s): someKey" or method-call-specific errors like ".all() cannot be used without .returning()"
- **Applicability to pipesafe**: 5 — Direct application to match.ts, set.ts, and fieldReference.ts. Replace current implicit `never` returns with explicit `DrizzleTypeError<msg>` when invalid keys are detected. Example: `set({ invalid_field: true })` would return `DrizzleTypeError<'Invalid key(s): invalid_field'>` instead of silently failing

### T2: Union-Aware Key Filtering (SingleKeyObject / FromSingleKeyObject)
- **Category**: T6 (Constraint-Side Validation) + T4 (Conditional Degradation)
- **File**: src/utils.ts:158–164, src/query-builders/select.types.ts:60–64
- **Snippet**:
```typescript
export type IsUnion<T, U extends T = T> = (T extends any ? (U extends T ? false : true) : never) extends false ? false
  : true;

export type IsNever<T> = [T] extends [never] ? true : false;

export type SingleKeyObject<T, TError extends string, K = keyof T> = IsNever<K> extends true ? never
  : IsUnion<K> extends true ? DrizzleTypeError<TError>
  : T;

// Applied:
export type FromSingleKeyObject<T, Result, TError extends string, K = keyof T> = IsNever<K> extends true ? never
  : IsUnion<K> extends true ? DrizzleTypeError<TError>
  : Result;
```
- **User-facing trigger**: Calling `.select(subquery)` where the subquery has multiple columns without explicitly selecting one; attempting to select from a subquery that hasn't been aliased uniquely
- **Resulting error message**: "You can only select one column in the subquery"
- **Applicability to pipesafe**: 4 — Core pattern for pipesafe's group.ts and fieldReference.ts. When a field reference is ambiguous (union of possible types), return a branded error instead of falling back to `any` or `unknown`. Example: `$group({_id: '$ambiguousPath'})` where `ambiguousPath` could refer to multiple fields would error with "Ambiguous field reference; use explicit dotted path"

### T3: Conditional Method Exclusion via State (excludedMethods)
- **Category**: T4 (Conditional Degradation) + custom pattern for method-sequencing DX
- **File**: src/gel-core/query-builders/delete.ts:23–37, src/sqlite-core/query-builders/delete.ts:17–32
- **Snippet**:
```typescript
export type GelDeleteWithout<
  T extends AnyGelDeleteBase,
  TDynamic extends boolean,
  K extends keyof T & string,
> = TDynamic extends true ? T
  : Omit<
      GelDeleteBase<
        T['_']['table'],
        T['_']['queryResult'],
        T['_']['returning'],
        TDynamic,
        T['_']['excludedMethods'] | K
      >,
      T['_']['excludedMethods'] | K
    >;

// Result type for prepared queries:
export type SQLiteDeletePrepare<T extends AnySQLiteDeleteBase> = SQLitePreparedQuery<{
  type: T['_']['resultType'];
  run: T['_']['runResult'];
  all: T['_']['returning'] extends undefined ? DrizzleTypeError<'.all() cannot be used without .returning()'>
    : T['_']['returning'][];
  get: T['_']['returning'] extends undefined ? DrizzleTypeError<'.get() cannot be used without .returning()'>
    : T['_']['returning'] | undefined;
  values: T['_']['returning'] extends undefined ? DrizzleTypeError<'.values() cannot be used without .returning()'>
    : any[][];
}>;
```
- **User-facing trigger**: Calling `.all()` / `.get()` / `.values()` on a delete/update/insert query that does not have `.returning()` clauses
- **Resulting error message**: ".all() cannot be used without .returning()" in the prepared query result type
- **Applicability to pipesafe**: 5 (HIGH) — Directly applicable to Pipeline.ts stage sequencing and match.ts operator restrictions. Using `excludedMethods` + branded error returns would prevent invalid stage chains (e.g., `pipeline.match(...).match(...)` without intermediate stages) and invalid operator sequences. Example: After `.eq()`, calling `.regex()` would return a branded error in the method signature instead of falling back to `never`

### T4: Multi-Branch Template-Literal Column Resolution
- **Category**: T2 (Template-Literal Positional Errors) + T8 (String DSL Parser)
- **File**: src/query-builders/select.types.ts:116–131
- **Snippet**:
```typescript
export type BuildSubquerySelection<
  TSelection extends ColumnsSelection,
  TNullability extends Record<string, JoinNullability>,
> = TSelection extends never ? any
  :
    & {
        [Key in keyof TSelection]: TSelection[Key] extends SQL
          ? DrizzleTypeError<'You cannot reference this field without assigning it an alias first - use `.as(<alias>)`'>
          : TSelection[Key] extends SQL.Aliased ? TSelection[Key]
          : TSelection[Key] extends Table ? BuildSubquerySelection<TSelection[Key]['_']['columns'], TNullability>
          : TSelection[Key] extends Column
            ? ApplyNullabilityToColumn<TSelection[Key], TNullability[TSelection[Key]['_']['tableName']]>
          : TSelection[Key] extends ColumnsSelection ? BuildSubquerySelection<TSelection[Key], TNullability>
          : never;
      }
      & {};
```
- **User-facing trigger**: Including a raw SQL fragment in a subquery selection without an alias; attempting to select from a table without specifying which columns
- **Resulting error message**: "You cannot reference this field without assigning it an alias first - use `.as(<alias>)`"
- **Applicability to pipesafe**: 4 — Direct pattern for pipesafe's fieldReference.ts. Template-literal chains can validate `$path.to.field` multi-segment references by checking existence at each level, returning specific error messages for missing intermediate tables or columns instead of generic `never`

### T5: Nullable Column Inference & Nullability Mapping
- **Category**: T7 (Inference Capture and Mismatch Detection)
- **File**: src/query-builders/select.types.ts:13–27, 137–147
- **Snippet**:
```typescript
export type ApplyNullability<T, TNullability extends JoinNullability> = TNullability extends 'nullable' ? T | null
  : TNullability extends 'null' ? null
  : T;

export type ApplyNullabilityToColumn<TColumn extends Column, TNullability extends JoinNullability> =
  TNullability extends 'not-null' ? TColumn
    : Column<
        Assume<
          UpdateColConfig<TColumn['_'], {
            notNull: TNullability extends 'nullable' ? false : TColumn['_']['notNull'];
          }>,
          ColumnBaseConfig<ColumnDataType, string>
        >
      >;

export type ApplyNotNullMapToJoins<TResult, TNullabilityMap extends Record<string, JoinNullability>> =
  & {
      [TTableName in keyof TResult & keyof TNullabilityMap & string]: ApplyNullability<
        TResult[TTableName],
        TNullabilityMap[TTableName]
      >;
    }
    & {};
```
- **User-facing trigger**: Accessing a column from a left-joined table without narrowing via `.where()`; the type system updates nullability based on join type (left join adds `| null`)
- **Resulting error message**: Type narrowing automatically adjusts column types post-join; hovering shows `Column<{..., notNull: false}>`
- **Applicability to pipesafe**: 3 — Useful for stage composition in Pipeline.ts. After a `$match` that filters records, types could narrow to exclude `null` values automatically. After a `$lookup` (left join equivalent), types could widen to include `null | undefined` for optional fields

### T6: Symbol-Based Branding for Type Tracking
- **Category**: T11 (Branded/Phantom Symbols for Tracking)
- **File**: src/column.ts:26, src/sql/sql.ts:107–108, src/relations.ts:36–37, 57
- **Snippet**:
```typescript
// Column type config:
export type ColumnTypeConfig<T extends ColumnBaseConfig<ColumnDataType, string>, TTypeConfig extends object> = T & {
  brand: 'Column';
  tableName: T['tableName'];
  name: T['name'];
  dataType: T['dataType'];
  // ... other tracked metadata
};

// SQL type:
declare _: {
  brand: 'SQL';
  type: T;
};

// Relation markers:
declare readonly $brand: 'Relation';
declare readonly $brand: 'Relations';
```
- **User-facing trigger**: IDE shows that a value originated from a Column, SQL expression, or Relation when hovering or inspecting types
- **Resulting error message**: No error; helps developers trace type origins for debugging complex query chains
- **Applicability to pipesafe**: 2 — Lower priority, but adding `__brand: 'FieldReference'` and `__brand: 'MatchExpression'` to pipesafe types would improve IDE tooltips and error debugging when tracing type mismatches through complex pipeline compositions

### T7: Deprecation Warnings on Old APIs
- **Category**: T12 (JSDoc Deprecation Markers)
- **File**: src/sql/sql.ts:331, 336, 396, 452, 502, 607; src/table.ts:189; src/sqlite-core/table.ts:90, 126
- **Snippet**:
```typescript
/** @deprecated Use one of the alternatives: {@link InferSelectModel} / {@link InferInsertModel}, or `table.$inferSelect` / `table.$inferInsert` */
export type InferModel<
  TTable extends Table,
  TInferMode extends 'select' | 'insert' = 'select',
> = ...

/**
 * @deprecated Use `sql.identifier` instead.
 */
export function name(value: string): Name { ... }

/**
 * @deprecated The third parameter of sqliteTable is changing and will only accept an array instead of an object
 */
function sqliteTable<const T extends Record<string, ColumnBuilderBaseConfig>>(
  name: string,
  columns: T,
  config?: unknown,
): ...
```
- **User-facing trigger**: Using old `InferModel<>` type, `name()` function, or old object-based config syntax
- **Resulting error message**: IDE strikethrough, deprecation warning in hover tooltip, migration hint
- **Applicability to pipesafe**: 3 — Useful for soft-migrating from loose aggregation patterns (e.g., deprecate baggy `$set` object syntax in favor of strict typed field updaters; deprecate old match operator modes in favor of new branded conditionals)

## Negative results

- **No explicit State Machine with Finalizer Slot (T3)**: Unlike ArkType, Drizzle does not thread errors through a stateful parser; instead, constraint-side validation and conditional returns handle errors inline
- **No `r extends infer _ ? _ : never` forcing pattern**: Drizzle does not use aggressive inference recovery; conditional types settle directly without the forcing trick
- **No ZeroWidthSpace sentinel**: Drizzle uses branded interface properties (`$drizzleTypeError`, `brand`) instead of invisible markers; simpler and avoids string-collision risks
- **Limited template-literal DSL parsing**: Drizzle does not parse complex type strings at compile-time; instead, it validates column/table/alias references via direct record lookups and conditional type branching
- **No generic context binding errors (T14)**: Drizzle does not validate generic argument counts or types; it relies on TypeScript's native generic checking

## Cross-references

**Drizzle patterns that directly map to pipesafe pain points:**

- **fieldReference.ts** (current implicit `never` on invalid paths): → Use Drizzle's branded `DrizzleTypeError<>` + multi-branch template-literal column resolution (T4) to return explicit "Invalid field path: 'path.to.missing'" instead of silent `never`

- **match.ts** (operator unions swallow invalid operators): → Use Drizzle's `excludedMethods` state machine (T3) pattern combined with branded error returns to prevent invalid operator sequences. After `.eq()`, `.regex()` would not be callable; the type signature would return `DrizzleTypeError<'.regex() is not supported after .eq()'>` 

- **set.ts** (dotted-key conflicts, schema mismatches): → Combine Drizzle's `ValidateShape<>` key validation (T1) with `SingleKeyObject<>` union detection (T2) to catch duplicate field assignments and schema mismatches at compile-time, returning branded errors instead of silent overwrites

- **group.ts** (wrong aggregator operand type): → Apply Drizzle's conditional degradation pattern (T3) + nullable column inference (T5) to validate aggregator function constraints. Example: `.sum($field)` where `$field` is non-numeric would return `DrizzleTypeError<'sum() requires a numeric field; field is string'>` instead of cascading type errors

- **Pipeline.ts** (stage sequencing, deep nesting): → Use deprecation markers (T7) + `excludedMethods` state tracking (T3) to enforce stage ordering rules and guide users toward valid sequences. Example: deprecate `.match(...).match(...)` without intermediate stages; flag invalid stage chains at compile-time

**Drizzle's strongest DX wins:**

1. **Branded error interface** (`DrizzleTypeError<E extends string>`) with `$drizzleTypeError` property — portable, composable, avoids string collisions
2. **Union detection + conditional degradation** (`IsUnion<K>` + `SingleKeyObject<>`) — elegant pattern for catching ambiguous or invalid multi-key references
3. **State-based method exclusion** (`excludedMethods` pattern) — powerful for enforcing build-chain sequences and preventing invalid method calls based on prior state
4. **Multi-branch conditional column resolution** in `BuildSubquerySelection<>` — direct template-literal approach to validating nested field references
5. **Nullable column inference with join-type tracking** — demonstrates how types can propagate context (join type → nullability) through complex query chains, applicable to pipesafe's stage composition

