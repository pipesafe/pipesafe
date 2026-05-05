import type { Document, PipeSafeError } from "../utils/core";
import type { Assert, AssertPipeSafeError, Equal } from "../utils/tests";
import type {
  AddExpression,
  SubtractExpression,
  MultiplyExpression,
  DivideExpression,
  ModExpression,
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
  PipeSafeError<string, unknown>
>;
type _Assert_AddBrand = Assert<
  AssertPipeSafeError<
    _Add_Brand,
    "Operator '$add' requires a numeric operand (number, field reference to a number, or nested expression)"
  >
>;

// $subtract operand tuple must be a 2-tuple, each element including the brand.
type _Subtract_FirstElement = SubtractOperandTuple<ArithSchema>[0];
type _Subtract_Brand = Extract<
  _Subtract_FirstElement,
  PipeSafeError<string, unknown>
>;
type _Assert_SubtractBrand = Assert<
  AssertPipeSafeError<
    _Subtract_Brand,
    "Operator '$subtract' requires a numeric operand (number, field reference to a number, or nested expression)"
  >
>;
type _Assert_SubtractIs2Tuple = Assert<
  Equal<SubtractOperandTuple<ArithSchema>["length"], 2>
>;

// $multiply operand element must include the brand with the operator name.
type _Multiply_Brand = Extract<
  MultiplyOperandElement<ArithSchema>,
  PipeSafeError<string, unknown>
>;
type _Assert_MultiplyBrand = Assert<
  AssertPipeSafeError<
    _Multiply_Brand,
    "Operator '$multiply' requires a numeric operand (number, field reference to a number, or nested expression)"
  >
>;

// $divide operand tuple — same as $subtract.
type _Divide_FirstElement = DivideOperandTuple<ArithSchema>[0];
type _Divide_Brand = Extract<
  _Divide_FirstElement,
  PipeSafeError<string, unknown>
>;
type _Assert_DivideBrand = Assert<
  AssertPipeSafeError<
    _Divide_Brand,
    "Operator '$divide' requires a numeric operand (number, field reference to a number, or nested expression)"
  >
>;

// $mod operand tuple — same shape.
type _Mod_FirstElement = ModOperandTuple<ArithSchema>[0];
type _Mod_Brand = Extract<_Mod_FirstElement, PipeSafeError<string, unknown>>;
type _Assert_ModBrand = Assert<
  AssertPipeSafeError<
    _Mod_Brand,
    "Operator '$mod' requires a numeric operand (number, field reference to a number, or nested expression)"
  >
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

export type {
  _Assert_AddBrand,
  _Assert_SubtractBrand,
  _Assert_SubtractIs2Tuple,
  _Assert_MultiplyBrand,
  _Assert_DivideBrand,
  _Assert_ModBrand,
  _Assert_AddAcceptsNumber,
  _Assert_AddAcceptsNumericRef,
};
