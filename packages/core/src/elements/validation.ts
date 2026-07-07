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
 * references check against `FieldReference<Schema>`, expression operands
 * against the registry's `ExpressionFor<Schema, Op>` — the brand the user
 * sees at an invalid operand IS the operand kernel's brand.
 */

import { Document, NonExpandableTypes } from "../utils/objects";
import { PipeSafeError } from "../utils/errors";
import {
  HasOperatorKey,
  HasSingleOperatorKey,
  OperatorKeyOf,
} from "../utils/dispatch";
import { ExpressionFor } from "./expressions";
import { FieldReference } from "./fieldReference";
import { WithoutDollar } from "../utils/strings";

/**
 * Re-check for a `$`-keyed (expression-shaped) value:
 *
 * - multi-`$`-key object → the exactly-one-operator brand
 * - unknown operator → `Operator '...' is not a known expression operator.`
 * - known operator, invalid operand → the registry's expected shape, so
 *   TS reports TS2322 at the offending operand against the operand
 *   kernel's branded union
 * - valid → `never`
 */
export type ValidateExpressionValue<Schema extends Document, V> =
  HasSingleOperatorKey<V> extends false ?
    PipeSafeError<`Expression objects must have exactly one operator.`>
  : [V] extends [ExpressionFor<Schema, OperatorKeyOf<V>>] ? never
  : [ExpressionFor<Schema, OperatorKeyOf<V>>] extends [never] ?
    PipeSafeError<`Operator '${OperatorKeyOf<V> & string}' is not a known expression operator.`>
  : ExpressionFor<Schema, OperatorKeyOf<V>>;

/**
 * Recursive walk over a literal value tree. Handles the three `$`-shapes
 * the Query layer accepts structurally (field-reference strings, expression
 * objects, and plain objects containing either at any depth). Arrays are
 * left to the Query layer (their element unions are finite and shallow);
 * non-expandable objects (Date, ObjectId, RegExp, ...) are always valid.
 */
export type ValidateNestedValue<Schema extends Document, V> =
  V extends `$${string}` ?
    V extends FieldReference<Schema> ?
      never
    : PipeSafeError<`Field '${WithoutDollar<V & `$${string}`>}' is not on the schema.`>
  : HasOperatorKey<V> extends true ? ValidateExpressionValue<Schema, V>
  : V extends readonly unknown[] ? never
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
