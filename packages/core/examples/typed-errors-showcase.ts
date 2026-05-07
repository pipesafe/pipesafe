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
// and explains the constraint.
//
// Hover shows:
//   Type 'string' is not assignable to type 'PipeSafeError<"Operator
//   '$gte' is not allowed on this field (numeric/date only)", "pending"
//   | "shipped" | "delivered">'.
//
// @ts-expect-error  $gte requires numeric/date field
const _match_bad = orders.match({ status: { $gte: "pending" } });

// ❌ Typo'd top-level field. ValidateMatchQuery brands it.
//
// Hover shows:
//   PipeSafeError<"Field 'tota' is not on the schema", Order>
//
// @ts-expect-error  'tota' is not a field of Order
const _match_typo = orders.match({ tota: { $gte: 100 } });

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
// names the key.
//
// Hover shows:
//   Type 'number' is not assignable to type 'PipeSafeError<"Cannot
//   include field 'totl' — not on schema", Order>'.
//
// @ts-expect-error  'totl' is not a field of Order
const _project_bad = orders.project({ total: 1, totl: 1 });

// ❌ Mixing inclusion (1) and exclusion (0) on non-_id fields. MongoDB
// rejects this at runtime; the brand surfaces it at compile time.
//
// Hover shows:
//   PipeSafeError<"Cannot mix inclusion (1/true) and exclusion (0/false)
//   in the same $project. Pick one mode (excluding '_id' from inclusion
//   mode is the only allowed mix).", { total: 1; status: 0 }>
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

// Note: `$sum: '$customerId'` (a string field reference) is rejected by
// the type system but doesn't fire a brand at the chained call site —
// GroupQuery's `[key: string]:` index signature suppresses operand
// validation here. The brand still surfaces when assigning the literal
// to a `GroupQuery<Order>`-typed variable directly. Tracked as a
// follow-up.

// =============================================================================
// Note: where these errors come from
// =============================================================================
//
// Each `PipeSafeError<Msg, Ctx>` brand is defined in
// `packages/core/src/utils/core.ts`. The literal `Msg` is what
// surfaces in the hover. `Ctx` is the offending value/schema, useful
// for debugging when the message alone isn't enough.
//
// Brands fire from these wrappers (all in `packages/core/src/stages/`):
//
//   match.ts   → ValidateMatchQuery + ComparatorMatchers
//   sort.ts    → strict mapped type SortQuery (no wrapper needed)
//   project.ts → ValidateProjectQuery (handles unknown keys + mixed mode)
//   group.ts   → per-aggregator operand brands (call-site is a follow-up)

export {
  _sort_valid,
  _sort_bad,
  _match_valid,
  _match_bad,
  _match_typo,
  _project_valid,
  _project_bad,
  _project_mixed,
  _group_valid,
};
