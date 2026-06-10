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

// group — call-site brand surfacing for `$sum: '$stringField'` is a
// known limitation. The brand exists in the type system (covered by
// group.typeAssertions.ts) but doesn't fire at the chained call site
// because GroupQuery's `[key: string]:` index signature suppresses
// excess-property and operand-validation checks. Wrapping
// Pipeline.group's parameter in a validation mapped type interferes
// with TS's resolution of the legitimate compound-_id pattern
// (e.g. `_id: { date: { $dateToString: ... } }`). Filed as a follow-up.

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
  _unset_bad,
  _project_mixed,
  _project_unknown,
  _replaceRoot_bad,
  _unwind_bad,
  _facet_bad,
};
