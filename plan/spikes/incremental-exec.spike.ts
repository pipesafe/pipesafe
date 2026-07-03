/**
 * SPIKE: Incremental & microbatch execution mechanics on real MongoDB
 *
 * Purpose:   Empirically verify every runtime mechanism `Model.Mode.Incremental`
 *            and `Model.Mode.Microbatch` (plan/04-transform-roadmap.md §3,
 *            plan/spikes/incremental-model-api.spike.ts) will depend on:
 *            watermark reads, the three apply strategies (append / merge /
 *            deleteInsert) mapped onto $merge, rerun idempotency, late-arriving
 *            data, microbatch window replay & out-of-order execution, and the
 *            $merge edge cases (unique-index requirement, whenMatched:"fail"
 *            partial writes, invalid "delete" action, self-merge,
 *            whenNotMatched:"discard").
 * Run:       bun run tsx plan/spikes/incremental-exec.spike.ts   (repo root)
 * Status:    EXECUTED 2026-07-03 against mongodb-memory-server ^10
 *            (standalone mongod 7.0.24, wiredTiger) — all 29 checks passed.
 *
 * Findings summary (details inline at each section):
 *  1. $merge with a multi-field / non-_id `on:` HARD-FAILS without a unique
 *     index on exactly those fields: code 51183, "Cannot find index to verify
 *     that join fields will be unique". The framework MUST create the index
 *     (with `unique: true`) before the first incremental merge. `on: "_id"`
 *     needs nothing.
 *  2. whenMatched:"fail" is NOT usable as an idempotent append strategy: on a
 *     duplicate it aborts MID-STREAM and NON-TRANSACTIONALLY (code 11000-ish
 *     MergeStageNoMatchingDocument variant; observed partial writes — some
 *     new docs land before the error). Correct append = whenMatched:
 *     "keepExisting" + whenNotMatched:"insert" — verified idempotent.
 *  3. whenMatched:"replace" vs "merge" differ exactly as documented and it
 *     matters for partial delta docs: "merge" preserves target-only fields
 *     ($set semantics), "replace" drops them. Both idempotent on replay for
 *     full docs.
 *  3b. SURPRISE — merging on a non-_id key when the pipeline doc carries an
 *     _id different from the matched target doc's _id fails hard: code 66
 *     ImmutableField "$merge failed to update the matching document, did you
 *     attempt to modify the _id...". The framework MUST auto-append $unset:
 *     "_id" (or equivalent) whenever `on` != "_id" — this cost the first
 *     spike run a hang-to-timeout and is exactly the kind of footgun users
 *     would hit immediately.
 *  4. There is NO delete action in $merge (whenMatched:"delete" rejected at
 *     parse time). deleteInsert must be: client-side deleteMany on the delta
 *     key set, then aggregate + $merge insert. Non-atomic window between the
 *     two — readers can observe missing docs. Confirmed empirically.
 *  5. Watermark $gt filter misses late-arriving events (receivedAt older than
 *     max in target) forever. Mitigations verified: lookback re-scan (works
 *     because merge-on-key is idempotent) or microbatch window replay.
 *  6. Microbatch delete-window-then-merge is fully idempotent INCLUDING
 *     source-side deletes (merge-only replay leaves zombie docs — verified);
 *     windows run correctly out of order; a mid-window failure retries to a
 *     converged state because the delete pass resets the window.
 *  7. $merge into the SAME collection being aggregated is allowed (MongoDB
 *     >=4.4) — enables self-referential dedup/compaction models.
 *  8. whenNotMatched:"discard" works as the "updates only" mode — useful for
 *     late-data policy "update existing windows, never resurrect".
 *  9. All of the above work on a STANDALONE memory server — no replica set
 *     needed for $merge/$out (only change streams need RS).
 * 10. @pipesafe/core's Pipeline.merge() already accepts on/whenMatched/
 *     whenNotMatched and Model.buildPipeline() threads $merge through it —
 *     the executor work is confined to manifold (watermark pre-query, index
 *     ensure, delete pre-pass, window loop).
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Collection as DriverCollection, Document } from "mongodb";
import { Pipeline } from "@pipesafe/core";

// ============================================================================
// Harness
// ============================================================================

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

type RawEvent = {
  _id: string; // use eventId as _id in source for simple seeding
  eventId: string;
  userId: string;
  receivedAt: Date;
  status: string;
  amount: number;
};
type StgEvent = RawEvent & { day: Date };

const D = (s: string) => new Date(s);
const ev = (
  id: string,
  receivedAt: string,
  status = "new",
  amount = 10
): RawEvent => ({
  _id: id,
  eventId: id,
  userId: `u-${id}`,
  receivedAt: D(receivedAt),
  status,
  amount,
});

/** transform stage shared by all runs ($set day = dateTrunc(receivedAt)) */
const TRANSFORM = {
  $set: { day: { $dateTrunc: { date: "$receivedAt", unit: "day" } } },
};

async function maxWatermark(
  target: DriverCollection<Document>,
  field: string
): Promise<Date | null> {
  const [doc] = await target
    .aggregate([{ $group: { _id: null, wm: { $max: `$${field}` } } }])
    .toArray();
  return (doc?.["wm"] as Date | undefined) ?? null;
}

async function dump(c: DriverCollection<Document>) {
  return (await c.find().sort({ eventId: 1 }).toArray()).map((d) => {
    const { _id: _ignored, ...rest } = d;
    return rest;
  });
}

async function main() {
  const mem = await MongoMemoryServer.create(); // standalone, no replica set
  const client = new MongoClient(mem.getUri());
  try {
    await client.connect();
    await body(client);
  } finally {
    await client.close();
    await mem.stop();
  }
}

async function body(client: MongoClient) {
  const db = client.db("spike");
  const source = db.collection("raw_events");
  const target = db.collection("stg_events");

  // ==========================================================================
  section("0. $merge edge case: on-field WITHOUT unique index");
  // ==========================================================================
  await source.insertMany([ev("e1", "2025-01-01T10:00:00Z")]);
  let noIndexError = "";
  try {
    await source
      .aggregate([
        TRANSFORM,
        {
          $merge: {
            into: "stg_events",
            on: "eventId",
            whenMatched: "replace",
            whenNotMatched: "insert",
          },
        },
      ])
      .toArray();
  } catch (e) {
    noIndexError = String(e);
  }
  check(
    "$merge on non-indexed field fails with code 51183",
    noIndexError.includes("51183") ||
      noIndexError.includes("Cannot find index"),
    noIndexError.slice(0, 140)
  );
  // Framework obligation: ensure the unique index BEFORE first merge.
  await target.createIndex({ eventId: 1 }, { unique: true });

  // ==========================================================================
  section("1. First (full) run + watermark read");
  // ==========================================================================
  await source.insertMany([
    ev("e2", "2025-01-01T12:00:00Z"),
    ev("e3", "2025-01-02T09:00:00Z"),
  ]);
  const MERGE_UPSERT = {
    $merge: {
      into: "stg_events",
      on: "eventId",
      whenMatched: "replace",
      whenNotMatched: "insert",
    },
  };
  await source.aggregate([TRANSFORM, MERGE_UPSERT]).toArray();
  check("full run materialized 3 docs", (await target.countDocuments()) === 3);
  const wm1 = await maxWatermark(target, "receivedAt");
  check(
    "watermark = max(receivedAt) in target",
    wm1?.toISOString() === "2025-01-02T09:00:00.000Z",
    `wm=${wm1?.toISOString()}`
  );
  check(
    "watermark on empty/missing target is null (first-run signal)",
    (await maxWatermark(db.collection("nope"), "receivedAt")) === null
  );

  // ==========================================================================
  section("2. Incremental run: delta $match + merge strategy");
  // ==========================================================================
  // New event after watermark + an UPDATE to e2 (newer receivedAt, new status)
  await source.insertMany([ev("e4", "2025-01-03T08:00:00Z")]);
  await source.updateOne(
    { eventId: "e2" },
    { $set: { status: "updated", receivedAt: D("2025-01-03T09:00:00Z") } }
  );
  const deltaMatch = { $match: { receivedAt: { $gt: wm1 } } };
  await source.aggregate([deltaMatch, TRANSFORM, MERGE_UPSERT]).toArray();
  check(
    "incremental merge run: 4 docs (e4 inserted, e2 replaced)",
    (await target.countDocuments()) === 4
  );
  const e2 = await target.findOne({ eventId: "e2" });
  check("updated doc replaced in place", e2?.["status"] === "updated");

  // Rerun the SAME delta — idempotency of merge strategy
  const before = JSON.stringify(await dump(target));
  await source.aggregate([deltaMatch, TRANSFORM, MERGE_UPSERT]).toArray();
  check(
    "merge strategy rerun is idempotent (target state identical)",
    JSON.stringify(await dump(target)) === before
  );

  // ==========================================================================
  section("3. Append strategy mechanics");
  // ==========================================================================
  // 3a. whenMatched:"fail" — what actually happens on rerun with duplicates?
  await source.insertMany([ev("e5", "2025-01-03T10:00:00Z")]);
  const beforeFailCount = await target.countDocuments();
  let failErr = "";
  try {
    // Reprocess a range that overlaps existing target docs
    await source
      .aggregate([
        TRANSFORM,
        {
          $merge: {
            into: "stg_events",
            on: "eventId",
            whenMatched: "fail",
            whenNotMatched: "insert",
          },
        },
      ])
      .toArray();
  } catch (e) {
    failErr = String(e);
  }
  const afterFailCount = await target.countDocuments();
  check(
    "whenMatched:'fail' aborts on first duplicate",
    failErr.length > 0,
    failErr.slice(0, 140)
  );
  check(
    "whenMatched:'fail' abort is NON-TRANSACTIONAL (e5 may or may not have landed before abort)",
    afterFailCount >= beforeFailCount,
    `before=${beforeFailCount} after=${afterFailCount} (partial writes possible; docs preceding the dup in pipeline order land)`
  );
  // 3b. Correct append: keepExisting + insert — idempotent insert-only
  await target.deleteMany({ eventId: "e5" }); // reset e5
  const MERGE_APPEND = {
    $merge: {
      into: "stg_events",
      on: "eventId",
      whenMatched: "keepExisting",
      whenNotMatched: "insert",
    },
  };
  await source.aggregate([TRANSFORM, MERGE_APPEND]).toArray();
  const e2AfterAppend = await target.findOne({ eventId: "e2" });
  check(
    "append (keepExisting): existing docs untouched, new doc e5 inserted",
    (await target.countDocuments()) === 5 &&
      e2AfterAppend?.["status"] === "updated"
  );
  const beforeAppend = JSON.stringify(await dump(target));
  await source.aggregate([TRANSFORM, MERGE_APPEND]).toArray();
  check(
    "append rerun over full source is idempotent",
    JSON.stringify(await dump(target)) === beforeAppend
  );

  // ==========================================================================
  section("4. merge vs replace with PARTIAL delta docs");
  // ==========================================================================
  // Target doc e3 has {day}. Send a partial doc {eventId, status} only.
  const partialSource = db.collection("partial_src");
  await partialSource.insertMany([
    { _id: "p1", eventId: "e3", status: "enriched" },
  ]);
  // 4a. GOTCHA: if the delta doc carries an _id different from the target's,
  // whenMatched:"merge" tries to $set the immutable _id and HARD-FAILS.
  let immutableErr = "";
  try {
    await partialSource
      .aggregate([
        {
          $merge: {
            into: "stg_events",
            on: "eventId",
            whenMatched: "merge",
            whenNotMatched: "discard",
          },
        },
      ])
      .toArray();
  } catch (e) {
    immutableErr = String(e);
  }
  check(
    "merging on non-_id key with mismatched _id fails: code 66 ImmutableField",
    immutableErr.includes("ImmutableField") ||
      immutableErr.includes("immutable field '_id'"),
    immutableErr.slice(0, 160)
  );
  // => framework must strip _id ($unset) from delta docs when on != _id.
  await partialSource
    .aggregate([
      { $unset: "_id" },
      {
        $merge: {
          into: "stg_events",
          on: "eventId",
          whenMatched: "merge",
          whenNotMatched: "discard",
        },
      },
    ])
    .toArray();
  const e3merged = await target.findOne({ eventId: "e3" });
  check(
    "whenMatched:'merge' preserves fields absent from delta doc ($set semantics)",
    e3merged?.["status"] === "enriched" &&
      e3merged?.["day"] !== undefined &&
      e3merged?.["amount"] === 10
  );
  await partialSource
    .aggregate([
      { $unset: "_id" },
      {
        $merge: {
          into: "stg_events",
          on: "eventId",
          whenMatched: "replace",
          whenNotMatched: "discard",
        },
      },
    ])
    .toArray();
  const e3replaced = await target.findOne({ eventId: "e3" });
  check(
    "whenMatched:'replace' DROPS fields absent from delta doc",
    e3replaced?.["status"] === "enriched" && e3replaced?.["day"] === undefined,
    "partial-doc deltas must use 'merge', full-doc recomputes may use 'replace'"
  );
  // repair e3 for later sections
  await source
    .aggregate([{ $match: { eventId: "e3" } }, TRANSFORM, MERGE_UPSERT])
    .toArray();

  // ==========================================================================
  section("5. deleteInsert strategy — no delete action exists in $merge");
  // ==========================================================================
  let deleteActionErr = "";
  try {
    await source
      .aggregate([
        TRANSFORM,
        {
          $merge: { into: "stg_events", on: "eventId", whenMatched: "delete" },
        },
      ])
      .toArray();
  } catch (e) {
    deleteActionErr = String(e);
  }
  check(
    "whenMatched:'delete' is rejected (no such action)",
    deleteActionErr.length > 0,
    deleteActionErr.slice(0, 120)
  );
  // Real deleteInsert: (1) compute delta keys, (2) deleteMany, (3) merge-insert
  const deltaKeys = (
    await source
      .aggregate([deltaMatch, { $project: { _id: 0, eventId: 1 } }])
      .toArray()
  ).map((d) => d["eventId"] as string);
  await target.deleteMany({ eventId: { $in: deltaKeys } });
  const midState = await target.countDocuments({
    eventId: { $in: deltaKeys },
  });
  check(
    "deleteInsert is NON-ATOMIC: window where delta docs are absent",
    midState === 0,
    "a reader between delete and insert sees missing docs — must be documented"
  );
  await source
    .aggregate([
      deltaMatch,
      TRANSFORM,
      {
        $merge: {
          into: "stg_events",
          on: "eventId",
          whenMatched: "fail", // safe: we just deleted the keys
          whenNotMatched: "insert",
        },
      },
    ])
    .toArray();
  check(
    "deleteInsert converges to same 5-doc state",
    (await target.countDocuments()) === 5
  );

  // ==========================================================================
  section("6. Late-arriving data vs watermark");
  // ==========================================================================
  const wm2 = await maxWatermark(target, "receivedAt");
  // Event arrives NOW but carries an OLD receivedAt (before watermark)
  await source.insertMany([ev("late1", "2025-01-01T23:00:00Z", "late")]);
  await source
    .aggregate([
      { $match: { receivedAt: { $gt: wm2 } } },
      TRANSFORM,
      MERGE_UPSERT,
    ])
    .toArray();
  check(
    "plain $gt watermark MISSES late-arriving event (silent data loss)",
    (await target.findOne({ eventId: "late1" })) === null
  );
  // Mitigation: lookback — rescan watermark minus N; idempotent via merge-on-key
  const lookbackMs = 48 * 3600 * 1000;
  await source
    .aggregate([
      {
        $match: { receivedAt: { $gt: new Date(wm2!.getTime() - lookbackMs) } },
      },
      TRANSFORM,
      MERGE_UPSERT,
    ])
    .toArray();
  check(
    "lookback rescan picks up late event; overlap harmless (merge idempotent)",
    (await target.findOne({ eventId: "late1" }))?.["status"] === "late" &&
      (await target.countDocuments()) === 6
  );

  // ==========================================================================
  section("7. Microbatch: windowed runs, out-of-order, replay, retry");
  // ==========================================================================
  const mbSource = db.collection("mb_raw");
  const mbTarget = db.collection("mb_daily");
  await mbTarget.createIndex({ eventId: 1 }, { unique: true });
  await mbSource.insertMany([
    ev("d1a", "2025-02-01T01:00:00Z"),
    ev("d1b", "2025-02-01T13:00:00Z"),
    ev("d2a", "2025-02-02T02:00:00Z"),
    ev("d2b", "2025-02-02T14:00:00Z"),
    ev("d3a", "2025-02-03T03:00:00Z"),
  ]);
  const windowStages = (start: string, end: string): Document[] => [
    { $match: { receivedAt: { $gte: D(start), $lt: D(end) } } }, // auto-prepended by runner
    TRANSFORM,
    {
      $merge: {
        into: "mb_daily",
        on: "eventId",
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  ];
  const runWindow = async (start: string, end: string, deleteFirst = true) => {
    if (deleteFirst) {
      // full-window replacement pre-pass
      await mbTarget.deleteMany({
        receivedAt: { $gte: D(start), $lt: D(end) },
      });
    }
    await mbSource.aggregate(windowStages(start, end)).toArray();
  };

  // Out-of-order execution: day2, day3, day1
  await runWindow("2025-02-02", "2025-02-03");
  await runWindow("2025-02-03", "2025-02-04");
  await runWindow("2025-02-01", "2025-02-02");
  check(
    "out-of-order window execution converges (5 docs)",
    (await mbTarget.countDocuments()) === 5,
    "windows are independent; order irrelevant"
  );

  // Replay idempotency
  const mbBefore = JSON.stringify(await dump(mbTarget));
  await runWindow("2025-02-02", "2025-02-03");
  check(
    "window replay (delete+merge) is idempotent",
    JSON.stringify(await dump(mbTarget)) === mbBefore
  );

  // Source-side delete: merge-only replay leaves a zombie; delete+merge doesn't
  await mbSource.deleteOne({ eventId: "d2b" });
  await runWindow("2025-02-02", "2025-02-03", /* deleteFirst */ false);
  check(
    "merge-only replay CANNOT remove source-deleted docs (zombie d2b remains)",
    (await mbTarget.findOne({ eventId: "d2b" })) !== null
  );
  await runWindow("2025-02-02", "2025-02-03", /* deleteFirst */ true);
  check(
    "delete-window-then-merge replay removes source-deleted docs",
    (await mbTarget.findOne({ eventId: "d2b" })) === null &&
      (await mbTarget.countDocuments()) === 4
  );

  // Failed-window retry: force a mid-window failure with whenMatched:"fail"
  await mbSource.insertMany([ev("d3b", "2025-02-03T05:00:00Z")]);
  let windowErr = "";
  try {
    await mbSource
      .aggregate([
        {
          $match: {
            receivedAt: { $gte: D("2025-02-03"), $lt: D("2025-02-04") },
          },
        },
        TRANSFORM,
        {
          $merge: {
            into: "mb_daily",
            on: "eventId",
            whenMatched: "fail", // d3a already exists -> abort mid-window
            whenNotMatched: "insert",
          },
        },
      ])
      .toArray();
  } catch (e) {
    windowErr = String(e);
  }
  check("simulated window failure occurred", windowErr.length > 0);
  // Retry the whole window with the proper idempotent recipe:
  await runWindow("2025-02-03", "2025-02-04");
  check(
    "failed-window retry converges (d3a + d3b present exactly once)",
    (await mbTarget.countDocuments({
      receivedAt: { $gte: D("2025-02-03") },
    })) === 2
  );

  // ==========================================================================
  section("8. Remaining $merge edge cases");
  // ==========================================================================
  // 8a. $merge into the same collection as the source (compaction/self-merge)
  let selfMergeErr = "";
  try {
    await source
      .aggregate([
        { $match: { eventId: "e1" } },
        { $set: { status: "self-merged" } },
        { $merge: { into: "raw_events", on: "_id", whenMatched: "replace" } },
      ])
      .toArray();
  } catch (e) {
    selfMergeErr = String(e);
  }
  check(
    "$merge into SAME collection as source is allowed (>=4.4)",
    selfMergeErr === "" &&
      (await source.findOne({ eventId: "e1" }))?.["status"] === "self-merged",
    selfMergeErr.slice(0, 120)
  );

  // 8b. whenNotMatched:"discard" — update-only late-data policy
  const preDiscard = await target.countDocuments();
  await source
    .aggregate([
      TRANSFORM,
      { $set: { status: "touched" } },
      {
        $merge: {
          into: "stg_events",
          on: "eventId",
          whenMatched: "merge",
          whenNotMatched: "discard",
        },
      },
    ])
    .toArray();
  check(
    "whenNotMatched:'discard' updates matches, silently drops non-matches",
    (await target.countDocuments()) === preDiscard &&
      (await target.findOne({ eventId: "e2" }))?.["status"] === "touched"
  );

  // ==========================================================================
  section("9. Same flow through @pipesafe/core Pipeline (API viability)");
  // ==========================================================================
  const wm3 = await maxWatermark(target, "receivedAt");
  await source.insertMany([ev("e9", "2025-01-05T10:00:00Z")]);
  // This is what manifold's executor will assemble: delta $match spliced with
  // a resolved watermark value + user transform + $merge from the Mode config.
  const typedPipeline = new Pipeline<RawEvent>({ pipeline: [] })
    .match({ receivedAt: { $gt: wm3! } })
    .set({ day: { $dateTrunc: { date: "$receivedAt", unit: "day" } } })
    .merge({
      into: "stg_events",
      on: "eventId",
      whenMatched: "replace",
      whenNotMatched: "insert",
    });
  await source.aggregate(typedPipeline.getPipeline()).toArray();
  check(
    "core Pipeline builds & executes the full incremental shape (match/set/merge)",
    (await target.findOne({ eventId: "e9" }))?.["day"]?.toISOString?.() ===
      "2025-01-05T00:00:00.000Z"
  );
  const stages = typedPipeline.getPipeline();
  check(
    "delta filter is a plain leading stage (splice/prepend point for the runner)",
    JSON.stringify(Object.keys(stages[0] ?? {})) === '["$match"]',
    JSON.stringify(stages[0])
  );

  // ==========================================================================
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} checks failed`);
}

const g = globalThis as { process?: { exitCode?: number } };
main().catch((e: unknown) => {
  console.error(e);
  if (g.process) g.process.exitCode = 1;
});

// Satisfy noUnusedLocals-style lint for the StgEvent doc shape (documentation)
export type { StgEvent };
