import { Document, NonExpandableTypes } from "../utils/objects";
import {
  MultiOperatorError,
  PipeSafeError,
  RequiresMsg,
} from "../utils/errors";
import {
  HasSingleOperatorKey,
  NotAnExpression,
  OperatorKeyOf,
} from "../utils/dispatch";
import { ExpressionOperand } from "./operands";
import {
  FieldReference,
  GetFieldTypeWithoutArrays,
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
 * Set-operator operand — everything `ArrayOperand` accepts plus the
 * array-producing operators that commonly feed set operators but sit
 * outside `ArrayProducingExpression`'s circularity-avoiding core:
 * `$reduce` (accumulate-then-dedupe), `$ifNull` (defaulting an optional
 * array field to `[]`), and the set operators THEMSELVES — each resolves to
 * an array, so `$setUnion: [{ $setIntersection: [...] }, ...]` is valid
 * MongoDB. The mutual recursion (a set operator's operand references
 * `SetOperand`, which references the set operators) is safe because
 * `ExpressionSpec` is an interface and resolves lazily. Plus
 * `$$`-system/`let`-variable references (`$setUnion: ["$labels",
 * "$$localTags"]` inside a $lookup-let sub-pipeline is valid MongoDB;
 * element inference degrades to `unknown`). The branded arm comes from
 * `ArrayOperand` with the set operator's own name.
 */
type SetOperand<Schema extends Document, Op extends string> =
  | ArrayOperand<Schema, Op>
  | ExpressionFor<
      Schema,
      | "$reduce"
      | "$ifNull"
      | "$setUnion"
      | "$setIntersection"
      | "$setDifference"
    >
  | `$$${string}`;

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
 * Operand of the date-part operators ($hour, $dayOfWeek, $month, ...), which
 * MongoDB accepts either as a bare date expression or as the
 * `{ date, timezone }` object form.
 */
type DatePartOperand<Schema extends Document, Op extends string> =
  | DateOperand<Schema, Op>
  | { date: DateOperand<Schema, Op>; timezone?: string };

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
 * Does not support nested expressions to keep things simple.
 *
 * The literal arm is deliberately the FULL `string` (which subsumes
 * `$`-strings): this type sits in ACCEPTANCE positions, where narrowing to
 * NoDollarString would reject legit separators (" ", "(", ""). The actual
 * rejection of typo'd/non-string `$`-refs happens element-wise in
 * ValidateConcatValue (elements/validation.ts), which dispatches BEFORE the
 * registry relation — so the wide literal arm here cannot swallow them at
 * chained call sites. The brand's message is what ValidateConcatElement
 * surfaces (same RequiresMsg).
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
 * Valid inputs for array operations: field references, literals,
 * expressions, or `$$`-system/`let`-variable references (`$map`/`$reduce`
 * over `"$$localTags"` inside a $lookup-let sub-pipeline is valid MongoDB;
 * element inference degrades to `unknown`).
 */
export type ArrayInput<Schema extends Document> =
  | FieldReferencesThatInferTo<Schema, unknown[]>
  | ArrayProducingExpression<Schema>
  | unknown[]
  | `$$${string}`;

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
 * The operator's CATEGORY is declared by membership in the matching
 * `*_EXPRESSION_OPERATORS` const array (below the registry). Those arrays
 * are AUTHORITATIVE — this registry must carry an entry for every listed
 * operator (the composed list's `satisfies` surfaces a missing entry at
 * the array declaration); the category unions derive from the arrays.
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
  };
  /** Returns the size of an array. */
  $size: {
    operand: ArrayOperand<Schema, "$size">;
    returns: number;
  };
  /** Element at index (0-based; negative counts from the end). */
  $arrayElemAt: {
    operand: readonly [
      ArrayOperand<Schema, "$arrayElemAt">,
      number | FieldReferencesThatInferTo<Schema, number>,
    ];
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
  };
  /**
   * Transforms each element. `as` is optional and defaults to `$$this`
   * (per MongoDB). Result is literal-dependent: the `in` expression is
   * resolved with the element variable in scope (`InferScopedExpression`);
   * unresolvable `in` shapes degrade to unknown, never to a wrong type.
   */
  $map: {
    operand: { input: ArrayInput<Schema>; as?: string; in: unknown };
  };
  /**
   * Folds an array into a single value: `in` is evaluated per element with
   * `$$this` (the element) and `$$value` (the accumulator, seeded by
   * `initialValue`) in scope. `initialValue` evaluates BEFORE iteration
   * begins (per MongoDB), so neither variable is in scope there. Result is
   * literal-dependent: see the `InferDependentExpression` arm.
   */
  $reduce: {
    operand: {
      input: ArrayInput<Schema>;
      initialValue: unknown;
      in: unknown;
    };
  };
  /** Distinct elements appearing in ANY of the input arrays. */
  $setUnion: {
    operand: readonly SetOperand<Schema, "$setUnion">[];
  };
  /** Distinct elements appearing in ALL of the input arrays. */
  $setIntersection: {
    operand: readonly SetOperand<Schema, "$setIntersection">[];
  };
  /** Elements of the FIRST array that do not appear in the second. */
  $setDifference: {
    operand: readonly [
      SetOperand<Schema, "$setDifference">,
      SetOperand<Schema, "$setDifference">,
    ];
  };
  /** Sums numeric values in an array ($group accumulation lives in group.ts). */
  $sum: {
    operand:
      | FieldReferencesThatInferTo<Schema, number[]>
      | ArrayProducingExpression<Schema>
      | MapExpression<Schema>
      | readonly number[];
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
  $toDate: {
    operand: ArithmeticOperand<Schema, "$toDate">;
    returns: Date;
  };
  /**
   * The date-part family. Thirteen operators with one operand shape and one
   * result type between them, so they are registered as a block rather than
   * as thirteen paragraphs that would each say the same thing.
   */
  $year: { operand: DatePartOperand<Schema, "$year">; returns: number };
  $month: { operand: DatePartOperand<Schema, "$month">; returns: number };
  $dayOfMonth: {
    operand: DatePartOperand<Schema, "$dayOfMonth">;
    returns: number;
  };
  $dayOfWeek: {
    operand: DatePartOperand<Schema, "$dayOfWeek">;
    returns: number;
  };
  $dayOfYear: {
    operand: DatePartOperand<Schema, "$dayOfYear">;
    returns: number;
  };
  $hour: { operand: DatePartOperand<Schema, "$hour">; returns: number };
  $minute: { operand: DatePartOperand<Schema, "$minute">; returns: number };
  $second: { operand: DatePartOperand<Schema, "$second">; returns: number };
  $millisecond: {
    operand: DatePartOperand<Schema, "$millisecond">;
    returns: number;
  };
  $week: { operand: DatePartOperand<Schema, "$week">; returns: number };
  $isoDayOfWeek: {
    operand: DatePartOperand<Schema, "$isoDayOfWeek">;
    returns: number;
  };
  $isoWeek: { operand: DatePartOperand<Schema, "$isoWeek">; returns: number };
  $isoWeekYear: {
    operand: DatePartOperand<Schema, "$isoWeekYear">;
    returns: number;
  };

  // --- Arithmetic operators (all return number) -----------------------------
  $add: {
    operand: readonly ArithmeticOperand<Schema, "$add">[];
    returns: number;
  };
  $subtract: {
    operand: ArithmeticPair<Schema, "$subtract">;
    returns: number;
  };
  $multiply: {
    operand: readonly ArithmeticOperand<Schema, "$multiply">[];
    returns: number;
  };
  $divide: {
    operand: ArithmeticPair<Schema, "$divide">;
    returns: number;
  };
  $mod: {
    operand: ArithmeticPair<Schema, "$mod">;
    returns: number;
  };

  // --- String operators ------------------------------------------------------
  /** Concatenates strings. */
  $concat: {
    operand: readonly StringOperand<Schema, "$concat">[];
    returns: string;
  };

  // --- Conditional operators (results depend on the literal args) -----------
  /** First non-null operand. */
  $ifNull: {
    operand: readonly [
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
      ...ConditionalOperand<Schema>[],
    ];
  };
  /** Ternary: [condition, thenValue, elseValue]. */
  $cond: {
    operand: readonly [
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
      ConditionalOperand<Schema>,
    ];
  };

  // --- Variable binding ------------------------------------------------------
  /** Binds $$vars for a sub-expression; result not tracked. */
  $let: {
    operand: { vars: Record<string, unknown>; in: unknown };
    returns: unknown;
  };

  // --- Literal ----------------------------------------------------------------
  /** Returns the value without parsing; result is the literal's own type. */
  $literal: { operand: unknown };

  // --- Comparison operators (all return boolean) ------------------------------
  $in: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
  };
  $eq: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
  };
  $ne: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
  };
  $gt: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
  };
  $gte: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
  };
  $lt: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
  };
  $lte: {
    operand: ComparisonPair<Schema>;
    returns: boolean;
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
  | "$setEquals"
  | "$setIsSubset"
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
  // Trigonometry
  | "$acos"
  | "$acosh"
  | "$asin"
  | "$asinh"
  | "$atan"
  | "$atan2"
  | "$atanh"
  | "$cos"
  | "$cosh"
  | "$degreesToRadians"
  | "$radiansToDegrees"
  | "$sin"
  | "$sinh"
  | "$tan"
  | "$tanh"
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
  | "$toUUID"
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

// ---------------------------------------------------------------------------
// Runtime operator-name lists — AUTHORITATIVE. The pattern, used throughout
// the package: declare a const array, infer its string union right next to
// it (`(typeof X)[number]`), compose bigger lists by spreading, and use
// `Record<Union, V>` where an object-shaped view is needed. The registry
// conforms to these lists, not the other way around: the `satisfies` on the
// composed list is the cheapest compile-time tie, and an error there reads
// "the registry is missing an entry for this operator" — not doubt about
// the list. (A registry key absent from the lists is caught by the
// completions suite's exact-match ideals.) Never keep the two sides in sync
// with assertion pins.
// ---------------------------------------------------------------------------

export const ARRAY_EXPRESSION_OPERATORS = [
  "$concatArrays",
  "$size",
  "$arrayElemAt",
  "$filter",
  "$map",
  "$reduce",
  "$setUnion",
  "$setIntersection",
  "$setDifference",
  "$sum",
] as const;
type ArrayOps = (typeof ARRAY_EXPRESSION_OPERATORS)[number];

export const DATE_EXPRESSION_OPERATORS = [
  "$dateToString",
  "$dateTrunc",
  "$dateAdd",
  "$dateSubtract",
  "$toDate",
  "$year",
  "$month",
  "$dayOfMonth",
  "$dayOfWeek",
  "$dayOfYear",
  "$hour",
  "$minute",
  "$second",
  "$millisecond",
  "$week",
  "$isoDayOfWeek",
  "$isoWeek",
  "$isoWeekYear",
] as const;
type DateOps = (typeof DATE_EXPRESSION_OPERATORS)[number];

export const ARITHMETIC_EXPRESSION_OPERATORS = [
  "$add",
  "$subtract",
  "$multiply",
  "$divide",
  "$mod",
] as const;
type ArithmeticOps = (typeof ARITHMETIC_EXPRESSION_OPERATORS)[number];

export const STRING_EXPRESSION_OPERATORS = ["$concat"] as const;
type StringOps = (typeof STRING_EXPRESSION_OPERATORS)[number];

export const CONDITIONAL_EXPRESSION_OPERATORS = ["$ifNull", "$cond"] as const;
type ConditionalOps = (typeof CONDITIONAL_EXPRESSION_OPERATORS)[number];

export const VARIABLE_EXPRESSION_OPERATORS = ["$let"] as const;
type VariableOps = (typeof VARIABLE_EXPRESSION_OPERATORS)[number];

// No derived union: nothing consumes a literal-category operator type.
export const LITERAL_EXPRESSION_OPERATORS = ["$literal"] as const;

export const COMPARISON_EXPRESSION_OPERATORS = [
  "$in",
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
] as const;
type ComparisonOps = (typeof COMPARISON_EXPRESSION_OPERATORS)[number];

/** Every registered expression operator — the per-category lists spread
 * together. */
export const EXPRESSION_OPERATORS = [
  ...ARRAY_EXPRESSION_OPERATORS,
  ...DATE_EXPRESSION_OPERATORS,
  ...ARITHMETIC_EXPRESSION_OPERATORS,
  ...STRING_EXPRESSION_OPERATORS,
  ...CONDITIONAL_EXPRESSION_OPERATORS,
  ...VARIABLE_EXPRESSION_OPERATORS,
  ...LITERAL_EXPRESSION_OPERATORS,
  ...COMPARISON_EXPRESSION_OPERATORS,
] as const satisfies readonly (keyof ExpressionSpec<Document>)[];
type ExpressionOperator = (typeof EXPRESSION_OPERATORS)[number];

/** Closed set of registry categories. */
export type ExpressionCategory =
  | "array"
  | "date"
  | "arithmetic"
  | "string"
  | "conditional"
  | "variable"
  | "literal"
  | "comparison";

/** Object-shaped view of the lists: category → its operator array. */
export const EXPRESSION_OPERATORS_BY_CATEGORY = {
  array: ARRAY_EXPRESSION_OPERATORS,
  date: DATE_EXPRESSION_OPERATORS,
  arithmetic: ARITHMETIC_EXPRESSION_OPERATORS,
  string: STRING_EXPRESSION_OPERATORS,
  conditional: CONDITIONAL_EXPRESSION_OPERATORS,
  variable: VARIABLE_EXPRESSION_OPERATORS,
  literal: LITERAL_EXPRESSION_OPERATORS,
  comparison: COMPARISON_EXPRESSION_OPERATORS,
} as const satisfies Record<ExpressionCategory, readonly ExpressionOperator[]>;

/** Registry keys filed under category `C` — derived from the lists. */
export type OpsInCategory<C extends ExpressionCategory> =
  (typeof EXPRESSION_OPERATORS_BY_CATEGORY)[C][number];

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
export type SetUnionExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$setUnion"
>;
export type SetIntersectionExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$setIntersection"
>;
export type SetDifferenceExpression<Schema extends Document> = ExpressionFor<
  Schema,
  "$setDifference"
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

// ============================================================================
// Literal-dependent inference: ONE walk, parameterized by the variable scope
// ($$this / $$value inside $map and $reduce). Top-level expressions are the
// empty scope (`Vars = {}`).
// ============================================================================

/** Extracts the element type of an array type; never for non-arrays,
 *  unknown for untracked (`unknown`) operands. */
type ElementOfArray<T> =
  unknown extends T ? unknown
  : T extends readonly (infer E)[] ? E
  : never;

type NullIn<T> = [Extract<T, null | undefined>] extends [never] ? never : null;

/** `Vars` with `Name` bound to `T`; inner bindings shadow outer ones. */
type BindVar<Vars extends Document, Name extends string, T> = Omit<
  Vars,
  Name
> & { [K in Name]: T };

/**
 * Resolves a `$$variable` or `$$variable.path` reference (without the `$$`
 * prefix) against an in-scope variable map, e.g. `{ this: Element }` for
 * $map or `{ this: Element; value: Accumulator }` for $reduce. Variables we
 * can't track (user-defined $let vars, system variables like $$NOW) resolve
 * to `unknown` so surrounding inference degrades gracefully instead of
 * producing `never` (which would DROP fields from resolvers).
 */
/** Unresolvable path: validation brands it, inference degrades to unknown;
 *  union members missing the path read as null. */
type DegradeBrand<T> =
  [T] extends [PipeSafeError<string>] ? unknown
  : T extends PipeSafeError<string> ? null
  : T;

type ResolveScopedVariable<Vars extends Document, Ref extends string> =
  Ref extends `${infer Name}.${infer Path}` ?
    Name extends keyof Vars ?
      DegradeBrand<GetFieldTypeWithoutArrays<Vars[Name], Path>>
    : unknown
  : Ref extends keyof Vars ? Vars[Ref]
  : unknown;

/**
 * Infers any expression VALUE inside a variable scope: `$$var` / `$$var.path`
 * resolve through `Vars`; single-`$` references resolve against the ROOT
 * schema (a `$path` inside $map/$reduce still reads the root document);
 * operator objects go through the single `InferExpression` dispatch with the
 * scope; `$`-less literals resolve member-wise, mirroring
 * InferNestedFieldReference.
 */
type InferScopedExpression<
  Schema extends Document,
  Vars extends Document,
  Expr,
> =
  Expr extends "$$REMOVE" ? never
  : Expr extends `$$${infer Ref}` ? ResolveScopedVariable<Vars, Ref>
  : Expr extends `$${infer Path}` ?
    DegradeBrand<GetFieldTypeWithoutArrays<Schema, Path>>
  : Expr extends string ? Expr
  : [OperatorKeyOf<Expr>] extends [never] ?
    Expr extends readonly unknown[] ?
      { [I in keyof Expr]: InferScopedExpression<Schema, Vars, Expr[I]> }
    : Expr extends object ?
      Expr extends NonExpandableTypes ?
        Expr
      : { [K in keyof Expr]: InferScopedExpression<Schema, Vars, Expr[K]> }
    : Expr
  : InferExpression<Schema, Expr, Vars>;

/** Element type of an array INPUT ($map/$filter/$reduce/$arrayElemAt);
 *  null-stripped, non-arrays degrade to unknown. */
type InputElement<Schema extends Document, Vars extends Document, Source> =
  NonNullable<InferScopedExpression<Schema, Vars, Source>> extends (
    readonly (infer E)[]
  ) ?
    E
  : unknown;

/**
 * Result of the array-combining operators: the union of the element types of
 * `ElementOperands`, plus `null` when any of `Operands` can be null or
 * missing (MongoDB then returns null).
 */
type ArrayResult<
  Schema extends Document,
  Vars extends Document,
  Operands,
  ElementOperands = Operands,
> =
  | ElementOfArray<InferScopedExpression<Schema, Vars, ElementOperands>>[]
  | NullIn<InferScopedExpression<Schema, Vars, Operands>> extends infer R ?
    R // evaluated, so hovers show the type rather than this alias
  : never;

/** $ifNull skips null literals and null-strips the rest; `unknown` stays
 *  `unknown` (`NonNullable<unknown>` would collapse to `{}`). */
type IfNullOperand<Schema extends Document, Vars extends Document, Operand> =
  Operand extends null ? never
  : InferScopedExpression<Schema, Vars, Operand> extends infer R ?
    unknown extends R ?
      R
    : NonNullable<R>
  : never;

/**
 * The scope a $map `in` sees: the element is bound as `$$this` unless the
 * literal declares a custom `as` name (MongoDB does NOT rebind `$$this`
 * then). A widened (non-literal) `as` can't be tracked: only the outer scope
 * stays visible.
 */
type MapScopeVars<Vars extends Document, Expr, Element> =
  Expr extends { $map: { as: infer As } } ?
    As extends string ?
      string extends As ?
        Vars
      : BindVar<Vars, As, Element>
    : Vars
  : BindVar<Vars, "this", Element>;

/**
 * Hand-written inference arms for the literal-dependent operators — the only
 * per-operator inference code left after the registry rebuild. Operands are
 * resolved with the caller's variable scope. `$reduce` evaluates `in` once
 * with `$$value` bound to the initialValue's type (initialValue itself is
 * evaluated in the OUTER scope, before iteration).
 */
type InferDependentExpression<
  Schema extends Document,
  Expr,
  Vars extends Document,
> =
  Expr extends { $concatArrays: infer Operands extends readonly unknown[] } ?
    ArrayResult<Schema, Vars, Operands[number]>
  : Expr extends { $arrayElemAt: readonly [infer Source, unknown] } ?
    | InputElement<Schema, Vars, Source>
    | NullIn<InferScopedExpression<Schema, Vars, Source>>
  : Expr extends { $filter: { input: infer Source } } ?
    | InputElement<Schema, Vars, Source>[]
    | NullIn<InferScopedExpression<Schema, Vars, Source>>
  : Expr extends { $map: { input: infer Source; in: infer In } } ?
    | InferScopedExpression<
        Schema,
        MapScopeVars<Vars, Expr, InputElement<Schema, Vars, Source>>,
        In
      >[]
    | NullIn<InferScopedExpression<Schema, Vars, Source>>
  : Expr extends (
    {
      $reduce: {
        input: infer Source;
        initialValue: infer Init;
        in: infer In;
      };
    }
  ) ?
    | InferScopedExpression<
        Schema,
        BindVar<
          BindVar<Vars, "this", InputElement<Schema, Vars, Source>>,
          "value",
          InferScopedExpression<Schema, Vars, Init>
        >,
        In
      >
    | NullIn<InferScopedExpression<Schema, Vars, Source>>
  : Expr extends (
    | { $setUnion: infer Operands extends readonly unknown[] }
    | { $setIntersection: infer Operands extends readonly unknown[] }
  ) ?
    // Intersection shares union's shape: an over-approximation that never
    // widens past the union.
    ArrayResult<Schema, Vars, Operands[number]>
  : Expr extends { $setDifference: readonly [infer First, infer Second] } ?
    // Removing elements never widens: the FIRST operand's element type.
    ArrayResult<Schema, Vars, First | Second, First>
  : Expr extends { $ifNull: readonly [...infer Tests, infer Replacement] } ?
    // The replacement is returned as-is, null included.
    | IfNullOperand<Schema, Vars, Tests[number]>
    | InferScopedExpression<Schema, Vars, Replacement>
  : Expr extends { $cond: readonly [unknown, infer TrueVal, infer FalseVal] } ?
    InferScopedExpression<Schema, Vars, TrueVal | FalseVal>
  : Expr extends { $cond: { then: infer TrueVal; else: infer FalseVal } } ?
    InferScopedExpression<Schema, Vars, TrueVal | FalseVal>
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
export type InferExpression<
  Schema extends Document,
  Expr,
  Vars extends Document = {},
> =
  [OperatorKeyOf<Expr>] extends [never] ? NotAnExpression
  : HasSingleOperatorKey<Expr> extends false ? MultiOperatorError
  : [OperatorKeyOf<Expr>] extends [LiteralDependentOps] ?
    InferDependentExpression<Schema, Expr, Vars>
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
