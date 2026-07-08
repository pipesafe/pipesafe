import {
  FieldReferencesThatInferTo,
  InferNestedFieldReference,
} from "../elements/fieldReference";
import { ValidateNestedValue } from "../elements/validation";
import {
  AnyLiteral,
  ExpressionShaped,
  LiteralOrFieldReferenceInferringTo,
} from "../elements/literals";
import {
  Expression,
  ConditionalExpression,
  ExpressionsReturning,
} from "../elements/expressions";
import { Document, OmitNeverValues, Prettify } from "../utils/objects";
import { NoDollarString } from "../utils/strings";
import {
  HasOperatorKey,
  HasSingleOperatorKey,
  OperatorKeyOf,
} from "../utils/dispatch";
import {
  MultiOperatorError,
  PassThrough,
  PipeSafeError,
  RequiresMsg,
  UnknownAccumulatorError,
} from "../utils/errors";
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
  // Any registry expression whose declared result is numeric ($size,
  // arithmetic, $toDate arithmetic chains, ...) — derived, so new numeric
  // operators join automatically. ConditionalExpression stays explicit:
  // $ifNull/$cond results are literal-dependent (declared `unknown`).
  | ExpressionsReturning<Schema, number>
  | ConditionalExpression<Schema>;

/**
 * Operand for $min/$max. MongoDB defines them over BSON-comparable values —
 * numbers, dates, AND strings (lexicographic) are the ones this library
 * models; `$min: "$name"` is valid MongoDB and must compile.
 */
type MinMaxAccumulatorOperand<Schema extends Document, Op extends string> =
  | ExpressionOperand<
      Schema,
      // The ref side accepts every modeled comparable; the LITERAL string
      // arm is narrowed to NoDollarString below — a bare `string` here
      // would swallow `$`-typo refs and make the brand unreachable.
      number | Date | boolean,
      RequiresMsg<
        "Accumulator",
        Op,
        "a comparable (number, date, string, or boolean) operand"
      >
    >
  | NoDollarString
  | FieldReferencesThatInferTo<Schema, string>
  | ExpressionsReturning<Schema, number | Date | string | boolean>
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

/**
 * $group accumulators that are VALID MongoDB but not yet in
 * `AccumulatorSpec`. Allow-listed BY NAME: accepted with no operand
 * validation and `unknown` result inference, so real pipelines compile
 * while a typo'd accumulator brands with `UnknownAccumulatorError`
 * (utils/errors.ts).
 *
 * DO NOT widen this to `` `$${string}` `` — the explicit list is exactly
 * what makes unknown-accumulator rejection possible.
 *
 * Implementing one = register it in `AccumulatorSpec` (plus a
 * `ResolveAccumulatorFunction` arm if operand-dependent) and DELETE it
 * from this list. If a valid accumulator is missing here, add it here —
 * never loosen the checks that consume the list.
 */
export type UnimplementedAccumulators =
  | "$accumulator"
  | "$bottom"
  | "$bottomN"
  | "$firstN"
  | "$lastN"
  | "$maxN"
  | "$median"
  | "$mergeObjects"
  | "$minN"
  | "$percentile"
  | "$stdDevPop"
  | "$stdDevSamp"
  | "$top"
  | "$topN";

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
  : // Allow-listed unimplemented accumulators (UnimplementedAccumulators)
  // have no inference — their result degrades to `unknown`, never to a
  // `never`-poisoned field. (Typo'd keys also land here, but validation
  // brands those at the call site, so their output type is moot.)
  HasOperatorKey<Accumulator> extends true ? unknown
  : never;

export type GroupQuery<Schema extends Document> = {
  _id: AnyLiteral<Schema> | Expression<Schema> | null;
} & {
  // ExpressionShaped accepts $-keyed values structurally (§3.8 rule 6):
  // rejecting at the constraint would misreport the error on sibling
  // keys. The NAME check happens in ValidateGroupQuery instead — the key
  // must be registered (AccumulatorSpec) or allow-listed
  // (UnimplementedAccumulators, e.g. $stdDevPop/$top/$mergeObjects);
  // registered numeric/comparable accumulators are also operand-checked.
  [key: string]:
    | AnyLiteral<Schema>
    | AccumulatorFunction<Schema>
    | ExpressionShaped
    | null;
};

/**
 * The accumulators whose operands ValidateGroupQuery re-checks. Derived
 * checking: the operand type AND its brand come from AccumulatorSpec, so
 * adding an accumulator to this key set (after registering it) is the whole
 * cost of extending call-site validation — the flexible accumulators
 * ($push/$addToSet/$first/$last/$count) accept any operand by design and
 * stay out.
 */
type CheckedAccumulatorOps = "$sum" | "$avg" | "$min" | "$max";

/**
 * Registry-derived accumulator re-check: dispatch on the operator key,
 * compare the value against the registry's own shape (`AccumulatorFor`),
 * and on failure map the key to the brand EXTRACTED from the registry
 * operand's union — the message is spelled once, inside
 * NumericAccumulatorOperand/MinMaxAccumulatorOperand's RequiresMsg (§3.8
 * rule 3).
 */
/** The registry operand's own brand, extracted — spelled once (§3.8 rule 3). */
type BrandedAccumulatorFor<
  Schema extends Document,
  Op extends CheckedAccumulatorOps,
> = {
  [K in Op]: Extract<
    AccumulatorSpec<Schema>[K]["operand"],
    PipeSafeError<string>
  >;
};

type ValidateAccumulatorValue<Schema extends Document, A> =
  // Schema-FREE fast-accept: literal operands that are valid regardless of
  // the schema. Besides skipping the registry work for the common
  // `$sum: 1` case, this arm RESOLVES for unresolved generic schemas —
  // without it, generic-schema pipeline helpers
  // (`<D extends Document>(p: Pipeline<D, D>) => p.group(...)`) fail on
  // deferred conditionals even for schema-independent operands.
  [A] extends (
    [
      | { $sum: number }
      | { $avg: number }
      | { $min: number | Date | boolean | NoDollarString }
      | { $max: number | Date | boolean | NoDollarString },
    ]
  ) ?
    never
  : // Schema-INDEPENDENT name check first, so it still runs on wide
  // schemas AND resolves for generic-schema helpers: the accumulator must
  // be registered or allow-listed — anything else is a typo, not a
  // MongoDB accumulator.
  [OperatorKeyOf<A>] extends (
    [keyof AccumulatorSpec<Schema> | UnimplementedAccumulators]
  ) ?
    OperatorKeyOf<A> extends infer Op extends CheckedAccumulatorOps ?
      string extends keyof Schema ?
        never // operand checks are meaningless on a wide/index-signature schema
      : // $min/$max: ANY non-`$` string literal is a comparable. The union
      // relation below can't express "string minus `$`-prefix" (NoDollarString
      // only covers alphanumeric-leading strings, falsely rejecting "", "_x",
      // "(none)"), so accept it here; `$`-strings fall through to the union,
      // where the refs arm checks them against the schema.
      Op extends "$min" | "$max" ?
        A[Op & keyof A] extends `$${string}` ?
          [A] extends [AccumulatorFor<Schema, Op>] ?
            never
          : BrandedAccumulatorFor<Schema, Op>
        : A[Op & keyof A] extends string ? never
        : [A] extends [AccumulatorFor<Schema, Op>] ? never
        : BrandedAccumulatorFor<Schema, Op>
      : // Readonly-tolerant via the registry's readonly operand positions
      // (see ExpressionSpec).
      [A] extends [AccumulatorFor<Schema, Op>] ? never
      : BrandedAccumulatorFor<Schema, Op>
    : never // registered-but-unchecked ($push, ...) or allow-listed:
  : // schema-free, so it RESOLVES for generic-schema helpers
    UnknownAccumulatorError<OperatorKeyOf<A> & string>;

/**
 * Per-key group re-check. `_id` is an expression/literal position — it gets
 * the shared nested-validation walk (`elements/validation.ts`), including
 * compound-`_id` objects. Non-`_id` keys are accumulator positions:
 * registered numeric-family accumulators get the registry-derived operand
 * check; a `$`-keyed value with more than one operator key is malformed;
 * everything else (unregistered accumulators, plain literals) is accepted —
 * unregistered accumulators are valid MongoDB the registry doesn't model
 * yet. Distributes over union-typed values so a union of valid
 * accumulators stays valid.
 */
type ValidateGroupValue<Schema extends Document, K, V> =
  V extends unknown ?
    K extends "_id" ? ValidateNestedValue<Schema, V>
    : [OperatorKeyOf<V>] extends [never] ? ValidateNestedValue<Schema, V>
    : HasSingleOperatorKey<V> extends false ? MultiOperatorError
    : [Exclude<keyof V & string, `$${string}`>] extends [never] ?
      ValidateAccumulatorValue<Schema, V>
    : // Accumulator key mixed with plain keys — MongoDB: "The field must
      // specify one accumulator" (mirrors ValidateExpressionValue's guard).
      MultiOperatorError
  : never;

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
 * Cost control (§3.8 rule 5): OmitNeverValues filters valid keys out, so a
 * fully-valid query — the common case — validates against `{}` and the
 * intersection relation short-circuits.
 *
 * The `string extends keyof Q` guard skips validation when Q is not a
 * literal query: when the CONSTRAINT check fails, TS falls back to
 * instantiating this wrapper with Q = GroupQuery<Schema> itself (whose
 * index signature makes `keyof Q` include `string`), and without the guard
 * the walk misfires on the wide value unions — branding the user's VALID
 * keys and overflowing the instantiation depth on top of the real
 * constraint error.
 */
export type ValidateGroupQuery<Schema extends Document, Q> =
  // Wide-QUERY guard: on constraint failure TS re-instantiates this wrapper
  // with Q = GroupQuery<Schema> itself — skip entirely. Schema-DEPENDENT
  // checks guard themselves (ValidateAccumulatorValue / the kernel's
  // ref/operand arms), so shape checks still run on index-signature
  // schemas.
  string extends keyof Q ? {}
  : OmitNeverValues<{
      [K in keyof Q]: ValidateGroupValue<Schema, K, Q[K]>;
    }>;

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
