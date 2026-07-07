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
// (`Field 'naem' is not on the schema.`) — previously this rejected through
// the deep AnyLiteral | Expression union and surfaced a spurious TS2589
// next to the error (plan §7.3 addendum).
// @ts-expect-error  '$naem' is not a valid field reference on User
const _set_bad = new Pipeline<User>().set({ display: "$naem" });

// unset — typo'd key should fail.
// @ts-expect-error  'naem' is not a field of User
const _unset_bad = new Pipeline<User>().unset("naem");

// set — a TOP-LEVEL invalid expression must fail: the ObjectLiteral $-key
// guard (elements/literals.ts, §7.3) stops it from slipping through the
// literal arm, so it must pass Expression<User> or be rejected.
// @ts-expect-error  '$name' is a string field; $add requires numeric operands
// prettier-ignore
const _set_bad_expr = new Pipeline<User>().set({ total: { $add: ["$name", 1] } });

// set — a VALID expression nested inside an object literal must keep
// compiling (accepted via ObjectLiteral's expression-shaped arm; before the
// $-key guard this only worked through the vacuous-assignability bug).
// prettier-ignore
const _set_good_nested = new Pipeline<User>().set({ meta: { computed: { $add: ["$age", 1] } } });

// set — a NESTED invalid expression fails: the ValidateNestedValue walk
// (elements/validation.ts) re-checks expression-shaped values at any depth
// and maps the offending node to the registry's expected operand shape.
// @ts-expect-error  '$name' is a string field; $add requires numeric operands
// prettier-ignore
const _set_bad_nested = new Pipeline<User>().set({ meta: { computed: { $add: ["$name", 1] } } });

// set — a NESTED unknown field reference fails with the Field brand (the
// walk checks `$`-strings at any depth; ObjectLiteral accepts them
// structurally so the rejection stays shallow).
// @ts-expect-error  '$naem' is not a valid field reference on User
// prettier-ignore
const _set_bad_nested_ref = new Pipeline<User>().set({ meta: { userName: "$naem" } });

// set — nested VALID refs and deep literals must not brand.
// prettier-ignore
const _set_good_nested_ref = new Pipeline<User>().set({ meta: { userName: "$name", info: { plain: 1 } } });

// set — an operator key mixed with plain keys is malformed (MongoDB: "an
// expression specification must contain exactly one field").
// @ts-expect-error  expression objects must have exactly one operator
// prettier-ignore
const _set_bad_mixed_keys = new Pipeline<User>().set({ y: { $add: ["$age", 1], extra: 1 } });

// set — UNREGISTERED operators are valid MongoDB the registry doesn't model
// ($toUpper, $switch, ...); they must keep compiling (typos share this
// leniency — the partial-registry trade-off, elements/validation.ts).
// prettier-ignore
const _set_unknown_op_ok = new Pipeline<User>().set({ upper: { $toUpper: "$name" } });

// set — `$$`-system variables are not field references; they are accepted.
// prettier-ignore
const _set_system_var_ok = new Pipeline<User>().set({ a: { b: "$$REMOVE" }, now: "$$NOW" });

// group — accumulator operand brands now fire at the chained call site via
// the key-filtered ValidateGroupQuery intersection (§7.4; GroupQuery's
// `[key: string]:` index signature suppresses the in-Query brands, §3.8
// rule 2).
// @ts-expect-error  '$name' is a string field; $sum requires a numeric operand
// prettier-ignore
const _group_bad_sum = new Pipeline<User>().group({ _id: null, total: { $sum: "$name" } });

// group — $min/$max accept BSON-comparable operands (number, date, string,
// boolean: `$min: "$name"` is lexicographic min, `$max: true` is "any
// true" — all valid MongoDB); arrays are not modeled as comparable and
// brand, and a `$`-typo ref still brands (the string arm is NoDollarString,
// so refs stay routed through the schema check).
// prettier-ignore
const _group_min_string_ok = new Pipeline<User>().group({ _id: null, first: { $min: "$name" } });

// prettier-ignore
const _group_max_bool_ok = new Pipeline<User>().group({ _id: null, any: { $max: true } });

// @ts-expect-error  array literals are not a modeled comparable for $min
// prettier-ignore
const _group_bad_min = new Pipeline<User>().group({ _id: null, first: { $min: ["$age"] } });

// @ts-expect-error  '$naem' is not a valid field reference on User
// prettier-ignore
const _group_bad_max = new Pipeline<User>().group({ _id: null, last: { $max: "$naem" } });

// group — numeric-RETURNING expressions are valid $sum operands (registry-
// derived ExpressionsReturning arm): `$sum: { $size: ... }` is idiomatic.
// prettier-ignore
const _group_sum_size_ok = new Pipeline<User>().group({ _id: null, n: { $sum: { $size: "$tags" } } });

// group — the compound-_id pattern must KEEP compiling under the wrapper
// (the reason the intersection form is required; plan §7.4), and the valid
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
// @ts-expect-error  '$name' is a string field; $add requires numeric operands
// prettier-ignore
const _group_bad_id_nested = new Pipeline<User>().group({ _id: { calc: { $add: ["$name", 1] } }, count: { $sum: 1 } });

// group — UNREGISTERED accumulators are accepted structurally: MongoDB has
// accumulators the registry doesn't model ($stdDevPop, $top, ...), and
// branding them would reject valid pipelines with errors on the wrong keys.
// Typos share this leniency by design (partial-registry trade-off).
// prettier-ignore
const _group_unknown_accum_ok = new Pipeline<User>().group({ _id: null, dev: { $stdDevPop: "$age" } });

// project — an invalid expression value fails (ValidateProjectQuery routes
// values through the ValidateNestedValue walk).
// @ts-expect-error  '$name' is a string field; $add requires numeric operands
// prettier-ignore
const _project_bad_expr = new Pipeline<User>().project({ total: { $add: ["$name", 1] } });

// project — an unknown field reference value fails with the Field brand at
// the call site (previously it only surfaced in the OUTPUT schema).
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
// @ts-expect-error  '$naem' is not a valid field reference on User
// prettier-ignore
const _project_bad_ref_in_array = new Pipeline<User>().project({ name: 1, meta: { list: [{ x: "$naem" }] } });

// project — mixed inclusion/exclusion should fail.
// @ts-expect-error  cannot mix inclusion and exclusion
const _project_mixed = new Pipeline<User>().project({ name: 1, age: 0 });

// project — including an unknown key should fail.
// @ts-expect-error  unknownKey is not a field of User
// prettier-ignore
const _project_unknown = new Pipeline<User>().project({ name: 1, unknownKey: 1 });

// replaceRoot — newRoot referencing a missing field should fail.
// @ts-expect-error  '$missing' is not a valid field reference
// prettier-ignore
const _replaceRoot_bad = new Pipeline<User>().replaceRoot({ newRoot: "$missing" });

// unwind — $unwind on a scalar field is rejected, and since Pipeline.unwind
// is constrained to UnwindPath, the rejection hover names the module's
// branded error ('$unwind' requires an array field reference) rather than a
// raw structural mismatch.
// @ts-expect-error  $unwind requires an array field
const _unwind_bad = new Pipeline<User>().unwind("$name");

// facet — sub-pipeline using a typo'd field should fail.
// Satisfied transitively by Task 1 (sort fix propagates into the lambda).
// @ts-expect-error  'naem' is not a field inside the facet sub-pipeline
// prettier-ignore
const _facet_bad = new Pipeline<User>().facet({ bad: (p) => p.sort({ naem: 1 }) });

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
  _set_system_var_ok,
  _unset_bad,
  _group_bad_sum,
  _group_min_string_ok,
  _group_max_bool_ok,
  _group_bad_min,
  _group_bad_max,
  _group_sum_size_ok,
  _group_unknown_accum_ok,
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
