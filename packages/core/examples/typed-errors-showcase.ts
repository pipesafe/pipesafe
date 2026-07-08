/**
 * Typed-error showcase: demonstrates how match, sort, project, and
 * group now produce literal `PipeSafeError<...>` messages at the call
 * site when given invalid input, instead of silently passing or
 * producing "is not assignable to never" walls.
 *
 * Hover over each `_bad_*` constant to see the brand message. The
 * `@ts-expect-error` directives mean each line is REQUIRED to fail —
 * remove a directive and TypeScript will tell you the exact error.
 */

import { Pipeline } from "@pipesafe/core";

type Order = {
  _id: string;
  customerId: string;
  status: "pending" | "shipped" | "delivered";
  total: number;
  createdAt: Date;
  items: { sku: string; qty: number; price: number }[];
};

const orders = new Pipeline<Order>();

// =============================================================================
// $sort
// =============================================================================

// ✅ Valid: known schema fields
const _sort_valid = orders.sort({ createdAt: -1, total: 1 });

// ❌ Typo: 'createdAtt' is not a field of Order.
//
// Hover shows:
//   Object literal may only specify known properties, and 'createdAtt'
//   does not exist in type 'SortQuery<Order>'.
//
// @ts-expect-error  typo'd field name
const _sort_bad = orders.sort({ createdAtt: -1 });

// =============================================================================
// $match
// =============================================================================

// ✅ Valid: $gte on a numeric field
const _match_valid = orders.match({ total: { $gte: 100 } });

// ❌ $gte against a string field. The brand message names the operator
// and the constraint it violates.
//
// Hover shows:
//   Type 'string' is not assignable to type 'PipeSafeError<"Operator
//   '$gte' requires a numeric or date field.">'.
//
// @ts-expect-error  $gte requires numeric/date field
const _match_bad = orders.match({ status: { $gte: "pending" } });

// Note: typo'd top-level fields (e.g. `match({ tota: { $gte: 100 } })`)
// are NOT branded at the call site. A validation wrapper would catch
// them but produces a verbose error type that includes both the
// user's literal value and the brand intersected. Kept the error
// surface focused on the higher-value brand cases (operator-on-wrong-
// type) instead.

// =============================================================================
// $project
// =============================================================================

// ✅ Valid: known fields with inclusion + a renamed/computed field
const _project_valid = orders.project({
  total: 1,
  status: 1,
  customer: "$customerId", // alias creates a new field, allowed
});

// ❌ Inclusion of a key that isn't on the schema. The brand message
// names the offending key.
//
// Hover shows:
//   Type 'number' is not assignable to type 'PipeSafeError<"Field 'totl'
//   is not on the schema.">'.
//
// @ts-expect-error  'totl' is not a field of Order
const _project_bad = orders.project({ total: 1, totl: 1 });

// ❌ Mixing inclusion (1) and exclusion (0) on non-_id fields. MongoDB
// rejects this at runtime; the brand surfaces it at compile time.
//
// Hover shows:
//   Type '0' is not assignable to type 'PipeSafeError<"Stage '$project'
//   cannot mix inclusion 1/true and exclusion 0/false.">'.
//
// @ts-expect-error  cannot mix inclusion and exclusion
const _project_mixed = orders.project({ total: 1, status: 0 });

// =============================================================================
// $group (call-site brand is a known limitation)
// =============================================================================

// ✅ Valid: $sum on a numeric field reference
const _group_valid = orders.group({
  _id: "$status",
  totalRevenue: { $sum: "$total" },
});

// ❌ Error: $sum on a string field reference brands AT the chained call
// site (the key-filtered ValidateGroupQuery intersection re-checks the
// literal; GroupQuery's index signature used to suppress this):
//   "Accumulator '$sum' requires a numeric operand."
// @ts-expect-error  '$customerId' is a string field
// prettier-ignore
const _group_bad_sum = orders.group({ _id: "$status", n: { $sum: "$customerId" } });

// =============================================================================
// Note: where these errors come from
// =============================================================================
//
// `PipeSafeError<Msg>` is a single-message branded interface defined
// in `packages/core/src/utils/core.ts`. The literal `Msg` is the entire
// surface area — dynamic context (operator names, key names, path
// segments) is templated into the message so the hover stays focused.
//
// Brands fire from these wrappers (all in `packages/core/src/stages/`):
//
//   match.ts   → ComparatorMatchers (per-operator brands)
//   sort.ts    → strict mapped type SortQuery (no wrapper needed)
//   project.ts → ValidateProjectQuery (unknown keys, mixed mode, values)
//   set.ts     → ValidateSetQuery (refs/expressions at any depth)
//   group.ts   → ValidateGroupQuery (accumulator operands, compound _id)
//
// set/project/group re-check nested values through the shared kernel in
// `packages/core/src/elements/validation.ts`.

export {
  _group_bad_sum,
  _sort_valid,
  _sort_bad,
  _match_valid,
  _match_bad,
  _project_valid,
  _project_bad,
  _project_mixed,
  _group_valid,
};
