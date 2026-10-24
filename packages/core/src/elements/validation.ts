/**
 * THE nested-value validation kernel.
 *
 * The Query types ACCEPT `$`-shaped values structurally (`` `$${string}` ``
 * strings, `ExpressionShaped` objects) — rejecting through the deep
 * `AnyLiteral | Expression` union accumulates relation depth on the shared
 * call-checking stack and surfaces spurious TS2589s. The helpers here are
 * the matching REJECTION surface: stage `ValidateXxxQuery` wrappers
 * re-check the inferred literal with them and map offending keys to brands
 * (or the registry's expected operand shape).
 *
 * Contract shared by every helper: `never` means "valid — nothing to
 * report"; anything else is the replacement type the wrapper maps the key
 * to. Constraints are never re-spelled here: field references resolve
 * through `GetFieldTypeWithoutArrays` (the same authority inference uses,
 * so acceptance and inference cannot disagree and the Field brand is
 * spelled once); `$$`-variable references resolve through
 * `ValidateVariableReference` (variables.ts — same authority as
 * `InferVariableReference`); expression operands check against the
 * registry's `ExpressionFor<Schema, Op>`.
 *
 * Operator names must be registered (`ExpressionSpec`) or allow-listed
 * (`UnimplementedExpressionOps` — accepted with no operand validation or
 * inference); anything else is a typo and brands with
 * `UnknownOperatorError`. Structurally malformed shapes brand too:
 * multi-operator objects, operator keys mixed with plain keys, and
 * registered operators with invalid operands.
 *
 * `Vars` is the USER variable environment (bound names WITHOUT the `$$`
 * prefix → their inferred types), threaded through every helper by the
 * binder walks below. The registry operand relation is Vars-blind, so an
 * operand that references a USER variable falls back to the
 * ref/variable/operator-name walk; its operand TYPE errors are runtime
 * MongoDB's to report. Every other operand stays strict.
 */

import {
  Document,
  NonExpandableTypes,
  OmitNeverValues,
} from "../utils/objects";
import {
  IsPipeSafeError,
  MultiOperatorError,
  PipeSafeError,
  RequiresMsg,
  UnknownOperatorError,
} from "../utils/errors";
import {
  HasOperatorKey,
  HasSingleOperatorKey,
  OperatorKeyOf,
} from "../utils/dispatch";
import {
  ExpressionFor,
  ExpressionSpec,
  InferArrayElementType,
  UnimplementedExpressionOps,
} from "./expressions";
import { GetFieldTypeWithoutArrays } from "./fieldReference";
import {
  BindLetVars,
  BindVariable,
  BoundAsName,
  InferVariableReference,
  SystemVariable,
  ValidateVariableName,
  ValidateVariableReference,
} from "./variables";
import { WithoutDollar } from "../utils/strings";

/**
 * Re-check for a `$`-keyed (expression-shaped) value:
 *
 * - operator key(s) mixed with plain keys, or more than one operator key →
 *   the exactly-one-operator brand (MongoDB: "an expression specification
 *   must contain exactly one field")
 * - $concat / $let / $map / $filter → dedicated element-wise/interior walks
 * - registered operator, invalid operand → the registry's expected shape,
 *   so TS reports TS2322 at the offending operand against the operand
 *   kernel's branded union
 * - allow-listed unimplemented operator → valid (no operand check)
 * - anything else → UnknownOperatorError (a typo, not a MongoDB operator)
 * - valid → `never`
 */
export type ValidateExpressionValue<
  Schema extends Document,
  V,
  Vars extends Document = {},
> =
  [Exclude<keyof V & string, `$${string}`>] extends [never] ?
    HasSingleOperatorKey<V> extends false ? MultiOperatorError
    : // Special-cased operators, folded behind ONE guard so the common
    // path pays a single comparison. $concat needs an element-wise walk
    // (the union relation can't express "any non-`$` string" and can't
    // resolve refs element-wise); the binder walks MUST run before the
    // fast-accept below — their `unknown`-typed interiors pass the
    // whole-operand relation vacuously, skipping exactly the positions
    // that need the Vars environment.
    [OperatorKeyOf<V>] extends ["$concat" | "$let" | "$map" | "$filter"] ?
      [OperatorKeyOf<V>] extends ["$concat"] ?
        ValidateConcatValue<Schema, V, Vars>
      : [OperatorKeyOf<V>] extends ["$let"] ? ValidateLetValue<Schema, V, Vars>
      : [OperatorKeyOf<V>] extends ["$map"] ?
        ValidateBinderValue<Schema, V, "$map", Vars>
      : ValidateBinderValue<Schema, V, "$filter", Vars>
    : [OperatorKeyOf<V>] extends [keyof ExpressionSpec<Schema>] ?
      // Schema-FREE fast-accept (mirrors group's ValidateAccumulatorValue):
      // an operand valid against the EMPTY schema is valid against any
      // schema — the ref arms collapse to `never` under `{}`, so only
      // schema-independent operands (literals, nested literal expressions)
      // pass here. Besides skipping the Schema-parameterized operand types
      // for the common literal case, this arm RESOLVES for generic-schema
      // helpers, where the guarded check below stays deferred. The
      // fast-accepts are ALSO the wide-shape cycle breaker for the binder
      // walk below (see elements/CLAUDE.md).
      [V] extends [ExpressionFor<{}, OperatorKeyOf<V>>] ? never
      : string extends keyof Schema ?
        never // schema-dependent operand check is meaningless on a wide schema
      : // Readonly-tolerant WITHOUT per-literal transformation: the
      // registry's operand array positions are `readonly`, so mutable and
      // `as const` operands both relate directly.
      [V] extends [ExpressionFor<Schema, OperatorKeyOf<V>>] ? never
      : // The relation is Vars-blind, so user `$$vars` fail it: only an
      // operand that references one falls back to the
      // ref/variable/operator-name walk.
      UserVariableOperand<Vars, V> extends true ?
        ValidateOperandTree<Schema, V, OperatorKeyOf<V>, Vars>
      : ExpressionFor<Schema, OperatorKeyOf<V>>
    : [OperatorKeyOf<V>] extends [UnimplementedExpressionOps] ?
      never // allow-listed: valid MongoDB the registry doesn't model yet
    : // Schema-INDEPENDENT (like the multi-operator check), so it runs
      // even on wide/index-signature schemas.
      UnknownOperatorError<OperatorKeyOf<V> & string>
  : MultiOperatorError; // operator key alongside plain keys

/**
 * `$concat` re-check, element-wise; every element must be a string.
 * `$`-refs and `$$`-variables must RESOLVE to string ("$$NOW" is a Date →
 * RequiresMsg brand; unknown names → Variable brand; unresolvable types
 * are skipped); any non-`$` string literal passes (separators like " - "
 * that NoDollarString can't cover included). Kernel contract throughout.
 */
type ValidateConcatValue<
  Schema extends Document,
  V,
  Vars extends Document = {},
> =
  V extends { readonly $concat: infer Arr } ?
    Arr extends readonly unknown[] ?
      true extends (
        {
          [I in keyof Arr]: [
            ValidateConcatElement<Schema, Arr[I], Vars>,
          ] extends [never] ?
            never
          : true;
        }[number]
      ) ?
        {
          $concat: {
            [I in keyof Arr]: [
              ValidateConcatElement<Schema, Arr[I], Vars>,
            ] extends [never] ?
              Arr[I]
            : ValidateConcatElement<Schema, Arr[I], Vars>;
          };
        }
      : never
    : ExpressionFor<Schema, "$concat"> // non-array operand → expected shape
  : never;

type ValidateConcatElement<
  Schema extends Document,
  E,
  Vars extends Document = {},
> =
  E extends `$${string}` ?
    ValidateRefResolvesTo<Schema, E, string, ConcatErr, Vars>
  : E extends string ? never
  : ConcatErr;

type ConcatErr = PipeSafeError<
  RequiresMsg<"Operator", "$concat", "a string operand">
>;

/**
 * Kernel contract for a `$`-ref or `$$`-variable that must RESOLVE to `T`:
 * unknown names/paths get their own brand, a resolved type outside `T` gets
 * `Err`, and unresolvable/opaque types are skipped.
 */
export type ValidateRefResolvesTo<
  Schema extends Document,
  Ref extends string,
  T,
  Err,
  Vars extends Document,
> =
  Ref extends `$$${string}` ?
    ValidateVariableReference<Schema, Ref, Vars> extends infer VarErr ?
      [VarErr] extends [never] ?
        InferVariableReference<Schema, Ref, Vars> extends infer R ?
          unknown extends R ? never
          : [NonNullable<R>] extends [T] ? never
          : Err
        : never
      : VarErr
    : never
  : string extends keyof Schema ?
    never // ref resolution is meaningless on a wide/index-signature schema
  : GetFieldTypeWithoutArrays<Schema, WithoutDollar<Ref>> extends infer R ?
    IsPipeSafeError<R> extends true ? R
    : [NonNullable<R>] extends [T] ? never
    : Err
  : never;

/**
 * `$let` interior walk: `vars` values check in the OUTER environment; `in`
 * with the block's bindings layered on (BindLetVars — the same environment
 * inference binds). Malformed shapes get the registry's expected shape.
 */
type ValidateLetValue<Schema extends Document, V, Vars extends Document = {}> =
  V extends { $let: { vars: infer LetVars extends object; in: infer In } } ?
    ValidateBindings<Schema, LetVars, Vars> extends infer VarsErr ?
      ValidateNestedValue<
        Schema,
        In,
        BindLetVars<Schema, LetVars, Vars>
      > extends infer InErr ?
        [keyof VarsErr | InErr] extends [never] ?
          never
        : {
            $let: {
              vars: {
                [K in keyof LetVars]: K extends keyof VarsErr ? VarsErr[K]
                : LetVars[K];
              };
              in: [InErr] extends [never] ? In : InErr;
            };
          }
      : never
    : never
  : ExpressionFor<Schema, "$let">;

/**
 * Key-filtered re-check of a bindings object (`$let.vars`, `$lookup.let`):
 * each name must be a valid user variable name, each value valid in the
 * OUTER environment. Offending keys map to their brand; a fully-valid
 * object validates against `{}`. Wide-QUERY guard as ValidateNestedRecord.
 */
export type ValidateBindings<
  Schema extends Document,
  B,
  Vars extends Document = {},
> =
  string extends keyof B ? {}
  : OmitNeverValues<{
      [K in keyof B]: [ValidateVariableName<K>] extends [never] ?
        ValidateNestedValue<Schema, B[K], Vars>
      : ValidateVariableName<K>;
    }>;

/** The registry's own `input` operand type for $map/$filter — spelled once. */
type RegistryArrayInputOperand<
  Schema extends Document,
  Op extends "$map" | "$filter",
> =
  ExpressionSpec<Schema>[Op]["operand"] extends { input: infer I } ? I : never;

/**
 * Shared `input` re-check for the $map/$filter walks: `$$`-variables and
 * `$`-refs resolve through their authorities with an array demand; a
 * binder-shaped input gets its own interior walk (its `unknown`-typed
 * body passes the relation vacuously); everything else RELATES against
 * the registry's own input operand. Do NOT "improve" that last arm into a
 * `ValidateNestedValue` re-entry — it blows TS's instantiation depth (see
 * elements/CLAUDE.md). Inside a binder interior the Vars-blind Schema
 * relation is skipped (a bound "$$arr" nested in the input would falsely
 * fail it).
 */
type ValidateArrayInputValue<
  Schema extends Document,
  Input,
  Op extends "$map" | "$filter",
  Vars extends Document = {},
> =
  Input extends `$${string}` ?
    ValidateRefResolvesTo<
      Schema,
      Input,
      readonly unknown[],
      PipeSafeError<RequiresMsg<"Operator", Op, "an array operand">>,
      Vars
    >
  : // `input: string` keeps the registry's own (recursive) shapes out.
  Input extends (
    | { $map: { input: string } }
    | { $filter: { input: string } }
    | { $let: unknown }
  ) ?
    ValidateExpressionValue<Schema, Input, Vars>
  : // Schema-FREE fast-accept (mirrors ValidateExpressionValue's): resolves
  // for generic-schema helpers and skips the Schema operand types for
  // literal inputs.
  [Input] extends [RegistryArrayInputOperand<{}, Op>] ? never
  : string extends keyof Schema ?
    never // operand checks are meaningless on a wide/index-signature schema
  : [Input] extends [RegistryArrayInputOperand<Schema, Op>] ? never
  : UserVariableOperand<Vars, Input> extends true ?
    never // the relation is Vars-blind; a user variable fails it
  : PipeSafeError<RequiresMsg<"Operator", Op, "an array operand">>;

/**
 * The binder walks' sibling-key re-check (`as`, `limit`): each key other
 * than the walked ones relates against the registry's schema-free operand
 * (`as` must be a string, `limit` a number) — `never` when valid, else an
 * Operator brand, so TS2322 lands on the offending key (the bare expected
 * type would intersect the literal to `never` and misplace the error).
 */
type ValidateBinderSiblingKey<
  Op extends "$map" | "$filter",
  K,
  Value,
  Reg = ExpressionSpec<{}>[Op]["operand"],
> =
  K extends keyof Reg & string ?
    [Value] extends [Exclude<Reg[K], undefined>] ?
      K extends "as" ?
        ValidateVariableName<Value>
      : never
    : PipeSafeError<
        RequiresMsg<
          "Operator",
          Op,
          `${Exclude<Reg[K], undefined> extends number ? "a numeric" : "a string"} '${K}'`
        >
      >
  : never;

/** `true` when any sibling key of a binder operand fails its re-check. */
type BinderSiblingErr<
  Op extends "$map" | "$filter",
  Operand,
  Walked extends string,
> = {
  [K in keyof Operand]: K extends Walked ? never
  : [ValidateBinderSiblingKey<Op, K, Operand[K]>] extends [never] ? never
  : true;
}[keyof Operand];

/** The bound sub-expression of each binder operand. */
type BinderBodyKey = { $map: "in"; $filter: "cond" };

/**
 * `$map`/`$filter` interior walk: `input` in the outer environment, the
 * body (`in`/`cond`) with the element bound under the `as` name (default
 * "this"). The replacement keeps sibling operand keys so TS2322 lands on
 * the offending member.
 */
type ValidateBinderValue<
  Schema extends Document,
  V,
  Op extends keyof BinderBodyKey,
  Vars extends Document = {},
  Body extends string = BinderBodyKey[Op],
> =
  V extends Record<Op, infer Operand> ?
    Operand extends { input: infer Input } & Record<Body, infer B> ?
      ValidateArrayInputValue<Schema, Input, Op, Vars> extends infer InputErr ?
        ValidateNestedValue<
          Schema,
          B,
          BindVariable<
            Vars,
            BoundAsName<Operand>,
            InferArrayElementType<Schema, Input, Vars>
          >
        > extends infer BodyErr ?
          [
            InputErr | BodyErr | BinderSiblingErr<Op, Operand, "input" | Body>,
          ] extends [never] ?
            never
          : {
              [P in Op]: {
                [K in keyof Operand]: K extends "input" ?
                  [InputErr] extends [never] ?
                    Operand[K]
                  : InputErr
                : K extends Body ?
                  [BodyErr] extends [never] ?
                    Operand[K]
                  : BodyErr
                : [ValidateBinderSiblingKey<Op, K, Operand[K]>] extends (
                  [never]
                ) ?
                  Operand[K]
                : ValidateBinderSiblingKey<Op, K, Operand[K]>;
              };
            }
        : never
      : never
    : ExpressionFor<Schema, Op> // malformed operand → expected shape
  : ExpressionFor<Schema, Op>;

/**
 * `true` for an operand, inside a binder interior or `$lookup.let`
 * sub-pipeline, that references a USER variable — bound, or an unknown
 * name the walk brands. The registry operand relations are Vars-blind, so
 * such operands demote them to fast-accepts with the name/ref walk
 * catching the leftovers; system variables are modeled by the relation and
 * stay strict.
 */
export type UserVariableOperand<Vars extends Document, V> =
  [keyof Vars] extends [never] ? false : ContainsUserVariableRef<V>;

/** Walk an operator's operand tree; the replacement re-wraps it. */
export type ValidateOperandTree<
  Schema extends Document,
  V,
  Op,
  Vars extends Document,
> =
  ValidateNestedValue<Schema, V[Op & keyof V], Vars> extends infer R ?
    [R] extends [never] ?
      never
    : { [K in Op & string]: R }
  : never;

/**
 * `true` when a literal value tree holds a non-system `$$`-reference.
 * Non-distributive throughout: literal trees carry no unions, and TS also
 * instantiates this with the registry's recursive operand unions while
 * contextually typing a call — walking those recurses to TS2589.
 */
type ContainsUserVariableRef<V> =
  [V] extends [`$$${string}`] ?
    [V] extends [SystemVariable | `${SystemVariable}.${string}`] ?
      false
    : true
  : [V] extends [readonly unknown[]] ?
    true extends { [I in keyof V]: ContainsUserVariableRef<V[I]> }[number] ?
      true
    : false
  : [V] extends [object] ?
    [V] extends [NonExpandableTypes] ? false
    : true extends { [K in keyof V]: ContainsUserVariableRef<V[K]> }[keyof V] ?
      true
    : false
  : false;

/**
 * Recursive walk over a literal value tree. `$$`-strings resolve through
 * ValidateVariableReference (system variables incl. dotted paths, plus the
 * Vars-bound user variables; anything else brands —
 * aggregation-command-level `let` is not modeled yet); single-`$` strings
 * resolve through the same field authority inference uses. Arrays walk
 * their elements; non-expandable objects (Date, ObjectId, ...) are always
 * valid.
 */
export type ValidateNestedValue<
  Schema extends Document,
  V,
  Vars extends Document = {},
> =
  V extends `$$${string}` ? ValidateVariableReference<Schema, V, Vars>
  : V extends `$${string}` ?
    string extends keyof Schema ?
      never // ref resolution is meaningless on a wide/index-signature schema
    : GetFieldTypeWithoutArrays<Schema, WithoutDollar<V>> extends infer R ?
      IsPipeSafeError<R> extends true ?
        R
      : never
    : never
  : V extends readonly unknown[] ? ValidateArrayValue<Schema, V, Vars>
  : V extends object ?
    V extends NonExpandableTypes ? never
    : string extends keyof V ?
      never // widened object type (Record/Document) — not a literal; skip
    : HasOperatorKey<V> extends true ? ValidateExpressionValue<Schema, V, Vars>
    : ValidateObjectValue<Schema, V, Vars>
  : never;

/**
 * Key-filtered wrapper for `[key: string]` value records (`$set`), wired
 * as `Q & ValidateNestedRecord<Schema, Q>`:
 * OmitNeverValues drops valid keys, so a fully-valid record validates
 * against `{}` and only offending keys survive, mapped to the kernel's
 * replacement (TS2322 at the offending value). Wide-QUERY guard: on
 * constraint failure TS re-instantiates the wrapper with the wide query
 * type itself — walking its value unions would brand valid keys and
 * overflow the instantiation depth on top of the real error.
 */
export type ValidateNestedRecord<
  Schema extends Document,
  Q,
  Vars extends Document = {},
> =
  string extends keyof Q ? {}
  : OmitNeverValues<{
      [K in keyof Q]: ValidateNestedValue<Schema, Q[K], Vars>;
    }>;

/**
 * Plain-object arm of the walk: if ANY child is invalid, produce a
 * replacement object that keeps valid children as-is (`V[K]`) and swaps
 * invalid ones for their replacement — so the TS2322 lands exactly at the
 * deepest offending value. If all children are valid, `never` (the parent
 * key is filtered out by the wrapper). The double `ValidateNestedValue`
 * spelling per child is an alias-cache hit, not a recomputation.
 */
type ValidateObjectValue<
  Schema extends Document,
  V,
  Vars extends Document = {},
> =
  true extends (
    {
      [K in keyof V]: [ValidateNestedValue<Schema, V[K], Vars>] extends (
        [never]
      ) ?
        never
      : true;
    }[keyof V]
  ) ?
    {
      [K in keyof V]: [ValidateNestedValue<Schema, V[K], Vars>] extends (
        [never]
      ) ?
        V[K]
      : ValidateNestedValue<Schema, V[K], Vars>;
    }
  : never;

/**
 * Array/tuple arm: same never-or-replacement contract, element-wise. A
 * mapped type over an array type maps its element positions, so tuples
 * keep their shape and the error lands on the offending element.
 */
type ValidateArrayValue<
  Schema extends Document,
  V extends readonly unknown[],
  Vars extends Document = {},
> =
  true extends (
    {
      [I in keyof V]: [ValidateNestedValue<Schema, V[I], Vars>] extends (
        [never]
      ) ?
        never
      : true;
    }[number]
  ) ?
    {
      [I in keyof V]: [ValidateNestedValue<Schema, V[I], Vars>] extends (
        [never]
      ) ?
        V[I]
      : ValidateNestedValue<Schema, V[I], Vars>;
    }
  : never;
