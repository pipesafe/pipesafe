import type { Document } from "../utils/objects";
import type { PipeSafeError } from "../utils/errors";
import type { Assert, AssertPipeSafeError, Equal } from "../utils/tests";
import type {
  ExpressionSpec,
  ExpressionCategory,
  OpsInCategory,
  ARRAY_EXPRESSION_OPERATORS,
  DATE_EXPRESSION_OPERATORS,
  ARITHMETIC_EXPRESSION_OPERATORS,
  STRING_EXPRESSION_OPERATORS,
  CONDITIONAL_EXPRESSION_OPERATORS,
  VARIABLE_EXPRESSION_OPERATORS,
  LITERAL_EXPRESSION_OPERATORS,
  COMPARISON_EXPRESSION_OPERATORS,
  EXPRESSION_OPERATORS,
  LiteralDependentOps,
  UnimplementedExpressionOps,
  AddExpression,
  SubtractExpression,
  MultiplyExpression,
  DivideExpression,
  ModExpression,
  ConcatExpression,
  DateToStringExpression,
  DateTruncExpression,
  DateAddExpression,
  DateSubtractExpression,
  SizeExpression,
  ConcatArraysExpression,
  ArrayElemAtExpression,
  FilterExpression,
} from "./expressions";

/**
 * Type assertions for the typed-error pattern applied to expressions.ts
 * arithmetic operands (Phase C1).
 *
 * `ArithmeticOperandFor<Schema, Op>` wraps the operand union with a branded
 * `PipeSafeError` arm. Wrong-typed operand values surface in IDE hovers as
 * "Operator '$add' requires a numeric operand …" instead of degrading to
 * `never` downstream.
 */

type ArithSchema = {
  count: number;
  name: string;
  joinedAt: Date;
  tags: string[];
};

// Extract the per-operator operand type from each expression. The operand is
// `<Operator>Expression<S>['$op']` (or array element type for variadic ops).

type AddOperandElement<S extends Document> = AddExpression<S>["$add"][number];
type SubtractOperandTuple<S extends Document> =
  SubtractExpression<S>["$subtract"];
type MultiplyOperandElement<S extends Document> =
  MultiplyExpression<S>["$multiply"][number];
type DivideOperandTuple<S extends Document> = DivideExpression<S>["$divide"];
type ModOperandTuple<S extends Document> = ModExpression<S>["$mod"];

// $add operand union must include the branded error arm.
type _Add_Brand = Extract<
  AddOperandElement<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_AddBrand = Assert<
  AssertPipeSafeError<_Add_Brand, "Operator '$add' requires a numeric operand.">
>;

// $subtract operand tuple must be a 2-tuple, each element including the brand.
type _Subtract_FirstElement = SubtractOperandTuple<ArithSchema>[0];
type _Subtract_Brand = Extract<_Subtract_FirstElement, PipeSafeError<string>>;
type _Assert_SubtractBrand = Assert<
  AssertPipeSafeError<
    _Subtract_Brand,
    "Operator '$subtract' requires a numeric operand."
  >
>;
type _Assert_SubtractIs2Tuple = Assert<
  Equal<SubtractOperandTuple<ArithSchema>["length"], 2>
>;

// $multiply operand element must include the brand with the operator name.
type _Multiply_Brand = Extract<
  MultiplyOperandElement<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_MultiplyBrand = Assert<
  AssertPipeSafeError<
    _Multiply_Brand,
    "Operator '$multiply' requires a numeric operand."
  >
>;

// $divide operand tuple — same as $subtract.
type _Divide_FirstElement = DivideOperandTuple<ArithSchema>[0];
type _Divide_Brand = Extract<_Divide_FirstElement, PipeSafeError<string>>;
type _Assert_DivideBrand = Assert<
  AssertPipeSafeError<
    _Divide_Brand,
    "Operator '$divide' requires a numeric operand."
  >
>;

// $mod operand tuple — same shape.
type _Mod_FirstElement = ModOperandTuple<ArithSchema>[0];
type _Mod_Brand = Extract<_Mod_FirstElement, PipeSafeError<string>>;
type _Assert_ModBrand = Assert<
  AssertPipeSafeError<_Mod_Brand, "Operator '$mod' requires a numeric operand.">
>;

// Positive sweep: a literal number is still a valid $add operand.
type _Assert_AddAcceptsNumber = Assert<
  Equal<5 extends AddOperandElement<ArithSchema> ? true : false, true>
>;

// Positive sweep: a field reference to a numeric field is still a valid
// $add operand.
type _Assert_AddAcceptsNumericRef = Assert<
  Equal<"$count" extends AddOperandElement<ArithSchema> ? true : false, true>
>;

// ----------------------------------------------------------------------------
// Phase C2 — $concat string operand
// ----------------------------------------------------------------------------

type ConcatOperandElement<S extends Document> =
  ConcatExpression<S>["$concat"][number];

// $concat operand element must include the brand for non-string operands.
type _Concat_Brand = Extract<
  ConcatOperandElement<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_ConcatBrand = Assert<
  AssertPipeSafeError<
    _Concat_Brand,
    "Operator '$concat' requires a string operand."
  >
>;

// Positive sweeps for $concat.
type _Assert_ConcatAcceptsLiteral = Assert<
  Equal<"hi" extends ConcatOperandElement<ArithSchema> ? true : false, true>
>;
type _Assert_ConcatAcceptsStringRef = Assert<
  Equal<"$name" extends ConcatOperandElement<ArithSchema> ? true : false, true>
>;

// ----------------------------------------------------------------------------
// Phase C3 — Date operand on $dateToString.date / $dateTrunc.date /
// $dateAdd.startDate / $dateSubtract.startDate
// ----------------------------------------------------------------------------

type DateToStringDateOperand<S extends Document> =
  DateToStringExpression<S>["$dateToString"]["date"];
type DateTruncDateOperand<S extends Document> =
  DateTruncExpression<S>["$dateTrunc"]["date"];
type DateAddStartDateOperand<S extends Document> =
  DateAddExpression<S>["$dateAdd"]["startDate"];
type DateSubtractStartDateOperand<S extends Document> =
  DateSubtractExpression<S>["$dateSubtract"]["startDate"];

// Each date operand union must include the branded error arm.
type _DateToString_Brand = Extract<
  DateToStringDateOperand<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_DateToStringBrand = Assert<
  AssertPipeSafeError<
    _DateToString_Brand,
    "Operator '$dateToString' requires a Date operand."
  >
>;

type _DateTrunc_Brand = Extract<
  DateTruncDateOperand<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_DateTruncBrand = Assert<
  AssertPipeSafeError<
    _DateTrunc_Brand,
    "Operator '$dateTrunc' requires a Date operand."
  >
>;

type _DateAdd_Brand = Extract<
  DateAddStartDateOperand<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_DateAddBrand = Assert<
  AssertPipeSafeError<
    _DateAdd_Brand,
    "Operator '$dateAdd' requires a Date operand."
  >
>;

type _DateSubtract_Brand = Extract<
  DateSubtractStartDateOperand<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_DateSubtractBrand = Assert<
  AssertPipeSafeError<
    _DateSubtract_Brand,
    "Operator '$dateSubtract' requires a Date operand."
  >
>;

// Positive sweep: a Date field reference still satisfies the operand.
type _Assert_DateToStringAcceptsDateRef = Assert<
  Equal<
    "$joinedAt" extends DateToStringDateOperand<ArithSchema> ? true : false,
    true
  >
>;

// ----------------------------------------------------------------------------
// Phase C4 — Array operand on $size, $concatArrays, $arrayElemAt, $filter
// ----------------------------------------------------------------------------

type SizeOperand<S extends Document> = SizeExpression<S>["$size"];
type ConcatArraysOperandElement<S extends Document> =
  ConcatArraysExpression<S>["$concatArrays"][number];
type ArrayElemAtFirstOperand<S extends Document> =
  ArrayElemAtExpression<S>["$arrayElemAt"][0];
type FilterInputOperand<S extends Document> =
  FilterExpression<S>["$filter"]["input"];

// Each array operand union must include the branded error arm.
type _Size_Brand = Extract<SizeOperand<ArithSchema>, PipeSafeError<string>>;
type _Assert_SizeBrand = Assert<
  AssertPipeSafeError<
    _Size_Brand,
    "Operator '$size' requires an array operand."
  >
>;

type _ConcatArrays_Brand = Extract<
  ConcatArraysOperandElement<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_ConcatArraysBrand = Assert<
  AssertPipeSafeError<
    _ConcatArrays_Brand,
    "Operator '$concatArrays' requires an array operand."
  >
>;

type _ArrayElemAt_Brand = Extract<
  ArrayElemAtFirstOperand<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_ArrayElemAtBrand = Assert<
  AssertPipeSafeError<
    _ArrayElemAt_Brand,
    "Operator '$arrayElemAt' requires an array operand."
  >
>;

type _Filter_Brand = Extract<
  FilterInputOperand<ArithSchema>,
  PipeSafeError<string>
>;
type _Assert_FilterBrand = Assert<
  AssertPipeSafeError<
    _Filter_Brand,
    "Operator '$filter' requires an array operand."
  >
>;

// Positive sweep: an array field reference still satisfies $size.
type _Assert_SizeAcceptsArrayRef = Assert<
  Equal<"$tags" extends SizeOperand<ArithSchema> ? true : false, true>
>;

// ---------------------------------------------------------------------------
// Registry category lockstep: every ExpressionSpec entry declares a category
// (the key sets are DERIVED from it). An entry with a missing/typo'd
// category would silently vanish from its category union — this pin turns
// that into a compile failure.
// ---------------------------------------------------------------------------

type _EveryOpCategorized = Assert<
  Equal<
    Exclude<keyof ExpressionSpec<Document>, OpsInCategory<ExpressionCategory>>,
    never
  >
>;

// ---------------------------------------------------------------------------
// Runtime array ↔ registry lockstep: the category unions derive from the
// exported *_EXPRESSION_OPERATORS arrays, and these pins verify each array
// against the registry's per-entry `category` declarations — an operator
// added to only one side (entry or array), or filed under the wrong
// category, fails here in both drift directions.
// ---------------------------------------------------------------------------

type _ArrayOpsListed = Assert<
  Equal<(typeof ARRAY_EXPRESSION_OPERATORS)[number], OpsInCategory<"array">>
>;
type _DateOpsListed = Assert<
  Equal<(typeof DATE_EXPRESSION_OPERATORS)[number], OpsInCategory<"date">>
>;
type _ArithmeticOpsListed = Assert<
  Equal<
    (typeof ARITHMETIC_EXPRESSION_OPERATORS)[number],
    OpsInCategory<"arithmetic">
  >
>;
type _StringOpsListed = Assert<
  Equal<(typeof STRING_EXPRESSION_OPERATORS)[number], OpsInCategory<"string">>
>;
type _ConditionalOpsListed = Assert<
  Equal<
    (typeof CONDITIONAL_EXPRESSION_OPERATORS)[number],
    OpsInCategory<"conditional">
  >
>;
type _VariableOpsListed = Assert<
  Equal<
    (typeof VARIABLE_EXPRESSION_OPERATORS)[number],
    OpsInCategory<"variable">
  >
>;
type _LiteralOpsListed = Assert<
  Equal<(typeof LITERAL_EXPRESSION_OPERATORS)[number], OpsInCategory<"literal">>
>;
type _ComparisonOpsListed = Assert<
  Equal<
    (typeof COMPARISON_EXPRESSION_OPERATORS)[number],
    OpsInCategory<"comparison">
  >
>;
type _EveryOpListed = Assert<
  Equal<(typeof EXPRESSION_OPERATORS)[number], keyof ExpressionSpec<Document>>
>;

// The literal-dependent set is DERIVED from `returns`-omission on registry
// entries. This pin (a) documents the current set and (b) catches both
// drift directions: an entry that accidentally drops its `returns` joins
// this union and fails here; a dependent entry that accidentally gains a
// `returns` leaves it and fails here.
type _DerivedLiteralDependentOps = Assert<
  Equal<
    LiteralDependentOps,
    | "$concatArrays"
    | "$arrayElemAt"
    | "$filter"
    | "$ifNull"
    | "$cond"
    | "$literal"
  >
>;

// Registry/allow-list DISJOINTNESS: "add a registry entry + DELETE its
// allow-list line" is the documented recipe, and validation checks the
// registry BEFORE the allow-list — so an operator in both is silently dead
// allow-list weight today, and a validation-ladder reorder would turn it
// into an operand-check bypass. This pin makes the forgotten DELETE step a
// compile failure.
type _RegistryAllowListDisjoint = Assert<
  Equal<
    Extract<keyof ExpressionSpec<Document>, UnimplementedExpressionOps>,
    never
  >
>;

export type {
  _DerivedLiteralDependentOps,
  _EveryOpCategorized,
  _ArrayOpsListed,
  _DateOpsListed,
  _ArithmeticOpsListed,
  _StringOpsListed,
  _ConditionalOpsListed,
  _VariableOpsListed,
  _LiteralOpsListed,
  _ComparisonOpsListed,
  _EveryOpListed,
  _RegistryAllowListDisjoint,
  _Assert_AddBrand,
  _Assert_SubtractBrand,
  _Assert_SubtractIs2Tuple,
  _Assert_MultiplyBrand,
  _Assert_DivideBrand,
  _Assert_ModBrand,
  _Assert_AddAcceptsNumber,
  _Assert_AddAcceptsNumericRef,
  _Assert_ConcatBrand,
  _Assert_ConcatAcceptsLiteral,
  _Assert_ConcatAcceptsStringRef,
  _Assert_DateToStringBrand,
  _Assert_DateTruncBrand,
  _Assert_DateAddBrand,
  _Assert_DateSubtractBrand,
  _Assert_DateToStringAcceptsDateRef,
  _Assert_SizeBrand,
  _Assert_ConcatArraysBrand,
  _Assert_ArrayElemAtBrand,
  _Assert_FilterBrand,
  _Assert_SizeAcceptsArrayRef,
};
