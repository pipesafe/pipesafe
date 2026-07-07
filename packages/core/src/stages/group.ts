import { InferNestedFieldReference } from "../elements/fieldReference";
import { ValidateNestedValue } from "../elements/validation";
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
import { HasSingleOperatorKey, OperatorKeyOf } from "../utils/dispatch";
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
 * The branded replacement `ValidateGroupQuery` maps an invalid accumulator
 * to. Message via `RequiresMsg` so the skeleton stays enforced.
 */
type BrandedAccumulator<Op extends string, What extends string> = {
  [K in Op]: PipeSafeError<RequiresMsg<"Accumulator", Op, What>>;
};

/**
 * Per-value accumulator re-check: `never` means "valid — nothing to
 * report"; anything else is the branded replacement. Re-uses the registry's
 * operand types for the checks (§3.8 rule 3 — each constraint is spelled
 * once, in `NumericAccumulatorOperand` / `MinMaxAccumulatorOperand`). The
 * flexible accumulators ($push/$addToSet/$first/$last) accept any
 * literal/ref/expression by design and are not re-checked.
 */
type ValidateAccumulatorValue<Schema extends Document, A> =
  A extends { $sum: infer O } ?
    [O] extends [NumericAccumulatorOperand<Schema, "$sum">] ?
      never
    : BrandedAccumulator<"$sum", "a numeric operand">
  : A extends { $avg: infer O } ?
    [O] extends [NumericAccumulatorOperand<Schema, "$avg">] ?
      never
    : BrandedAccumulator<"$avg", "a numeric operand">
  : A extends { $min: infer O } ?
    [O] extends [MinMaxAccumulatorOperand<Schema, "$min">] ?
      never
    : BrandedAccumulator<"$min", "a numeric or date operand">
  : A extends { $max: infer O } ?
    [O] extends [MinMaxAccumulatorOperand<Schema, "$max">] ?
      never
    : BrandedAccumulator<"$max", "a numeric or date operand">
  : never;

/**
 * Per-key group re-check. `_id` is an expression/literal position — it gets
 * the shared nested-validation walk (`elements/validation.ts`), including
 * compound-`_id` objects. Non-`_id` keys are accumulator positions:
 * `$`-keyed values must be a single known accumulator (with a valid operand
 * for the numeric family); `$`-less values are plain literals and get the
 * nested walk.
 */
type ValidateGroupValue<Schema extends Document, K, V> =
  K extends "_id" ? ValidateNestedValue<Schema, V>
  : [OperatorKeyOf<V>] extends [never] ? ValidateNestedValue<Schema, V>
  : HasSingleOperatorKey<V> extends false ?
    PipeSafeError<`Expression objects must have exactly one operator.`>
  : [OperatorKeyOf<V>] extends [keyof AccumulatorSpec<Schema>] ?
    ValidateAccumulatorValue<Schema, V>
  : PipeSafeError<`Accumulator '${OperatorKeyOf<V> & string}' is not a known accumulator.`>;

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
 * Cost control (§3.8 rule 5): keys whose value is valid are filtered OUT by
 * the `as` clause — including a valid (compound) `_id`, so its contextual
 * typing is untouched on the happy path. A fully-valid query — the common
 * case — validates against `{}` and the intersection relation
 * short-circuits. Only offending keys survive, mapped to their branded
 * replacement so TS reports TS2322 at the bad value.
 */
export type ValidateGroupQuery<Schema extends Document, G> = {
  [K in keyof G as [ValidateGroupValue<Schema, K, G[K]>] extends [never] ? never
  : K]: ValidateGroupValue<Schema, K, G[K]>;
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
