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
// `ExpressionSpec` is THE registration point (spec §2 recommendation 1):
// one entry per operator holding its operand (input) shape and, for
// fixed-return operators, its result type. Everything else — the
// per-operator expression types, the category unions, the `Expression`
// union, and the fixed-return arm of `InferExpression` — is derived
// mechanically. Adding an operator = adding one registry entry (plus one
// `InferDependentExpression` arm if its result depends on the literal
// arguments).

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
// Derived expression types — never hand-maintained
// ----------------------------------------------------------------------------

/**
 * The expression object shape for one operator (or a union of single-key
 * shapes when `Op` is a union — the conditional distributes deliberately).
 */
export type ExpressionFor<Schema extends Document, Op> =
  Op extends keyof ExpressionSpec<Schema> ?
    { [K in Op]: ExpressionSpec<Schema>[K]["operand"] }
  : never;

// Category key sets — the registry's table of contents.
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
type VariableOps = "$let";
type ComparisonOps = "$in" | "$eq" | "$ne" | "$gt" | "$gte" | "$lt" | "$lte";

// Per-operator expression types (public API, derived).
export type ConcatArraysExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$concatArrays"
>;
export type SizeExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$size"
>;
export type ArrayElemAtExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$arrayElemAt"
>;
export type FilterExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$filter"
>;
export type MapExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$map"
>;
export type SumExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$sum"
>;
export type DateToStringExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$dateToString"
>;
export type DateTruncExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$dateTrunc"
>;
export type DateAddExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$dateAdd"
>;
export type DateSubtractExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$dateSubtract"
>;
export type ToDateExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$toDate"
>;
export type AddExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$add"
>;
export type SubtractExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$subtract"
>;
export type MultiplyExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$multiply"
>;
export type DivideExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$divide"
>;
export type ModExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$mod"
>;
export type ConcatExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$concat"
>;
export type IfNullExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$ifNull"
>;
export type CondExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$cond"
>;
export type LetExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$let"
>;
export type LiteralExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$literal"
>;
export type InAggExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$in"
>;
export type EqExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$eq"
>;
export type NeExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$ne"
>;
export type GtExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$gt"
>;
export type GteExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$gte"
>;
export type LtExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$lt"
>;
export type LteExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$lte"
>;

// Category unions (derived views over the registry).
export type ArrayExpression<Schema extends Document> = ExpressionFor<
  Schema,
  ArrayOps
>;
export type DateExpression<Schema extends Document> = ExpressionFor<
  Schema,
  DateOps
>;
export type ArithmeticExpression<Schema extends Document> = ExpressionFor<
  Schema,
  ArithmeticOps
>;
export type StringExpression<Schema extends Document> = ExpressionFor<
  Schema,
  StringOps
>;
export type ConditionalExpression<Schema extends Document> = ExpressionFor<
  Schema,
  ConditionalOps
>;
export type VariableExpression<Schema extends Document> = ExpressionFor<
  Schema,
  VariableOps
>;
export type ComparisonExpression<Schema extends Document> = ExpressionFor<
  Schema,
  ComparisonOps
>;

/**
 * Union of all expression operators — derived from the registry keys, so a
 * new registry entry joins automatically.
 */
export type Expression<Schema extends Document> = ExpressionFor<
  Schema,
  keyof ExpressionSpec<Schema>
>;

// ----------------------------------------------------------------------------
// Inference — operator-key dispatch (spec §3.4)
// ----------------------------------------------------------------------------

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
  : [OperatorKeyOf<Expr>] extends [keyof ExpressionSpec<Schema>] ?
    ExpressionSpec<Schema>[OperatorKeyOf<Expr> &
      keyof ExpressionSpec<Schema>]["returns"]
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
