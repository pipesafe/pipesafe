/**
 * Conformance guard: the hand-written expression and accumulator types must
 * stay in sync with their registries (`ExpressionSpec` / `AccumulatorSpec`).
 * Hand-written types were chosen over registry-DERIVED ones after the A/B
 * comparison (~6% fewer whole-project instantiations; see
 * docs/type-standardisation-plan.md §6) — this file is what makes that
 * choice safe: drift is a compile error rather than impossible.
 */

import { Assert, Equal } from "../utils/tests";
import {
  Expression,
  ExpressionFor,
  ExpressionSpec,
  InferExpression,
  SizeExpression,
  ConcatArraysExpression,
  ArrayElemAtExpression,
  FilterExpression,
  MapExpression,
  SumExpression,
  DateToStringExpression,
  DateTruncExpression,
  DateAddExpression,
  DateSubtractExpression,
  ToDateExpression,
  AddExpression,
  SubtractExpression,
  MultiplyExpression,
  DivideExpression,
  ModExpression,
  ConcatExpression,
  IfNullExpression,
  CondExpression,
  LetExpression,
  LiteralExpression,
  InAggExpression,
  EqExpression,
  NeExpression,
  GtExpression,
  GteExpression,
  LtExpression,
  LteExpression,
} from "./expressions";
import {
  AccumulatorFunction,
  AccumulatorFor,
  AccumulatorSpec,
} from "../stages/group";

type S = { n: number; s: string; d: Date; arr: number[] };

// ============================================================================
// 1. Every hand-written expression type equals its registry-derived shape
// ============================================================================

type _c1 = Assert<Equal<SizeExpression<S>, ExpressionFor<S, "$size">>>;
type _c2 = Assert<
  Equal<ConcatArraysExpression<S>, ExpressionFor<S, "$concatArrays">>
>;
type _c3 = Assert<
  Equal<ArrayElemAtExpression<S>, ExpressionFor<S, "$arrayElemAt">>
>;
type _c4 = Assert<Equal<FilterExpression<S>, ExpressionFor<S, "$filter">>>;
type _c5 = Assert<Equal<MapExpression<S>, ExpressionFor<S, "$map">>>;
type _c6 = Assert<Equal<SumExpression<S>, ExpressionFor<S, "$sum">>>;
type _c7 = Assert<
  Equal<DateToStringExpression<S>, ExpressionFor<S, "$dateToString">>
>;
type _c8 = Assert<
  Equal<DateTruncExpression<S>, ExpressionFor<S, "$dateTrunc">>
>;
type _c9 = Assert<Equal<DateAddExpression<S>, ExpressionFor<S, "$dateAdd">>>;
type _c10 = Assert<
  Equal<DateSubtractExpression<S>, ExpressionFor<S, "$dateSubtract">>
>;
type _c11 = Assert<Equal<ToDateExpression<S>, ExpressionFor<S, "$toDate">>>;
type _c12 = Assert<Equal<AddExpression<S>, ExpressionFor<S, "$add">>>;
type _c13 = Assert<Equal<SubtractExpression<S>, ExpressionFor<S, "$subtract">>>;
type _c14 = Assert<Equal<MultiplyExpression<S>, ExpressionFor<S, "$multiply">>>;
type _c15 = Assert<Equal<DivideExpression<S>, ExpressionFor<S, "$divide">>>;
type _c16 = Assert<Equal<ModExpression<S>, ExpressionFor<S, "$mod">>>;
type _c17 = Assert<Equal<ConcatExpression<S>, ExpressionFor<S, "$concat">>>;
type _c18 = Assert<Equal<IfNullExpression<S>, ExpressionFor<S, "$ifNull">>>;
type _c19 = Assert<Equal<CondExpression<S>, ExpressionFor<S, "$cond">>>;
type _c20 = Assert<Equal<LetExpression<S>, ExpressionFor<S, "$let">>>;
type _c21 = Assert<Equal<LiteralExpression<S>, ExpressionFor<S, "$literal">>>;
type _c22 = Assert<Equal<InAggExpression<S>, ExpressionFor<S, "$in">>>;
type _c23 = Assert<Equal<EqExpression<S>, ExpressionFor<S, "$eq">>>;
type _c24 = Assert<Equal<NeExpression<S>, ExpressionFor<S, "$ne">>>;
type _c25 = Assert<Equal<GtExpression<S>, ExpressionFor<S, "$gt">>>;
type _c26 = Assert<Equal<GteExpression<S>, ExpressionFor<S, "$gte">>>;
type _c27 = Assert<Equal<LtExpression<S>, ExpressionFor<S, "$lt">>>;
type _c28 = Assert<Equal<LteExpression<S>, ExpressionFor<S, "$lte">>>;

// The hand-written Expression union covers exactly the registry's keys.
type _unionComplete = Assert<
  Equal<Expression<S>, ExpressionFor<S, keyof ExpressionSpec<S>>>
>;

// ============================================================================
// 2. Fixed-return inference arms match the registry's `returns`
// ============================================================================

type _r1 = Assert<
  Equal<
    InferExpression<S, { $size: "$arr" }>,
    ExpressionSpec<S>["$size"]["returns"]
  >
>;
type _r2 = Assert<
  Equal<
    InferExpression<S, { $dateToString: { format: "x"; date: "$d" } }>,
    ExpressionSpec<S>["$dateToString"]["returns"]
  >
>;
type _r3 = Assert<
  Equal<
    InferExpression<S, { $add: [1, 2] }>,
    ExpressionSpec<S>["$add"]["returns"]
  >
>;
type _r4 = Assert<
  Equal<
    InferExpression<S, { $concat: ["a", "$s"] }>,
    ExpressionSpec<S>["$concat"]["returns"]
  >
>;
type _r5 = Assert<
  Equal<
    InferExpression<S, { $eq: [1, 1] }>,
    ExpressionSpec<S>["$eq"]["returns"]
  >
>;

// ============================================================================
// 3. Accumulators: hand-written union ≡ registry-derived
// ============================================================================

type _acc = Assert<
  Equal<AccumulatorFunction<S>, AccumulatorFor<S, keyof AccumulatorSpec<S>>>
>;

export type {
  _c1,
  _c2,
  _c3,
  _c4,
  _c5,
  _c6,
  _c7,
  _c8,
  _c9,
  _c10,
  _c11,
  _c12,
  _c13,
  _c14,
  _c15,
  _c16,
  _c17,
  _c18,
  _c19,
  _c20,
  _c21,
  _c22,
  _c23,
  _c24,
  _c25,
  _c26,
  _c27,
  _c28,
  _unionComplete,
  _r1,
  _r2,
  _r3,
  _r4,
  _r5,
  _acc,
};
