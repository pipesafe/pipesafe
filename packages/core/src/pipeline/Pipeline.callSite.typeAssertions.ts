/**
 * Call-site brand-surfacing assertions
 *
 * Each block exercises one Pipeline method with a wrong input. The
 * `@ts-expect-error` directive must fire — meaning the call site rejects
 * the bad input — for the test to pass. Initially most directives below
 * are unused (the bad input slips through), so this file fails. As each
 * method's signature is fixed, more directives become satisfied.
 *
 * This file is a regression guard against the `<const X extends Q>(q: X)`
 * pattern silently re-emerging for any stage method.
 */

import { Pipeline } from "./Pipeline";
import { Document } from "../utils/objects";

type User = {
  _id: string;
  name: string;
  age: number;
  tags: string[];
  joinedAt: Date;
  status: "active" | "inactive";
};

// match — already works for $gte on string field; keep it as a positive
// regression check.
// @ts-expect-error  $gte requires numeric/date field
const _match_bad = new Pipeline<User>().match({ name: { $gte: "Alice" } });

// sort — typo'd field name should fail.
// @ts-expect-error  'naem' is not a field of User
const _sort_bad = new Pipeline<User>().sort({ naem: 1 });

// set — typo'd field reference should fail. ValidateSetQuery brands it
// (`Field 'naem' is not on the schema.`).
// @ts-expect-error  '$naem' is not a valid field reference on User
const _set_bad = new Pipeline<User>().set({ display: "$naem" });

// unset — typo'd key should fail.
// @ts-expect-error  'naem' is not a field of User
const _unset_bad = new Pipeline<User>().unset("naem");

// set — a TOP-LEVEL invalid expression must fail: the ObjectLiteral $-key
// guard (elements/literals.ts) stops it from slipping through the literal
// arm, so it must pass Expression<User> or be rejected.
const _set_bad_expr = new Pipeline<User>().set({
  // @ts-expect-error  '$name' is a string field; $add requires numeric operands
  total: { $add: ["$name", 1] },
});

// set — a VALID expression nested inside an object literal must keep
// compiling (accepted via ObjectLiteral's expression-shaped arm).
const _set_good_nested = new Pipeline<User>().set({
  meta: { computed: { $add: ["$age", 1] } },
});

// set — a NESTED invalid expression fails: the ValidateNestedValue walk
// (elements/validation.ts) re-checks expression-shaped values at any depth
// and maps the offending node to the registry's expected operand shape.
const _set_bad_nested = new Pipeline<User>().set({
  // @ts-expect-error  '$name' is a string field; $add requires numeric operands
  meta: { computed: { $add: ["$name", 1] } },
});

// set — a NESTED unknown field reference fails with the Field brand (the
// walk checks `$`-strings at any depth; ObjectLiteral accepts them
// structurally so the rejection stays shallow).
const _set_bad_nested_ref = new Pipeline<User>().set({
  // @ts-expect-error  '$naem' is not a valid field reference on User
  meta: { userName: "$naem" },
});

// set — nested VALID refs and deep literals must not brand.
const _set_good_nested_ref = new Pipeline<User>().set({
  meta: { userName: "$name", info: { plain: 1 } },
});

// set — an operator key mixed with plain keys is malformed (MongoDB: "an
// expression specification must contain exactly one field").
const _set_bad_mixed_keys = new Pipeline<User>().set({
  // @ts-expect-error  expression objects must have exactly one operator
  y: { $add: ["$age", 1], extra: 1 },
});

// set — ALLOW-LISTED unimplemented operators are valid MongoDB the registry
// doesn't model ($toUpper, $switch, ... — enumerated by name in
// UnimplementedExpressionOps); they must keep compiling with no operand
// validation.
const _set_unknown_op_ok = new Pipeline<User>().set({
  upper: { $toUpper: "$name" },
  tier: { $switch: { branches: [], default: "x" } },
});

// set — a `$`-key OUTSIDE registry + allow-list is a typo, not a MongoDB
// operator: it brands with UnknownOperatorError instead of being silently
// accepted.
const _set_bad_typo_op = new Pipeline<User>().set({
  // @ts-expect-error  '$toUper' is not a recognized aggregation operator
  upper: { $toUper: "$name" },
});

// set — the typo rejection reaches ANY literal depth via the nested walk.
const _set_bad_typo_op_nested = new Pipeline<User>().set({
  // @ts-expect-error  '$tuUpper' is not a recognized aggregation operator
  meta: { v: { $tuUpper: "$name" } },
});

// set — expression values inside GENERIC-schema helpers compile: the
// schema-free fast-accept arm resolves where the schema-guarded operand
// check stays deferred (registered op with literal operands), and the
// allow-list name check is schema-free by construction.
const _set_generic_helper_ok = <D extends Document>(p: Pipeline<D, D>): void =>
  void p.set({ x: { $toUpper: "$y" }, y: { $add: [1, 2] } });

// set — `$$`-system variables are not field references; they are accepted.
const _set_system_var_ok = new Pipeline<User>().set({
  a: { b: "$$REMOVE" },
  now: "$$NOW",
});

// set — $concat operands are validated ELEMENT-WISE (ValidateConcatValue):
// plain strings of any shape (separators NoDollarString can't cover),
// valid string refs, and `$$`-variable references that RESOLVE to strings
// ("$$ROOT.name") pass; typo'd `$`-refs brand with the Field message; refs
// to non-string fields, non-string literals, AND non-string system
// variables ("$$NOW" is a Date) brand with the operator's RequiresMsg.
const _set_concat_ok = new Pipeline<User>().set({
  greeting: { $concat: ["Hello ", "$name", " - ", "(", "", "$$ROOT.name"] },
});

const _set_concat_nonstring_sysvar = new Pipeline<User>().set({
  greeting: {
    $concat: [
      "Now: ",
      // @ts-expect-error  '$$NOW' is a Date; $concat requires a string operand
      "$$NOW",
    ],
  },
});

const _set_concat_bad_ref = new Pipeline<User>().set({
  greeting: {
    $concat: [
      "Hello ",
      // @ts-expect-error  '$naem' is not on the schema
      "$naem",
    ],
  },
});

const _set_concat_nonstring_ref = new Pipeline<User>().set({
  greeting: {
    $concat: [
      "Age: ",
      // @ts-expect-error  '$age' is a number field; $concat requires a string operand
      "$age",
    ],
  },
});

const _set_concat_bad_literal = new Pipeline<User>().set({
  greeting: {
    $concat: [
      "n = ",
      // @ts-expect-error  number literals are not valid $concat operands
      42,
    ],
  },
});

// set — allow-listed valid-but-unmodeled operators (here: trigonometry,
// MongoDB 4.2+) are accepted by NAME; only names outside registry +
// allow-list brand as typos.
const _set_trig_allowlisted_ok = new Pipeline<User>().set({
  angleRad: { $degreesToRadians: "$age" },
  angleDeg: { $radiansToDegrees: "$age" },
});

// set — system variables are accepted in TYPED operand positions by their
// ACCURATE type (SystemVariablesThatInferTo): a Date-target operand takes
// "$$NOW".
const _set_sysvar_operand_ok = new Pipeline<User>().set({
  expiry: { $dateAdd: { startDate: "$$NOW", unit: "day", amount: 30 } },
});

// set — $let interiors are validated WITH the block's bindings
// (ValidateLetValue): bound `$$`-vars pass (including dotted paths into
// document-typed ones), `vars` values are checked in the OUTER scope, and
// unknown `$$`-names inside `in` still brand.
const _set_let_ok = new Pipeline<User>().set({
  agePlus: { $let: { vars: { t: "$age" }, in: { $add: ["$$t", 1] } } },
  viaRoot: { $let: { vars: { r: "$$ROOT" }, in: "$$r.age" } },
});

const _set_let_bad_vars_ref = new Pipeline<User>().set({
  x: {
    $let: {
      vars: {
        // @ts-expect-error  '$naem' is not on the schema
        t: "$naem",
      },
      in: "$$t",
    },
  },
});

const _set_let_unknown_var = new Pipeline<User>().set({
  x: {
    $let: {
      vars: { t: "$age" },
      // @ts-expect-error  '$$typo' is not a recognized system variable
      in: "$$typo",
    },
  },
});

// set — $map/$filter bind the element under `as` (default "this"); the
// bound variable resolves inside `in`/`cond` and an unbound `$$`-name
// brands.
const _set_map_ok = new Pipeline<User>().set({
  hashTags: {
    $map: { input: "$tags", as: "t", in: { $concat: ["#", "$$t"] } },
  },
});

const _set_filter_ok = new Pipeline<User>().set({
  activeTags: {
    $filter: { input: "$tags", cond: { $ne: ["$$this", "inactive"] } },
  },
});

const _set_filter_bad_cond_var = new Pipeline<User>().set({
  t: {
    $filter: {
      input: "$tags",
      // @ts-expect-error  '$$item' is not bound here (the element is $$this)
      cond: { $eq: ["$$item", "x"] },
    },
  },
});

// group — accumulator operand brands fire at the chained call site via
// the key-filtered ValidateGroupQuery intersection (GroupQuery's
// `[key: string]:` index signature suppresses the in-Query brands).
const _group_bad_sum = new Pipeline<User>().group({
  _id: null,
  // @ts-expect-error  '$name' is a string field; $sum requires a numeric operand
  total: { $sum: "$name" },
});

// group — $min/$max accept BSON-comparable operands (number, date, string,
// boolean: `$min: "$name"` is lexicographic min, `$max: true` is "any
// true" — all valid MongoDB); arrays are not modeled as comparable and
// brand, and a `$`-typo ref still brands (the string arm is NoDollarString,
// so refs stay routed through the schema check).
const _group_min_string_ok = new Pipeline<User>().group({
  _id: null,
  first: { $min: "$name" },
});

const _group_max_bool_ok = new Pipeline<User>().group({
  _id: null,
  any: { $max: true },
});

const _group_bad_min = new Pipeline<User>().group({
  _id: null,
  // @ts-expect-error  array literals are not a modeled comparable for $min
  first: { $min: ["$age"] },
});

const _group_bad_max = new Pipeline<User>().group({
  _id: null,
  // @ts-expect-error  '$naem' is not a valid field reference on User
  last: { $max: "$naem" },
});

// group — numeric-RETURNING expressions are valid $sum operands (registry-
// derived ExpressionsReturning arm): `$sum: { $size: ... }` is idiomatic.
const _group_sum_size_ok = new Pipeline<User>().group({
  _id: null,
  n: { $sum: { $size: "$tags" } },
});

// group — non-alphanumeric-leading strings are valid comparables
// (NoDollarString can't express "string minus $-prefix").
const _group_min_underscore_ok = new Pipeline<User>().group({
  _id: null,
  m: { $min: "_pending" },
});

// group — `$$`-system variables are valid MongoDB in _id and in ANY
// accumulator position (`$max: "$$NOW"`, `$push: "$$ROOT"`): they must not
// hit the comparable/numeric operand brands. Dotted paths into
// document-typed variables resolve ("$$ROOT.joinedAt"); a bad path brands
// with the Field message.
const _group_system_vars_ok = new Pipeline<User>().group({
  _id: "$$NOW",
  latest: { $max: "$$NOW" },
  total: { $sum: "$$NOW" },
  docs: { $push: "$$ROOT" },
  newest: { $max: "$$ROOT.joinedAt" },
});

const _group_bad_sysvar_path = new Pipeline<User>().group({
  _id: null,
  // @ts-expect-error  'naem' is not on the schema
  latest: { $max: "$$ROOT.naem" },
});

// group — an accumulator key mixed with plain keys is malformed (MongoDB:
// "The field must specify one accumulator").
const _group_bad_mixed_accum = new Pipeline<User>().group({
  _id: null,
  // @ts-expect-error  accumulator objects must have exactly one operator
  n: { $sum: 1, extra: true },
});

// group — the compound-_id pattern must KEEP compiling under the wrapper
// (the reason the intersection form is required), and the valid
// accumulators — including Date-typed $min/$max — must not brand.
const _group_compound_id = new Pipeline<User>().group({
  _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$joinedAt" } } },
  count: { $sum: 1 },
  avgAge: { $avg: "$age" },
  firstSeen: { $min: "$joinedAt" },
  maxAge: { $max: "$age" },
});

// group — a nested invalid expression inside compound _id fails (the _id
// position gets the ValidateNestedValue walk).
const _group_bad_id_nested = new Pipeline<User>().group({
  // @ts-expect-error  '$name' is a string field; $add requires numeric operands
  _id: { calc: { $add: ["$name", 1] } },
  count: { $sum: 1 },
});

// group — ALLOW-LISTED unimplemented accumulators keep compiling: MongoDB
// has accumulators the registry doesn't model, enumerated by name in
// UnimplementedAccumulators ($stdDevPop, $top, ...). Plain keys INSIDE the
// operand ($top's {output, sortBy}) are fine — the mixed-keys guard only
// inspects the accumulator object's own keys.
const _group_unknown_accum_ok = new Pipeline<User>().group({
  _id: null,
  dev: { $stdDevPop: "$age" },
  best: { $top: { output: "$name", sortBy: { age: -1 } } },
});

// group — an accumulator key OUTSIDE registry + allow-list is a typo and
// brands with UnknownAccumulatorError.
const _group_bad_typo_accum = new Pipeline<User>().group({
  _id: null,
  // @ts-expect-error  '$stdDevPops' is not a recognized accumulator
  dev: { $stdDevPops: "$age" },
});

// group — generic-schema helpers compile with allow-listed accumulators
// (the schema-free name check resolves where schema-guarded checks defer).
const _group_generic_helper_ok = <D extends Document>(
  p: Pipeline<D, D>
): void => void p.group({ _id: null, n: { $sum: 1 }, s: { $stdDevPop: "$x" } });

// project — an invalid expression value fails (ValidateProjectQuery routes
// values through the ValidateNestedValue walk).
const _project_bad_expr = new Pipeline<User>().project({
  // @ts-expect-error  '$name' is a string field; $add requires numeric operands
  total: { $add: ["$name", 1] },
});

// project — an unknown field reference value fails with the Field brand
// at the call site.
// @ts-expect-error  '$naem' is not a valid field reference on User
const _project_bad_ref = new Pipeline<User>().project({ display: "$naem" });

// project — valid computed values (rename, expression, nested object,
// plain-string literal assignment, system variable) must not brand.
const _project_good_computed = new Pipeline<User>().project({
  name: 1,
  display: "$name",
  total: { $add: ["$age", 1] },
  meta: { userName: "$name" },
  greeting: "hello",
  root: "$$ROOT",
});

// project — a bad ref inside an ARRAY under a nested object brands at the
// element (the walk covers array elements).
const _project_bad_ref_in_array = new Pipeline<User>().project({
  name: 1,
  // @ts-expect-error  '$naem' is not a valid field reference on User
  meta: { list: [{ x: "$naem" }] },
});

// project — mixed inclusion/exclusion should fail.
// @ts-expect-error  cannot mix inclusion and exclusion
const _project_mixed = new Pipeline<User>().project({ name: 1, age: 0 });

// project — including an unknown key should fail.
const _project_unknown = new Pipeline<User>().project({
  name: 1,
  // @ts-expect-error  unknownKey is not a field of User
  unknownKey: 1,
});

// replaceRoot — newRoot referencing a missing field should fail. The
// rejection lands as a single TS2322 at the offending value line.
const _replaceRoot_bad = new Pipeline<User>().replaceRoot({
  // @ts-expect-error  '$missing' is not a valid field reference
  newRoot: "$missing",
});

// unwind — $unwind on a scalar field is rejected, and since Pipeline.unwind
// is constrained to UnwindPath, the rejection hover names the module's
// branded error ('$unwind' requires an array field reference) rather than a
// raw structural mismatch.
// @ts-expect-error  $unwind requires an array field
const _unwind_bad = new Pipeline<User>().unwind("$name");

// facet — sub-pipeline using a typo'd field should fail.
// Satisfied transitively by Task 1 (sort fix propagates into the lambda).
const _facet_bad = new Pipeline<User>().facet({
  // @ts-expect-error  'naem' is not a field inside the facet sub-pipeline
  bad: (p) => p.sort({ naem: 1 }),
});

export {
  _match_bad,
  _sort_bad,
  _set_bad,
  _set_bad_expr,
  _set_good_nested,
  _set_bad_nested,
  _set_bad_nested_ref,
  _set_good_nested_ref,
  _set_bad_mixed_keys,
  _set_unknown_op_ok,
  _set_bad_typo_op,
  _set_bad_typo_op_nested,
  _set_generic_helper_ok,
  _set_system_var_ok,
  _set_concat_ok,
  _set_concat_bad_ref,
  _set_concat_nonstring_ref,
  _set_concat_bad_literal,
  _set_concat_nonstring_sysvar,
  _set_trig_allowlisted_ok,
  _set_sysvar_operand_ok,
  _set_let_ok,
  _set_let_bad_vars_ref,
  _set_let_unknown_var,
  _set_map_ok,
  _set_filter_ok,
  _set_filter_bad_cond_var,
  _group_system_vars_ok,
  _group_bad_sysvar_path,
  _unset_bad,
  _group_bad_sum,
  _group_min_string_ok,
  _group_max_bool_ok,
  _group_bad_min,
  _group_min_underscore_ok,
  _group_bad_mixed_accum,
  _group_bad_max,
  _group_sum_size_ok,
  _group_unknown_accum_ok,
  _group_bad_typo_accum,
  _group_generic_helper_ok,
  _group_compound_id,
  _group_bad_id_nested,
  _project_bad_expr,
  _project_bad_ref,
  _project_good_computed,
  _project_bad_ref_in_array,
  _project_mixed,
  _project_unknown,
  _replaceRoot_bad,
  _unwind_bad,
  _facet_bad,
};
