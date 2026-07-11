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
import { VariableReferences } from "./literals";
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
// Allow-listed unimplemented operators are VALID — the registry models a
// subset of MongoDB's 100+ operators; the remainder is enumerated by name
// in UnimplementedExpressionOps ($toUpper, $switch, ...) with no operand
// validation.
type _AllowListedOpValid = Assert<
  Equal<ValidateExpressionValue<User, { $toUpper: "$name" }>, never>
>;
type _AllowListedSwitchValid = Assert<
  Equal<ValidateExpressionValue<User, { $switch: { branches: [] } }>, never>
>;
// A `$`-key OUTSIDE registry + allow-list is a typo and brands byte-for-byte
// (schema-independently — it fires even on wide/index-signature schemas).
type _UnknownOpBrands = Assert<
  Equal<
    ValidateExpressionValue<User, { $toUper: "$name" }>,
    PipeSafeError<"Operator '$toUper' is not a recognized aggregation operator.">
  >
>;
type _UnknownOpBrandsOnWideSchema = Assert<
  Equal<
    ValidateExpressionValue<Record<string, unknown>, { $toUper: "$name" }>,
    PipeSafeError<"Operator '$toUper' is not a recognized aggregation operator.">
  >
>;

// An operator key alongside plain keys is malformed (MongoDB: "an
// expression specification must contain exactly one field").
type _MixedKeys = Assert<
  Equal<
    ValidateExpressionValue<User, { $add: ["$age", 1]; extra: 1 }>,
    PipeSafeError<"Expression objects must have exactly one operator.">
  >
>;

// MongoDB system variables ($$-prefix) are not field references — valid.
type _SystemVariable = Assert<Equal<ValidateNestedValue<User, "$$NOW">, never>>;
type _SystemVariableNested = Assert<
  Equal<ValidateNestedValue<User, { a: "$$ROOT" }>, never>
>;

// ---------------------------------------------------------------------------
// `$$`-variable resolution: dotted paths into document-typed variables
// resolve against the schema; unknown names and bad paths brand
// (byte-for-byte) with the Variable/Field messages.
// ---------------------------------------------------------------------------

type _SystemVariablePathValid = Assert<
  Equal<ValidateNestedValue<User, "$$ROOT.name">, never>
>;
type _SystemVariablePathInvalid = Assert<
  Equal<
    ValidateNestedValue<User, "$$ROOT.naem">,
    PipeSafeError<"Field 'naem' is not on the schema.">
  >
>;
type _SystemVariablePathIntoNonDocument = Assert<
  Equal<
    ValidateNestedValue<User, "$$NOW.naem">,
    PipeSafeError<"Field 'naem' is not on the schema.">
  >
>;
type _UnknownSystemVariable = Assert<
  Equal<
    ValidateNestedValue<User, "$$now">,
    PipeSafeError<"Variable '$$now' is not a recognized system variable.">
  >
>;

// ---------------------------------------------------------------------------
// The USER-environment vocabulary (VariableReferences): bindings accepted
// by exact name and dotted path; out-of-scope `$$`-names are not in the
// finite union. Pinned type-level — call-site failure elaboration can trip
// TS's depth limiter (pre-existing; see CLAUDE.md).
// ---------------------------------------------------------------------------

type _LetEnv = { u: string; order: { qty: number } };
type _EnvVocabularyAcceptsBinding = Assert<
  Equal<"$$u" extends VariableReferences<_LetEnv> ? true : false, true>
>;
type _EnvVocabularyAcceptsBindingPath = Assert<
  Equal<"$$order.qty" extends VariableReferences<_LetEnv> ? true : false, true>
>;
type _EnvVocabularyRejectsUnknown = Assert<
  Equal<"$$typo" extends VariableReferences<_LetEnv> ? true : false, false>
>;
type _EnvWalkAcceptsBinding = Assert<
  Equal<ValidateNestedValue<User, "$$u", _LetEnv>, never>
>;
type _EnvWalkBrandsUnknown = Assert<
  Equal<
    ValidateNestedValue<User, "$$typo", _LetEnv>,
    PipeSafeError<"Variable '$$typo' is not a recognized system variable.">
  >
>;

// ---------------------------------------------------------------------------
// Binder interiors ($let/$map/$filter) are walked WITH their bindings:
// bound `$$`-vars pass (dotted paths included), unknown ones brand, and
// the replacement tree keeps valid members while swapping offenders.
// ---------------------------------------------------------------------------

type _LetValid = Assert<
  Equal<
    ValidateNestedValue<
      User,
      { $let: { vars: { t: "$age" }; in: { $add: ["$$t", 1] } } }
    >,
    never
  >
>;
type _LetBadVarsRef = Assert<
  Equal<
    ValidateNestedValue<User, { $let: { vars: { t: "$naem" }; in: "$$t" } }>,
    {
      $let: {
        vars: { t: PipeSafeError<"Field 'naem' is not on the schema."> };
        in: "$$t";
      };
    }
  >
>;
type _LetUnknownVarInBody = Assert<
  Equal<
    ValidateNestedValue<User, { $let: { vars: { t: "$age" }; in: "$$typo" } }>,
    {
      $let: {
        vars: { t: "$age" };
        in: PipeSafeError<"Variable '$$typo' is not a recognized system variable.">;
      };
    }
  >
>;

// Local schema for the binder walks (User has no array field).
type Tagged = { name: string; tags: string[] };

type _MapValid = Assert<
  Equal<
    ValidateNestedValue<
      Tagged,
      { $map: { input: "$tags"; as: "t"; in: { $concat: ["#", "$$t"] } } }
    >,
    never
  >
>;
type _FilterValidDefaultThis = Assert<
  Equal<
    ValidateNestedValue<
      Tagged,
      { $filter: { input: "$tags"; cond: { $eq: ["$$this", "x"] } } }
    >,
    never
  >
>;
type _FilterUnboundVarBrands = Assert<
  Equal<
    ValidateNestedValue<
      Tagged,
      { $filter: { input: "$tags"; cond: { $eq: ["$$item", "x"] } } }
    >,
    {
      $filter: {
        input: "$tags";
        cond: {
          $eq: [
            PipeSafeError<"Variable '$$item' is not a recognized system variable.">,
            "x",
          ];
        };
      };
    }
  >
>;
// A non-array input still gets the operator's array demand (the pre-walk
// relation behavior, preserved by ValidateArrayInputValue's `$`-ref arm).
type _FilterNonArrayInput = Assert<
  Equal<
    ValidateNestedValue<
      Tagged,
      { $filter: { input: "$name"; cond: { $eq: ["$$this", "x"] } } }
    >,
    {
      $filter: {
        input: PipeSafeError<"Operator '$filter' requires an array operand.">;
        cond: { $eq: ["$$this", "x"] };
      };
    }
  >
>;

// Arrays walk their elements: a bad ref inside an array literal brands at
// the element position; valid arrays are never.
type _BadRefInArray = Assert<
  Equal<
    ValidateNestedValue<User, { list: [{ x: "$naem" }] }>,
    {
      list: [{ x: PipeSafeError<"Field 'naem' is not on the schema."> }];
    }
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
  _AllowListedOpValid,
  _AllowListedSwitchValid,
  _UnknownOpBrands,
  _UnknownOpBrandsOnWideSchema,
  _MixedKeys,
  _SystemVariable,
  _SystemVariableNested,
  _SystemVariablePathValid,
  _SystemVariablePathInvalid,
  _SystemVariablePathIntoNonDocument,
  _UnknownSystemVariable,
  _EnvVocabularyAcceptsBinding,
  _EnvVocabularyAcceptsBindingPath,
  _EnvVocabularyRejectsUnknown,
  _EnvWalkAcceptsBinding,
  _EnvWalkBrandsUnknown,
  _LetValid,
  _LetBadVarsRef,
  _LetUnknownVarInBody,
  _MapValid,
  _FilterValidDefaultThis,
  _FilterUnboundVarBrands,
  _FilterNonArrayInput,
  _BadRefInArray,
  _BadOperand,
  _ReplacementTree,
};
