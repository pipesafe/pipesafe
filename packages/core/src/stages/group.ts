import { InferNestedFieldReference } from "../elements/fieldReference";
import {
  UserVariableOperand,
  ValidateNestedBinders,
  ValidateNestedValue,
  ValidateOperandTree,
  ValidateRefResolvesTo,
} from "../elements/validation";
import {
  AnyLiteral,
  ExpressionShaped,
  LiteralOrFieldReferenceInferringTo,
} from "../elements/literals";
import {
  ReferenceValue,
  ValidateVariableReference,
} from "../elements/variables";
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
import { ExpressionOperand, ReferencesInferringTo } from "../elements/operands";

/** The BSON-comparable values $min/$max are modeled over. */
type Comparable = number | Date | string | boolean;

/**
 * The value type each checked accumulator's operand must resolve to — the
 * one spelling its operand union and its `$$`-variable check share.
 */
type AccumulatorTarget = {
  $sum: number;
  $avg: number;
  $min: Comparable;
  $max: Comparable;
};

/**
 * Numeric operand for accumulators like $sum, $avg — an ExpressionOperand
 * kernel set (numbers, field references to numbers, brand) extended with the
 * expression forms accumulators accept. The brand surfaces in IDE hovers
 * when the operand is incompatible (e.g. a string field reference passed to
 * $sum) — instead of a structural-mismatch wall.
 */
type NumericAccumulatorOperand<
  Schema extends Document,
  Op extends "$sum" | "$avg",
> =
  | ExpressionOperand<
      Schema,
      AccumulatorTarget[Op],
      RequiresMsg<"Accumulator", Op, "a numeric operand">
    >
  // Any registry expression whose declared result is numeric ($size,
  // arithmetic, $toDate arithmetic chains, ...) — derived, so new numeric
  // operators join automatically. ConditionalExpression stays explicit:
  // $ifNull/$cond results are literal-dependent (no declared `returns`).
  | ExpressionsReturning<Schema, AccumulatorTarget[Op]>
  | ConditionalExpression<Schema>;

/**
 * Operand for $min/$max. MongoDB defines them over BSON-comparable values —
 * numbers, dates, AND strings (lexicographic) are the ones this library
 * models; `$min: "$name"` is valid MongoDB and must compile.
 */
type MinMaxAccumulatorOperand<
  Schema extends Document,
  Op extends "$min" | "$max",
> =
  | ExpressionOperand<
      Schema,
      // The ref side accepts every modeled comparable; the LITERAL string
      // arm is narrowed to NoDollarString below — a bare `string` here
      // would swallow `$`-typo refs and make the brand unreachable.
      Exclude<AccumulatorTarget[Op], string>,
      RequiresMsg<
        "Accumulator",
        Op,
        "a comparable (number, date, string, or boolean) operand"
      >
    >
  | NoDollarString
  | ReferencesInferringTo<Schema, string>
  | ExpressionsReturning<Schema, AccumulatorTarget[Op]>
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
 * accumulators ($sum/$avg/$count), its result type. Operand-DEPENDENT
 * accumulators OMIT `returns` (the omission is the declaration, matching
 * the expression registry's encoding) and get an explicit inference arm
 * in `ResolveAccumulatorFunction`. `AccumulatorFunction` and the fixed
 * arms are derived from the registry — adding an accumulator means adding
 * one entry (plus one dependent arm if its result derives from the
 * operand).
 */
export interface AccumulatorSpec<Schema extends Document> {
  $sum: { operand: NumericAccumulatorOperand<Schema, "$sum">; returns: number };
  $avg: { operand: NumericAccumulatorOperand<Schema, "$avg">; returns: number };
  /** Operand-dependent results (like the expression registry, dependence
   *  is declared by OMITTING `returns`; inference lives in
   *  ResolveAccumulatorFunction's explicit arms). */
  $min: { operand: MinMaxAccumulatorOperand<Schema, "$min"> };
  $max: { operand: MinMaxAccumulatorOperand<Schema, "$max"> };
  $count: { operand: {}; returns: number };
  $push: { operand: FlexibleAccumulatorOperand<Schema> };
  $addToSet: { operand: FlexibleAccumulatorOperand<Schema> };
  $first: { operand: FlexibleAccumulatorOperand<Schema> };
  $last: { operand: FlexibleAccumulatorOperand<Schema> };
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

/**
 * Every accumulator operator — AUTHORITATIVE; `AccumulatorSpec` conforms
 * to this list, not the other way around. Exported so tooling (docs, the
 * IDE autocomplete tests) consumes the same names the types are built
 * from. The `satisfies` is the cheapest compile-time tie: an error here
 * reads "the registry is missing an entry for this accumulator". (A
 * registry key absent from this list is caught by the completions suite's
 * exact-match ideal.) Never keep the two in sync with assertion pins.
 */
export const ACCUMULATOR_OPERATORS = [
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$count",
  "$push",
  "$addToSet",
  "$first",
  "$last",
] as const satisfies readonly (keyof AccumulatorSpec<Document>)[];

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
export type ResolveAccumulatorFunction<
  Schema extends Document,
  Accumulator,
  Vars extends Document = {},
> =
  Accumulator extends { $sum: any } ? AccumulatorSpec<Schema>["$sum"]["returns"]
  : Accumulator extends { $avg: any } ?
    AccumulatorSpec<Schema>["$avg"]["returns"]
  : Accumulator extends { $count: any } ?
    AccumulatorSpec<Schema>["$count"]["returns"]
  : Accumulator extends { $min: infer A } ?
    InferNestedFieldReference<Schema, A, Vars>
  : Accumulator extends { $max: infer A } ?
    InferNestedFieldReference<Schema, A, Vars>
  : Accumulator extends { $push: infer A } ?
    InferNestedFieldReference<Schema, A, Vars>[]
  : Accumulator extends { $addToSet: infer A } ?
    InferNestedFieldReference<Schema, A, Vars>[]
  : Accumulator extends { $first: infer A } ?
    InferNestedFieldReference<Schema, A, Vars>
  : Accumulator extends { $last: infer A } ?
    InferNestedFieldReference<Schema, A, Vars>
  : // Allow-listed unimplemented accumulators (UnimplementedAccumulators)
  // have no inference — their result degrades to `unknown`, never to a
  // `never`-poisoned field. (Typo'd keys also land here, but validation
  // brands those at the call site, so their output type is moot.)
  HasOperatorKey<Accumulator> extends true ? unknown
  : never;

export type GroupQuery<Schema extends Document, Vars extends Document = {}> = {
  // The environment's `$$`-variable references ($$NOW, "$$ROOT.name",
  // lookup-let bindings, ...) are valid _id expressions; AnyLiteral's
  // string arm is NoDollarString, so they need their own arm — finite, so
  // they autocomplete and an out-of-scope `$$var` rejects at the
  // constraint.
  // `FieldReference<Schema>` is likewise its own arm: grouping by any field —
  // including array/document refs like `$tags`/`$shipping`/`$items` — is valid
  // MongoDB, but AnyLiteral only offers references that infer to PRIMITIVES.
  // It must appear on BOTH arms: the `[key: string]` index signature below
  // covers _id, so suggested refs must typecheck against it too (same
  // precedent as the `` `$$${string}` `` arm — an _id-only addition makes the
  // index signature reject them).
  _id:
    | AnyLiteral<Schema>
    | Expression<Schema>
    | ReferenceValue<Schema, Vars>
    | null;
} & {
  // The index signature covers _id too, so it must also carry the `$$` and
  // FieldReference arms (an intersection member rejecting _id would reject the
  // whole query). ExpressionShaped accepts $-keyed values structurally:
  // rejecting at the constraint would misreport the error on sibling
  // keys. The NAME check happens in ValidateGroupQuery instead — the key
  // must be registered (AccumulatorSpec) or allow-listed
  // (UnimplementedAccumulators, e.g. $stdDevPop/$top/$mergeObjects);
  // registered numeric/comparable accumulators are also operand-checked.
  [key: string]:
    | AnyLiteral<Schema>
    | AccumulatorFunction<Schema>
    | ExpressionShaped
    | ReferenceValue<Schema, Vars>
    | null;
};

/**
 * The IsAny guard is load-bearing for CheckedAccumulatorOps below:
 * FlexibleAccumulatorOperand collapses to `any` (its
 * LiteralOrFieldReferenceInferringTo<Schema, any> arm), and
 * `Extract<any, PipeSafeError<string>>` is `any` — without the guard
 * $push/$addToSet/$first/$last would wrongly join the derived set.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The accumulators whose operands ValidateGroupQuery re-checks — DERIVED
 * from the registry: exactly the entries whose operand union carries a
 * PipeSafeError brand arm (the brand is what the re-check surfaces).
 * Registering an accumulator with a branded operand extends call-site
 * validation automatically; the flexible accumulators
 * ($push/$addToSet/$first/$last/$count) carry no brand and stay out.
 * Schema-independent, so it is computed once over `Document` (exported for
 * the documenting pin in group.typeAssertions.ts).
 */
export type CheckedAccumulatorOps = {
  [K in keyof AccumulatorSpec<Document>]: IsAny<
    AccumulatorSpec<Document>[K]["operand"]
  > extends true ?
    never
  : [
    Extract<AccumulatorSpec<Document>[K]["operand"], PipeSafeError<string>>,
  ] extends [never] ?
    never
  : K;
}[keyof AccumulatorSpec<Document>];

/**
 * Registry-derived accumulator re-check: dispatch on the operator key,
 * compare the value against the registry's own shape (`AccumulatorFor`),
 * and on failure map the key to the brand EXTRACTED from the registry
 * operand's union — the message is spelled once, inside
 * NumericAccumulatorOperand/MinMaxAccumulatorOperand's RequiresMsg.
 */
/** The registry operand's own brand, extracted — spelled once. */
type AccumulatorBrand<
  Schema extends Document,
  Op extends CheckedAccumulatorOps,
> = Extract<AccumulatorSpec<Schema>[Op]["operand"], PipeSafeError<string>>;

type BrandedAccumulatorFor<
  Schema extends Document,
  Op extends CheckedAccumulatorOps,
> = { [K in Op]: AccumulatorBrand<Schema, K> };

/**
 * An unchecked accumulator's (`$push`, `$first`, allow-listed) `$$`-variable
 * operand must resolve; field refs are not walked (they would stay deferred
 * for generic-schema helpers).
 */
type ValidateVariableOperand<
  Schema extends Document,
  A,
  Vars extends Document,
> =
  A[OperatorKeyOf<A> & keyof A] extends infer Ref extends `$$${string}` ?
    ValidateVariableReference<Schema, Ref, Vars> extends infer E ?
      [E] extends [never] ?
        never
      : { [K in OperatorKeyOf<A>]: E }
    : never
  : never;

type ValidateAccumulatorValue<
  Schema extends Document,
  A,
  Vars extends Document = {},
> =
  // Schema-FREE fast-accept: an operand valid against the EMPTY schema is
  // valid against any schema (the ref arms collapse to `never` under `{}`).
  // DERIVED from the registry (`AccumulatorFor<{}, Op>`) so an operand
  // narrowing or a new checked accumulator cannot silently diverge from
  // this arm — it is checked FIRST, so a hand-spelled copy that drifted
  // wider would make the registry brands unreachable. Besides skipping the
  // registry work for the common `$sum: 1` case, this arm RESOLVES for
  // unresolved generic schemas — without it, generic-schema pipeline
  // helpers (`<D extends Document>(p: Pipeline<D, D>) => p.group(...)`)
  // fail on deferred conditionals even for schema-independent operands.
  [A] extends [AccumulatorFor<{}, OperatorKeyOf<A>>] ?
    ValidateVariableOperand<Schema, A, Vars> // unchecked operands pass it
  : // Schema-INDEPENDENT name check first, so it still runs on wide
  // schemas AND resolves for generic-schema helpers: the accumulator must
  // be registered or allow-listed — anything else is a typo, not a
  // MongoDB accumulator.
  [OperatorKeyOf<A>] extends (
    [keyof AccumulatorSpec<Schema> | UnimplementedAccumulators]
  ) ?
    OperatorKeyOf<A> extends infer Op extends CheckedAccumulatorOps ?
      // `$$`-variables resolve before the operand relation: unknown
      // names/bad paths get the Variable/Field brand, a resolved type
      // outside the accumulator's target the registry brand ("$$NOW" is a
      // Date, so `$sum: "$$NOW"` rejects; "$$ROOT.age" passes).
      A[Op & keyof A] extends infer Ref extends `$$${string}` ?
        ValidateRefResolvesTo<
          Schema,
          Ref,
          AccumulatorTarget[Op],
          AccumulatorBrand<Schema, Op>,
          Vars
        > extends infer E ?
          [E] extends [never] ?
            never
          : { [K in Op]: E }
        : never
      : string extends keyof Schema ?
        never // operand checks are meaningless on a wide/index-signature schema
      : // Readonly-tolerant via the registry's readonly operand positions
      // (see ExpressionSpec). The relation runs first, so the
      // user-variable gate only sees operands that fail it (mirrors
      // ValidateExpressionValue).
      [A] extends [AccumulatorFor<Schema, Op>] ? never
      : UserVariableOperand<Vars, A> extends true ?
        ValidateOperandTree<Schema, A, Op, Vars>
      : // $min/$max: ANY non-`$` string literal is a comparable. The union
      // relation can't express "string minus `$`-prefix" (NoDollarString
      // only covers alphanumeric-leading strings, falsely rejecting "", "_x",
      // "(none)"), so accept it here.
      Op extends "$min" | "$max" ?
        A[Op & keyof A] extends `$${string}` ? BrandedAccumulatorFor<Schema, Op>
        : A[Op & keyof A] extends string ? never
        : BrandedAccumulatorFor<Schema, Op>
      : BrandedAccumulatorFor<Schema, Op>
    : ValidateVariableOperand<Schema, A, Vars> // allow-listed
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
type ValidateGroupValue<
  Schema extends Document,
  K,
  V,
  Vars extends Document = {},
> =
  V extends unknown ?
    K extends "_id" ? ValidateNestedValue<Schema, V, Vars>
    : [OperatorKeyOf<V>] extends [never] ? ValidateNestedValue<Schema, V, Vars>
    : HasSingleOperatorKey<V> extends false ? MultiOperatorError
    : [Exclude<keyof V & string, `$${string}`>] extends [never] ?
      ValidateNestedBinders<Schema, V, Vars> extends infer B ?
        [B] extends [never] ?
          ValidateAccumulatorValue<Schema, V, Vars>
        : B
      : never
    : // Accumulator key mixed with plain keys — MongoDB: "The field must
      // specify one accumulator" (mirrors ValidateExpressionValue's guard).
      MultiOperatorError
  : never;

/**
 * Key-filtered validation wrapper for `Pipeline.group`. GroupQuery's
 * `[key: string]` index signature suppresses per-value operand checks at
 * the call site, so the accumulator brands cannot fire from
 * chained calls. This wrapper re-checks the inferred literal at the
 * parameter position via intersection (`$group: G & ValidateGroupQuery<…>`
 * — the intersection form is REQUIRED: replacing the raw `G` parameter
 * breaks contextual typing of compound `_id` expressions).
 *
 * Cost control: OmitNeverValues filters valid keys out, so a
 * fully-valid query — the common case — validates against `{}` and the
 * intersection relation short-circuits.
 *
 * The `string extends keyof Q` guard skips validation when Q is not a
 * literal query: when the CONSTRAINT check fails, TS falls back to
 * instantiating this wrapper with Q = GroupQuery<Schema> itself (whose
 * index signature makes `keyof Q` include `string`), and without the guard
 * the walk misfires on the wide value unions — branding the user's VALID
 * keys and overflowing the instantiation depth on top of the real
 * constraint error. Distributive over Q, as ValidateNestedRecord.
 */
export type ValidateGroupQuery<
  Schema extends Document,
  Q,
  Vars extends Document = {},
> =
  // Wide-QUERY guard: on constraint failure TS re-instantiates this wrapper
  // with Q = GroupQuery<Schema> itself — skip entirely. Schema-DEPENDENT
  // checks guard themselves (ValidateAccumulatorValue / the kernel's
  // ref/operand arms), so shape checks still run on index-signature
  // schemas.
  Q extends unknown ?
    string extends keyof Q ?
      {}
    : OmitNeverValues<{
        [K in keyof Q]: ValidateGroupValue<Schema, K, Q[K], Vars>;
      }>
  : never;

export type ResolveGroupOutput<
  Schema extends Document,
  G extends GroupQuery<Schema, Vars>,
  Vars extends Document = {},
> = PassThrough<
  Schema,
  // Wide query (non-literal, or the constraint-failure fallback): skip inference.
  string extends keyof G ? Document
  : Prettify<
      {
        _id: InferNestedFieldReference<Schema, G["_id"], Vars> extends (
          infer Id
        ) ?
          Id extends object ?
            Id extends Date | unknown[] ?
              Id // Don't flatten Date/array _id (e.g. tuples from $dateToParts)
            : Prettify<Id>
          : Id // Primitive _id (string, number, null) — pass through
        : never;
      } & {
        [key in Exclude<keyof G, "_id">]: ResolveAccumulatorFunction<
          Schema,
          G[key],
          Vars
        >;
      }
    >
>;
