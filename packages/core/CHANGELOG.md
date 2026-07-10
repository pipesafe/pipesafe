# @pipesafe/core

## 2.0.0

### Major Changes

- f488fa7: Type-system standardisation. Every stage now follows one convention —
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
  in the output schema. `$$`-system variables now infer as `unknown` instead
  of silently dropping the field from the output schema (`$$REMOVE` still
  removes), and are accepted in `$group` `_id`/accumulator positions
  (`$max: "$$NOW"` compiles); `$concat` validates its operands (typo'd
  `$`-refs and non-string refs brand instead of shipping); the
  trigonometry operators and `$toUUID` are allow-listed (no longer falsely
  brand as typos); unknown dotted `$project` inclusion keys brand instead of
  silently resolving to a `never` leaf.

  Breaking: `@pipesafe/manifold` now requires `@pipesafe/core` 2.x
  (peer dependency `>=2.0.0 <3.0.0`); `ResolveCountOutput` gained a `Schema`
  first type parameter; `MergeOptions` is REMOVED — use `MergeQuery`
  (deprecated aliases are no longer shipped; renames land in majors);
  several internal type names changed. Whole-project type instantiations
  drop ~40% for equivalent pipelines; a CI budget gate
  (`bun run budget:check`) now guards type-level performance.

### Minor Changes

- 1d856dd: Export the runtime operator-name vocabularies as authoritative const arrays: grouped match matcher arrays (with `FIELD_MATCH_OPERATORS` / `TOP_LEVEL_MATCH_OPERATORS` spread combinations), per-category expression operator arrays (with the `EXPRESSION_OPERATORS` spread and an `EXPRESSION_OPERATORS_BY_CATEGORY` record), and `ACCUMULATOR_OPERATORS`. The operator-key unions derive from these arrays by construction (`(typeof ARR)[number]`), and the registries conform to them via `satisfies` checks at the array declarations.
- 1d856dd: Fix IDE autocomplete across Pipeline call sites: match string/Date fields no longer leak RegExp/Date methods (symbol-keyed exact-value arms), `$elemMatch` offers element fields plus matchers and now accepts per-field element queries (`{ $elemMatch: { qty: { $gt: 5 } } }`), `$set`/`$project` suggest existing field selectors as keys while keeping arbitrary new keys legal, expression/accumulator value objects suggest only their operators (Date/ObjectId methods no longer leak), and `$group`'s `_id` suggests and accepts references to array/document fields (`{ _id: "$shipping" }`).
- 1d856dd: `$$`-system variables are now an enumerated vocabulary (new `SYSTEM_VARIABLES` export) accepted and autocompleted wherever the wide `$$` namespace used to be: `$set`/`$project` string values (which now also autocomplete field references), `$group` `_id` and accumulator operands, `$replaceRoot`'s `newRoot` (previously rejected system variables entirely), and the nested-validation kernel. An unlisted `$$variable` is rejected — as an `UnknownSystemVariableError` brand in nested positions or a "Did you mean" constraint error at top level — while `$let`/`$map`/`$filter`-bound user variables remain accepted inside the operand interiors that bind them. Aggregation-command-level `let` variables are not modeled yet.

### Patch Changes

- fbf7b47: Remove the internal test helper `useMemoryMongo` from the public entry point. It statically imported `mongodb-memory-server` and `vitest` (dev-only dependencies), so merely importing `@pipesafe/core` in ESM environments failed with `Cannot find package 'mongodb-memory-server'` unless consumers installed it themselves (#100).

## 1.1.0

### Minor Changes

- c4a8c92: `$lookup` now accepts mismatched array/scalar field types (`T[] → T` and `T → T[]`), matching MongoDB's element-wise semantics. When no foreign field is compatible, the constraint surfaces a branded `PipeSafeError` instead of falling through to "is not assignable to never".

## 1.0.0

### Major Changes

- c530d6d: Add typed compile-time error messages across the pipeline builder. Invalid pipeline shapes that previously produced "is not assignable to never" cascades now hover with literal `PipeSafeError<Msg>` messages naming the operator, accumulator, stage, or field that's wrong.

  Covers `$match` operators (`$gte` on string fields, `$size` on non-arrays, etc.), `$group` accumulator operands (`$sum`/`$avg`/`$min`/`$max` against wrong-typed fields), `$project` (unknown-key inclusion, mixed inclusion/exclusion), `$unwind` on scalar fields, expression operands (`$add`/`$concat`/`$dateToString`/`$concatArrays` etc.), invalid field-reference paths, and a strict `SortQuery` that flags typo'd field names.

  The `Pipeline` method signatures were tuned (direct typing for `sort`, validation-mapped wrapper for `project`) so the brands surface at the chained call site rather than only when the literal is assigned to a typed variable.

  See `CLAUDE.md` for the brand format conventions, signature patterns, and known limitations.

  Behaviour changes:
  - `SortQuery<Schema>` no longer accepts arbitrary string keys via a permissive index signature — typos like `pipeline.sort({ naem: 1 })` are now flagged.
  - `Pipeline.project` now rejects mixed inclusion (1/true) and exclusion (0/false) on non-`_id` fields at compile time (MongoDB rejects this at runtime).

  No runtime behaviour changes; all existing runtime tests and type-assertion files still pass.

### Minor Changes

- 41114be: Add typed `$merge` terminal stage to `Pipeline` (mirrors `.out()` semantics) and unify `Model.Mode.Upsert`/`Append` output construction in manifold to delegate to the new builder. `MergeOptions` now lives in `@pipesafe/core`; manifold re-exports it for back-compat.
- 7cf13c1: Add `$limit`, `$skip`, `$sample`, and `$count` aggregation pipeline stages with type-safe wrappers and `UsedStages` tracking.
- 48539ad: Add type-safe `$out` stage support for `{ db, coll }` and time-series output collections, with `timeField` constrained to `Date` field references and `metaField` constrained to non-`_id` field references

## 0.8.0

### Minor Changes

- 37ddaa0: Add `$facet` stage with type-safe multi-pipeline output inference and `UsedStages` tracking for cross-scope pipeline builder reuse
- 37ddaa0: Add $graphLookup stage with type-safe recursive graph traversal
- 079eeec: Tag user-supplied `MongoClient` instances with PipeSafe driver metadata at every entry point (`Collection`, `Database`, `Pipeline`, `Project`), not just the `pipesafe.connect()` singleton. Tagging is idempotent so wrapping the same client in multiple PipeSafe constructs will not duplicate entries in the server-side handshake log.

## 0.7.0

### Minor Changes

- 1647d74: Switch build tooling from raw tsc to tsdown (powered by Rolldown) with unbundle mode. Produces dual ESM/CJS output preserving source file structure for better tree-shaking. Dependencies auto-externalized from package.json.

### Patch Changes

- 4fd4b30: Add default export condition to package.json exports for broader bundler compatibility
- 1647d74: Fix Pipeline.\_chain() not forwarding MongoClient, which caused execute() to throw "Not connected" after chained stages
- 1647d74: Move mongodb from dependencies to peerDependencies to prevent duplicate MongoClient types when consumers link PipeSafe locally or use a different mongodb resolution path
- 9905152: Tighten InferExpression to use proper expression types instead of loose structural matchers

## 0.6.0

### Minor Changes

- 6cec201: Rename tmql monorepo to PipeSafe

  Breaking changes:
  - Package renamed from `tmql` to `@pipesafe/core`
  - Package renamed from `tmql-orchestration` to `@pipesafe/manifold`
  - All class prefixes removed: `TMPipeline` → `Pipeline`, `TMCollection` → `Collection`, etc.
  - Singleton renamed from `tmql` to `pipesafe`

## 0.5.1

### Patch Changes

- 36a681f: Sync package versions after initial tmql-orchestration publish

## 0.5.0

### Minor Changes

- ccb3b54: Add core pipeline stages: $sort, $limit, $skip, and $unwind
  - $sort: Type-safe sorting with support for nested fields and $meta text score
  - $limit: Limit documents in pipeline output
  - $skip: Skip documents for pagination
  - $unwind: Deconstruct array fields with full type inference, supports includeArrayIndex and preserveNullAndEmptyArrays options

- 3cd51f9: Add conditional, comparison, array, and variable binding expression operators

  **Conditional expressions:**
  - $cond: Conditional branching with 3 operands (condition, true value, false value)
  - $ifNull: Support for n arguments for fallback chains (minimum 2)

  **Comparison expressions (return boolean):**
  - $eq, $ne: Equality and inequality checks
  - $gt, $gte, $lt, $lte: Numeric/date comparisons
  - $in: Check if value exists in array

  **Array expressions:**
  - $arrayElemAt: Access array element by index with proper element type inference
  - $filter: Filter array elements with condition, returns filtered array type
  - $map: Transform array elements with proper type inference
  - $sum: Sum numeric values in an array expression (returns `number`)

  **Literal expressions:**
  - $literal: Return value without parsing (preserves literal types)

  **Variable binding:**
  - $let: Define variables for use in expressions

  **Group stage improvements:**
  - Aggregators ($sum, $avg, $min, $max, $push, $addToSet, $first, $last) now accept arithmetic and conditional expressions as operands

  **Stage chaining fixes:**
  - Fixed stages to correctly use `PreviousStageDocs` instead of `StartingDocs`
  - Affected stages: $match, $unset, $lookup, $group
  - Example: `.set({ newField: 1 }).match({ newField: 1 })` now works correctly

  **Cross-database pipeline execution:**
  - Fixed `TMProject.executeModel` to use source database when reading, not output database
  - Enables pipelines where source and output collections are in different databases

  **TMSource interface:**
  - Added `getOutputDatabase()` method to `TMSource` interface
  - Implemented in `TMCollection` to return configured `databaseName`
  - Added `getSourceDatabase()` method to `TMModel`

  **Type inference improvements:**
  - Fixed `cursor()` return type to reflect pipeline output instead of input
  - Fixed optional property syntax (`?:`) preservation in `MergeSetValue` and expressions
  - Fixed field references to nullable/optional fields in type filtering

  **New exports:**
  - Type testing utilities: `Assert`, `Equal`, `IsAssignable`, `NotImplemented`, `ExpectAssertFailure`
  - Runtime helpers: `expectType`, `assertTypeEqual`
  - Utility type: `Prettify`

  **Infrastructure:**
  - Upgraded TypeScript from 5.8.3 to 5.9.3
  - Upgraded ts-morph from 26.0.0 to 27.0.2 (aligned with TS 5.9)
  - TypeScript 5.9 "Caching Type Instantiations" improves performance for generics-heavy codebases

  **Bug fixes:**
  - Fixed RegExp methods polluting autocomplete suggestions in $match queries

## 0.4.1

### Patch Changes

- d1ce198: Change license from MIT to Elastic License 2.0 (ELv2)

## 0.4.0

### Minor Changes

- 258c587: Add TMModel and TMProject for DAG-based pipeline composition
  - **TMModel**: Define named, materializable pipelines with typed input/output. Models form a DAG through their `from` property, enabling dependency tracking and ordered execution.
  - **TMProject**: Orchestrate multiple models with automatic topological sorting, validation, and parallel execution of independent stages.
  - **TMSource**: Unified interface allowing TMCollection and TMModel to be used interchangeably as pipeline sources.
  - **Auto-discovery**: All dependencies (both upstream `from` and `lookup`/`unionWith` references) are automatically discovered - just specify your leaf models.
  - **Materialization modes**: `TMModel.Mode.Replace` (`$out`), `TMModel.Mode.Upsert` (`$merge`), and `TMModel.Mode.Append` presets for common patterns.
  - **Execution features**: Dry run mode, target/exclude filtering, and progress callbacks (`onModelStart`, `onModelComplete`).
  - **Visualization**: Generate Mermaid diagrams of model dependencies with `project.toMermaid()`.

- 539e81e: Adds type definitions and inference for MongoDB date manipulation expression operators

## 0.3.1

### Patch Changes

- 35d7450: Add passthrough methods for common MongoDB database operations

## 0.3.0

### Minor Changes

- cde9e7e: Add collection methods passthrough to mongodb node driver

## 0.2.0

### Minor Changes

- e57735e: Implmented connection concept

## 0.1.1

### Patch Changes

- 9f6f317: Added support for $concat expressions in $set and $project stages
