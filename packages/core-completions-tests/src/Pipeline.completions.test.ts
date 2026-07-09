import { describe, expect, it } from "vitest";
import {
  ACCUMULATOR_OPERATORS,
  EXPRESSION_OPERATORS,
  FIELD_MATCH_OPERATORS,
  TOP_LEVEL_MATCH_OPERATORS,
} from "@pipesafe/core";
import { createCompletionTester, type CompletionProbe } from "./harness";

/**
 * IDE-autocomplete regression tests for the Pipeline call sites.
 *
 * Every test pins the IDEAL completion list for its cursor position with
 * an EXACT (order-insensitive) match — extra entries are leaks, missing
 * entries are lost suggestions, and both fail the test.
 *
 * This suite runs in the ordinary root vitest job (`bun run test:ci`).
 * Positions that are KNOWN BAD today keep their exact ideal assertion but
 * are marked `it.fails` (with a `KNOWN BAD` comment naming the offending
 * type): vitest passes them while the defect exists and FAILS them the
 * moment the type is fixed — remove the `.fails` modifier then to promote
 * the test to a regression guard. Do not weaken an ideal list to make a
 * test pass.
 */

const FIXTURE = `
import { Pipeline } from "@pipesafe/core";

interface Order {
  _id: string;
  status: "pending" | "shipped" | "delivered";
  price: number;
  quantity: number;
  createdAt: Date;
  tags: string[];
  shipping: { city: string; zip: string };
  items: { sku: string; qty: number }[];
}

declare const orders: Pipeline<Order>;
`;

const tester = createCompletionTester();
const at = (snippet: string) => tester.completionsAt(FIXTURE + snippet);

/**
 * Exact-match assertion: the probe must offer the ideal list, the whole
 * ideal list, and nothing but the ideal list. `memberCompletion: true`
 * additionally requires a CONTEXTUAL key list — without it the editor
 * falls back to ~1000 global identifiers even if some names matched.
 */
function expectExactly(
  probe: CompletionProbe,
  ideal: readonly string[],
  { memberCompletion }: { memberCompletion?: boolean } = {}
) {
  if (memberCompletion !== undefined) {
    expect(probe.isMemberCompletion).toBe(memberCompletion);
  }
  expect([...probe.names].sort()).toEqual([...ideal].sort());
}

// ---------------------------------------------------------------------------
// Ideal vocabulary, derived from the Order fixture and the core registries.
// ---------------------------------------------------------------------------

/** Object-literal KEY form of every field selector: dotted paths quoted. */
const FIELD_SELECTOR_KEYS = [
  "_id",
  "status",
  "price",
  "quantity",
  "createdAt",
  "tags",
  "shipping",
  '"shipping.city"',
  '"shipping.zip"',
  "items",
  '"items.sku"',
  '"items.qty"',
];

/** String-literal form of every field path (unset). */
const FIELD_PATHS = [
  "_id",
  "status",
  "price",
  "quantity",
  "createdAt",
  "tags",
  "shipping",
  "shipping.city",
  "shipping.zip",
  "items",
  "items.sku",
  "items.qty",
];

/** Every `$`-prefixed field reference (no array indices, per FieldPath). */
const FIELD_REFS = [
  "$_id",
  "$status",
  "$price",
  "$quantity",
  "$createdAt",
  "$tags",
  "$shipping",
  "$shipping.city",
  "$shipping.zip",
  "$items",
  "$items.sku",
  "$items.qty",
];

const NUMERIC_FIELD_REFS = ["$price", "$quantity"];

/**
 * The operator vocabularies (FIELD_MATCH_OPERATORS,
 * TOP_LEVEL_MATCH_OPERATORS, EXPRESSION_OPERATORS, ACCUMULATOR_OPERATORS)
 * are imported from @pipesafe/core — the same exported arrays core derives
 * its operator-key unions from, and pinned against the registries by
 * core's typeAssertions. Type-inapplicable matchers ($size on a number,
 * $regex on a Date, …) are deliberately part of the ideal: the library
 * keeps every matcher key and brands the OPERAND with a PipeSafeError, so
 * the user gets "requires an array field" instead of "unknown property".
 * Allow-listed Unimplemented* operators are accepted by validation but not
 * modeled, so they are (for now) not part of the ideal lists.
 */

// ---------------------------------------------------------------------------

describe("match", () => {
  it("suggests exactly the field selectors and logical operators as top-level keys", () => {
    const probe = at(`orders.match({ ‸ });`);
    expectExactly(
      probe,
      [...FIELD_SELECTOR_KEYS, ...TOP_LEVEL_MATCH_OPERATORS],
      {
        memberCompletion: true,
      }
    );
  });

  it("suggests the same keys inside a nested $and", () => {
    const probe = at(`orders.match({ $and: [{ ‸ }] });`);
    expectExactly(
      probe,
      [...FIELD_SELECTOR_KEYS, ...TOP_LEVEL_MATCH_OPERATORS],
      {
        memberCompletion: true,
      }
    );
  });

  it("suggests exactly the matchers for a number field", () => {
    const probe = at(`orders.match({ price: { ‸ } });`);
    expectExactly(probe, FIELD_MATCH_OPERATORS, { memberCompletion: true });
  });

  // KNOWN BAD: MatchersForType<T> includes `T extends string ? RegExp :
  // never` so direct-regex matching (`{ status: /^ship/ }`) typechecks —
  // but RegExp is an object type, so its PROPERTIES (exec, test, compile,
  // flags, …) leak into the key list of every string field.
  it.fails("suggests exactly the matchers for a string field", () => {
    const probe = at(`orders.match({ status: { ‸ } });`);
    expectExactly(probe, FIELD_MATCH_OPERATORS, { memberCompletion: true });
  });

  // KNOWN BAD: MatchersForType<Date> carries the bare `T` (exact-value
  // match arm), and Date's 40+ methods (getDate, setHours, …) leak in.
  it.fails("suggests exactly the matchers for a Date field", () => {
    const probe = at(`orders.match({ createdAt: { ‸ } });`);
    expectExactly(probe, FIELD_MATCH_OPERATORS, { memberCompletion: true });
  });

  it("suggests exactly the matchers for an array field", () => {
    const probe = at(`orders.match({ tags: { ‸ } });`);
    expectExactly(probe, FIELD_MATCH_OPERATORS, { memberCompletion: true });
  });

  it("suggests element keys plus matchers for an embedded-document field", () => {
    const probe = at(`orders.match({ shipping: { ‸ } });`);
    expectExactly(probe, [...FIELD_MATCH_OPERATORS, "city", "zip"], {
      memberCompletion: true,
    });
  });

  it("suggests element keys plus matchers for an array-of-documents field", () => {
    const probe = at(`orders.match({ items: { ‸ } });`);
    expectExactly(probe, [...FIELD_MATCH_OPERATORS, "sku", "qty"], {
      memberCompletion: true,
    });
  });

  // KNOWN BAD twice over: the $elemMatch operand is the bare element type,
  // so (1) one union arm resolves to a PipeSafeError whose literal key
  // "~pipesafe.error" is offered to the user, and (2) the matcher keys
  // MongoDB accepts inside $elemMatch ({ qty: { $gt: 5 } }, { $gte: 80 })
  // are not offered (nor accepted) at all.
  it.fails("suggests element keys plus matchers inside $elemMatch", () => {
    const probe = at(`orders.match({ items: { $elemMatch: { ‸ } } });`);
    expectExactly(probe, [...FIELD_MATCH_OPERATORS, "sku", "qty"], {
      memberCompletion: true,
    });
  });

  it("suggests exactly the literal union values inside $in", () => {
    const probe = at(`orders.match({ status: { $in: ["‸"] } });`);
    expectExactly(probe, ["pending", "shipped", "delivered"]);
  });
});

describe("sort", () => {
  it("suggests exactly the field selectors as keys", () => {
    const probe = at(`orders.sort({ ‸ });`);
    expectExactly(probe, FIELD_SELECTOR_KEYS, { memberCompletion: true });
  });
});

describe("set", () => {
  // KNOWN BAD (too broad): SetQuery keys are a plain `[key: string]` index
  // signature. New computed keys are legal, but existing schema fields
  // should still be offered; instead there is no contextual key list at
  // all (isMemberCompletion=false) and the editor floods ~1000 globals.
  it.fails("suggests exactly the field selectors as keys", () => {
    const probe = at(`orders.set({ ‸ });`);
    expectExactly(probe, FIELD_SELECTOR_KEYS, { memberCompletion: true });
  });

  // KNOWN BAD (too broad): the string arms of SetQuery's value union are
  // `` `$${string}` `` + NoDollarString, which absorb the finite
  // FieldReference<Schema> union under normalization (see the
  // AUTOCOMPLETE-ONLY notes in stages/set.ts) — typing `"` in a value
  // position suggests nothing.
  it.fails("suggests exactly the field references for a string value", () => {
    const probe = at(`orders.set({ total: "‸" });`);
    expectExactly(probe, FIELD_REFS);
  });

  // KNOWN BAD: AnyLiteral<Schema> carries bare Date | ObjectId arms, so
  // their methods (getDate, toHexString, _bsontype, …) leak into the
  // operator-key list of every expression-object value position.
  it.fails(
    "suggests exactly the expression operators for a $-keyed value object",
    () => {
      const probe = at(`orders.set({ total: { ‸ } });`);
      expectExactly(probe, EXPRESSION_OPERATORS, { memberCompletion: true });
    }
  );

  it("suggests exactly the type-matching field references inside a typed operand", () => {
    const probe = at(`orders.set({ total: { $add: ["‸"] } });`);
    // ArithmeticOperand wants numbers: only the numeric refs qualify.
    expectExactly(probe, NUMERIC_FIELD_REFS);
  });
});

describe("project", () => {
  // KNOWN BAD (too broad): same `[key: string]` index signature as set —
  // no contextual keys, global-identifier flood.
  it.fails("suggests exactly the field selectors as keys", () => {
    const probe = at(`orders.project({ ‸ });`);
    expectExactly(probe, FIELD_SELECTOR_KEYS, { memberCompletion: true });
  });
});

describe("group", () => {
  it("suggests exactly _id as a key (output field names are user-chosen)", () => {
    const probe = at(`orders.group({ ‸ });`);
    expectExactly(probe, ["_id"], { memberCompletion: true });
  });

  // KNOWN BAD: grouping by any field is valid MongoDB, but AnyLiteral only
  // offers references that infer to primitives — array/document refs
  // ($tags, $shipping, $items, $items.sku, …) are missing.
  it.fails("suggests exactly the field references for _id", () => {
    const probe = at(`orders.group({ _id: "‸" });`);
    expectExactly(probe, FIELD_REFS);
  });

  // KNOWN BAD: same AnyLiteral Date/ObjectId method leak as in set.
  it.fails(
    "suggests exactly the accumulator operators inside an accumulator object",
    () => {
      const probe = at(`orders.group({ _id: null, total: { ‸ } });`);
      expectExactly(probe, ACCUMULATOR_OPERATORS, { memberCompletion: true });
    }
  );

  it("suggests exactly the numeric field references for $sum", () => {
    const probe = at(`orders.group({ _id: null, total: { $sum: "‸" } });`);
    expectExactly(probe, NUMERIC_FIELD_REFS);
  });
});

describe("path-string stages", () => {
  it("unset suggests exactly the field paths", () => {
    const probe = at(`orders.unset("‸");`);
    expectExactly(probe, FIELD_PATHS);
  });

  it("unwind suggests exactly the array field references", () => {
    const probe = at(`orders.unwind("‸");`);
    expectExactly(probe, ["$tags", "$items", "$items.sku", "$items.qty"]);
  });

  it("replaceRoot suggests exactly its option key", () => {
    const probe = at(`orders.replaceRoot({ ‸ });`);
    expectExactly(probe, ["newRoot"], { memberCompletion: true });
  });

  it("replaceRoot newRoot suggests exactly the field references", () => {
    const probe = at(`orders.replaceRoot({ newRoot: "‸" });`);
    expectExactly(probe, FIELD_REFS);
  });
});

describe("structured stages", () => {
  it("lookup suggests exactly its option keys", () => {
    const probe = at(`orders.lookup({ ‸ });`);
    expectExactly(
      probe,
      ["from", "localField", "foreignField", "as", "pipeline"],
      {
        memberCompletion: true,
      }
    );
  });
});
