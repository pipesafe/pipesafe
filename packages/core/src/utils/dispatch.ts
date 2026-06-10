/**
 * Operator-key dispatch kernel (docs/type-standardisation-plan.md §3.4).
 *
 * The early-exit rule: decide what a value *is* from its `$`-prefixed keys
 * alone; only after dispatch, resolve and validate it against the schema.
 * MongoDB forbids `$`-prefixed keys in stored documents (and
 * `NoDollarString` encodes that for literals), so `$`-key presence is a
 * sound discriminator between expression objects and nested object literals.
 */

import { UnionToIntersection } from "./objects";

/**
 * The `$`-prefixed key(s) of an expression-shaped value, or `never` for
 * non-objects and `$`-less objects. A multi-operator object yields a union
 * of keys — guard consumers with tuple checks (`[Op] extends [...]`) so the
 * union does not distribute.
 */
export type OperatorKeyOf<Expr> =
  Expr extends object ? keyof Expr & `$${string}` : never;

/**
 * `true` when the value carries at least one `$`-prefixed key (tier-2 check
 * in the dispatch ladder): it is expression-shaped and should be routed to
 * expression inference rather than treated as a nested object literal.
 */
export type HasOperatorKey<Expr> =
  [OperatorKeyOf<Expr>] extends [never] ? false : true;

/**
 * `true` when the value has exactly one `$`-prefixed key. Multi-operator
 * objects (`{ $add: ..., $size: ... }`) are invalid in MongoDB; dispatchers
 * use this to route them to the exactly-one-operator brand.
 *
 * Detection: a union of keys is not assignable to its own intersection; a
 * single key is. Routed through `UnionToIntersection` (a generic alias)
 * because distribution only happens over naked type parameters — inlining
 * the conditional over `OperatorKeyOf<Expr>` would not distribute.
 */
export type HasSingleOperatorKey<Expr> =
  [OperatorKeyOf<Expr>] extends [never] ? false
  : [OperatorKeyOf<Expr>] extends [UnionToIntersection<OperatorKeyOf<Expr>>] ?
    true
  : false;

/**
 * Sentinel returned by expression inference for values that are not
 * expressions at all (no `$`-prefixed key). Distinct from `never` so callers
 * like `InferNestedFieldReference` can distinguish "treat as literal" from
 * "dispatched but resolved to nothing".
 */
export interface NotAnExpression {
  readonly "~pipesafe.notAnExpression": true;
}
