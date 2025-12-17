import { Document } from "../utils/core";
import {
  FieldReference, // Used in InferArrayExpression
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
    | AnyLiteral<Schema>[] // Array literal containing any literal values
    | FieldReferencesThatInferTo<Schema, unknown[]>
  )[]; // Field reference that resolves to any array type
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
  $size:
    | FieldReferencesThatInferTo<Schema, unknown[]> // Field reference that resolves to an array
    | AnyLiteral<Schema>[]; // Array literal
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
    date:
      | FieldReferencesThatInferTo<Schema, Date> // Field reference that resolves to Date
      | Date; // Date literal
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
    date:
      | FieldReferencesThatInferTo<Schema, Date> // Field reference that resolves to Date
      | Date; // Date literal
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
    startDate:
      | FieldReferencesThatInferTo<Schema, Date> // Field reference that resolves to Date
      | Date; // Date literal
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
    startDate:
      | FieldReferencesThatInferTo<Schema, Date> // Field reference that resolves to Date
      | Date; // Date literal
    unit: DateUnit;
    amount: number | FieldReferencesThatInferTo<Schema, number>;
    timezone?: string;
  };
};

/**
 * Union of all array expressions
 * Extend this as we add more array operators
 */
export type ArrayExpression<Schema extends Document> =
  | ConcatArraysExpression<Schema>
  | SizeExpression<Schema>;

/**
 * Arithmetic expression operands - numbers, field references to numbers, or nested expressions
 * These can be nested recursively (e.g., $add inside $divide)
 */
type ArithmeticOperand<Schema extends Document> =
  | number
  | FieldReferencesThatInferTo<Schema, number>
  | Expression<Schema>; // Allow nested expressions

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
  | DateSubtractExpression<Schema>;

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
 * Union of all expression operators
 * Extend this as we add more expression categories
 */
export type Expression<Schema extends Document> =
  | ArrayExpression<Schema>
  | DateExpression<Schema>
  | ArithmeticExpression<Schema>
  | StringExpression<Schema>;

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
 * Infer the result type of an array expression
 * For $concatArrays: Union of all array element types
 * For $size: always returns number
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
  : never;

/**
 * Infer the result type of a date expression
 * - $dateToString: returns string
 * - $dateTrunc, $dateAdd, $dateSubtract: return Date
 */
export type InferDateExpression<_Schema extends Document, Expr> =
  Expr extends { $dateToString: unknown } ? string
  : Expr extends { $dateTrunc: unknown } ? Date
  : Expr extends { $dateAdd: unknown } ? Date
  : Expr extends { $dateSubtract: unknown } ? Date
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
  : // Array expressions
  Expr extends { $concatArrays: unknown } | { $size: unknown } ?
    InferArrayExpression<Schema, Expr>
  : // String expressions
  Expr extends { $concat: unknown } ? InferStringExpression<Schema, Expr>
  : never;
