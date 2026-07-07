/**
 * THE nested-value validation kernel (§3.8, §7.2).
 *
 * Query-vs-Validate delineation (§3.8): the Query types ACCEPT `$`-shaped
 * values structurally (`` `$${string}` `` strings, `ExpressionShaped`
 * objects) so that failing relations stay shallow — rejecting through the
 * deep `AnyLiteral | Expression` union accumulates relation depth on the
 * shared call-checking stack and surfaces spurious TS2589s (plan §7.3
 * addendum). The helpers here are the matching REJECTION surface: stage
 * `ValidateXxxQuery` wrappers re-check the inferred literal with them and
 * map offending keys to brands (or the registry's expected operand shape).
 *
 * Contract shared by every helper: `never` means "valid — nothing to
 * report"; anything else is the replacement type the wrapper maps the key
 * to. Constraints are never re-spelled here (§3.8 rule 3): field
 * references resolve through `GetFieldTypeWithoutArrays` (the same
 * authority inference uses, so acceptance and inference cannot disagree
 * and the Field brand is spelled once), expression operands check against
 * the registry's `ExpressionFor<Schema, Op>`.
 *
 * Deliberately FORGIVING where the registry is incomplete: MongoDB has
 * 100+ expression operators and the registry covers a subset, so an
 * unknown single-operator key is treated as VALID (it was accepted before
 * the §7.3 guard closed the literal hole, and rejecting it would break
 * real pipelines). Only structurally malformed shapes brand: multi-
 * operator objects, operator keys mixed with plain keys, and known
 * operators with invalid operands.
 */

import { Document, NonExpandableTypes } from "../utils/objects";
import { IsPipeSafeError, MultiOperatorError } from "../utils/errors";
import { HasOperatorKey, OperatorKeyOf } from "../utils/dispatch";
import { UnionToIntersection } from "../utils/objects";
import { ExpressionFor, ExpressionSpec } from "./expressions";
import { GetFieldTypeWithoutArrays } from "./fieldReference";
import { WithoutDollar } from "../utils/strings";

/**
 * Re-check for a `$`-keyed (expression-shaped) value:
 *
 * - operator key(s) mixed with plain keys, or more than one operator key →
 *   the exactly-one-operator brand (MongoDB: "an expression specification
 *   must contain exactly one field")
 * - known operator, invalid operand → the registry's expected shape, so
 *   TS reports TS2322 at the offending operand against the operand
 *   kernel's branded union
 * - unknown operator → valid (see the forgiving-registry note above)
 * - valid → `never`
 */
export type ValidateExpressionValue<Schema extends Document, V> =
  [Exclude<keyof V & string, `$${string}`>] extends [never] ?
    [OperatorKeyOf<V>] extends [UnionToIntersection<OperatorKeyOf<V>>] ?
      [OperatorKeyOf<V>] extends [keyof ExpressionSpec<Schema>] ?
        [V] extends [ExpressionFor<Schema, OperatorKeyOf<V>>] ?
          never
        : ExpressionFor<Schema, OperatorKeyOf<V>>
      : never // unknown operator — forgiving (partial registry)
    : MultiOperatorError
  : MultiOperatorError; // operator key alongside plain keys

/**
 * Recursive walk over a literal value tree. `$$`-prefixed strings are
 * MongoDB SYSTEM VARIABLES ($$NOW, $$ROOT, $$REMOVE, $$this, ...), not
 * field references — they are accepted as-is (rejecting them would reject
 * valid MongoDB; their inference is not yet modeled). Single-`$` strings
 * are field references and resolve through the same authority inference
 * uses. Arrays walk their elements (a bad ref inside an array literal is
 * as wrong as one outside it); non-expandable objects (Date, ObjectId,
 * RegExp, ...) are always valid.
 */
export type ValidateNestedValue<Schema extends Document, V> =
  V extends `$$${string}` ? never
  : V extends `$${string}` ?
    GetFieldTypeWithoutArrays<Schema, WithoutDollar<V>> extends infer R ?
      IsPipeSafeError<R> extends true ?
        R
      : never
    : never
  : HasOperatorKey<V> extends true ? ValidateExpressionValue<Schema, V>
  : V extends readonly unknown[] ? ValidateArrayValue<Schema, V>
  : V extends object ?
    V extends NonExpandableTypes ?
      never
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
