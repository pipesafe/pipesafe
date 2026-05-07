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
import { Document, PassThrough, PipeSafeError, Prettify } from "../utils/core";

/**
 * Numeric operand for accumulators like $sum, $avg.
 *
 * Accepts: numbers, field references to numbers, arithmetic expressions,
 * conditional expressions. Per-operator union arm includes a branded
 * `PipeSafeError` that surfaces in IDE hovers when the operand is
 * incompatible (e.g. a string field reference passed to $sum) — instead of
 * the previous structural-mismatch wall.
 */
type NumericAccumulatorOperand<Schema extends Document, Op extends string> =
  | LiteralOrFieldReferenceInferringTo<Schema, number>
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>
  | PipeSafeError<`Accumulator '${Op}' requires a numeric operand.`>;

/**
 * Operand for $min/$max that can be numbers or dates.
 * Same brand pattern as NumericAccumulatorOperand but allows Date too.
 */
type MinMaxAccumulatorOperand<Schema extends Document, Op extends string> =
  | LiteralOrFieldReferenceInferringTo<Schema, number>
  | LiteralOrFieldReferenceInferringTo<Schema, Date>
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>
  | PipeSafeError<`Accumulator '${Op}' requires a numeric or date operand.`>;

/**
 * Flexible operand for accumulators like $push, $first, $last.
 * Intentionally accepts any literal/field-ref/expression — wrapping with a
 * brand would defeat the purpose.
 */
type FlexibleAccumulatorOperand<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, any>
  | Expression<Schema>;

export type AccumulatorFunction<Schema extends Document> =
  | {
      $sum: NumericAccumulatorOperand<Schema, "$sum">;
    }
  | {
      $avg: NumericAccumulatorOperand<Schema, "$avg">;
    }
  | {
      $min: MinMaxAccumulatorOperand<Schema, "$min">;
    }
  | {
      $max: MinMaxAccumulatorOperand<Schema, "$max">;
    }
  | {
      $count: {};
    }
  | {
      $push: FlexibleAccumulatorOperand<Schema>;
    }
  | {
      $addToSet: FlexibleAccumulatorOperand<Schema>;
    }
  | {
      $first: FlexibleAccumulatorOperand<Schema>;
    }
  | {
      $last: FlexibleAccumulatorOperand<Schema>;
    };

export type ResolveAccumulatorFunction<Schema extends Document, Accumulator> =
  Accumulator extends { $sum: any } ? number
  : Accumulator extends { $avg: any } ? number
  : Accumulator extends { $min: infer A } ? InferNestedFieldReference<Schema, A>
  : Accumulator extends { $max: infer A } ? InferNestedFieldReference<Schema, A>
  : Accumulator extends { $count: any } ? number
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
  StartingDocs extends Document,
  G extends GroupQuery<StartingDocs>,
> = PassThrough<
  StartingDocs,
  Prettify<
    {
      _id: InferNestedFieldReference<StartingDocs, G["_id"]> extends infer Id ?
        Id extends object ?
          Id extends Date | unknown[] ?
            Id // Don't flatten Date/array _id (e.g. tuples from $dateToParts)
          : Prettify<Id>
        : Id // Primitive _id (string, number, null) — pass through
      : never;
    } & {
      [key in Exclude<keyof G, "_id">]: ResolveAccumulatorFunction<
        StartingDocs,
        G[key]
      >;
    }
  >
>;
