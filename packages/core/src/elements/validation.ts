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
 * spelled once); expression operands check against the registry's
 * `ExpressionFor<Schema, Op>`.
 *
 * Operator names must be registered (`ExpressionSpec`) or allow-listed
 * (`UnimplementedExpressionOps` — accepted with no operand validation or
 * inference); anything else is a typo and brands with
 * `UnknownOperatorError`. Structurally malformed shapes brand too:
 * multi-operator objects, operator keys mixed with plain keys, and
 * registered operators with invalid operands.
 */

import { Document, NonExpandableTypes } from "../utils/objects";
import {
  IsPipeSafeError,
  MultiOperatorError,
  PipeSafeError,
  RequiresMsg,
  UnknownOperatorError,
  UnknownSystemVariableError,
} from "../utils/errors";
import {
  HasOperatorKey,
  HasSingleOperatorKey,
  OperatorKeyOf,
} from "../utils/dispatch";
import {
  ExpressionFor,
  ExpressionSpec,
  UnimplementedExpressionOps,
} from "./expressions";
import { GetFieldTypeWithoutArrays } from "./fieldReference";
import { SystemVariable } from "./literals";
import { WithoutDollar } from "../utils/strings";

/**
 * Re-check for a `$`-keyed (expression-shaped) value:
 *
 * - operator key(s) mixed with plain keys, or more than one operator key →
 *   the exactly-one-operator brand (MongoDB: "an expression specification
 *   must contain exactly one field")
 * - registered operator, invalid operand → the registry's expected shape,
 *   so TS reports TS2322 at the offending operand against the operand
 *   kernel's branded union
 * - allow-listed unimplemented operator → valid (no operand check)
 * - anything else → UnknownOperatorError (a typo, not a MongoDB operator)
 * - valid → `never`
 */
export type ValidateExpressionValue<Schema extends Document, V> =
  [Exclude<keyof V & string, `$${string}`>] extends [never] ?
    HasSingleOperatorKey<V> extends false ? MultiOperatorError
    : [OperatorKeyOf<V>] extends [keyof ExpressionSpec<Schema>] ?
      // $concat gets an element-wise walk (mirrors group's $min/$max): the
      // union relation can't express "any non-`$` string" — NoDollarString
      // is alphanumeric-leading only, so " - " or "(" would falsely brand —
      // and the whole-operand relation can't resolve refs element-wise.
      [OperatorKeyOf<V>] extends ["$concat"] ? ValidateConcatValue<Schema, V>
      : // Schema-FREE fast-accept (mirrors group's ValidateAccumulatorValue):
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
    : [OperatorKeyOf<V>] extends [UnimplementedExpressionOps] ?
      never // allow-listed: valid MongoDB the registry doesn't model yet
    : // Schema-INDEPENDENT (like the multi-operator check), so it runs
      // even on wide/index-signature schemas.
      UnknownOperatorError<OperatorKeyOf<V> & string>
  : MultiOperatorError; // operator key alongside plain keys

/**
 * `$concat` operand re-check, element-wise. Every element must be a string:
 * `$$`-system variables pass, single-`$` refs must resolve to a string-typed
 * field (unknown paths get the Field brand from the resolving authority;
 * known non-string refs get the operator's RequiresMsg brand), any non-`$`
 * string literal passes (including the "", " - ", "(" separators
 * NoDollarString can't cover), and everything else brands. Same
 * never-or-replacement contract as the rest of the kernel.
 */
type ValidateConcatValue<Schema extends Document, V> =
  V extends { readonly $concat: infer Arr } ?
    Arr extends readonly unknown[] ?
      true extends (
        {
          [I in keyof Arr]: [ValidateConcatElement<Schema, Arr[I]>] extends (
            [never]
          ) ?
            never
          : true;
        }[number]
      ) ?
        {
          $concat: {
            [I in keyof Arr]: [ValidateConcatElement<Schema, Arr[I]>] extends (
              [never]
            ) ?
              Arr[I]
            : ValidateConcatElement<Schema, Arr[I]>;
          };
        }
      : never
    : ExpressionFor<Schema, "$concat"> // non-array operand → expected shape
  : never;

type ValidateConcatElement<Schema extends Document, E> =
  E extends SystemVariable ? never
  : E extends `$$${string}` ? UnknownSystemVariableError<E>
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
 * Recursive walk over a literal value tree. `$$`-prefixed strings are
 * MongoDB variable references, not field references: the enumerated
 * SYSTEM_VARIABLES pass; any other `$$`-name brands as an unknown system
 * variable (`$let`/`$map`/`$filter`-bound USER variables never reach this
 * walk — the interiors that bind them are `unknown`-typed in the registry
 * and skip validation; aggregation-command-level `let` variables are not
 * modeled yet). Single-`$` strings are field references and resolve
 * through the same authority inference uses. Arrays walk their elements
 * (a bad ref inside an array literal is as wrong as one outside it);
 * non-expandable objects (Date, ObjectId, RegExp, ...) are always valid.
 */
export type ValidateNestedValue<Schema extends Document, V> =
  V extends SystemVariable ? never
  : V extends `$$${string}` ? UnknownSystemVariableError<V>
  : V extends `$${string}` ?
    string extends keyof Schema ?
      never // ref resolution is meaningless on a wide/index-signature schema
    : GetFieldTypeWithoutArrays<Schema, WithoutDollar<V>> extends infer R ?
      IsPipeSafeError<R> extends true ?
        R
      : never
    : never
  : V extends readonly unknown[] ? ValidateArrayValue<Schema, V>
  : V extends object ?
    V extends NonExpandableTypes ? never
    : string extends keyof V ?
      never // widened object type (Record/Document) — not a literal; skip
    : HasOperatorKey<V> extends true ? ValidateExpressionValue<Schema, V>
    : ValidateObjectValue<Schema, V>
  : never;

/**
 * Plain-object arm of the walk: if ANY child is invalid, produce a
 * replacement object that keeps valid children as-is (`V[K]`) and swaps
 * invalid ones for their replacement — so the TS2322 lands exactly at the
 * deepest offending value. If all children are valid, `never` (the parent
 * key is filtered out by the wrapper). The double `ValidateNestedValue`
 * spelling per child is an alias-cache hit, not a recomputation.
 */
type ValidateObjectValue<Schema extends Document, V> =
  true extends (
    {
      [K in keyof V]: [ValidateNestedValue<Schema, V[K]>] extends [never] ?
        never
      : true;
    }[keyof V]
  ) ?
    {
      [K in keyof V]: [ValidateNestedValue<Schema, V[K]>] extends [never] ? V[K]
      : ValidateNestedValue<Schema, V[K]>;
    }
  : never;

/**
 * Array/tuple arm: same never-or-replacement contract, element-wise. A
 * mapped type over an array type maps its element positions, so tuples
 * keep their shape and the error lands on the offending element.
 */
type ValidateArrayValue<Schema extends Document, V extends readonly unknown[]> =
  true extends (
    {
      [I in keyof V]: [ValidateNestedValue<Schema, V[I]>] extends [never] ?
        never
      : true;
    }[number]
  ) ?
    {
      [I in keyof V]: [ValidateNestedValue<Schema, V[I]>] extends [never] ? V[I]
      : ValidateNestedValue<Schema, V[I]>;
    }
  : never;
