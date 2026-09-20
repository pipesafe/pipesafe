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
 * `ValidateVariableReference` (literals.ts — same authority as
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
 * binder walks below. Inside a binder interior the Vars-blind registry
 * operand relation demotes to a fast-accept and the operand tree is walked
 * for ref/variable/operator-name errors; operand TYPE errors there are
 * runtime MongoDB's to report.
 */

import { Document, NonExpandableTypes } from "../utils/objects";
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
  BindLetVars,
  BindVariable,
  BoundAsName,
  ExpressionFor,
  ExpressionSpec,
  InferArrayElementType,
  UnimplementedExpressionOps,
} from "./expressions";
import { GetFieldTypeWithoutArrays } from "./fieldReference";
import {
  HasUserBindings,
  InferVariableReference,
  ValidateVariableReference,
} from "./literals";
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
      : [OperatorKeyOf<V>] extends ["$map"] ? ValidateMapValue<Schema, V, Vars>
      : ValidateFilterValue<Schema, V, Vars>
    : [OperatorKeyOf<V>] extends [keyof ExpressionSpec<Schema>] ?
      HasUserBindings<Vars> extends false ?
        // Schema-FREE fast-accept (mirrors group's ValidateAccumulatorValue):
        // an operand valid against the EMPTY schema is valid against any
        // schema — the ref arms collapse to `never` under `{}`, so only
        // schema-independent operands (literals, nested literal expressions)
        // pass here. Besides skipping the Schema-parameterized operand types
        // for the common literal case, this arm RESOLVES for generic-schema
        // helpers, where the guarded check below stays deferred.
        [V] extends [ExpressionFor<{}, OperatorKeyOf<V>>] ? never
        : string extends keyof Schema ?
          never // schema-dependent operand check is meaningless on a wide schema
        : // Readonly-tolerant WITHOUT per-literal transformation: the
        // registry's operand array positions are `readonly`, so mutable and
        // `as const` operands both relate directly.
        [V] extends [ExpressionFor<Schema, OperatorKeyOf<V>>] ? never
        : ExpressionFor<Schema, OperatorKeyOf<V>>
      : // Binder interior: the Vars-blind relation demotes to FAST-ACCEPT
      // (it must not REJECT — bound `$$vars` fail it) and leftovers get
      // the operand-tree walk, so bad refs/variables/operator names still
      // brand. The fast-accepts are ALSO the wide-shape cycle breaker —
      // removing them recurses registry→operand-union→registry to TS's
      // depth limit (see elements/CLAUDE.md). $literal interiors are
      // verbatim values, never walked.
      [V] extends [ExpressionFor<{}, OperatorKeyOf<V>>] ? never
      : [V] extends [ExpressionFor<Schema, OperatorKeyOf<V>>] ? never
      : [OperatorKeyOf<V>] extends ["$literal"] ? never
      : ValidateNestedValue<
        Schema,
        V[OperatorKeyOf<V> & keyof V],
        Vars
      > extends infer R ?
        [R] extends [never] ?
          never
        : { [K in OperatorKeyOf<V> & string]: R }
      : never
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
  E extends `$$${string}` ?
    ValidateVariableReference<Schema, E, Vars> extends infer Err ?
      [Err] extends [never] ?
        InferVariableReference<Schema, E, Vars> extends infer R ?
          unknown extends R ?
            never // unresolvable/opaque variable — nothing to check
          : [NonNullable<R>] extends [string] ? never
          : PipeSafeError<
              RequiresMsg<"Operator", "$concat", "a string operand">
            >
        : never
      : Err
    : never
  : E extends `$${string}` ?
    string extends keyof Schema ?
      never // ref resolution is meaningless on a wide/index-signature schema
    : GetFieldTypeWithoutArrays<Schema, WithoutDollar<E>> extends infer R ?
      IsPipeSafeError<R> extends true ? R
      : [NonNullable<R>] extends [string] ? never
      : PipeSafeError<RequiresMsg<"Operator", "$concat", "a string operand">>
    : never
  : E extends string ? never
  : PipeSafeError<RequiresMsg<"Operator", "$concat", "a string operand">>;

/**
 * `$let` interior walk: `vars` values check in the OUTER environment; `in`
 * with the block's bindings layered on (BindLetVars — the same environment
 * inference binds). Malformed shapes get the registry's expected shape.
 */
type ValidateLetValue<Schema extends Document, V, Vars extends Document = {}> =
  V extends { $let: { vars: infer LetVars; in: infer In } } ?
    ValidateNestedValue<Schema, LetVars, Vars> extends infer VarsErr ?
      ValidateNestedValue<
        Schema,
        In,
        BindLetVars<Schema, LetVars, Vars>
      > extends infer InErr ?
        [VarsErr | InErr] extends [never] ?
          never
        : {
            $let: {
              vars: [VarsErr] extends [never] ? LetVars : VarsErr;
              in: [InErr] extends [never] ? In : InErr;
            };
          }
      : never
    : never
  : ExpressionFor<Schema, "$let">;

/** The registry's own `input` operand type for $map/$filter — spelled once. */
type RegistryArrayInputOperand<
  Schema extends Document,
  Op extends "$map" | "$filter",
> =
  ExpressionSpec<Schema>[Op]["operand"] extends { input: infer I } ? I : never;

/**
 * Shared `input` re-check for the $map/$filter walks: `$$`-variables and
 * `$`-refs resolve through their authorities with an array demand;
 * everything else RELATES against the registry's own input operand. Do NOT
 * "improve" that last arm into a `ValidateNestedValue` re-entry — it blows
 * TS's instantiation depth (see elements/CLAUDE.md). Inside a binder
 * interior the Vars-blind Schema relation is skipped (a bound "$$arr"
 * nested in the input would falsely fail it).
 */
type ValidateArrayInputValue<
  Schema extends Document,
  Input,
  Op extends "$map" | "$filter",
  Vars extends Document = {},
> =
  Input extends `$$${string}` ?
    ValidateVariableReference<Schema, Input, Vars> extends infer Err ?
      [Err] extends [never] ?
        InferVariableReference<Schema, Input, Vars> extends infer R ?
          unknown extends R ?
            never // unresolvable/opaque variable — nothing to check
          : [NonNullable<R>] extends [readonly unknown[]] ? never
          : PipeSafeError<RequiresMsg<"Operator", Op, "an array operand">>
        : never
      : Err
    : never
  : Input extends `$${string}` ?
    string extends keyof Schema ?
      never // ref resolution is meaningless on a wide/index-signature schema
    : GetFieldTypeWithoutArrays<Schema, WithoutDollar<Input>> extends infer R ?
      IsPipeSafeError<R> extends true ? R
      : [NonNullable<R>] extends [readonly unknown[]] ? never
      : PipeSafeError<RequiresMsg<"Operator", Op, "an array operand">>
    : never
  : // Schema-FREE fast-accept (mirrors ValidateExpressionValue's): resolves
  // for generic-schema helpers and skips the Schema operand types for
  // literal inputs.
  [Input] extends [RegistryArrayInputOperand<{}, Op>] ? never
  : HasUserBindings<Vars> extends false ?
    string extends keyof Schema ?
      never // operand checks are meaningless on a wide/index-signature schema
    : [Input] extends [RegistryArrayInputOperand<Schema, Op>] ? never
    : PipeSafeError<RequiresMsg<"Operator", Op, "an array operand">>
  : never; // binder interior — the relation is Vars-blind; skip

/**
 * `$map` interior walk: `input` in the outer environment, `in` with the
 * element bound under the `as` name (default "this"). The replacement
 * keeps sibling operand keys so TS2322 lands on the offending member.
 */
type ValidateMapValue<Schema extends Document, V, Vars extends Document = {}> =
  V extends { $map: infer MapOperand } ?
    MapOperand extends { input: infer Input; in: infer In } ?
      ValidateArrayInputValue<Schema, Input, "$map", Vars> extends (
        infer InputErr
      ) ?
        ValidateNestedValue<
          Schema,
          In,
          BindVariable<
            Vars,
            BoundAsName<MapOperand>,
            InferArrayElementType<Schema, Input, Vars>
          >
        > extends infer InErr ?
          [InputErr | InErr] extends [never] ?
            never
          : {
              $map: {
                [K in keyof MapOperand]: K extends "input" ?
                  [InputErr] extends [never] ?
                    MapOperand[K]
                  : InputErr
                : K extends "in" ?
                  [InErr] extends [never] ?
                    MapOperand[K]
                  : InErr
                : MapOperand[K];
              };
            }
        : never
      : never
    : ExpressionFor<Schema, "$map"> // malformed operand → expected shape
  : ExpressionFor<Schema, "$map">;

/**
 * `$filter` interior walk: `input` in the outer environment, `cond` with
 * the element bound under the `as` name (default "this").
 */
type ValidateFilterValue<
  Schema extends Document,
  V,
  Vars extends Document = {},
> =
  V extends { $filter: infer FilterOperand } ?
    FilterOperand extends { input: infer Input; cond: infer Cond } ?
      ValidateArrayInputValue<Schema, Input, "$filter", Vars> extends (
        infer InputErr
      ) ?
        ValidateNestedValue<
          Schema,
          Cond,
          BindVariable<
            Vars,
            BoundAsName<FilterOperand>,
            InferArrayElementType<Schema, Input, Vars>
          >
        > extends infer CondErr ?
          [InputErr | CondErr] extends [never] ?
            never
          : {
              $filter: {
                [K in keyof FilterOperand]: K extends "input" ?
                  [InputErr] extends [never] ?
                    FilterOperand[K]
                  : InputErr
                : K extends "cond" ?
                  [CondErr] extends [never] ?
                    FilterOperand[K]
                  : CondErr
                : FilterOperand[K];
              };
            }
        : never
      : never
    : ExpressionFor<Schema, "$filter"> // malformed operand → expected shape
  : ExpressionFor<Schema, "$filter">;

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
