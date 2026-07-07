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

// set — typo'd field reference should fail. (Note: the `$naem` typo
// also currently triggers TS2589 depth limit, which counts as "fails to
// compile" for our purposes.)
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

// TODO(§7.3 option B): a NESTED invalid expression is still accepted —
// ObjectLiteral's expression-shaped arm checks only the `$`-key shape, not
// operand validity; strictness for nested operand errors arrives with the
// per-stage Validate layer (§7.2). When that lands, convert this to a real
// expect-error pin.
// prettier-ignore
const _set_bad_nested_TODO = new Pipeline<User>().set({ meta: { computed: { $add: ["$name", 1] } } });

// group — accumulator operand brands now fire at the chained call site via
// the key-filtered ValidateGroupQuery intersection (§7.4; GroupQuery's
// `[key: string]:` index signature suppresses the in-Query brands, §3.8
// rule 2).
// @ts-expect-error  '$name' is a string field; $sum requires a numeric operand
// prettier-ignore
const _group_bad_sum = new Pipeline<User>().group({ _id: null, total: { $sum: "$name" } });

// group — the compound-_id pattern must KEEP compiling under the wrapper
// (the reason the intersection form is required; plan §7.4).
const _group_compound_id = new Pipeline<User>().group({
  _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$joinedAt" } } },
  count: { $sum: 1 },
  avgAge: { $avg: "$age" },
});

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
  _set_bad_nested_TODO,
  _unset_bad,
  _group_bad_sum,
  _group_compound_id,
  _project_mixed,
  _project_unknown,
  _replaceRoot_bad,
  _unwind_bad,
  _facet_bad,
};
