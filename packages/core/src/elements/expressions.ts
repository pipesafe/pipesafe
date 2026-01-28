import { Document } from "../utils/core";
import {
  FieldReference,
  InferFieldReference,
  FieldReferencesThatInferTo,
} from "./fieldReference";
import { AnyLiteral } from "./literals";

// ============================================================================
// MongoDB Expression Operators
// ============================================================================

/**
 * $concatArrays expression - concatenates arrays
 * Syntax: { $concatArrays: [array1, array2, ...] }
 * Each array can be:
 * - Array literal: [1, 2, 3]
 * - Field reference to an array: "$items"
 * - Nested expressions (future)
 */
export type ConcatArraysExpression<Schema extends Document> = {
  $concatArrays: (
    | FieldReferencesThatInferTo<Schema, unknown[]>
    | AnyLiteral<Schema>[]
  )[];
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
  $size: FieldReferencesThatInferTo<Schema, unknown[]> | AnyLiteral<Schema>[];
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
    date: FieldReferencesThatInferTo<Schema, Date> | Date;
    timezone?: string;
    onNull?: unknown;
  };
};

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
    date: FieldReferencesThatInferTo<Schema, Date> | Date;
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
    startDate: FieldReferencesThatInferTo<Schema, Date> | Date;
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
    startDate: FieldReferencesThatInferTo<Schema, Date> | Date;
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
  $toDate: ArithmeticOperand<Schema>;
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
    FieldReferencesThatInferTo<Schema, unknown[]> | AnyLiteral<Schema>[],
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
    input: FieldReferencesThatInferTo<Schema, unknown[]> | unknown[];
    as: string;
    cond: unknown; // Condition expression (uses $$var references)
    limit?: number;
  };
};

/**
 * Array-producing expressions that can be used as input to $map, $filter, etc.
 * Excludes $map and $sum to avoid circular references.
 */
export type ArrayProducingExpression<Schema extends Document> =
  | ConcatArraysExpression<Schema>
  | ArrayElemAtExpression<Schema>
  | FilterExpression<Schema>;

/**
 * Valid inputs for array operations: field references, literals, or expressions
 */
export type ArrayInput<Schema extends Document> =
  | FieldReferencesThatInferTo<Schema, unknown[]>
  | ArrayProducingExpression<Schema>
  | unknown[];

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
 * Arithmetic expression operands - numbers, field references to numbers, or nested expressions
 * These can be nested recursively (e.g., $add inside $divide)
 */
type ArithmeticOperand<Schema extends Document> =
  | number
  | FieldReferencesThatInferTo<Schema, number>
  | Expression<Schema>;

/**
 * $add expression - adds numbers together
 * Syntax: { $add: [expr1, expr2, ...] }
 * Accepts: array of numbers, field references to numbers, or nested expressions
 * Returns: number
 */
export type AddExpression<Schema extends Document> = {
  $add: ArithmeticOperand<Schema>[];
};

/**
 * $subtract expression - subtracts numbers
 * Syntax: { $subtract: [expr1, expr2] }
 * Accepts: array with 2 elements (minuend, subtrahend)
 * Returns: number
 */
export type SubtractExpression<Schema extends Document> = {
  $subtract: [ArithmeticOperand<Schema>, ArithmeticOperand<Schema>];
};

/**
 * $multiply expression - multiplies numbers
 * Syntax: { $multiply: [expr1, expr2, ...] }
 * Accepts: array of numbers, field references to numbers, or nested expressions
 * Returns: number
 */
export type MultiplyExpression<Schema extends Document> = {
  $multiply: ArithmeticOperand<Schema>[];
};

/**
 * $divide expression - divides numbers
 * Syntax: { $divide: [expr1, expr2] }
 * Accepts: array with 2 elements (dividend, divisor)
 * Returns: number
 */
export type DivideExpression<Schema extends Document> = {
  $divide: [ArithmeticOperand<Schema>, ArithmeticOperand<Schema>];
};

/**
 * $mod expression - modulo operation
 * Syntax: { $mod: [expr1, expr2] }
 * Accepts: array with 2 elements (dividend, divisor)
 * Returns: number
 */
export type ModExpression<Schema extends Document> = {
  $mod: [ArithmeticOperand<Schema>, ArithmeticOperand<Schema>];
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
 * String expression operands - strings and field references to strings only
 * Note: Does not support nested expressions to keep it simple
 */
type StringOperand<Schema extends Document> =
  | string
  | FieldReferencesThatInferTo<Schema, string>;

/**
 * $concat expression - concatenates strings together
 * Syntax: { $concat: [expr1, expr2, ...] }
 * Accepts: array of strings and field references to strings only
 * Returns: string
 */
export type ConcatExpression<Schema extends Document> = {
  $concat: StringOperand<Schema>[];
};

/**
 * Union of all string expressions
 * Extend this as we add more string operators
 */
export type StringExpression<Schema extends Document> =
  ConcatExpression<Schema>;

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
 * Infer the result type of an array expression
 * For $concatArrays: Union of all array element types
 * For $size: always returns number
 * For $arrayElemAt: returns the array element type
 * For $filter: returns array of the input element type
 * For $map: returns unknown[] (in expression uses $$vars we can't track)
 * For $sum: returns number (sum of array elements)
 */
export type InferArrayExpression<Schema extends Document, Expr> =
  Expr extends (
    {
      $concatArrays: infer Arrays;
    }
  ) ?
    Arrays extends unknown[] ?
      UnionArrayElements<Schema, Arrays>[]
    : never
  : Expr extends { $size: unknown } ? number
  : Expr extends { $arrayElemAt: [infer ArraySource, unknown] } ?
    InferArrayElementType<Schema, ArraySource>
  : Expr extends { $filter: { input: infer ArraySource } } ?
    InferArrayElementType<Schema, ArraySource>[]
  : Expr extends { $map: unknown } ? unknown[]
  : Expr extends { $sum: unknown } ? number
  : never;

/**
 * Infer the result type of a date expression
 * - $dateToString: returns string
 * - $dateTrunc, $dateAdd, $dateSubtract, $toDate: return Date
 */
export type InferDateExpression<_Schema extends Document, Expr> =
  Expr extends { $dateToString: unknown } ? string
  : Expr extends { $dateTrunc: unknown } ? Date
  : Expr extends { $dateAdd: unknown } ? Date
  : Expr extends { $dateSubtract: unknown } ? Date
  : Expr extends { $toDate: unknown } ? Date
  : never;

/**
 * Infer the result type of a string expression
 * All string operators return string
 */
export type InferStringExpression<_Schema extends Document, Expr> =
  Expr extends { $concat: unknown } ? string : never;

/**
 * Infer the result type of an arithmetic expression
 * All arithmetic operators return number
 */
export type InferArithmeticExpression<_Schema extends Document, Expr> =
  Expr extends (
    | { $add: unknown }
    | { $subtract: unknown }
    | { $multiply: unknown }
    | { $divide: unknown }
    | { $mod: unknown }
  ) ?
    number
  : never;

/**
 * Helper to exclude null and undefined from a type
 */
type NonNullable<T> = T extends null | undefined ? never : T;

/**
 * Helper to infer expression result type
 * Centralizes all expression type mappings for reusability
 */
type InferExpressionType<_Schema extends Document, Expr> =
  Expr extends { $dateToString: unknown } ? string
  : Expr extends { $dateTrunc: unknown } ? Date
  : Expr extends { $dateAdd: unknown } ? Date
  : Expr extends { $dateSubtract: unknown } ? Date
  : Expr extends { $toDate: unknown } ? Date
  : Expr extends { $add: unknown } ? number
  : Expr extends { $subtract: unknown } ? number
  : Expr extends { $multiply: unknown } ? number
  : Expr extends { $divide: unknown } ? number
  : Expr extends { $mod: unknown } ? number
  : Expr extends { $concat: unknown } ? string
  : Expr extends { $size: unknown } ? number
  : Expr extends { $concatArrays: infer Arrays } ?
    Arrays extends unknown[] ?
      (Arrays[number] extends (infer E)[] ? E : never)[]
    : never
  : // Array element access - infer from array source
  Expr extends { $arrayElemAt: [infer Arr, unknown] } ?
    Arr extends (infer E)[] ?
      E
    : unknown
  : Expr extends { $filter: { input: infer Arr } } ?
    Arr extends (infer E)[] ?
      E[]
    : unknown[]
  : // Variable binding - returns unknown (result depends on `in` expression)
  Expr extends { $let: unknown } ? unknown
  : // Comparison expressions return boolean
  Expr extends { $in: unknown } ? boolean
  : Expr extends { $eq: unknown } ? boolean
  : Expr extends { $ne: unknown } ? boolean
  : Expr extends { $gt: unknown } ? boolean
  : Expr extends { $gte: unknown } ? boolean
  : Expr extends { $lt: unknown } ? boolean
  : Expr extends { $lte: unknown } ? boolean
  : never;

/**
 * Helper to infer operand type for $ifNull (filters out null - $ifNull never returns null literals)
 */
type InferIfNullOperand<Schema extends Document, Operand> =
  Operand extends null ?
    never // $ifNull skips null literals, they're never returned
  : Operand extends FieldReference<Schema> ?
    NonNullable<InferFieldReference<Schema, Operand>>
  : Operand extends (infer T)[] ?
    T // Array literal
  : Operand extends { $ifNull: unknown } | { $cond: unknown } ?
    InferConditionalExpression<Schema, Operand> // Conditional expressions
  : InferExpressionType<Schema, Operand> extends never ?
    NonNullable<Operand> // Not an expression, treat as literal
  : InferExpressionType<Schema, Operand>; // Is an expression

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
  : Operand extends { $ifNull: unknown } | { $cond: unknown } ?
    InferConditionalExpression<Schema, Operand> // Conditional expressions
  : InferExpressionType<Schema, Operand> extends never ?
    NonNullable<Operand> // Not an expression, treat as literal
  : InferExpressionType<Schema, Operand>; // Is an expression

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
 * Infer the result type of a conditional expression
 * - $ifNull: returns the union of all operand types (filtering null literals)
 * - $cond: returns the union of the true and false value types (including null)
 */
export type InferConditionalExpression<Schema extends Document, Expr> =
  Expr extends { $ifNull: infer Operands } ?
    Operands extends unknown[] ?
      UnionIfNullOperandTypes<Schema, Operands>
    : never
  : Expr extends { $cond: [unknown, infer TrueVal, infer FalseVal] } ?
    InferCondOperand<Schema, TrueVal> | InferCondOperand<Schema, FalseVal>
  : never;

/**
 * Infer the result type of any expression
 * Delegates to specific expression type inferrers
 */
export type InferExpression<Schema extends Document, Expr> =
  // Date expressions
  Expr extends (
    | { $dateToString: unknown }
    | { $dateTrunc: unknown }
    | { $dateAdd: unknown }
    | { $dateSubtract: unknown }
    | { $toDate: unknown }
  ) ?
    InferDateExpression<Schema, Expr>
  : // Arithmetic expressions
  Expr extends (
    | { $add: unknown }
    | { $subtract: unknown }
    | { $multiply: unknown }
    | { $divide: unknown }
    | { $mod: unknown }
  ) ?
    InferArithmeticExpression<Schema, Expr>
  : // Array expressions (including $arrayElemAt, $filter, $map, $sum)
  Expr extends (
    | { $concatArrays: unknown }
    | { $size: unknown }
    | { $arrayElemAt: unknown }
    | { $filter: unknown }
    | { $map: unknown }
    | { $sum: unknown }
  ) ?
    InferArrayExpression<Schema, Expr>
  : // String expressions
  Expr extends { $concat: unknown } ? InferStringExpression<Schema, Expr>
  : // Conditional expressions
  Expr extends { $ifNull: unknown } | { $cond: unknown } ?
    InferConditionalExpression<Schema, Expr>
  : // Variable binding expressions (return unknown)
  Expr extends { $let: unknown } ? unknown
  : // Literal expressions (return the literal type)
  Expr extends { $literal: infer Value } ? Value
  : // Comparison expressions (all return boolean)
  Expr extends (
    | { $in: unknown }
    | { $eq: unknown }
    | { $ne: unknown }
    | { $gt: unknown }
    | { $gte: unknown }
    | { $lt: unknown }
    | { $lte: unknown }
  ) ?
    boolean
  : never;
