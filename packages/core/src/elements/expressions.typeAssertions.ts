import type { Document } from "../utils/objects";
import type { PipeSafeError } from "../utils/errors";
import type { Assert, AssertPipeSafeError, Equal } from "../utils/tests";
import type {
  ExpressionSpec,
  ExpressionsReturning,
  InferExpression,
  LiteralDependentOps,
  OpsInCategory,
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
// The date-part family — $year/$month/.../$isoWeekYear
// ----------------------------------------------------------------------------
// Thirteen operators registered as a block, each with the operator name
// respelled inside its own entry. Everything below sweeps the WHOLE family
// via one mapped type per property, so a single copy-pasted entry (the real
// failure mode of a block registration) fails at the offending key rather
// than hiding behind whichever sibling happened to get a test.

/** The family these assertions cover. */
type DatePartOp =
  | "$year"
  | "$month"
  | "$dayOfMonth"
  | "$dayOfWeek"
  | "$dayOfYear"
  | "$hour"
  | "$minute"
  | "$second"
  | "$millisecond"
  | "$week"
  | "$isoDayOfWeek"
  | "$isoWeek"
  | "$isoWeekYear";

type DatePartSchema = {
  ts: Date;
  name: string;
};

// Coverage is not self-certifying: the list above is hand-written, so tie it
// to a DERIVED set — the date-category operators whose declared result is
// `number`, which is exactly what "date part" means in the registry. Drift
// fails in both directions: a fourteenth date-part operator registered
// without extending this file lands in the derived set and fails here, and a
// removed one fails here too. (Same shape as _DerivedLiteralDependentOps —
// a derived-set pin, not a type/const sync pin.)
type _DerivedDatePartOps = {
  [K in OpsInCategory<"date">]: ExpressionSpec<Document>[K] extends (
    { returns: number }
  ) ?
    K
  : never;
}[OpsInCategory<"date">];

type _Assert_DatePartFamilyIsCovered = Assert<
  Equal<_DerivedDatePartOps, DatePartOp>
>;

// --- Result inference: every operator resolves to `number` ------------------
// This is the bug the family was registered to fix (#116). Before
// registration the operators were allow-listed, so InferExpression fell
// through to the unregistered tail and every one of these was `unknown`.

/** `{ $op: "$ts" }` — the bare operand form. */
type DatePartBareForm = {
  [K in DatePartOp]: InferExpression<DatePartSchema, { [P in K]: "$ts" }>;
};
type _Assert_DatePartBareFormInfersNumber = Assert<
  Equal<DatePartBareForm, Record<DatePartOp, number>>
>;

/** `{ $op: { date, timezone } }` — the object operand form. */
type DatePartObjectForm = {
  [K in DatePartOp]: InferExpression<
    DatePartSchema,
    { [P in K]: { date: "$ts"; timezone: "Europe/London" } }
  >;
};
type _Assert_DatePartObjectFormInfersNumber = Assert<
  Equal<DatePartObjectForm, Record<DatePartOp, number>>
>;

/** A `Date` literal operand resolves the same way a reference does. */
type DatePartLiteralForm = {
  [K in DatePartOp]: InferExpression<DatePartSchema, { [P in K]: Date }>;
};
type _Assert_DatePartLiteralFormInfersNumber = Assert<
  Equal<DatePartLiteralForm, Record<DatePartOp, number>>
>;

// Inference is FORGIVING by contract (elements/CLAUDE.md): a malformed
// operand keeps the operator's declared result kind and reports at the input
// position. Pin that for the family — a string reference must not turn the
// result into `unknown` or `never`.
type DatePartWrongOperand = {
  [K in DatePartOp]: InferExpression<DatePartSchema, { [P in K]: "$name" }>;
};
type _Assert_DatePartWrongOperandStillInfersNumber = Assert<
  Equal<DatePartWrongOperand, Record<DatePartOp, number>>
>;

// --- Operand acceptance: both MongoDB forms, for every operator -------------

type DatePartOperandOf<K extends DatePartOp> =
  ExpressionSpec<DatePartSchema>[K]["operand"];

type _Assert_DatePartAcceptsDateRef = Assert<
  Equal<
    { [K in DatePartOp]: "$ts" extends DatePartOperandOf<K> ? true : false },
    Record<DatePartOp, true>
  >
>;

type _Assert_DatePartAcceptsObjectForm = Assert<
  Equal<
    {
      [K in DatePartOp]: { date: "$ts"; timezone: "Europe/London" } extends (
        DatePartOperandOf<K>
      ) ?
        true
      : false;
    },
    Record<DatePartOp, true>
  >
>;

// `timezone` is optional — the object form must accept a bare `{ date }`.
type _Assert_DatePartObjectFormTimezoneOptional = Assert<
  Equal<
    {
      [K in DatePartOp]: { date: "$ts" } extends DatePartOperandOf<K> ? true
      : false;
    },
    Record<DatePartOp, true>
  >
>;

// A string field reference is NOT in the operand set — it only relates to the
// branded arm, which is what puts the message in the hover.
type _Assert_DatePartRejectsStringRef = Assert<
  Equal<
    { [K in DatePartOp]: "$name" extends DatePartOperandOf<K> ? true : false },
    Record<DatePartOp, false>
  >
>;

// --- Brand messages: every entry names ITSELF -------------------------------
// The one thing thirteen near-identical registry entries can get wrong
// silently. `DatePartOperand<Schema, "$hour">` pasted into `$minute` compiles,
// infers `number`, accepts the same operands — and hovers with the wrong
// operator name. Only a per-key message check catches it.

type DatePartBrandMsg<K extends DatePartOp> =
  Extract<DatePartOperandOf<K>, PipeSafeError<string>> extends (
    PipeSafeError<infer Msg>
  ) ?
    Msg
  : never;

type _Assert_DatePartBrandsNameTheirOwnOperator = Assert<
  Equal<
    { [K in DatePartOp]: DatePartBrandMsg<K> },
    { [K in DatePartOp]: `Operator '${K}' requires a Date operand.` }
  >
>;

// The object form's inner `date` carries the same brand, so a wrong-typed
// `{ date: "$name" }` hovers with the operator name too.
type DatePartObjectDateBrand<K extends DatePartOp> =
  Extract<
    Extract<DatePartOperandOf<K>, { date: unknown }>["date"],
    PipeSafeError<string>
  > extends PipeSafeError<infer Msg> ?
    Msg
  : never;

type _Assert_DatePartObjectDateBrandsNameTheirOwnOperator = Assert<
  Equal<
    { [K in DatePartOp]: DatePartObjectDateBrand<K> },
    { [K in DatePartOp]: `Operator '${K}' requires a Date operand.` }
  >
>;

// --- Registration consequences ----------------------------------------------
// Registering with `returns: number` is what puts the family into the derived
// "expressions producing a number" set — which is how a date part becomes a
// legal operand of the numeric accumulators and of arithmetic.

type _Assert_DatePartJoinsNumericExpressions = Assert<
  Equal<
    {
      [K in DatePartOp]: { [P in K]: "$ts" } extends (
        ExpressionsReturning<DatePartSchema, number>
      ) ?
        true
      : false;
    },
    Record<DatePartOp, true>
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
  _Assert_DatePartFamilyIsCovered,
  _Assert_DatePartBareFormInfersNumber,
  _Assert_DatePartObjectFormInfersNumber,
  _Assert_DatePartLiteralFormInfersNumber,
  _Assert_DatePartWrongOperandStillInfersNumber,
  _Assert_DatePartAcceptsDateRef,
  _Assert_DatePartAcceptsObjectForm,
  _Assert_DatePartObjectFormTimezoneOptional,
  _Assert_DatePartRejectsStringRef,
  _Assert_DatePartBrandsNameTheirOwnOperator,
  _Assert_DatePartObjectDateBrandsNameTheirOwnOperator,
  _Assert_DatePartJoinsNumericExpressions,
  _Assert_SizeBrand,
  _Assert_ConcatArraysBrand,
  _Assert_ArrayElemAtBrand,
  _Assert_FilterBrand,
  _Assert_SizeAcceptsArrayRef,
};
