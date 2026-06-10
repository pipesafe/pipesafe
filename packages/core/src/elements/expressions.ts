import { Document } from "../utils/objects";
import { PipeSafeError, RequiresMsg } from "../utils/errors";
import {
  HasSingleOperatorKey,
  NotAnExpression,
  OperatorKeyOf,
} from "../utils/dispatch";
import { ExpressionOperand } from "./operands";
import {
  FieldReference,
  InferFieldReference,
  FieldReferencesThatInferTo,
} from "./fieldReference";
import { AnyLiteral } from "./literals";

// ============================================================================
// MongoDB Expression Operators — registry edition
// ============================================================================
// ATTEMPT-B VARIATION 1: `ExpressionSpec` is a CONFORMANCE registry — the
// per-operator types, unions, and inference arms below are hand-written, and
// expressions.conformance.typeAssertions.ts asserts they stay in sync with
// the registry. (Attempt A instead derives everything from the registry.)

// ----------------------------------------------------------------------------
// Operand helpers (kernel one-liners; see elements/operands.ts)
// ----------------------------------------------------------------------------

/**
 * Array operand — accepts a field reference to an array field, or an array
 * literal of any element type. The branded `PipeSafeError` arm surfaces in
 * IDE hovers when a user passes a non-array value (e.g. a string field
 * reference) where an array is required. Specialized rather than an
 * `ExpressionOperand` one-liner because the literal arm is `AnyLiteral[]`
 * while the reference arm targets `unknown[]`.
 */
type ArrayOperand<Schema extends Document, Op extends string> =
  | FieldReferencesThatInferTo<Schema, unknown[]>
  | AnyLiteral<Schema>[]
  | PipeSafeError<RequiresMsg<"Operator", Op, "an array operand">>;

/**
 * Date operand for $dateToString.date, $dateTrunc.date, $dateAdd.startDate,
 * $dateSubtract.startDate. Branded `PipeSafeError` arm surfaces in IDE hovers
 * when a non-Date operand is supplied (e.g. a string field reference passed
 * to a `date` parameter) instead of letting the value silently degrade.
 */
type DateOperand<
  Schema extends Document,
  Op extends string,
> = ExpressionOperand<
  Schema,
  Date,
  RequiresMsg<"Operator", Op, "a Date operand">
>;

/**
 * Arithmetic expression operands — numbers, field references to numbers, or
 * nested expressions. The branded `PipeSafeError` arm surfaces in IDE hovers
 * when a user passes a non-numeric field reference (e.g. `'$stringField'`)
 * instead of letting it silently degrade to `never` downstream.
 */
type ArithmeticOperand<Schema extends Document, Op extends string> =
  | ExpressionOperand<
      Schema,
      number,
      RequiresMsg<"Operator", Op, "a numeric operand">
    >
  | Expression<Schema>;

/**
 * String expression operands — strings and field references to strings only.
 * Does not support nested expressions to keep things simple. The branded
 * `PipeSafeError` arm surfaces in IDE hovers when a non-string operand is
 * passed (e.g. a numeric field reference) instead of degrading silently.
 */
type StringOperand<
  Schema extends Document,
  Op extends string,
> = ExpressionOperand<
  Schema,
  string,
  RequiresMsg<"Operator", Op, "a string operand">
>;

/**
 * Generic expression operands - can be any literal, null, field reference, or expression
 * Used for conditional operators like $ifNull and $cond that accept flexible types
 */
type ConditionalOperand<Schema extends Document> =
  | null
  | AnyLiteral<Schema>
  | FieldReference<Schema>
  | Expression<Schema>;

/**
 * Comparison operand - values that can be compared
 * Note: Excludes ComparisonExpression to avoid circular reference
 */
type ComparisonOperand<Schema extends Document> =
  | null
  | AnyLiteral<Schema>
  | FieldReference<Schema>
  | ArrayExpression<Schema>
  | DateExpression<Schema>
  | ArithmeticExpression<Schema>
  | StringExpression<Schema>
  | ConditionalExpression<Schema>;

/**
 * Time unit for date truncation/manipulation
 */
export type DateUnit =
  | "year"
  | "quarter"
  | "week"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "millisecond";

/**
 * Array-producing expressions that can be used as input to $map, $filter, etc.
 * Excludes $map and $sum to avoid circular references.
 */
export type ArrayProducingExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$concatArrays" | "$arrayElemAt" | "$filter"
>;

/**
 * Valid inputs for array operations: field references, literals, or expressions
 */
export type ArrayInput<Schema extends Document> =
  | FieldReferencesThatInferTo<Schema, unknown[]>
  | ArrayProducingExpression<Schema>
  | unknown[];

// ----------------------------------------------------------------------------
// THE registry
// ----------------------------------------------------------------------------

/**
 * Per-operator registration: `operand` is the input shape (carrying the
 * operand brands), `returns` is the result type for fixed-return operators.
 * For the literal-dependent operators (`LiteralDependentOps`) `returns`
 * holds the widest correct type — top-level inference for those routes
 * through `InferDependentExpression`, which refines from the literal
 * arguments.
 *
 * Being an interface, members resolve lazily and mutual recursion with the
 * derived `Expression` union is safe.
 */
export interface ExpressionSpec<Schema extends Document> {
  // --- Array operators -----------------------------------------------------
  /** Concatenates arrays. Result element type depends on the literal args. */
  $concatArrays: {
    operand: ArrayOperand<Schema, "$concatArrays">[];
    returns: unknown[];
  };
  /** Returns the size of an array. */
  $size: { operand: ArrayOperand<Schema, "$size">; returns: number };
  /** Element at index (0-based; negative counts from the end). */
  $arrayElemAt: {
    operand: [
      ArrayOperand<Schema, "$arrayElemAt">,
      number | FieldReferencesThatInferTo<Schema, number>,
    ];
    returns: unknown;
  };
  /** Filters an array by a condition (cond uses $$var references). */
  $filter: {
    operand: {
      input: ArrayOperand<Schema, "$filter">;
      as: string;
      cond: unknown;
      limit?: number;
    };
    returns: unknown[];
  };
  /**
   * Transforms each element. `in` needs $$variable tracking we don't have,
   * so the result stays unknown[] ($sum wrapping still infers number).
   */
  $map: {
    operand: { input: ArrayInput<Schema>; as: string; in: unknown };
    returns: unknown[];
  };
  /** Sums numeric values in an array ($group accumulation lives in group.ts). */
  $sum: {
    operand:
      | FieldReferencesThatInferTo<Schema, number[]>
      | ArrayProducingExpression<Schema>
      | MapExpression<Schema>
      | number[];
    returns: number;
  };

  // --- Date operators -------------------------------------------------------
  /** Converts a date to a string with the given format. */
  $dateToString: {
    operand: {
      format: string;
      date: DateOperand<Schema, "$dateToString">;
      timezone?: string;
      onNull?: unknown;
    };
    returns: string;
  };
  /** Truncates a date to a unit. */
  $dateTrunc: {
    operand: {
      date: DateOperand<Schema, "$dateTrunc">;
      unit: DateUnit;
      binSize?: number;
      timezone?: string;
      startOfWeek?:
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday"
        | "sunday";
    };
    returns: Date;
  };
  /** Adds an amount of units to a date. */
  $dateAdd: {
    operand: {
      startDate: DateOperand<Schema, "$dateAdd">;
      unit: DateUnit;
      amount: number | FieldReferencesThatInferTo<Schema, number>;
      timezone?: string;
    };
    returns: Date;
  };
  /** Subtracts an amount of units from a date. */
  $dateSubtract: {
    operand: {
      startDate: DateOperand<Schema, "$dateSubtract">;
      unit: DateUnit;
      amount: number | FieldReferencesThatInferTo<Schema, number>;
      timezone?: string;
    };
    returns: Date;
  };
  /** Converts a Unix-ms number (or numeric expression) to a Date. */
  $toDate: { operand: ArithmeticOperand<Schema, "$toDate">; returns: Date };

  // --- Arithmetic operators (all return number) -----------------------------
  $add: { operand: ArithmeticOperand<Schema, "$add">[]; returns: number };
  $subtract: {
    operand: [
      ArithmeticOperand<Schema, "$subtract">,
      ArithmeticOperand<Schema, "$subtract">,
    ];
    returns: number;
  };
  $multiply: {
    operand: ArithmeticOperand<Schema, "$multiply">[];
    returns: number;
  };
  $divide: {
    operand: [
      ArithmeticOperand<Schema, "$divide">,
      ArithmeticOperand<Schema, "$divide">,
    ];
    returns: number;
  };
  $mod: {
    operand: [
      ArithmeticOperand<Schema, "$mod">,
      ArithmeticOperand<Schema, "$mod">,
    ];
    returns: number;
  };

  // --- String operators ------------------------------------------------------
  /** Concatenates strings. */
  $concat: { operand: StringOperand<Schema, "$concat">[]; returns: string };

  // --- Conditional operators (results depend on the literal args) -----------
  /** First non-null operand. */
  $ifNull: {
    operand: [
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
      ...ConditionalOperand<Schema>[],
    ];
    returns: unknown;
  };
  /** Ternary: [condition, thenValue, elseValue]. */
  $cond: {
    operand: [
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
    ];
    returns: unknown;
  };

  // --- Variable binding ------------------------------------------------------
  /** Binds $$vars for a sub-expression; result not tracked. */
  $let: {
    operand: { vars: Record<string, unknown>; in: unknown };
    returns: unknown;
  };

  // --- Literal ----------------------------------------------------------------
  /** Returns the value without parsing; result is the literal's own type. */
  $literal: { operand: unknown; returns: unknown };

  // --- Comparison operators (all return boolean) ------------------------------
  $in: {
    operand: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
    returns: boolean;
  };
  $eq: {
    operand: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
    returns: boolean;
  };
  $ne: {
    operand: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
    returns: boolean;
  };
  $gt: {
    operand: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
    returns: boolean;
  };
  $gte: {
    operand: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
    returns: boolean;
  };
  $lt: {
    operand: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
    returns: boolean;
  };
  $lte: {
    operand: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
    returns: boolean;
  };
}

// ----------------------------------------------------------------------------
// Hand-written expression types (ATTEMPT-B VARIATION 1)
// ----------------------------------------------------------------------------
// Unlike attempt A (types derived from the registry via ExpressionFor), the
// per-operator types and unions below are hand-written; ExpressionSpec above
// is a CONFORMANCE CHECK only — expressions.conformance.typeAssertions.ts
// asserts each hand-written type matches its registry entry, so drift is a
// compile error instead of being structurally impossible.

/** Conformance helper: the registry-derived shape for one operator. */
export type ExpressionFor<Schema extends Document, Op> =
  Op extends keyof ExpressionSpec<Schema> ?
    { [K in Op]: ExpressionSpec<Schema>[K]["operand"] }
  : never;

/**
 * $concatArrays expression - concatenates arrays
 * Syntax: { $concatArrays: [array1, array2, ...] }
 * Each array can be:
 * - Array literal: [1, 2, 3]
 * - Field reference to an array: "$items"
 * - Nested expressions (future)
 */
export type ConcatArraysExpression<Schema extends Document> = {
  $concatArrays: ArrayOperand<Schema, "$concatArrays">[];
};

/**
 * $size expression - returns the size of an array
 * Syntax: { $size: "$arrayField" } or { $size: [1, 2, 3] }
 * Accepts:
 * - Field reference to an array: "$items"
 * - Array literal: [1, 2, 3]
 * Returns: number (the length of the array)
 */
export type SizeExpression<Schema extends Document> = {
  $size: ArrayOperand<Schema, "$size">;
};

/**
 * $dateToString expression - converts a date to a string
 * Syntax: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }
 * Accepts:
 * - format: string (date format string)
 * - date: Field reference to a Date field or Date literal
 * - timezone: optional string
 * - onNull: optional value
 * Returns: string
 */
export type DateToStringExpression<Schema extends Document> = {
  $dateToString: {
    format: string;
    date: DateOperand<Schema, "$dateToString">;
    timezone?: string;
    onNull?: unknown;
  };
};

/**
 * $dateTrunc expression - truncates a date to a specified unit
 * Syntax: { $dateTrunc: { date: "$timestamp", unit: "day" } }
 * Accepts:
 * - date: Field reference to a Date field or Date literal
 * - unit: time unit to truncate to
 * - binSize: optional number of units
 * - timezone: optional timezone string
 * - startOfWeek: optional day to start week (for "week" unit)
 * Returns: Date
 */
export type DateTruncExpression<Schema extends Document> = {
  $dateTrunc: {
    date: DateOperand<Schema, "$dateTrunc">;
    unit: DateUnit;
    binSize?: number;
    timezone?: string;
    startOfWeek?:
      | "monday"
      | "tuesday"
      | "wednesday"
      | "thursday"
      | "friday"
      | "saturday"
      | "sunday";
  };
};

/**
 * $dateAdd expression - adds a specified amount to a date
 * Syntax: { $dateAdd: { startDate: "$timestamp", unit: "day", amount: 1 } }
 * Accepts:
 * - startDate: Field reference to a Date field or Date literal
 * - unit: time unit to add
 * - amount: number of units to add (can be field reference)
 * - timezone: optional timezone string
 * Returns: Date
 */
export type DateAddExpression<Schema extends Document> = {
  $dateAdd: {
    startDate: DateOperand<Schema, "$dateAdd">;
    unit: DateUnit;
    amount: number | FieldReferencesThatInferTo<Schema, number>;
    timezone?: string;
  };
};

/**
 * $dateSubtract expression - subtracts a specified amount from a date
 * Syntax: { $dateSubtract: { startDate: "$timestamp", unit: "day", amount: 1 } }
 * Accepts:
 * - startDate: Field reference to a Date field or Date literal
 * - unit: time unit to subtract
 * - amount: number of units to subtract (can be field reference)
 * - timezone: optional timezone string
 * Returns: Date
 */
export type DateSubtractExpression<Schema extends Document> = {
  $dateSubtract: {
    startDate: DateOperand<Schema, "$dateSubtract">;
    unit: DateUnit;
    amount: number | FieldReferencesThatInferTo<Schema, number>;
    timezone?: string;
  };
};

/**
 * $toDate expression - converts a numeric value (Unix timestamp in milliseconds) to a Date
 * Syntax: { $toDate: "$timestamp" } or { $toDate: { $multiply: ['$created', 1000] } }
 * Accepts:
 * - A number representing milliseconds since epoch
 * - A field reference to a numeric field
 * - A nested expression that returns a number
 * Returns: Date
 */
export type ToDateExpression<Schema extends Document> = {
  $toDate: ArithmeticOperand<Schema, "$toDate">;
};

/**
 * $arrayElemAt expression - returns the element at a specified array index
 * Syntax: { $arrayElemAt: [<array>, <index>] }
 * Accepts:
 * - First element: array field reference or array literal
 * - Second element: numeric index (0-based, negative counts from end)
 * Returns: The element type of the array (or unknown for dynamic arrays)
 */
export type ArrayElemAtExpression<Schema extends Document> = {
  $arrayElemAt: [
    ArrayOperand<Schema, "$arrayElemAt">,
    number | FieldReferencesThatInferTo<Schema, number>,
  ];
};

/**
 * $filter expression - filters an array based on a condition
 * Syntax: { $filter: { input: <array>, as: <string>, cond: <expression> } }
 * Returns: Filtered array
 */
export type FilterExpression<Schema extends Document> = {
  $filter: {
    input: ArrayOperand<Schema, "$filter">;
    as: string;
    cond: unknown; // Condition expression (uses $$var references)
    limit?: number;
  };
};

/**
 * $map expression - transforms each element of an array
 * Syntax: { $map: { input: <array>, as: <string>, in: <expression> } }
 * Returns: Array of transformed elements
 * Note: The `in` expression type inference requires $$variable tracking,
 * so we return unknown[] for now. $sum wrapping will still infer number.
 */
export type MapExpression<Schema extends Document> = {
  $map: {
    input: ArrayInput<Schema>;
    as: string;
    in: unknown; // Expression using $$var references
  };
};

/**
 * $sum expression - sums numeric values in an array
 * Syntax: { $sum: <array-expression> } or { $sum: <field-reference> }
 * In $set context: operates on array expressions
 * In $group context: accumulates values (handled separately)
 * Returns: number
 */
export type SumExpression<Schema extends Document> = {
  $sum:
    | FieldReferencesThatInferTo<Schema, number[]>
    | ArrayProducingExpression<Schema>
    | MapExpression<Schema>
    | number[];
};

/**
 * Union of all array expressions
 * Extend this as we add more array operators
 */
export type ArrayExpression<Schema extends Document> =
  | ConcatArraysExpression<Schema>
  | SizeExpression<Schema>
  | ArrayElemAtExpression<Schema>
  | FilterExpression<Schema>
  | MapExpression<Schema>
  | SumExpression<Schema>;

/**
 * $add expression - adds numbers together
 * Syntax: { $add: [expr1, expr2, ...] }
 * Accepts: array of numbers, field references to numbers, or nested expressions
 * Returns: number
 */
export type AddExpression<Schema extends Document> = {
  $add: ArithmeticOperand<Schema, "$add">[];
};

/**
 * $subtract expression - subtracts numbers
 * Syntax: { $subtract: [expr1, expr2] }
 * Accepts: array with 2 elements (minuend, subtrahend)
 * Returns: number
 */
export type SubtractExpression<Schema extends Document> = {
  $subtract: [
    ArithmeticOperand<Schema, "$subtract">,
    ArithmeticOperand<Schema, "$subtract">,
  ];
};

/**
 * $multiply expression - multiplies numbers
 * Syntax: { $multiply: [expr1, expr2, ...] }
 * Accepts: array of numbers, field references to numbers, or nested expressions
 * Returns: number
 */
export type MultiplyExpression<Schema extends Document> = {
  $multiply: ArithmeticOperand<Schema, "$multiply">[];
};

/**
 * $divide expression - divides numbers
 * Syntax: { $divide: [expr1, expr2] }
 * Accepts: array with 2 elements (dividend, divisor)
 * Returns: number
 */
export type DivideExpression<Schema extends Document> = {
  $divide: [
    ArithmeticOperand<Schema, "$divide">,
    ArithmeticOperand<Schema, "$divide">,
  ];
};

/**
 * $mod expression - modulo operation
 * Syntax: { $mod: [expr1, expr2] }
 * Accepts: array with 2 elements (dividend, divisor)
 * Returns: number
 */
export type ModExpression<Schema extends Document> = {
  $mod: [ArithmeticOperand<Schema, "$mod">, ArithmeticOperand<Schema, "$mod">];
};

/**
 * Union of all date expressions
 * Extend this as we add more date operators
 */
export type DateExpression<Schema extends Document> =
  | DateToStringExpression<Schema>
  | DateTruncExpression<Schema>
  | DateAddExpression<Schema>
  | DateSubtractExpression<Schema>
  | ToDateExpression<Schema>;

/**
 * $concat expression - concatenates strings together
 * Syntax: { $concat: [expr1, expr2, ...] }
 * Accepts: array of strings and field references to strings only
 * Returns: string
 */
export type ConcatExpression<Schema extends Document> = {
  $concat: StringOperand<Schema, "$concat">[];
};

/**
 * Union of all string expressions
 * Extend this as we add more string operators
 */
export type StringExpression<Schema extends Document> =
  ConcatExpression<Schema>;

/**
 * $ifNull expression - returns the first non-null value from a list of expressions
 * Syntax: { $ifNull: [expr1, expr2, expr3, ...] }
 * Accepts: array of 2 or more operands
 * - Returns the first non-null/non-missing value
 * - If all are null/missing, returns null
 * Returns: union of all operand types (excluding null/undefined)
 */
export type IfNullExpression<Schema extends Document> = {
  $ifNull: [
    ConditionalOperand<Schema>,
    ConditionalOperand<Schema>,
    ...ConditionalOperand<Schema>[],
  ];
};

/**
 * $cond expression - returns a value based on a boolean condition
 * Syntax: { $cond: [booleanExpr, trueValue, falseValue] }
 * Accepts:
 * - First element: a boolean expression or value (the condition)
 * - Second element: value to return if condition is true
 * - Third element: value to return if condition is false
 * Returns: union of the types of the true and false values
 */
export type CondExpression<Schema extends Document> = {
  $cond: [
    ConditionalOperand<Schema>,
    ConditionalOperand<Schema>,
    ConditionalOperand<Schema>,
  ];
};

/**
 * Union of all arithmetic expressions
 * Extend this as we add more arithmetic operators
 */
export type ArithmeticExpression<Schema extends Document> =
  | AddExpression<Schema>
  | SubtractExpression<Schema>
  | MultiplyExpression<Schema>
  | DivideExpression<Schema>
  | ModExpression<Schema>;

/**
 * Union of all conditional expressions
 * Extend this as we add more conditional operators
 */
export type ConditionalExpression<Schema extends Document> =
  | IfNullExpression<Schema>
  | CondExpression<Schema>;

// ============================================================================
// Variable Binding Expression Operators
// ============================================================================

/**
 * $let expression - binds variables for use in a sub-expression
 * Syntax: { $let: { vars: { <var1>: <expr1>, ... }, in: <expression> } }
 * Accepts:
 * - vars: Object mapping variable names to expressions
 * - in: Expression that can use $$var1, $$var2, etc.
 * Returns: The result of the `in` expression (unknown since vars are dynamic)
 */
export type LetExpression<_Schema extends Document> = {
  $let: {
    vars: Record<string, unknown>;
    in: unknown; // The expression result - uses $$var references
  };
};

/**
 * Union of all variable binding expressions
 */
export type VariableExpression<_Schema extends Document> =
  LetExpression<_Schema>;

// ============================================================================
// Literal Expression Operators
// ============================================================================

/**
 * $literal expression - returns a value without parsing
 * Syntax: { $literal: <value> }
 * Used to pass literal values that might otherwise be interpreted as operators
 * Returns: The exact type of the value
 */
export type LiteralExpression<_Schema extends Document> = {
  $literal: unknown;
};

// ============================================================================
// Comparison Expression Operators (return boolean)
// ============================================================================

/**
 * $in expression (aggregation) - checks if a value is in an array
 * Syntax: { $in: [<expression>, <array expression>] }
 * Note: This is different from $in in $match queries
 * Returns: boolean
 */
export type InAggExpression<Schema extends Document> = {
  $in: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
};

/**
 * $eq expression - checks if two values are equal
 * Syntax: { $eq: [expr1, expr2] }
 * Returns: boolean
 */
export type EqExpression<Schema extends Document> = {
  $eq: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
};

/**
 * $ne expression - checks if two values are not equal
 * Syntax: { $ne: [expr1, expr2] }
 * Returns: boolean
 */
export type NeExpression<Schema extends Document> = {
  $ne: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
};

/**
 * $gt expression - checks if first value is greater than second
 * Syntax: { $gt: [expr1, expr2] }
 * Returns: boolean
 */
export type GtExpression<Schema extends Document> = {
  $gt: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
};

/**
 * $gte expression - checks if first value is greater than or equal to second
 * Syntax: { $gte: [expr1, expr2] }
 * Returns: boolean
 */
export type GteExpression<Schema extends Document> = {
  $gte: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
};

/**
 * $lt expression - checks if first value is less than second
 * Syntax: { $lt: [expr1, expr2] }
 * Returns: boolean
 */
export type LtExpression<Schema extends Document> = {
  $lt: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
};

/**
 * $lte expression - checks if first value is less than or equal to second
 * Syntax: { $lte: [expr1, expr2] }
 * Returns: boolean
 */
export type LteExpression<Schema extends Document> = {
  $lte: [ComparisonOperand<Schema>, ComparisonOperand<Schema>];
};

/**
 * Union of all comparison expressions
 * All return boolean
 */
export type ComparisonExpression<Schema extends Document> =
  | InAggExpression<Schema>
  | EqExpression<Schema>
  | NeExpression<Schema>
  | GtExpression<Schema>
  | GteExpression<Schema>
  | LtExpression<Schema>
  | LteExpression<Schema>;

/**
 * Union of all expression operators
 * Extend this as we add more expression categories
 */
export type Expression<Schema extends Document> =
  | ArrayExpression<Schema>
  | DateExpression<Schema>
  | ArithmeticExpression<Schema>
  | StringExpression<Schema>
  | ConditionalExpression<Schema>
  | VariableExpression<Schema>
  | LiteralExpression<Schema>
  | ComparisonExpression<Schema>;

// ----------------------------------------------------------------------------
// Inference — operator-key dispatch (spec §3.4)
// ----------------------------------------------------------------------------

// Category key sets — used by the key-dispatched category inference views.
type ArrayOps =
  | "$concatArrays"
  | "$size"
  | "$arrayElemAt"
  | "$filter"
  | "$map"
  | "$sum";
type DateOps =
  | "$dateToString"
  | "$dateTrunc"
  | "$dateAdd"
  | "$dateSubtract"
  | "$toDate";
type ArithmeticOps = "$add" | "$subtract" | "$multiply" | "$divide" | "$mod";
type StringOps = "$concat";
type ConditionalOps = "$ifNull" | "$cond";

/**
 * Operators whose result type depends on the literal arguments rather than
 * being fixed in the registry.
 */
type LiteralDependentOps =
  | "$concatArrays"
  | "$arrayElemAt"
  | "$filter"
  | "$ifNull"
  | "$cond"
  | "$literal";

/**
 * Helper to get union of all array element types
 * Recursively processes each array in the concat list
 */
type UnionArrayElements<Schema extends Document, Arrays extends unknown[]> =
  Arrays extends [infer First, ...infer Rest] ?
    GetArrayElement<Schema, First> | UnionArrayElements<Schema, Rest>
  : never;

/**
 * Helper to extract element type from a single array argument
 * Handles both field references and array literals
 */
type GetArrayElement<Schema extends Document, Item> =
  Item extends (infer E)[] ?
    E // Array literal - extract element type
  : Item extends FieldReference<Schema> ?
    InferFieldReference<Schema, Item> extends (infer T)[] ?
      T // Field reference to array - extract element type
    : never
  : never;

/**
 * Helper to extract element type from an array source (field ref or literal)
 */
type InferArrayElementType<Schema extends Document, ArraySource> =
  // Array literal - extract element type
  ArraySource extends (infer E)[] ? E
  : // Field reference to array - get element type
  ArraySource extends FieldReference<Schema> ?
    InferFieldReference<Schema, ArraySource> extends (infer T)[] ?
      T
    : unknown
  : unknown;

/**
 * Helper to infer operand type for $ifNull (filters out null - $ifNull never
 * returns null literals). Non-expression operands are detected via the
 * NotAnExpression sentinel and treated as literals.
 */
type InferIfNullOperand<Schema extends Document, Operand> =
  Operand extends null ?
    never // $ifNull skips null literals, they're never returned
  : Operand extends FieldReference<Schema> ?
    NonNullable<InferFieldReference<Schema, Operand>>
  : Operand extends (infer T)[] ?
    T // Array literal
  : InferExpression<Schema, Operand> extends infer R ?
    [R] extends [NotAnExpression] ?
      NonNullable<Operand> // Not an expression, treat as literal
    : R // Is an expression — single dispatch, no second inference path
  : never;

/**
 * Helper to infer operand type for $cond (includes null - either branch can be returned)
 */
type InferCondOperand<Schema extends Document, Operand> =
  Operand extends null ?
    null // $cond CAN return null if it's in a branch
  : Operand extends FieldReference<Schema> ?
    NonNullable<InferFieldReference<Schema, Operand>>
  : Operand extends (infer T)[] ?
    T // Array literal
  : InferExpression<Schema, Operand> extends infer R ?
    [R] extends [NotAnExpression] ?
      NonNullable<Operand> // Not an expression, treat as literal
    : R // Is an expression — single dispatch, no second inference path
  : never;

/**
 * Helper to infer the union of all operand types in $ifNull
 * Recursively processes each operand and unions their types (filtering nulls)
 */
type UnionIfNullOperandTypes<
  Schema extends Document,
  Operands extends unknown[],
> =
  Operands extends [infer First, ...infer Rest] ?
    InferIfNullOperand<Schema, First> | UnionIfNullOperandTypes<Schema, Rest>
  : never;

/**
 * Hand-written inference arms for the literal-dependent operators — the only
 * per-operator inference code left after the registry rebuild.
 */
type InferDependentExpression<Schema extends Document, Expr> =
  Expr extends { $concatArrays: infer Arrays } ?
    Arrays extends unknown[] ?
      UnionArrayElements<Schema, Arrays>[]
    : never
  : Expr extends { $arrayElemAt: [infer ArraySource, unknown] } ?
    InferArrayElementType<Schema, ArraySource>
  : Expr extends { $filter: { input: infer ArraySource } } ?
    InferArrayElementType<Schema, ArraySource>[]
  : Expr extends { $ifNull: infer Operands } ?
    Operands extends unknown[] ?
      UnionIfNullOperandTypes<Schema, Operands>
    : never
  : Expr extends { $cond: [unknown, infer TrueVal, infer FalseVal] } ?
    InferCondOperand<Schema, TrueVal> | InferCondOperand<Schema, FalseVal>
  : Expr extends { $literal: infer Value } ? Value
  : never;

/**
 * Infer the result type of any expression — THE single dispatch
 * (spec §3.4 ladder, tiers 2–4):
 *
 *  - no `$`-prefixed key → `NotAnExpression` sentinel (the value is a
 *    literal; callers like InferNestedFieldReference treat it as such);
 *  - more than one `$` key → exactly-one-operator brand (invalid in MongoDB);
 *  - literal-dependent operator → hand-written arm refines from the args;
 *  - known fixed-return operator → the registry's `returns` (FORGIVING:
 *    a malformed operand does not change the inferred kind — the operand
 *    brand reports the error at the input position);
 *  - unknown `$` operator → `never`.
 */
export type InferExpression<Schema extends Document, Expr> =
  [OperatorKeyOf<Expr>] extends [never] ? NotAnExpression
  : HasSingleOperatorKey<Expr> extends false ?
    PipeSafeError<`Expression objects must have exactly one operator.`>
  : [OperatorKeyOf<Expr>] extends [LiteralDependentOps] ?
    InferDependentExpression<Schema, Expr>
  : // ATTEMPT-B VARIATION 1: hand-written fixed-return arms instead of the
  // registry's "returns" lookup (conformance assertions pin equivalence).
  Expr extends { $size: any } ? number
  : Expr extends { $map: any } ? unknown[]
  : Expr extends { $sum: any } ? number
  : Expr extends { $dateToString: any } ? string
  : Expr extends { $dateTrunc: any } ? Date
  : Expr extends { $dateAdd: any } ? Date
  : Expr extends { $dateSubtract: any } ? Date
  : Expr extends { $toDate: any } ? Date
  : Expr extends { $add: any } ? number
  : Expr extends { $subtract: any } ? number
  : Expr extends { $multiply: any } ? number
  : Expr extends { $divide: any } ? number
  : Expr extends { $mod: any } ? number
  : Expr extends { $concat: any } ? string
  : Expr extends { $let: any } ? unknown
  : Expr extends (
    | { $in: any }
    | { $eq: any }
    | { $ne: any }
    | { $gt: any }
    | { $gte: any }
    | { $lt: any }
    | { $lte: any }
  ) ?
    boolean
  : never;

// ----------------------------------------------------------------------------
// Category inference views — kept for assertion-level use; all key-dispatched
// ----------------------------------------------------------------------------

/**
 * Infer the result type of an array expression (key-dispatched view).
 */
export type InferArrayExpression<Schema extends Document, Expr> =
  [OperatorKeyOf<Expr>] extends [ArrayOps] ? InferExpression<Schema, Expr>
  : never;

/**
 * Infer the result type of a date expression (key-dispatched view).
 */
export type InferDateExpression<Schema extends Document, Expr> =
  [OperatorKeyOf<Expr>] extends [DateOps] ? InferExpression<Schema, Expr>
  : never;

/**
 * Infer the result type of a string expression (key-dispatched view).
 */
export type InferStringExpression<Schema extends Document, Expr> =
  [OperatorKeyOf<Expr>] extends [StringOps] ? InferExpression<Schema, Expr>
  : never;

/**
 * Infer the result type of an arithmetic expression (key-dispatched view).
 */
export type InferArithmeticExpression<Schema extends Document, Expr> =
  [OperatorKeyOf<Expr>] extends [ArithmeticOps] ? InferExpression<Schema, Expr>
  : never;

/**
 * Infer the result type of a conditional expression (key-dispatched view).
 */
export type InferConditionalExpression<Schema extends Document, Expr> =
  [OperatorKeyOf<Expr>] extends [ConditionalOps] ?
    InferDependentExpression<Schema, Expr>
  : never;
