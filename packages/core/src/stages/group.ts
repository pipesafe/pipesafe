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
 * Numeric operand for aggregators like $sum, $avg.
 *
 * Accepts: numbers, field references to numbers, arithmetic expressions,
 * conditional expressions. Per-operator union arm includes a branded
 * `PipeSafeError` that surfaces in IDE hovers when the operand is
 * incompatible (e.g. a string field reference passed to $sum) — instead of
 * the previous structural-mismatch wall.
 */
type NumericAggregatorOperandFor<Schema extends Document, Op extends string> =
  | LiteralOrFieldReferenceInferringTo<Schema, number>
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>
  | PipeSafeError<
      `Aggregator '${Op}' requires a numeric field reference or expression`,
      Schema
    >;

/**
 * Operand for $min/$max that can be numbers or dates.
 * Same brand pattern as NumericAggregatorOperandFor but allows Date too.
 */
type MinMaxAggregatorOperandFor<Schema extends Document, Op extends string> =
  | LiteralOrFieldReferenceInferringTo<Schema, number>
  | LiteralOrFieldReferenceInferringTo<Schema, Date>
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>
  | PipeSafeError<
      `Aggregator '${Op}' requires a numeric or date field reference`,
      Schema
    >;

/**
 * Flexible operand for aggregators like $push, $first, $last.
 * Intentionally accepts any literal/field-ref/expression — wrapping with a
 * brand would defeat the purpose.
 */
type FlexibleAggregatorOperand<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, any>
  | Expression<Schema>;

export type AggregatorFunction<Schema extends Document> =
  | {
      $sum: NumericAggregatorOperandFor<Schema, "$sum">;
    }
  | {
      $avg: NumericAggregatorOperandFor<Schema, "$avg">;
    }
  | {
      $min: MinMaxAggregatorOperandFor<Schema, "$min">;
    }
  | {
      $max: MinMaxAggregatorOperandFor<Schema, "$max">;
    }
  | {
      $count: {};
    }
  | {
      $push: FlexibleAggregatorOperand<Schema>;
    }
  | {
      $addToSet: FlexibleAggregatorOperand<Schema>;
    }
  | {
      $first: FlexibleAggregatorOperand<Schema>;
    }
  | {
      $last: FlexibleAggregatorOperand<Schema>;
    };

export type ResolveAggregatorFunction<Schema extends Document, Aggregator> =
  Aggregator extends { $sum: any } ? number
  : Aggregator extends { $avg: any } ? number
  : Aggregator extends { $min: infer A } ? InferNestedFieldReference<Schema, A>
  : Aggregator extends { $max: infer A } ? InferNestedFieldReference<Schema, A>
  : Aggregator extends { $count: any } ? number
  : Aggregator extends { $push: infer A } ?
    InferNestedFieldReference<Schema, A>[]
  : Aggregator extends { $addToSet: infer A } ?
    InferNestedFieldReference<Schema, A>[]
  : Aggregator extends { $first: infer A } ?
    InferNestedFieldReference<Schema, A>
  : Aggregator extends { $last: infer A } ? InferNestedFieldReference<Schema, A>
  : never;

export type GroupQuery<Schema extends Document> = {
  _id: AnyLiteral<Schema> | Expression<Schema> | null;
} & {
  [key: string]: AnyLiteral<Schema> | AggregatorFunction<Schema> | null;
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
      [key in Exclude<keyof G, "_id">]: ResolveAggregatorFunction<
        StartingDocs,
        G[key]
      >;
    }
  >
>;
