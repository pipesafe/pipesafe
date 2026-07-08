import type { Document } from "../utils/objects";
import type { PipeSafeError } from "../utils/errors";
import type { Assert, AssertPipeSafeError, Equal } from "../utils/tests";
import type {
  ExpressionSpec,
  ExpressionCategory,
  OpsInCategory,
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
  SetUnionExpression,
  SetIntersectionExpression,
  SetDifferenceExpression,
  InferExpression,
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

// ----------------------------------------------------------------------------
// Set operators — $setUnion / $setIntersection / $setDifference
// ----------------------------------------------------------------------------

type SetSchema = {
  tags: string[];
  maybeTags?: string[];
  nums: number[];
  name: string;
  items: { id: string; score: number }[];
  wrappers: { ids: string[] }[];
  posts: { tags?: string[] }[];
};

type SetUnionOperandElement<S extends Document> =
  SetUnionExpression<S>["$setUnion"][number];
type SetIntersectionOperandElement<S extends Document> =
  SetIntersectionExpression<S>["$setIntersection"][number];
type SetDifferenceOperandTuple<S extends Document> =
  SetDifferenceExpression<S>["$setDifference"];

// Each set operand union must include the branded error arm.
type _SetUnion_Brand = Extract<
  SetUnionOperandElement<SetSchema>,
  PipeSafeError<string>
>;
type _Assert_SetUnionBrand = Assert<
  AssertPipeSafeError<
    _SetUnion_Brand,
    "Operator '$setUnion' requires an array operand."
  >
>;

type _SetIntersection_Brand = Extract<
  SetIntersectionOperandElement<SetSchema>,
  PipeSafeError<string>
>;
type _Assert_SetIntersectionBrand = Assert<
  AssertPipeSafeError<
    _SetIntersection_Brand,
    "Operator '$setIntersection' requires an array operand."
  >
>;

type _SetDifference_Brand = Extract<
  SetDifferenceOperandTuple<SetSchema>[0],
  PipeSafeError<string>
>;
type _Assert_SetDifferenceBrand = Assert<
  AssertPipeSafeError<
    _SetDifference_Brand,
    "Operator '$setDifference' requires an array operand."
  >
>;
type _Assert_SetDifferenceIs2Tuple = Assert<
  Equal<SetDifferenceOperandTuple<SetSchema>["length"], 2>
>;

// Positive sweeps: array field references and nested array-producing
// expressions ($ifNull defaulting an optional array, $reduce accumulation)
// are valid set operands.
type _Assert_SetUnionAcceptsArrayRef = Assert<
  Equal<"$tags" extends SetUnionOperandElement<SetSchema> ? true : false, true>
>;
type _Assert_SetUnionAcceptsIfNull = Assert<
  Equal<
    { $ifNull: ["$maybeTags", []] } extends SetUnionOperandElement<SetSchema> ?
      true
    : false,
    true
  >
>;
type _Assert_SetUnionAcceptsReduce = Assert<
  Equal<
    {
      $reduce: { input: "$wrappers"; initialValue: []; in: unknown };
    } extends SetUnionOperandElement<SetSchema> ?
      true
    : false,
    true
  >
>;

// `$$`-system/`let`-variable references are valid set operands and
// $map/$reduce inputs — exactly what a $lookup-let sub-pipeline produces
// (`$setUnion: ["$labels", "$$localTags"]`). Untracked outside a scope,
// their contribution degrades to `unknown`.
type _Assert_SetUnionAcceptsSystemVar = Assert<
  Equal<
    "$$localTags" extends SetUnionOperandElement<SetSchema> ? true : false,
    true
  >
>;
type _SetUnionSystemVarInfer = InferExpression<
  SetSchema,
  { $setUnion: ["$tags", "$$localTags"] }
>;
type _Assert_SetUnionSystemVarInfer = Assert<
  Equal<_SetUnionSystemVarInfer, unknown[]>
>;
type _ReduceSystemVarInputInfer = InferExpression<
  SetSchema,
  { $reduce: { input: "$$localTags"; initialValue: 0; in: "$$this" } }
>;
type _Assert_ReduceSystemVarInputInfer = Assert<
  Equal<_ReduceSystemVarInputInfer, unknown>
>;

// ----------------------------------------------------------------------------
// Set operator result inference
// ----------------------------------------------------------------------------

// $setUnion: union of operand element types (here both resolve to string).
type _SetUnionInfer = InferExpression<
  SetSchema,
  { $setUnion: ["$tags", { $ifNull: ["$maybeTags", []] }] }
>;
type _Assert_SetUnionInfer = Assert<Equal<_SetUnionInfer, string[]>>;

// $setIntersection: same element-union shape as $setUnion (the "a" | "b"
// literal elements are absorbed into string during union normalization).
type _SetIntersectionInfer = InferExpression<
  SetSchema,
  { $setIntersection: ["$tags", ["a", "b"]] }
>;
type _Assert_SetIntersectionInfer = Assert<
  Equal<_SetIntersectionInfer, string[]>
>;

// $setDifference: the FIRST operand's element type (removing elements never
// widens the element type).
type _SetDifferenceInfer = InferExpression<
  SetSchema,
  {
    $setDifference: [
      "$nums",
      { $map: { input: "$items"; in: "$$this.score" } },
    ];
  }
>;
type _Assert_SetDifferenceInfer = Assert<Equal<_SetDifferenceInfer, number[]>>;

// ----------------------------------------------------------------------------
// Scoped $$this / $$value inference for $map and $reduce
// ----------------------------------------------------------------------------

// $map with a `$$this.path` reference resolves against the input element.
type _MapThisPathInfer = InferExpression<
  SetSchema,
  { $map: { input: "$items"; in: "$$this.id" } }
>;
type _Assert_MapThisPathInfer = Assert<Equal<_MapThisPathInfer, string[]>>;

// $map with a bare `$$this` resolves to the element type itself.
type _MapThisInfer = InferExpression<
  SetSchema,
  { $map: { input: "$nums"; in: "$$this" } }
>;
type _Assert_MapThisInfer = Assert<Equal<_MapThisInfer, number[]>>;

// $map with a custom `as` binds THAT variable name to the element type.
type _MapCustomAsInfer = InferExpression<
  SetSchema,
  { $map: { input: "$items"; as: "item"; in: "$$item.id" } }
>;
type _Assert_MapCustomAsInfer = Assert<Equal<_MapCustomAsInfer, string[]>>;

// ... and `$$this` is NOT bound under a custom `as` (per MongoDB, `as`
// REPLACES the default variable) — it degrades to unknown[].
type _MapCustomAsThisInfer = InferExpression<
  SetSchema,
  { $map: { input: "$items"; as: "item"; in: "$$this.id" } }
>;
type _Assert_MapCustomAsThisInfer = Assert<
  Equal<_MapCustomAsThisInfer, unknown[]>
>;

// $map whose `in` is a plain object literal resolves member-wise.
type _MapObjectInInfer = InferExpression<
  SetSchema,
  { $map: { input: "$items"; in: { key: "$$this.id"; fixed: 1 } } }
>;
type _Assert_MapObjectInInfer = Assert<
  Equal<_MapObjectInInfer, { key: string; fixed: 1 }[]>
>;

// $ifNull's array-literal fallback contributes the ARRAY type (MongoDB
// returns the replacement expression verbatim) — NOT its element type, so
// the $map result is a per-element union of arrays, never a scalar/array
// mix like ("none" | string[])[].
type _MapIfNullFallbackInfer = InferExpression<
  SetSchema,
  { $map: { input: "$posts"; in: { $ifNull: ["$$this.tags", ["none"]] } } }
>;
type _Assert_MapIfNullFallbackInfer = Assert<
  Equal<_MapIfNullFallbackInfer, (string[] | ["none"])[]>
>;

// $reduce accumulate-into-[] pattern: $$value starts as [] and each step
// concatenates an array reached through $$this — infers the flattened array.
type _ReduceConcatInfer = InferExpression<
  SetSchema,
  {
    $reduce: {
      input: "$wrappers";
      initialValue: [];
      in: { $concatArrays: ["$$value", { $ifNull: ["$$this.ids", []] }] };
    };
  }
>;
type _Assert_ReduceConcatInfer = Assert<Equal<_ReduceConcatInfer, string[]>>;

// $reduce whose `in` is a direct `$$this` reference returns the element type.
type _ReduceThisInfer = InferExpression<
  SetSchema,
  { $reduce: { input: "$nums"; initialValue: 0; in: "$$this" } }
>;
type _Assert_ReduceThisInfer = Assert<Equal<_ReduceThisInfer, number>>;

// $reduce's initialValue is evaluated BEFORE iteration begins (per MongoDB),
// so `$$this` is NOT in scope there: it must resolve to unknown, not to the
// input element type, and that unknown flows through `$$value`.
type _ReduceInitNoThisInfer = InferExpression<
  SetSchema,
  { $reduce: { input: "$nums"; initialValue: "$$this"; in: "$$value" } }
>;
type _Assert_ReduceInitNoThis = Assert<Equal<_ReduceInitNoThisInfer, unknown>>;

export type {
  _Assert_SetUnionBrand,
  _Assert_SetIntersectionBrand,
  _Assert_SetDifferenceBrand,
  _Assert_SetDifferenceIs2Tuple,
  _Assert_SetUnionAcceptsArrayRef,
  _Assert_SetUnionAcceptsIfNull,
  _Assert_SetUnionAcceptsReduce,
  _Assert_SetUnionAcceptsSystemVar,
  _Assert_SetUnionSystemVarInfer,
  _Assert_ReduceSystemVarInputInfer,
  _Assert_SetUnionInfer,
  _Assert_SetIntersectionInfer,
  _Assert_SetDifferenceInfer,
  _Assert_MapThisPathInfer,
  _Assert_MapThisInfer,
  _Assert_MapCustomAsInfer,
  _Assert_MapCustomAsThisInfer,
  _Assert_MapObjectInInfer,
  _Assert_MapIfNullFallbackInfer,
  _Assert_ReduceConcatInfer,
  _Assert_ReduceThisInfer,
  _Assert_ReduceInitNoThis,
};

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
    | "$map"
    | "$reduce"
    | "$setUnion"
    | "$setIntersection"
    | "$setDifference"
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
