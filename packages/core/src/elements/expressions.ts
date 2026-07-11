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
  InferNestedFieldReference,
} from "./fieldReference";
import {
  AnyLiteral,
  ExpressionShaped,
  InferVariableReference,
  SystemVariableReferences,
  SystemVariablesThatInferTo,
  VariableReferences,
} from "./literals";

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
  | SystemVariablesThatInferTo<Schema, readonly unknown[]>
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
 * Operands for the flexible conditional operators ($ifNull/$cond) — any
 * literal, null, field or variable reference, or expression
 * (`$cond: [c, "$$REMOVE", "$x"]` and `$ifNull: ["$x", "$$NOW"]` are both
 * idiomatic MongoDB).
 */
type ConditionalOperand<Schema extends Document> =
  | null
  | AnyLiteral<Schema>
  | FieldReference<Schema>
  | SystemVariableReferences<Schema>
  | Expression<Schema>;

/**
 * Comparison operand — values that can be compared, variable references
 * included (`$gte: ["$expiresAt", "$$NOW"]` is idiomatic). Excludes
 * ComparisonExpression to avoid circular reference.
 */
type ComparisonOperand<Schema extends Document> =
  | null
  | AnyLiteral<Schema>
  | FieldReference<Schema>
  | SystemVariableReferences<Schema>
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
 * Valid inputs for array operations: field references, array-typed system
 * variables ("$$USER_ROLES"), literals, or expressions
 */
export type ArrayInput<Schema extends Document> =
  | FieldReferencesThatInferTo<Schema, unknown[]>
  | SystemVariablesThatInferTo<Schema, readonly unknown[]>
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
  /** Filters an array by a condition. `cond` sees the element bound as
   *  `$$this` (or the `as` name); it stays `unknown` at acceptance and is
   *  re-checked by the Vars-aware validation walk. */
  $filter: {
    operand: {
      input: ArrayOperand<Schema, "$filter">;
      as?: string;
      cond: unknown;
      limit?: number;
    };
  };
  /** Transforms each element. `in` sees the element bound as `$$this`
   *  (or the `as` name, optional in MongoDB); the result is the inferred
   *  `in` type lifted to an array — literal-dependent, so no `returns`. */
  $map: {
    operand: { input: ArrayInput<Schema>; as?: string; in: unknown };
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
  /** Binds `$$`-variables. `vars` values evaluate in the OUTER scope; `in`
   *  sees them bound (acceptance stays structural; the Vars-aware walk
   *  re-checks both). The result is the inferred `in` type —
   *  literal-dependent, so no `returns`. */
  $let: {
    operand: { vars: Record<string, unknown>; in: unknown };
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
  "$sum",
] as const;
type ArrayOps = (typeof ARRAY_EXPRESSION_OPERATORS)[number];

export const DATE_EXPRESSION_OPERATORS = [
  "$dateToString",
  "$dateTrunc",
  "$dateAdd",
  "$dateSubtract",
  "$toDate",
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

/**
 * THE computed-value union — what an expression-valued position accepts
 * ($set/$project values, `$lookup.let` values). Spelled once here (stages
 * must not import each other). Every string arm is FINITE per the
 * completion-safety invariants (root CLAUDE.md), so refs/variables
 * autocomplete and a typo'd ref gets TS's native TS2820 "Did you mean"
 * at the value. `Expression<Schema>` is an AUTOCOMPLETE-ONLY member —
 * `ExpressionShaped` subsumes it for checking, so it cannot decide
 * acceptance; do not "fix" acceptance bugs by editing it.
 */
export type ExpressionValue<
  Schema extends Document,
  Vars extends Document = {},
> =
  | AnyLiteral<Schema>
  | Expression<Schema>
  | FieldReference<Schema>
  | SystemVariableReferences<Schema>
  | VariableReferences<Vars>
  | ExpressionShaped;

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
  Vars extends Document = {},
> =
  Arrays extends readonly [infer First, ...infer Rest] ?
    | GetArrayElement<Schema, First, Vars>
    | UnionArrayElements<Schema, Rest, Vars>
  : never;

/**
 * Helper to extract element type from a single array argument
 * Handles field references, `$$`-variable references, and array literals
 */
type GetArrayElement<
  Schema extends Document,
  Item,
  Vars extends Document = {},
> =
  Item extends readonly (infer E)[] ?
    E // Array literal - extract element type
  : Item extends FieldReference<Schema> ?
    InferFieldReference<Schema, Item> extends (infer T)[] ?
      T // Field reference to array - extract element type
    : never
  : Item extends `$$${string}` ?
    // Array-typed variable ("$$USER_ROLES", a bound "$$arr"): resolve and
    // unwrap; non-arrays degrade to unknown (validation owns rejection).
    InferVariableReference<Schema, Item, Vars> extends infer R ?
      R extends readonly (infer T)[] ?
        T
      : unknown
    : never
  : HasOperatorKey<Item> extends true ?
    // Array-producing expression item ($filter/$concatArrays/$map/...):
    // route through the single dispatch and unwrap. Without this arm the
    // item's elements silently vanished from the result — a WRONG type,
    // violating the degrade-to-widest contract.
    InferExpression<Schema, Item, Vars> extends infer R ?
      R extends (infer T)[] ?
        T
      : unknown
    : never
  : never;

/**
 * Element type of an array source (field ref, `$$`-variable reference, or
 * literal). Exported: the validation kernel's $map/$filter walks bind the
 * SAME element type inference uses.
 */
export type InferArrayElementType<
  Schema extends Document,
  ArraySource,
  Vars extends Document = {},
> =
  // Array literal - extract element type
  ArraySource extends readonly (infer E)[] ? E
  : // Field reference to array - get element type
  ArraySource extends FieldReference<Schema> ?
    InferFieldReference<Schema, ArraySource> extends (infer T)[] ?
      T
    : unknown
  : // Array-typed variable ("$$USER_ROLES", a bound "$$arr")
  ArraySource extends `$$${string}` ?
    InferVariableReference<Schema, ArraySource, Vars> extends infer R ?
      R extends readonly (infer T)[] ?
        T
      : unknown
    : never
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
  Vars extends Document = {},
> =
  Operand extends null ?
    SwallowsNull extends true ?
      never // $ifNull skips null literals, they're never returned
    : null // $cond CAN return null if it's in a branch
  : Operand extends FieldReference<Schema> ?
    SwallowsNull extends true ?
      NonNullable<InferFieldReference<Schema, Operand>>
    : InferFieldReference<Schema, Operand> // $cond keeps the field's null
  : Operand extends `$$${string}` ?
    // `$$`-variable branch ($$NOW, "$$REMOVE" for conditional removal, a
    // bound "$$var"): resolve through the same authority as the rest of
    // inference. $$REMOVE's `never` union-absorbs, which IS its semantics.
    SwallowsNull extends true ?
      NonNullable<InferVariableReference<Schema, Operand, Vars>>
    : InferVariableReference<Schema, Operand, Vars>
  : Operand extends readonly (infer T)[] ?
    T // Array literal
  : InferExpression<Schema, Operand, Vars> extends infer R ?
    [R] extends [NotAnExpression] ?
      Operand // Not an expression, treat as literal
    : R // Is an expression — single dispatch, no second inference path
  : never;

type InferIfNullOperand<
  Schema extends Document,
  Operand,
  Vars extends Document = {},
> = InferConditionalOperandValue<Schema, Operand, true, Vars>;

type InferCondOperand<
  Schema extends Document,
  Operand,
  Vars extends Document = {},
> = InferConditionalOperandValue<Schema, Operand, false, Vars>;

/**
 * Helper to infer the union of all operand types in $ifNull
 * Recursively processes each operand and unions their types (filtering nulls)
 */
type UnionIfNullOperandTypes<
  Schema extends Document,
  Operands extends readonly unknown[],
  Vars extends Document = {},
> =
  Operands extends readonly [infer First, ...infer Rest] ?
    | InferIfNullOperand<Schema, First, Vars>
    | UnionIfNullOperandTypes<Schema, Rest, Vars>
  : never;

/**
 * The `as` name a $map/$filter binds its element under (MongoDB defaults to
 * "this" when `as` is omitted). A non-literal `as` (a widened string) binds
 * nothing — lookups of the real name then miss the environment and degrade
 * to `unknown`, never to a wrong type.
 */
export type BoundAsName<Operand> =
  Operand extends { as: infer As extends string } ?
    string extends As ?
      never
    : As
  : "this";

/** Bind one variable name (shadowing any outer binding of the same name).
 *  Single lazy mapped type — no Omit/Prettify (see elements/CLAUDE.md on
 *  env-merge depth). */
export type BindVariable<Vars extends Document, Name extends string, T> = {
  [K in keyof Vars | Name]: K extends Name ? T
  : K extends keyof Vars ? Vars[K]
  : never;
};

/**
 * Evaluate a $let `vars` block in the OUTER environment and bind the
 * results (MongoDB: `vars` values cannot reference same-block siblings;
 * inner bindings shadow outer ones). Shared by inference and the
 * validation walk, so the two environments cannot diverge.
 */
export type BindLetVars<
  Schema extends Document,
  LetVars,
  Vars extends Document,
> = {
  [K in (keyof LetVars & string) | keyof Vars]: K extends keyof LetVars ?
    InferNestedFieldReference<Schema, LetVars[K], Vars>
  : K extends keyof Vars ? Vars[K]
  : never;
};

/**
 * Hand-written inference arms for the literal-dependent operators — the only
 * per-operator inference code left after the registry rebuild.
 *
 * All array/tuple PATTERNS here are `readonly`: since the registry's operand
 * positions became readonly, `<const>` call sites infer readonly tuples, and
 * a readonly pattern matches both mutabilities while a mutable pattern
 * matches neither (a mutable-pattern arm silently falls through and the
 * resolver DROPS the field). The binder arms EXTEND `Vars`
 * (BindVariable/BindLetVars) before recursing into their bound
 * sub-expressions.
 */
type InferDependentExpression<
  Schema extends Document,
  Expr,
  Vars extends Document = {},
> =
  Expr extends { $concatArrays: infer Arrays } ?
    Arrays extends readonly unknown[] ?
      UnionArrayElements<Schema, Arrays, Vars>[]
    : never
  : Expr extends { $arrayElemAt: readonly [infer ArraySource, unknown] } ?
    InferArrayElementType<Schema, ArraySource, Vars>
  : Expr extends { $filter: { input: infer ArraySource } } ?
    InferArrayElementType<Schema, ArraySource, Vars>[]
  : Expr extends { $map: infer MapOperand } ?
    MapOperand extends { input: infer Input; in: infer In } ?
      InferNestedFieldReference<
        Schema,
        In,
        BindVariable<
          Vars,
          BoundAsName<MapOperand>,
          InferArrayElementType<Schema, Input, Vars>
        >
      >[]
    : unknown[] // malformed operand — keep the operator's array result kind
  : Expr extends { $let: { vars: infer LetVars; in: infer In } } ?
    InferNestedFieldReference<Schema, In, BindLetVars<Schema, LetVars, Vars>>
  : Expr extends { $ifNull: infer Operands } ?
    Operands extends readonly unknown[] ?
      UnionIfNullOperandTypes<Schema, Operands, Vars>
    : never
  : Expr extends { $cond: readonly [unknown, infer TrueVal, infer FalseVal] } ?
    | InferCondOperand<Schema, TrueVal, Vars>
    | InferCondOperand<Schema, FalseVal, Vars>
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
