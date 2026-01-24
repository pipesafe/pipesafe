---
"tmql": minor
---

Add conditional, comparison, array, and variable binding expression operators

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
