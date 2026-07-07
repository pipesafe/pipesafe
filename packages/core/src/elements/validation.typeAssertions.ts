/**
 * Nested-validation kernel assertions.
 *
 * Pins the `never` = valid contract, the byte-for-byte brand messages, and
 * the replacement-tree shape (invalid nodes swapped, valid siblings kept)
 * for `ValidateNestedValue` / `ValidateExpressionValue`. Call-site behavior
 * (that the wrappers actually fire these from chained methods) is pinned in
 * pipeline/Pipeline.callSite.typeAssertions.ts.
 */

import { ValidateExpressionValue, ValidateNestedValue } from "./validation";
import { ExpressionFor } from "./expressions";
import { PipeSafeError } from "../utils/errors";
import { Assert, Equal } from "../utils/tests";

type User = { _id: string; name: string; age: number; joinedAt: Date };

// ---------------------------------------------------------------------------
// Valid values are `never` (nothing to report) at every shape and depth.
// ---------------------------------------------------------------------------

type _ValidPrimitive = Assert<Equal<ValidateNestedValue<User, 1>, never>>;
type _ValidString = Assert<Equal<ValidateNestedValue<User, "plain">, never>>;
type _ValidNull = Assert<Equal<ValidateNestedValue<User, null>, never>>;
type _ValidRef = Assert<Equal<ValidateNestedValue<User, "$name">, never>>;
type _ValidDate = Assert<Equal<ValidateNestedValue<User, Date>, never>>;
type _ValidArray = Assert<
  Equal<ValidateNestedValue<User, readonly ["$name", 1]>, never>
>;
type _ValidExpression = Assert<
  Equal<ValidateNestedValue<User, { $add: ["$age", 1] }>, never>
>;
type _ValidNestedTree = Assert<
  Equal<
    ValidateNestedValue<
      User,
      { meta: { userName: "$name"; computed: { $add: ["$age", 1] } } }
    >,
    never
  >
>;

// ---------------------------------------------------------------------------
// Invalid refs brand with the Field message (byte-for-byte).
// ---------------------------------------------------------------------------

type _BadRef = Assert<
  Equal<
    ValidateNestedValue<User, "$naem">,
    PipeSafeError<"Field 'naem' is not on the schema.">
  >
>;

// ---------------------------------------------------------------------------
// Expression re-checks: multi-key brand, unknown-operator brand, and the
// registry's expected shape for a known operator with a bad operand.
// ---------------------------------------------------------------------------

type _MultiKey = Assert<
  Equal<
    ValidateExpressionValue<User, { $add: [1, 2]; $size: "$x" }>,
    PipeSafeError<"Expression objects must have exactly one operator.">
  >
>;
type _UnknownOp = Assert<
  Equal<
    ValidateExpressionValue<User, { $sizee: "$tags" }>,
    PipeSafeError<"Operator '$sizee' is not a known expression operator.">
  >
>;
type _BadOperand = Assert<
  Equal<
    ValidateExpressionValue<User, { $add: ["$name", 1] }>,
    ExpressionFor<User, "$add">
  >
>;

// ---------------------------------------------------------------------------
// Replacement tree: invalid nodes are swapped for their replacement, valid
// siblings are kept as-is — so the TS2322 lands at the offending node.
// ---------------------------------------------------------------------------

type _ReplacementTree = Assert<
  Equal<
    ValidateNestedValue<User, { keep: "$name"; bad: "$naem" }>,
    {
      keep: "$name";
      bad: PipeSafeError<"Field 'naem' is not on the schema.">;
    }
  >
>;

export type {
  _ValidPrimitive,
  _ValidString,
  _ValidNull,
  _ValidRef,
  _ValidDate,
  _ValidArray,
  _ValidExpression,
  _ValidNestedTree,
  _BadRef,
  _MultiKey,
  _UnknownOp,
  _BadOperand,
  _ReplacementTree,
};
