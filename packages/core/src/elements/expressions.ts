import { Document } from "../utils/objects";
import {
  MultiOperatorError,
  PipeSafeError,
  RequiresMsg,
} from "../utils/errors";
import {
  HasOperatorKey,
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
// `ExpressionSpec` is THE registration point: one entry per operator holds
// its operand (input) shape and, for fixed-return operators, its result
// type. Everything else — the per-operator expression types, the category
// unions, the `Expression` union, and the fixed-return arm of
// `InferExpression` — is derived mechanically. Adding an operator = one
// registry entry (plus one `InferDependentExpression` arm if its result
// depends on the literal arguments).

// ----------------------------------------------------------------------------
// Operand helpers (kernel one-liners; see elements/operands.ts)
// ----------------------------------------------------------------------------

/**
 * Array operand — accepts a field reference to an array field, an array
 * literal of any element type, or an array-producing expression
 * ($concatArrays/$arrayElemAt/$filter/$map — e.g. `$size: { $filter: … }`).
 * The branded `PipeSafeError` arm surfaces in IDE hovers when a user passes
 * a non-array value (e.g. a string field reference) where an array is
 * required. Specialized rather than an `ExpressionOperand` one-liner
 * because the literal arm is `AnyLiteral[]` while the reference arm targets
 * `unknown[]`.
 */
type ArrayOperand<Schema extends Document, Op extends string> =
  | FieldReferencesThatInferTo<Schema, unknown[]>
  | readonly AnyLiteral<Schema>[]
  | ArrayProducingExpression<Schema>
  | MapExpression<Schema>
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

/** The `[left, right]` pair shape shared by the binary arithmetic operators. */
type ArithmeticPair<Schema extends Document, Op extends string> = readonly [
  ArithmeticOperand<Schema, Op>,
  ArithmeticOperand<Schema, Op>,
];

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

/** The `[left, right]` pair shape shared by all binary comparison operators. */
type ComparisonPair<Schema extends Document> = readonly [
  ComparisonOperand<Schema>,
  ComparisonOperand<Schema>,
];

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
 * Per-operator registration — one entry declares everything about an
 * operator that CAN be declared as data:
 *
 * - `operand`: the input shape (carrying the operand brands).
 * - `returns`: the result type — PRESENT only on fixed-return operators.
 *   A LITERAL-DEPENDENT operator (its result derives from its arguments —
 *   $cond's branches, $concatArrays' element types, ...) OMITS `returns`:
 *   the omission is the entry's own declaration of dependence
 *   (`LiteralDependentOps` is derived from it), and the real inference
 *   lives as an arm of `InferDependentExpression` below — TypeScript has
 *   no type-level lambdas, so a parameterized "how to compute the result"
 *   cannot be stored in a registry entry; the hand-written arm is the
 *   irreducible per-operator inference code. A missing arm degrades to
 *   `unknown`, never to a wrong type or a dropped field.
 * - `category`: the operator's category — the category key sets and
 *   unions (`ArrayExpression`, ...) are DERIVED from this field, so the
 *   category is declared exactly once (pinned by `_EveryOpCategorized`).
 *
 * Being an interface, members resolve lazily and mutual recursion with the
 * derived `Expression` union is safe.
 *
 * Operand ARRAY positions are `readonly`: a readonly target accepts both
 * mutable and `as const` (readonly) user operands — both valid MongoDB —
 * so the Validate re-checks need no per-literal readonly stripping (a
 * DeepMutable approach measured +280k instantiations / 2x check time by
 * defeating the relation cache).
 */
export interface ExpressionSpec<Schema extends Document> {
  // --- Array operators -----------------------------------------------------
  /** Concatenates arrays. Result element type depends on the literal args. */
  $concatArrays: {
    operand: readonly ArrayOperand<Schema, "$concatArrays">[];
    category: "array";
  };
  /** Returns the size of an array. */
  $size: {
    operand: ArrayOperand<Schema, "$size">;
    returns: number;
    category: "array";
  };
  /** Element at index (0-based; negative counts from the end). */
  $arrayElemAt: {
    operand: readonly [
      ArrayOperand<Schema, "$arrayElemAt">,
      number | FieldReferencesThatInferTo<Schema, number>,
    ];
    category: "array";
  };
  /** Filters an array by a condition (cond uses $$var references; `as`
   *  defaults to `$$this` in MongoDB, so it is optional). */
  $filter: {
    operand: {
      input: ArrayOperand<Schema, "$filter">;
      as?: string;
      cond: unknown;
      limit?: number;
    };
    category: "array";
  };
  /**
   * Transforms each element. `in` needs $$variable tracking we don't have,
   * so the result stays unknown[] ($sum wrapping still infers number).
   */
  $map: {
    operand: { input: ArrayInput<Schema>; as: string; in: unknown };
    returns: unknown[];
    category: "array";
  };
  /** Sums numeric values in an array ($group accumulation lives in group.ts). */
  $sum: {
    operand:
      | FieldReferencesThatInferTo<Schema, number[]>
      | ArrayProducingExpression<Schema>
      | MapExpression<Schema>
      | readonly number[];
    returns: number;
    category: "array";
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
    category: "date";
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
    category: "date";
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
    category: "date";
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
    category: "date";
  };
  /** Converts a Unix-ms number (or numeric expression) to a Date. */
  $toDate: {
    operand: ArithmeticOperand<Schema, "$toDate">;
    returns: Date;
    category: "date";
  };

  // --- Arithmetic operators (all return number) -----------------------------
  $add: {
    operand: readonly ArithmeticOperand<Schema, "$add">[];
    returns: number;
    category: "arithmetic";
  };
  $subtract: {
    operand: ArithmeticPair<Schema, "$subtract">;
    returns: number;
    category: "arithmetic";
  };
  $multiply: {
    operand: readonly ArithmeticOperand<Schema, "$multiply">[];
    returns: number;
    category: "arithmetic";
  };
  $divide: {
    operand: ArithmeticPair<Schema, "$divide">;
    returns: number;
    category: "arithmetic";
  };
  $mod: {
    operand: ArithmeticPair<Schema, "$mod">;
    returns: number;
    category: "arithmetic";
  };

  // --- String operators ------------------------------------------------------
  /** Concatenates strings. */
  $concat: {
    operand: readonly StringOperand<Schema, "$concat">[];
    returns: string;
    category: "string";
  };

  // --- Conditional operators (results depend on the literal args) -----------
  /** First non-null operand. */
  $ifNull: {
    operand: readonly [
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
      ...ConditionalOperand<Schema>[],
    ];
    category: "conditional";
  };
  /** Ternary: [condition, thenValue, elseValue]. */
  $cond: {
    operand: readonly [
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
    ];
    category: "conditional";
  };

  // --- Variable binding ------------------------------------------------------
  /** Binds $$vars for a sub-expression; result not tracked. */
  $let: {
    operand: { vars: Record<string, unknown>; in: unknown };
    returns: unknown;
    category: "variable";
  };

  // --- Literal ----------------------------------------------------------------
  /** Returns the value without parsing; result is the literal's own type. */
  $literal: { operand: unknown; category: "literal" };

  // --- Comparison operators (all return boolean) ------------------------------
  $in: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
    category: "comparison";
  };
  $eq: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
    category: "comparison";
  };
  $ne: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
    category: "comparison";
  };
  $gt: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
    category: "comparison";
  };
  $gte: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
    category: "comparison";
  };
  $lt: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
    category: "comparison";
  };
  $lte: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
    category: "comparison";
  };
}

/**
 * Aggregation expression operators that are VALID MongoDB but not yet
 * modeled by the registry. They are allow-listed BY NAME: accepted with no
 * operand validation and no result inference (results degrade to
 * `unknown`), so real pipelines compile while a typo'd operator brands
 * with `UnknownOperatorError` (utils/errors.ts).
 *
 * DO NOT widen this to `` `$${string}` `` — the explicit list is exactly
 * what makes unknown-operator rejection possible.
 *
 * Implementing one of these = add its `ExpressionSpec` entry (plus a
 * dependent-inference arm if literal-dependent) and DELETE it from this
 * list. If a valid operator is missing here, the fix is to add it here —
 * never to loosen the checks that consume the list.
 */
export type UnimplementedExpressionOps =
  // Accumulators usable in expression position ($project/$set over arrays)
  | "$avg"
  | "$max"
  | "$min"
  | "$median"
  | "$percentile"
  | "$stdDevPop"
  | "$stdDevSamp"
  // Arithmetic
  | "$abs"
  | "$ceil"
  | "$exp"
  | "$floor"
  | "$ln"
  | "$log"
  | "$log10"
  | "$pow"
  | "$round"
  | "$sqrt"
  | "$trunc"
  // Array
  | "$arrayToObject"
  | "$first"
  | "$firstN"
  | "$indexOfArray"
  | "$isArray"
  | "$last"
  | "$lastN"
  | "$maxN"
  | "$minN"
  | "$objectToArray"
  | "$range"
  | "$reduce"
  | "$reverseArray"
  | "$slice"
  | "$sortArray"
  | "$zip"
  // Bitwise
  | "$bitAnd"
  | "$bitNot"
  | "$bitOr"
  | "$bitXor"
  // Boolean
  | "$and"
  | "$not"
  | "$or"
  // Comparison
  | "$cmp"
  // Conditional
  | "$switch"
  // Custom
  | "$accumulator"
  | "$function"
  // Data size
  | "$binarySize"
  | "$bsonSize"
  // Date
  | "$dateDiff"
  | "$dateFromParts"
  | "$dateFromString"
  | "$dateToParts"
  | "$dayOfMonth"
  | "$dayOfWeek"
  | "$dayOfYear"
  | "$hour"
  | "$isoDayOfWeek"
  | "$isoWeek"
  | "$isoWeekYear"
  | "$millisecond"
  | "$minute"
  | "$month"
  | "$second"
  | "$week"
  | "$year"
  // Miscellaneous
  | "$getField"
  | "$rand"
  | "$sampleRate"
  | "$toHashedIndexKey"
  // Object
  | "$mergeObjects"
  | "$setField"
  | "$unsetField"
  // Set
  | "$allElementsTrue"
  | "$anyElementTrue"
  | "$setDifference"
  | "$setEquals"
  | "$setIntersection"
  | "$setIsSubset"
  | "$setUnion"
  // String
  | "$indexOfBytes"
  | "$indexOfCP"
  | "$ltrim"
  | "$regexFind"
  | "$regexFindAll"
  | "$regexMatch"
  | "$replaceAll"
  | "$replaceOne"
  | "$rtrim"
  | "$split"
  | "$strLenBytes"
  | "$strLenCP"
  | "$strcasecmp"
  | "$substr"
  | "$substrBytes"
  | "$substrCP"
  | "$toLower"
  | "$toUpper"
  | "$trim"
  // Text
  | "$meta"
  // Timestamp
  | "$tsIncrement"
  | "$tsSecond"
  // Type conversion / inspection
  | "$convert"
  | "$isNumber"
  | "$toBool"
  | "$toDecimal"
  | "$toDouble"
  | "$toInt"
  | "$toLong"
  | "$toObjectId"
  | "$toString"
  | "$type";

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

/**
 * Registry keys whose declared `returns` is assignable to `T` — derived, so
 * a new registry entry joins automatically. Used to build "any expression
 * producing a T" operand arms (e.g. numeric accumulators accepting
 * `{ $size: ... }`).
 */
type OpsReturning<Schema extends Document, T> = {
  [K in keyof ExpressionSpec<Schema>]: ExpressionSpec<Schema>[K] extends (
    { returns: infer R }
  ) ?
    R extends T ?
      K
    : never
  : never; // literal-dependent (no declared `returns`) — never in a fixed set
}[keyof ExpressionSpec<Schema>];

/** Union of expression shapes whose declared result is assignable to `T`. */
export type ExpressionsReturning<Schema extends Document, T> = ExpressionFor<
  Schema,
  OpsReturning<Schema, T>
>;

// Category key sets — DERIVED from the registry's per-entry `category`
// field, so an operator's category is declared exactly once, on its entry.
// Schema-free by construction: entry keys and categories don't depend on
// Schema, so the filter runs once against `ExpressionSpec<Document>` and is
// alias-cached globally. `_EveryOpCategorized`
// (expressions.typeAssertions.ts) pins that no entry omits its category.

/** Closed set of registry categories — every entry declares exactly one. */
export type ExpressionCategory =
  | "array"
  | "date"
  | "arithmetic"
  | "string"
  | "conditional"
  | "variable"
  | "literal"
  | "comparison";

/** Registry keys whose entry declares `category: C`. */
export type OpsInCategory<C extends ExpressionCategory> = {
  [K in keyof ExpressionSpec<Document>]: ExpressionSpec<Document>[K] extends (
    { category: C }
  ) ?
    K
  : never;
}[keyof ExpressionSpec<Document>];

type ArrayOps = OpsInCategory<"array">;
type DateOps = OpsInCategory<"date">;
type ArithmeticOps = OpsInCategory<"arithmetic">;
type StringOps = OpsInCategory<"string">;
type ConditionalOps = OpsInCategory<"conditional">;
type VariableOps = OpsInCategory<"variable">;
type ComparisonOps = OpsInCategory<"comparison">;

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
// Inference — operator-key dispatch
// ----------------------------------------------------------------------------

/**
 * Operators whose result type depends on the literal arguments rather than
 * being fixed in the registry — DERIVED: an entry declares this by
 * OMITTING `returns` (fixed-return operators declare one), which co-locates
 * the "my result is argument-dependent" fact on the entry itself. Each such
 * operator needs a matching `InferDependentExpression` arm; a missing arm
 * degrades gracefully to `unknown` (the dispatch tail), it does not produce
 * a wrong type or drop the field. Pinned by `_DerivedLiteralDependentOps`
 * (expressions.typeAssertions.ts).
 */
export type LiteralDependentOps = {
  [K in keyof ExpressionSpec<Document>]: ExpressionSpec<Document>[K] extends (
    { returns: unknown }
  ) ?
    never
  : K;
}[keyof ExpressionSpec<Document>];

/**
 * Helper to get union of all array element types
 * Recursively processes each array in the concat list
 */
type UnionArrayElements<
  Schema extends Document,
  Arrays extends readonly unknown[],
> =
  Arrays extends readonly [infer First, ...infer Rest] ?
    GetArrayElement<Schema, First> | UnionArrayElements<Schema, Rest>
  : never;

/**
 * Helper to extract element type from a single array argument
 * Handles both field references and array literals
 */
type GetArrayElement<Schema extends Document, Item> =
  Item extends readonly (infer E)[] ?
    E // Array literal - extract element type
  : Item extends FieldReference<Schema> ?
    InferFieldReference<Schema, Item> extends (infer T)[] ?
      T // Field reference to array - extract element type
    : never
  : HasOperatorKey<Item> extends true ?
    // Array-producing expression item ($filter/$concatArrays/$map/...):
    // route through the single dispatch and unwrap. Without this arm the
    // item's elements silently vanished from the result — a WRONG type,
    // violating the degrade-to-widest contract.
    InferExpression<Schema, Item> extends infer R ?
      R extends (infer T)[] ?
        T
      : unknown
    : never
  : never;

/**
 * Helper to extract element type from an array source (field ref or literal)
 */
type InferArrayElementType<Schema extends Document, ArraySource> =
  // Array literal - extract element type
  ArraySource extends readonly (infer E)[] ? E
  : // Field reference to array - get element type
  ArraySource extends FieldReference<Schema> ?
    InferFieldReference<Schema, ArraySource> extends (infer T)[] ?
      T
    : unknown
  : unknown;

/**
 * Shared operand inference for the conditional operators. The only semantic
 * difference between $ifNull and $cond is null handling, captured by
 * `SwallowsNull`: $ifNull returns the first NON-null operand, so null
 * literals contribute `never` and nullable field references are stripped;
 * $cond returns whichever branch is chosen, nulls included. Non-expression
 * operands are detected via the NotAnExpression sentinel and treated as
 * literals.
 */
type InferConditionalOperandValue<
  Schema extends Document,
  Operand,
  SwallowsNull extends boolean,
> =
  Operand extends null ?
    SwallowsNull extends true ?
      never // $ifNull skips null literals, they're never returned
    : null // $cond CAN return null if it's in a branch
  : Operand extends FieldReference<Schema> ?
    SwallowsNull extends true ?
      NonNullable<InferFieldReference<Schema, Operand>>
    : InferFieldReference<Schema, Operand> // $cond keeps the field's null
  : Operand extends readonly (infer T)[] ?
    T // Array literal
  : InferExpression<Schema, Operand> extends infer R ?
    [R] extends [NotAnExpression] ?
      Operand // Not an expression, treat as literal
    : R // Is an expression — single dispatch, no second inference path
  : never;

type InferIfNullOperand<
  Schema extends Document,
  Operand,
> = InferConditionalOperandValue<Schema, Operand, true>;

type InferCondOperand<
  Schema extends Document,
  Operand,
> = InferConditionalOperandValue<Schema, Operand, false>;

/**
 * Helper to infer the union of all operand types in $ifNull
 * Recursively processes each operand and unions their types (filtering nulls)
 */
type UnionIfNullOperandTypes<
  Schema extends Document,
  Operands extends readonly unknown[],
> =
  Operands extends readonly [infer First, ...infer Rest] ?
    InferIfNullOperand<Schema, First> | UnionIfNullOperandTypes<Schema, Rest>
  : never;

/**
 * Hand-written inference arms for the literal-dependent operators — the only
 * per-operator inference code left after the registry rebuild.
 *
 * All array/tuple PATTERNS here are `readonly`: since the registry's operand
 * positions became readonly, `<const>` call sites infer readonly tuples, and
 * a readonly pattern matches both mutabilities while a mutable pattern
 * matches neither (a mutable-pattern arm silently falls through and the
 * resolver DROPS the field).
 */
type InferDependentExpression<Schema extends Document, Expr> =
  Expr extends { $concatArrays: infer Arrays } ?
    Arrays extends readonly unknown[] ?
      UnionArrayElements<Schema, Arrays>[]
    : never
  : Expr extends { $arrayElemAt: readonly [infer ArraySource, unknown] } ?
    InferArrayElementType<Schema, ArraySource>
  : Expr extends { $filter: { input: infer ArraySource } } ?
    InferArrayElementType<Schema, ArraySource>[]
  : Expr extends { $ifNull: infer Operands } ?
    Operands extends readonly unknown[] ?
      UnionIfNullOperandTypes<Schema, Operands>
    : never
  : Expr extends { $cond: readonly [unknown, infer TrueVal, infer FalseVal] } ?
    InferCondOperand<Schema, TrueVal> | InferCondOperand<Schema, FalseVal>
  : Expr extends { $literal: infer Value } ? Value
  : // No matching arm (out-of-lockstep operator, or a malformed operand
    // shape the patterns don't match): degrade to `unknown`, mirroring the
    // dispatch tail — `never` here would DROP the field from resolvers.
    unknown;

/**
 * Infer the result type of any expression — THE single dispatch:
 *
 *  - no `$`-prefixed key → `NotAnExpression` sentinel (the value is a
 *    literal; callers like InferNestedFieldReference treat it as such);
 *  - more than one `$` key → exactly-one-operator brand (invalid in MongoDB);
 *  - literal-dependent operator → hand-written arm refines from the args;
 *  - known fixed-return operator → the registry's `returns` (FORGIVING:
 *    a malformed operand does not change the inferred kind — the operand
 *    brand reports the error at the input position);
 *  - unregistered `$` operator (allow-listed or typo) → `unknown`;
 *    validation, not inference, rejects the typos.
 */
export type InferExpression<Schema extends Document, Expr> =
  [OperatorKeyOf<Expr>] extends [never] ? NotAnExpression
  : HasSingleOperatorKey<Expr> extends false ? MultiOperatorError
  : [OperatorKeyOf<Expr>] extends [LiteralDependentOps] ?
    InferDependentExpression<Schema, Expr>
  : [OperatorKeyOf<Expr>] extends [keyof ExpressionSpec<Schema>] ?
    // Declared `returns` of a registered operator; a dependent entry the
    // arm dispatch missed degrades to `unknown` (never a dropped field).
    ExpressionSpec<Schema>[OperatorKeyOf<Expr> &
      keyof ExpressionSpec<Schema>] extends { returns: infer R } ?
      R
    : unknown
  : // Unregistered operator: degrade to `unknown`, never to a dropped
    // field — `never` here made the resolvers DROP it, and a later stage
    // reading it errored with a misleading Field-not-on-schema. Inference
    // stays lenient for ALL unregistered keys (allow-listed
    // UnimplementedExpressionOps AND typos alike): rejection is
    // validation's job (elements/validation.ts brands operators outside
    // registry + allow-list), and a branded call site never ships, so its
    // inferred output type is moot.
    unknown;

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
