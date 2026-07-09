import { describe, expect, it } from "vitest";
import { createCompletionTester } from "./harness";

/**
 * IDE-autocomplete regression tests for the Pipeline call sites.
 *
 * These drive `LanguageService.getCompletionsAtPosition` — the same API
 * tsserver uses for editor completions — at a `‸` cursor inside realistic
 * pipeline snippets, and pin exactly what an IDE offers there.
 *
 * Two kinds of tests:
 *  - regular `it(...)` pins GOOD behavior we must not regress;
 *  - `it.fails(...)` documents KNOWN-BAD positions (the assertion states
 *    the DESIRED list). When someone fixes the underlying type, the
 *    `.fails` test starts failing — delete the `.fails` modifier to
 *    promote it to a regression guard.
 *
 * The two failure classes `it.fails` documents:
 *  1. Structural-type members leaking into completions: a bare `T` /
 *     `RegExp` / `Date` / `ObjectId` union member is an object type, so
 *     TS offers its properties (`exec`, `getDate`, `toHexString`, …) as
 *     object-literal keys.
 *  2. Too-broad string positions: `[key: string]` index signatures and
 *     `` `$${string}` `` template arms absorb the finite literal unions
 *     (`FieldReference<Schema>`), so the IDE has nothing to suggest and
 *     falls back to global identifiers or silence.
 */

const FIXTURE = `
import { Pipeline } from "./pipeline/Pipeline";

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

/** The comparison/equality/array matchers every field type offers. */
const COMMON_MATCHERS = [
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$exists",
  "$type",
  "$size",
  "$all",
  "$elemMatch",
  "$regex",
  "$not",
];

describe("match", () => {
  it("suggests schema field selectors and logical operators as top-level keys", () => {
    const probe = at(`orders.match({ ‸ });`);
    // Member completion = the IDE shows a contextual key list, not a
    // fallback to global identifiers.
    expect(probe.isMemberCompletion).toBe(true);
    expect([...probe.names].sort()).toEqual(
      [
        "$and",
        "$expr",
        "$nor",
        "$or",
        "_id",
        "createdAt",
        "items",
        '"items.qty"',
        '"items.sku"',
        "price",
        "quantity",
        "shipping",
        '"shipping.city"',
        '"shipping.zip"',
        "status",
        "tags",
      ].sort()
    );
  });

  it("suggests the same field selectors inside a nested $and", () => {
    const probe = at(`orders.match({ $and: [{ ‸ }] });`);
    expect(probe.isMemberCompletion).toBe(true);
    expect(probe.names).toEqual(expect.arrayContaining(["status", "$or"]));
    expect(probe.names).not.toContain("toSorted");
  });

  it("suggests only matchers for a number field", () => {
    const probe = at(`orders.match({ price: { ‸ } });`);
    expect(probe.isMemberCompletion).toBe(true);
    expect([...probe.names].sort()).toEqual([...COMMON_MATCHERS].sort());
  });

  it("suggests only matchers for an array field — no array methods", () => {
    const probe = at(`orders.match({ tags: { ‸ } });`);
    expect(probe.isMemberCompletion).toBe(true);
    expect([...probe.names].sort()).toEqual([...COMMON_MATCHERS].sort());
    expect(probe.names).not.toContain("toSorted");
    expect(probe.names).not.toContain("map");
    expect(probe.names).not.toContain("length");
  });

  it("suggests element keys plus matchers for an embedded-document field", () => {
    const probe = at(`orders.match({ shipping: { ‸ } });`);
    expect([...probe.names].sort()).toEqual(
      [...COMMON_MATCHERS, "city", "zip"].sort()
    );
  });

  it("suggests literal union values inside $in", () => {
    const probe = at(`orders.match({ status: { $in: ["‸"] } });`);
    expect(probe.names).toEqual(["pending", "shipped", "delivered"]);
  });

  // KNOWN BAD: MatchersForType<T> includes `T extends string ? RegExp :
  // never` so direct-regex matching (`{ status: /^ship/ }`) typechecks —
  // but RegExp is an object type, so its PROPERTIES (exec, test, compile,
  // flags, …) leak into the key list for every string field.
  it.fails(
    "suggests only matchers for a string field — no RegExp methods",
    () => {
      const probe = at(`orders.match({ status: { ‸ } });`);
      expect(probe.names).not.toContain("exec");
      expect(probe.names).not.toContain("test");
      expect(probe.names).not.toContain("compile");
    }
  );

  // KNOWN BAD: same class as above — MatchersForType<Date> carries the
  // bare `T` (exact-value match), and Date's 40+ methods (getDate,
  // setHours, toISOString, …) leak into the key list.
  it.fails("suggests only matchers for a Date field — no Date methods", () => {
    const probe = at(`orders.match({ createdAt: { ‸ } });`);
    expect(probe.names).not.toContain("getDate");
    expect(probe.names).not.toContain("setHours");
    expect(probe.names).not.toContain("toISOString");
  });

  // KNOWN BAD: inside `$elemMatch` on an array-of-documents field, one
  // union arm resolves to a PipeSafeError brand, whose literal key
  // "~pipesafe.error" is offered to the user as a completion.
  it.fails(
    "does not leak the PipeSafeError brand key inside $elemMatch",
    () => {
      const probe = at(`orders.match({ items: { $elemMatch: { ‸ } } });`);
      expect(probe.names).toEqual(expect.arrayContaining(["sku", "qty"]));
      expect(probe.names).not.toContain('"~pipesafe.error"');
      expect(probe.names).not.toContain("~pipesafe.error");
    }
  );
});

describe("sort", () => {
  it("suggests exactly the schema field selectors as keys", () => {
    const probe = at(`orders.sort({ ‸ });`);
    expect(probe.isMemberCompletion).toBe(true);
    expect([...probe.names].sort()).toEqual(
      [
        "_id",
        "createdAt",
        "items",
        '"items.qty"',
        '"items.sku"',
        "price",
        "quantity",
        "shipping",
        '"shipping.city"',
        '"shipping.zip"',
        "status",
        "tags",
      ].sort()
    );
  });
});

describe("set / project", () => {
  it("suggests expression operators for a $-keyed value object", () => {
    const probe = at(`orders.set({ total: { ‸ } });`);
    expect(probe.isMemberCompletion).toBe(true);
    expect(probe.names).toEqual(
      expect.arrayContaining(["$add", "$multiply", "$cond", "$concat"])
    );
  });

  it("suggests matching field references inside a typed operand", () => {
    const probe = at(`orders.set({ total: { $add: ["‸"] } });`);
    // ArithmeticOperand wants numbers: only the numeric refs qualify.
    expect(probe.names).toEqual(["$price", "$quantity"]);
  });

  // KNOWN BAD (too broad): SetQuery/ProjectQuery keys are a plain
  // `[key: string]` index signature. New computed keys are legal, but
  // EXISTING schema fields should still be offered; instead the IDE gets
  // no contextual keys at all (isMemberCompletion=false) and floods the
  // list with ~1000 global identifiers.
  it.fails("set offers schema fields as key suggestions", () => {
    const probe = at(`orders.set({ ‸ });`);
    expect(probe.isMemberCompletion).toBe(true);
    expect(probe.names).toEqual(expect.arrayContaining(["price", "status"]));
  });

  it.fails("project offers schema fields as key suggestions", () => {
    const probe = at(`orders.project({ ‸ });`);
    expect(probe.isMemberCompletion).toBe(true);
    expect(probe.names).toEqual(expect.arrayContaining(["price", "status"]));
  });

  // KNOWN BAD (too broad): the string arms of SetQuery's value union are
  // `` `$${string}` `` + NoDollarString, which absorb the finite
  // FieldReference<Schema> union under normalization (see the
  // AUTOCOMPLETE-ONLY notes in stages/set.ts and stages/project.ts) — so
  // typing `"` in a value position suggests nothing.
  it.fails("set offers field references for a string value", () => {
    const probe = at(`orders.set({ total: "‸" });`);
    expect(probe.names).toContain("$price");
  });

  // KNOWN BAD: AnyLiteral<Schema> carries bare Date | ObjectId arms, so
  // their methods (getDate, toHexString, …) leak into the operator-key
  // list of every expression-object value position.
  it.fails("set value objects do not leak Date/ObjectId methods", () => {
    const probe = at(`orders.set({ total: { ‸ } });`);
    expect(probe.names).not.toContain("getDate");
    expect(probe.names).not.toContain("toHexString");
    expect(probe.names).not.toContain("_bsontype");
  });
});

describe("group", () => {
  it("suggests field references (dollar-prefixed paths) for _id", () => {
    const probe = at(`orders.group({ _id: "‸" });`);
    expect(probe.names).toEqual(
      expect.arrayContaining(["$status", "$price", "$shipping.city"])
    );
  });

  it("suggests accumulator operators inside an accumulator object", () => {
    const probe = at(`orders.group({ _id: null, total: { ‸ } });`);
    expect(probe.names).toEqual(
      expect.arrayContaining(["$sum", "$avg", "$min", "$max", "$push"])
    );
  });

  it("suggests only numeric field references for $sum", () => {
    const probe = at(`orders.group({ _id: null, total: { $sum: "‸" } });`);
    expect(probe.names).toEqual(["$price", "$quantity"]);
  });

  // KNOWN BAD: same AnyLiteral Date/ObjectId leak as in set — accumulator
  // object positions offer getDate/setHours/… next to $sum/$avg.
  it.fails("accumulator objects do not leak Date/ObjectId methods", () => {
    const probe = at(`orders.group({ _id: null, total: { ‸ } });`);
    expect(probe.names).not.toContain("getDate");
    expect(probe.names).not.toContain("toHexString");
  });
});

describe("path-string stages", () => {
  it("unset suggests every field path", () => {
    const probe = at(`orders.unset("‸");`);
    expect([...probe.names].sort()).toEqual(
      [
        "_id",
        "createdAt",
        "items",
        "items.qty",
        "items.sku",
        "price",
        "quantity",
        "shipping",
        "shipping.city",
        "shipping.zip",
        "status",
        "tags",
      ].sort()
    );
  });

  it("unwind suggests only array field references", () => {
    const probe = at(`orders.unwind("‸");`);
    expect([...probe.names].sort()).toEqual(
      ["$items", "$items.qty", "$items.sku", "$tags"].sort()
    );
  });

  it("replaceRoot newRoot suggests all field references", () => {
    const probe = at(`orders.replaceRoot({ newRoot: "‸" });`);
    expect(probe.names).toEqual(
      expect.arrayContaining(["$shipping", "$items", "$shipping.city"])
    );
  });
});

describe("structured stages", () => {
  it("lookup suggests its option keys", () => {
    const probe = at(`orders.lookup({ ‸ });`);
    expect([...probe.names].sort()).toEqual(
      ["as", "foreignField", "from", "localField", "pipeline"].sort()
    );
  });
});
