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
import { PassThrough, PipeSafeError, RequiresMsg } from "../utils/errors";
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
 * Accumulator registry (mirroring ExpressionSpec): one entry per
 * accumulator holding its operand shape and, for fixed-return
 * accumulators ($sum/$avg/$count), its result type. `AccumulatorFunction`
 * and the fixed arms of `ResolveAccumulatorFunction` are derived from it —
 * adding an accumulator means adding one entry (plus one dependent arm if
 * its result derives from the operand).
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

/** Single-operator accumulator shape(s) for `Op` (distributes over unions). */
type AccumulatorFor<Schema extends Document, Op> =
  Op extends keyof AccumulatorSpec<Schema> ?
    { [K in Op]: AccumulatorSpec<Schema>[K]["operand"] }
  : never;

export type AccumulatorFunction<Schema extends Document> = AccumulatorFor<
  Schema,
  keyof AccumulatorSpec<Schema>
>;

/**
 * Key-dispatched accumulator result inference. Fixed-return accumulators
 * read the registry; operand-dependent ones ($min/$max/$first/$last yield
 * the operand's type, $push/$addToSet an array of it) keep explicit arms.
 */
export type ResolveAccumulatorFunction<Schema extends Document, Accumulator> =
  Accumulator extends { $sum: any } ? AccumulatorSpec<Schema>["$sum"]["returns"]
  : Accumulator extends { $avg: any } ?
    AccumulatorSpec<Schema>["$avg"]["returns"]
  : Accumulator extends { $count: any } ?
    AccumulatorSpec<Schema>["$count"]["returns"]
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

/**
 * The brand an invalid numeric-accumulator operand is replaced with by
 * `ValidateGroupQuery`. Reuses the registry's operand type for the re-check
 * (§3.8 rule 3 — the constraint is spelled once, in
 * `NumericAccumulatorOperand`).
 */
type BrandedNumericAccumulator<Op extends "$sum" | "$avg"> = {
  [K in Op]: PipeSafeError<RequiresMsg<"Accumulator", Op, "a numeric operand">>;
};

/**
 * Key-filtered validation wrapper for `Pipeline.group` (§7.4). GroupQuery's
 * `[key: string]` index signature suppresses per-value operand checks at
 * the call site (§3.8 rule 2), so the accumulator brands never fired from
 * chained calls. This wrapper re-checks the inferred literal at the
 * parameter position via intersection (`$group: G & ValidateGroupQuery<…>`
 * — the intersection form is REQUIRED: replacing the raw `G` parameter
 * breaks contextual typing of compound `_id` expressions, in both the bare
 * and concrete-`_id` variants; see plan §7.4).
 *
 * Cost control (§3.8 rule 5): keys whose accumulator is valid are filtered
 * OUT by the `as` clause, so a fully-valid query — the common case —
 * validates against `{}` and the intersection relation short-circuits.
 * Only offending keys survive, mapped to the branded accumulator so TS
 * reports TS2322 at the bad operand value.
 */
export type ValidateGroupQuery<Schema extends Document, G> = {
  [K in keyof G as K extends "_id" ? never
  : G[K] extends { $sum: infer O } ?
    [O] extends [NumericAccumulatorOperand<Schema, "$sum">] ?
      never
    : K
  : G[K] extends { $avg: infer O } ?
    [O] extends [NumericAccumulatorOperand<Schema, "$avg">] ?
      never
    : K
  : never]: G[K] extends { $sum: unknown } ? BrandedNumericAccumulator<"$sum">
  : BrandedNumericAccumulator<"$avg">;
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
