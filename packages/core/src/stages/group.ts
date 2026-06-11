import { InferNestedFieldReference } from "../elements/fieldReference";
import {
  AnyLiteral,
  LiteralOrFieldReferenceInferringTo,
} from "../elements/literals";
import {
  Expression,
  ConditionalExpression,
  ArithmeticExpression,
} from "../elements/expressions";
import { Document, Prettify } from "../utils/objects";
import { PassThrough, RequiresMsg } from "../utils/errors";
import { ExpressionOperand } from "../elements/operands";

/**
 * Numeric operand for accumulators like $sum, $avg — an ExpressionOperand
 * kernel set (numbers, field references to numbers, brand) extended with the
 * expression forms accumulators accept. The brand surfaces in IDE hovers
 * when the operand is incompatible (e.g. a string field reference passed to
 * $sum) — instead of a structural-mismatch wall.
 */
type NumericAccumulatorOperand<Schema extends Document, Op extends string> =
  | ExpressionOperand<
      Schema,
      number,
      RequiresMsg<"Accumulator", Op, "a numeric operand">
    >
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>;

/**
 * Operand for $min/$max that can be numbers or dates.
 * Same brand pattern as NumericAccumulatorOperand but allows Date too.
 */
type MinMaxAccumulatorOperand<Schema extends Document, Op extends string> =
  | ExpressionOperand<
      Schema,
      number,
      RequiresMsg<"Accumulator", Op, "a numeric or date operand">
    >
  | LiteralOrFieldReferenceInferringTo<Schema, Date>
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>;

/**
 * Flexible operand for accumulators like $push, $first, $last.
 * Intentionally accepts any literal/field-ref/expression — wrapping with a
 * brand would defeat the purpose.
 */
type FlexibleAccumulatorOperand<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, any>
  | Expression<Schema>;

/**
 * AccumulatorSpec is a CONFORMANCE registry (mirroring ExpressionSpec): the
 * hand-written AccumulatorFunction union and resolver arms below are checked
 * against it by expressions.conformance.typeAssertions.ts, so drift is a
 * compile error.
 */
export interface AccumulatorSpec<Schema extends Document> {
  $sum: { operand: NumericAccumulatorOperand<Schema, "$sum">; returns: number };
  $avg: { operand: NumericAccumulatorOperand<Schema, "$avg">; returns: number };
  /** Result mirrors the operand's inferred type (dependent). */
  $min: { operand: MinMaxAccumulatorOperand<Schema, "$min">; returns: unknown };
  $max: { operand: MinMaxAccumulatorOperand<Schema, "$max">; returns: unknown };
  $count: { operand: {}; returns: number };
  /** Result is an array of the operand's inferred type (dependent). */
  $push: { operand: FlexibleAccumulatorOperand<Schema>; returns: unknown[] };
  $addToSet: {
    operand: FlexibleAccumulatorOperand<Schema>;
    returns: unknown[];
  };
  $first: { operand: FlexibleAccumulatorOperand<Schema>; returns: unknown };
  $last: { operand: FlexibleAccumulatorOperand<Schema>; returns: unknown };
}

/** Conformance helper: registry-derived shape for one accumulator. */
export type AccumulatorFor<Schema extends Document, Op> =
  Op extends keyof AccumulatorSpec<Schema> ?
    { [K in Op]: AccumulatorSpec<Schema>[K]["operand"] }
  : never;

// Hand-written union — conformance-checked against the registry.
export type AccumulatorFunction<Schema extends Document> =
  | { $sum: NumericAccumulatorOperand<Schema, "$sum"> }
  | { $avg: NumericAccumulatorOperand<Schema, "$avg"> }
  | { $min: MinMaxAccumulatorOperand<Schema, "$min"> }
  | { $max: MinMaxAccumulatorOperand<Schema, "$max"> }
  | { $count: {} }
  | { $push: FlexibleAccumulatorOperand<Schema> }
  | { $addToSet: FlexibleAccumulatorOperand<Schema> }
  | { $first: FlexibleAccumulatorOperand<Schema> }
  | { $last: FlexibleAccumulatorOperand<Schema> };

/**
 * Key-dispatched accumulator result inference; fixed returns hand-written
 * (conformance-checked), operand-dependent arms explicit.
 */
export type ResolveAccumulatorFunction<Schema extends Document, Accumulator> =
  Accumulator extends { $sum: any } ? number
  : Accumulator extends { $avg: any } ? number
  : Accumulator extends { $count: any } ? number
  : Accumulator extends { $min: infer A } ? InferNestedFieldReference<Schema, A>
  : Accumulator extends { $max: infer A } ? InferNestedFieldReference<Schema, A>
  : Accumulator extends { $push: infer A } ?
    InferNestedFieldReference<Schema, A>[]
  : Accumulator extends { $addToSet: infer A } ?
    InferNestedFieldReference<Schema, A>[]
  : Accumulator extends { $first: infer A } ?
    InferNestedFieldReference<Schema, A>
  : Accumulator extends { $last: infer A } ?
    InferNestedFieldReference<Schema, A>
  : never;

export type GroupQuery<Schema extends Document> = {
  _id: AnyLiteral<Schema> | Expression<Schema> | null;
} & {
  [key: string]: AnyLiteral<Schema> | AccumulatorFunction<Schema> | null;
};

export type ResolveGroupOutput<
  Schema extends Document,
  G extends GroupQuery<Schema>,
> = PassThrough<
  Schema,
  Prettify<
    {
      _id: InferNestedFieldReference<Schema, G["_id"]> extends infer Id ?
        Id extends object ?
          Id extends Date | unknown[] ?
            Id // Don't flatten Date/array _id (e.g. tuples from $dateToParts)
          : Prettify<Id>
        : Id // Primitive _id (string, number, null) — pass through
      : never;
    } & {
      [key in Exclude<keyof G, "_id">]: ResolveAccumulatorFunction<
        Schema,
        G[key]
      >;
    }
  >
>;
