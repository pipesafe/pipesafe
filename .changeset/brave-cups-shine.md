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

**Variable binding:**

- $let: Define variables for use in expressions

**Group stage improvements:**

- Aggregators ($sum, $avg, $min, $max, $push, $addToSet, $first, $last) now accept arithmetic and conditional expressions as operands

**Bug fixes:**

- Fixed RegExp methods polluting autocomplete suggestions in $match queries
