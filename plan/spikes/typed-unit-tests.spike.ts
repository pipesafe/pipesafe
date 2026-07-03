/**
 * SPIKE: Data tests as pipelines + typed unit tests (EPIC-H)
 *
 * Purpose:   Empirically validate plan/04-transform-roadmap.md §5 and
 *            plan/trd/EPIC-H-testing-framework.md against real
 *            @pipesafe/core + @pipesafe/manifold + mongodb-memory-server:
 *            (a) dbt's four built-in generic data tests (unique / not_null /
 *            accepted_values / relationships) written as small TYPED pipeline
 *            builders that return failing rows (0 rows = pass), executed on a
 *            seeded collection; (b) a typed unit test: fixtures type-checked
 *            against a Model's TInput at compile time (with a @ts-expect-error
 *            proof), executed via BOTH a seeded temp collection and a
 *            no-collection `$documents` db-level aggregation, diffed
 *            order-insensitively against expected TOutput[].
 *
 * How to run: bun run tsx plan/spikes/typed-unit-tests.spike.ts   (repo root)
 *            Type-level assertions additionally verified with:
 *            bunx tsc --noEmit --strict --skipLibCheck --target es2022 \
 *              --module esnext --moduleResolution bundler \
 *              plan/spikes/typed-unit-tests.spike.ts
 *
 * Status:    EXECUTED 2026-07-03. All runtime checks pass; findings below.
 *
 * Findings summary (details in EPIC-H TRD "Spike findings"):
 *  - H1  The "query returning failing documents" convention ports directly:
 *        unique = $group/$match count>1; acceptedValues = $nin; relationships
 *        = $lookup + $match { as: { $size: 0 } }. All four run typed
 *        end-to-end on mongodb-memory-server.
 *  - H2  not_null is the interesting one: the typed builder REJECTS
 *        `{ field: null }` when the schema says the field is non-nullable —
 *        the test would be querying for a violation of the declared type.
 *        Generic tests therefore probe fields as declared (nullable fields
 *        test cleanly) and need an untyped internal escape (custom()) to hunt
 *        for out-of-contract data on non-nullable fields. Framework built-ins
 *        should construct raw stages internally and expose only the typed
 *        field-selector surface.
 *  - H3  relationships compiles FULLY TYPED, contrary to our initial
 *        assumption (dead end): the typed lookup accepts a `string | null`
 *        local field against a `string` foreign `_id`, with or without a
 *        `$ne: null` pre-match. No custom() escape needed for the built-in.
 *        (Mild type-leniency note for TEST-2: nullable local fields join
 *        without complaint.)
 *  - H4  Typed unit tests work as advertised: fixtures declared as TInput[]
 *        fail compilation on wrong shapes (@ts-expect-error verified via tsc),
 *        Model.getPipelineStages() replays the transformation on fixture
 *        docs, and an order-insensitive canonical diff gives actionable
 *        failure output.
 *  - H5  `$documents` (db-level aggregate, no collection) runs the model
 *        stages on MongoDB 7.x memory server and — unlike insertMany into a
 *        temp collection — injects NO _id, so actual output matches expected
 *        TOutput[] exactly as authored. Temp-collection seeding requires
 *        stripping driver-injected _id before diffing. $documents is the
 *        preferred fixture path (MongoDB >= 5.1), temp collection the
 *        fallback.
 *  - H5b Core gap: `.project({ _id: 0, ... })` is a COMPILE ERROR when the
 *        schema does not declare _id (brand: "Field '_id' is not on the
 *        schema.") — so a model cannot strip the physical _id in-pipeline;
 *        the unit-test runner (and Upsert-mode users generally) must handle
 *        the implicit _id outside the type system.
 *  - H6  Manifold exports InferModelOutput but NOT InferModelInput; the
 *        public phantom `Model["__inputType"]` works today. TEST-4 should add
 *        the missing helper.
 */

import process from "node:process";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { Collection, type Document } from "@pipesafe/core";
import { Model, type InferModelOutput } from "@pipesafe/manifold";

// ---------------------------------------------------------------------------
// Checks helper
// ---------------------------------------------------------------------------
let checks = 0;
let failures = 0;
function check(name: string, cond: boolean): void {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
}

// ---------------------------------------------------------------------------
// Schemas + typed sources
// ---------------------------------------------------------------------------

type RawEvent = {
  eventId: string;
  userId: string | null; // nullable by contract: not_null test is meaningful
  status: string;
  amount: number;
  receivedAt: Date;
};
type User = { _id: string; name: string };

const events = new Collection<RawEvent>({ collectionName: "raw_events" });
const users = new Collection<User>({ collectionName: "users" });

// ---------------------------------------------------------------------------
// (a) Built-in generic data tests as typed pipeline builders.
//     Convention: pipeline returns FAILING documents; zero results = pass.
// ---------------------------------------------------------------------------

/** unique(field): $group by the field, keep groups with count > 1. */
function uniqueTest() {
  return events
    .aggregate()
    .group({ _id: "$eventId", count: { $count: {} } })
    .match({ count: { $gt: 1 } });
}

/** notNull(field): typed match on a nullable field. See finding H2. */
function notNullTest() {
  // `{ userId: null }` also matches MISSING fields in MongoDB — desirable
  // for a not_null test (missing is as bad as null).
  return events.aggregate().match({ userId: { $eq: null } });
}

/** acceptedValues(field, values): $nin over the allowed set. */
function acceptedValuesTest() {
  return events.aggregate().match({ status: { $nin: ["purchase", "refund"] } });
}

/**
 * relationships(local, foreign): orphan check via $lookup + empty-join match.
 * Finding H3: this compiles FULLY TYPED today. We first assumed the
 * `string | null` local field would be rejected against `_id: string` and a
 * custom() escape would be needed — empirically wrong (dead end): the typed
 * lookup accepts the nullable local field with or without the `$ne: null`
 * pre-match. Null rows are excluded up front so not_null and relationships
 * stay independent failures (dbt convention).
 */
function relationshipsTest() {
  return events
    .aggregate()
    .match({ userId: { $ne: null } })
    .lookup({
      from: users,
      localField: "userId",
      foreignField: "_id",
      as: "__parent",
    })
    .match({ __parent: { $size: 0 } })
    .unset("__parent");
}

// Type-level proof of H2: a not_null-style query against a NON-nullable
// field is a compile error — the schema says it cannot be null.
// @ts-expect-error eventId is `string`; matching { $eq: null } is rejected
const _h2 = () => events.aggregate().match({ eventId: { $eq: null } });

// ---------------------------------------------------------------------------
// (b) Typed unit test: a Model with fixtures checked against TInput/TOutput
// ---------------------------------------------------------------------------

const stgPurchases = new Model({
  name: "stg_purchases",
  from: events,
  pipeline: (p) =>
    p
      .match({ status: "purchase" })
      .set({ day: { $dateTrunc: { date: "$receivedAt", unit: "day" } } })
      // Finding H5b: `_id: 0` here is a compile error — RawEvent declares no
      // _id, so the typed project brands it "Field '_id' is not on the
      // schema." The physical _id therefore CANNOT be excluded in-pipeline
      // for schemas that omit _id; the unit-test runner must normalize.
      .project({ eventId: 1, userId: 1, amount: 1, day: 1 }),
  materialize: { type: "collection", mode: Model.Mode.Replace },
});

// Finding H6: no InferModelInput export — the phantom field works today.
type StgInput = (typeof stgPurchases)["__inputType"];
type StgOutput = InferModelOutput<typeof stgPurchases>;

const fixtures: StgInput[] = [
  {
    eventId: "e1",
    userId: "u1",
    status: "purchase",
    amount: 100,
    receivedAt: new Date("2026-01-01T10:30:00Z"),
  },
  {
    eventId: "e2",
    userId: "u2",
    status: "refund", // filtered out by the model
    amount: 50,
    receivedAt: new Date("2026-01-01T11:00:00Z"),
  },
  {
    eventId: "e3",
    userId: null,
    status: "purchase",
    amount: 25,
    receivedAt: new Date("2026-01-02T09:00:00Z"),
  },
];

// The flagship claim: a wrong-shaped fixture DOES NOT COMPILE.
// (dbt's YAML/CSV fixtures are validated by nothing until the warehouse runs.)
const _badFixtures: StgInput[] = [
  {
    eventId: "e9",
    userId: "u9",
    status: "purchase",
    // @ts-expect-error amount must be number, not string
    amount: "twelve",
    receivedAt: new Date(),
  },
];
void _badFixtures;

const expected: StgOutput[] = [
  {
    eventId: "e1",
    userId: "u1",
    amount: 100,
    day: new Date("2026-01-01T00:00:00Z"),
  },
  {
    eventId: "e3",
    userId: null,
    amount: 25,
    day: new Date("2026-01-02T00:00:00Z"),
  },
];

// Order-insensitive diff: canonicalize each doc (sorted keys, ISO dates),
// sort the canonical strings, compare arrays.
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${k}:${canon(o[k])}`)
    .join(",")}}`;
}
function diffRows(
  actual: Document[],
  exp: Document[]
): { missing: string[]; unexpected: string[] } {
  // Finding H5: strip driver-injected _id when the expected type declares
  // none (temp-collection seeding injects ObjectId _id; $documents does not).
  const expectsId = exp.some((d) => "_id" in d);
  const normalize = (d: Document): Document => {
    if (expectsId) return d;
    const { _id: _drop, ...rest } = d;
    return rest;
  };
  const a = actual.map((d) => canon(normalize(d)));
  const e = exp.map(canon);
  return {
    missing: e.filter((r) => !a.includes(r)),
    unexpected: a.filter((r) => !e.includes(r)),
  };
}

// ---------------------------------------------------------------------------
// Runtime: seed memory server, run everything
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db("spike");
  const build = await db.admin().buildInfo();
  console.log(`MongoDB memory server version: ${String(build["version"])}\n`);

  // Seed deliberately dirty data for the data tests.
  await db.collection("users").insertMany([
    { _id: "u1" as never, name: "Ada" },
    { _id: "u2" as never, name: "Grace" },
  ]);
  await db.collection("raw_events").insertMany([
    {
      eventId: "e1",
      userId: "u1",
      status: "purchase",
      amount: 100,
      receivedAt: new Date("2026-01-01"),
    },
    {
      eventId: "e1",
      userId: "u2",
      status: "purchase",
      amount: 90,
      receivedAt: new Date("2026-01-01"),
    }, // duplicate eventId
    {
      eventId: "e2",
      userId: null,
      status: "purchase",
      amount: 10,
      receivedAt: new Date("2026-01-02"),
    }, // null userId
    {
      eventId: "e3",
      userId: "u1",
      status: "chargeback",
      amount: 5,
      receivedAt: new Date("2026-01-02"),
    }, // bad status
    {
      eventId: "e4",
      userId: "ghost",
      status: "refund",
      amount: 7,
      receivedAt: new Date("2026-01-03"),
    }, // orphan userId
  ]);

  const run = async (p: { getPipeline(): Document[] }) =>
    db.collection("raw_events").aggregate(p.getPipeline()).toArray();

  console.log("== (a) Data tests: pipelines returning failing rows ==");

  const dup = await run(uniqueTest());
  console.log("unique(eventId) failing rows:", JSON.stringify(dup));
  check(
    "unique: flags the duplicated key with its count",
    dup.length === 1 && dup[0]?.["_id"] === "e1" && dup[0]?.["count"] === 2
  );

  const nulls = await run(notNullTest());
  console.log(
    "not_null(userId) failing rows:",
    JSON.stringify(nulls.map((d) => d["eventId"]))
  );
  check(
    "not_null: returns exactly the null-userId doc",
    nulls.length === 1 && nulls[0]?.["eventId"] === "e2"
  );

  const badStatus = await run(acceptedValuesTest());
  console.log(
    "accepted_values(status) failing rows:",
    JSON.stringify(badStatus.map((d) => d["status"]))
  );
  check(
    "accepted_values: returns exactly the out-of-set doc",
    badStatus.length === 1 && badStatus[0]?.["status"] === "chargeback"
  );

  const orphans = await run(relationshipsTest());
  console.log(
    "relationships(userId->users._id) failing rows:",
    JSON.stringify(orphans.map((d) => d["userId"]))
  );
  check(
    "relationships: returns exactly the orphan (null excluded)",
    orphans.length === 1 && orphans[0]?.["userId"] === "ghost"
  );

  console.log("\n== (b) Typed unit test: fixtures -> pipeline -> expected ==");
  const stages = stgPurchases.getPipelineStages();
  console.log("model stages:", JSON.stringify(stages));

  // Path 1: temp-collection seeding (works on any MongoDB version).
  const temp = db.collection("__fixture_stg_purchases");
  await temp.insertMany(fixtures.map((f) => ({ ...f })));
  const viaCollection = await temp.aggregate(stages).toArray();
  // Finding H5: insertMany injected ObjectId _id; the model's $project strips
  // it here, but a model WITHOUT a terminal $project would leak it — the
  // runner must strip _id unless TOutput declares one.
  const d1 = diffRows(viaCollection, expected);
  console.log("temp-collection actual:", JSON.stringify(viaCollection));
  check(
    "unit test passes via temp collection (order-insensitive)",
    d1.missing.length === 0 && d1.unexpected.length === 0
  );

  // Path 2: $documents — no collection, no _id injection (MongoDB >= 5.1).
  const viaDocuments = await db
    .aggregate([{ $documents: fixtures }, ...stages])
    .toArray();
  const d2 = diffRows(viaDocuments, expected);
  console.log("$documents actual:", JSON.stringify(viaDocuments));
  check(
    "unit test passes via $documents (no collection needed)",
    d2.missing.length === 0 && d2.unexpected.length === 0
  );

  // Failure reporting shape: mutate expectations and show the diff.
  const wrongExpected = expected.map((e) => ({ ...e, amount: e.amount + 1 }));
  const d3 = diffRows(viaDocuments, wrongExpected);
  console.log("failure diff sample:", JSON.stringify(d3, null, 2));
  check(
    "diff reports missing + unexpected rows on mismatch",
    d3.missing.length === 2 && d3.unexpected.length === 2
  );

  await client.close();
  await mongod.stop();

  console.log(`\n${String(checks - failures)}/${String(checks)} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

void main();
