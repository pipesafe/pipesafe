# tmql

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
