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
import { Document, Prettify } from "../utils/core";

/**
 * Numeric operand for aggregators like $sum, $avg
 * Accepts: numbers, field references to numbers, arithmetic expressions, conditional expressions
 */
type NumericAggregatorOperand<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, number>
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>;

/**
 * Operand for $min/$max that can be numbers or dates
 * Accepts: numbers/dates, field references, arithmetic expressions, conditional expressions
 */
type MinMaxAggregatorOperand<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, number>
  | LiteralOrFieldReferenceInferringTo<Schema, Date>
  | ArithmeticExpression<Schema>
  | ConditionalExpression<Schema>;

/**
 * Flexible operand for aggregators like $push, $first, $last
 * Accepts: any literal, field reference, or expression
 */
type FlexibleAggregatorOperand<Schema extends Document> =
  | LiteralOrFieldReferenceInferringTo<Schema, any>
  | Expression<Schema>;

export type AggregatorFunction<Schema extends Document> =
  | {
      $sum: NumericAggregatorOperand<Schema>;
    }
  | {
      $avg: NumericAggregatorOperand<Schema>;
    }
  | {
      $min: MinMaxAggregatorOperand<Schema>;
    }
  | {
      $max: MinMaxAggregatorOperand<Schema>;
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
> = Prettify<
  {
    _id: InferNestedFieldReference<StartingDocs, G["_id"]>; // Infer out
  } & {
    [key in Exclude<keyof G, "_id">]: ResolveAggregatorFunction<
      StartingDocs,
      G[key]
    >;
  }
>;
