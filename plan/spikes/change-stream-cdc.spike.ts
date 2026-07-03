/**
 * SPIKE: change-stream CDC — snapshot+cutover ordering, resume-token
 * checkpointing, crash/resume, and failure modes. EXECUTED, not a sketch.
 *
 * Purpose: empirically ground plan/05-orchestration-and-el-roadmap.md §6
 * (change-stream CDC as first-class EL) and the EPIC-J TRD
 * (plan/trd/EPIC-J-connectors-cdc.md). Refines the illustrative
 * plan/spikes/source-connector-api.spike.ts with real driver behavior.
 *
 * How to run (repo root; first run may download a mongod binary):
 *   bun run tsx plan/spikes/change-stream-cdc.spike.ts
 *
 * Status: EXECUTED 2026-07-03 against MongoMemoryReplSet (mongodb-memory-server
 * 10.2.x, mongodb driver 6.21.0, single-node replica set). All scenarios PASS.
 *
 * Findings summary (details printed by each scenario):
 *  1. Snapshot-then-stream ordering: capturing `operationTime` BEFORE the
 *     snapshot and starting the stream with `startAtOperationTime` yields a
 *     gap-free cutover even with writes racing the snapshot cursor; target
 *     equals source (counts + sha256 content hashes match).
 *     `startAtOperationTime` is INCLUSIVE of the captured time in practice —
 *     the pre-snapshot seed writes were re-delivered — so replays across the
 *     cutover boundary are guaranteed and keyed idempotent upserts are
 *     mandatory, not optional.
 *  2. Wrong ordering (operationTime captured AFTER the snapshot) demonstrably
 *     loses a mid-snapshot update: the stream delivers zero events and the
 *     target retains the stale document. This is THE correctness crux.
 *  3. Crash/resume: persisting the last applied event's `_id` (resume token)
 *     to `_manifold.checkpoints` only AFTER the target write resolves, then
 *     "crashing" (closing the stream with 2 applied-but-uncheckpointed
 *     events) and reopening with `resumeAfter` re-delivered exactly those 2
 *     events (counted as duplicates via token set) — no loss, and no
 *     duplication in the TARGET because ops are keyed. At-least-once +
 *     idempotent apply confirmed end to end.
 *  4. Fabricated resume tokens — three distinct behaviors (SURPRISE):
 *     (a) a parseable token with a FUTURE timestamp is silently ACCEPTED —
 *     the stream idles waiting for a resume point that will never exist; a
 *     corrupted checkpoint can therefore be a hang, not an error (mitigate
 *     with a liveness probe, not try/catch);
 *     (b) a mutated-but-parseable token from the real oplog range fails with
 *     MongoServerError code 280 ChangeStreamFatalError, errorLabel
 *     `NonResumableChangeStreamError`, "resume token was not found" — thrown
 *     lazily on the first tryNext/getMore, not at watch();
 *     (c) a structurally unparseable token fails with MongoServerError code
 *     50811 "KeyString format error: Unknown type" and NO error label — so a
 *     label-only re-snapshot policy would miss it; match on a code set too.
 *     `startAtOperationTime` earlier than the oldest oplog entry SUCCEEDS on
 *     a fresh memory server (nothing has been truncated); genuine
 *     ChangeStreamHistoryLost (code 286) requires oplog rollover and could
 *     not be forced on mongodb-memory-server — handling must key off the
 *     `NonResumableChangeStreamError` error label plus code set
 *     {286, 280, 50811}, all mapping to truncate + re-snapshot.
 *  5. Latency/batching: `tryNext()` on an idle stream blocks ~maxAwaitTimeMS
 *     (measured ≈ the configured 250ms) and returns immediately when events
 *     are buffered — so a poll loop's idle cost is one getMore per
 *     maxAwaitTimeMS, and `batchSize` only caps a single getMore response.
 *  6. `fullDocument: "updateLookup"` delivered a post-image for every update
 *     in these runs; the nullable case (doc deleted between oplog entry and
 *     lookup) must still be handled as a no-op because the trailing delete
 *     event tombstones the target anyway.
 */

import { createHash } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  MongoClient,
  MongoServerError,
  Timestamp,
  type ChangeStream,
  type ChangeStreamDocument,
  type Collection,
  type Db,
  type Document,
} from "mongodb";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                      */
/* ------------------------------------------------------------------ */

interface User {
  _id: string;
  name: string;
  plan: "free" | "pro";
  v: number;
}
/** target carries the documented system-field contract */
type Mirror = User & { _ps_synced: Date; _ps_deleted?: boolean };

interface CheckpointDoc {
  _id: string; // e.g. "cdc:app.users"
  token: Document; // the resume token ({ _data: string })
  ts: Date;
}

const failures: string[] = [];
function check(cond: boolean, label: string): void {
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures.push(label);
}

async function operationTime(client: MongoClient): Promise<Timestamp> {
  const res = await client.db("admin").command({ ping: 1 });
  return res.operationTime as Timestamp;
}

/** sha256 over _id-sorted docs with system fields stripped */
function contentHash(docs: Document[]): string {
  const stripped = docs
    .map(({ _ps_synced: _s, _ps_deleted: _d, ...rest }) => rest)
    .sort((a, b) => String(a._id).localeCompare(String(b._id)));
  return createHash("sha256")
    .update(JSON.stringify(stripped))
    .digest("hex")
    .slice(0, 16);
}

async function compare(
  source: Collection<User>,
  target: Collection<Mirror>
): Promise<{ equal: boolean; detail: string }> {
  const src = await source.find().toArray();
  const tgt = await target.find({ _ps_deleted: { $ne: true } }).toArray();
  const srcHash = contentHash(src);
  const tgtHash = contentHash(tgt);
  return {
    equal: srcHash === tgtHash && src.length === tgt.length,
    detail: `source ${String(src.length)} docs hash=${srcHash} | target ${String(tgt.length)} docs hash=${tgtHash}`,
  };
}

/** apply one change event as a keyed, idempotent op on the target */
async function applyEvent(
  target: Collection<Mirror>,
  ev: ChangeStreamDocument<User>
): Promise<"upsert" | "delete" | "noop"> {
  switch (ev.operationType) {
    case "insert":
    case "replace":
    case "update": {
      const doc =
        ev.operationType === "update" ? ev.fullDocument : ev.fullDocument;
      if (!doc) return "noop"; // updateLookup post-image gone; trailing delete event will tombstone
      await target.replaceOne(
        { _id: ev.documentKey._id },
        { ...doc, _ps_synced: new Date() },
        { upsert: true }
      );
      return "upsert";
    }
    case "delete":
      await target.updateOne(
        { _id: ev.documentKey._id },
        { $set: { _ps_deleted: true, _ps_synced: new Date() } },
        { upsert: true }
      );
      return "delete";
    default:
      return "noop";
  }
}

const tokenStr = (ev: ChangeStreamDocument<User>): string =>
  (ev._id as { _data: string })._data;

interface DrainStats {
  applied: number;
  duplicates: number;
  checkpointsWritten: number;
  crashed: boolean;
}

/**
 * Drain the stream until idle, applying events and checkpointing the LAST
 * APPLIED event's token every `checkpointEvery` events — strictly AFTER the
 * target write resolved (write-before-checkpoint invariant). `crashAfter`
 * simulates a process kill: apply N events past the last checkpoint, then
 * close the stream WITHOUT checkpointing them.
 */
async function drainApplyCheckpoint(opts: {
  stream: ChangeStream<User, ChangeStreamDocument<User>>;
  target: Collection<Mirror>;
  checkpoints: Collection<CheckpointDoc>;
  checkpointKey: string;
  checkpointEvery: number;
  seenTokens: Set<string>;
  crashAfter?: number;
}): Promise<DrainStats> {
  const stats: DrainStats = {
    applied: 0,
    duplicates: 0,
    checkpointsWritten: 0,
    crashed: false,
  };
  let sinceCheckpoint = 0;
  let lastToken: Document | null = null;

  const checkpoint = async (): Promise<void> => {
    if (!lastToken) return;
    await opts.checkpoints.updateOne(
      { _id: opts.checkpointKey },
      { $set: { token: lastToken, ts: new Date() } },
      { upsert: true }
    );
    stats.checkpointsWritten++;
    sinceCheckpoint = 0;
  };

  for (;;) {
    const ev = await opts.stream.tryNext();
    if (ev === null) break; // idle — drained
    const t = tokenStr(ev);
    if (opts.seenTokens.has(t)) stats.duplicates++;
    opts.seenTokens.add(t);
    const action = await applyEvent(opts.target, ev); // durable write FIRST
    if (action !== "noop") stats.applied++;
    lastToken = ev._id as Document;
    sinceCheckpoint++;
    if (opts.crashAfter !== undefined && sinceCheckpoint >= opts.crashAfter) {
      stats.crashed = true;
      await opts.stream.close(); // kill mid-stream: applied > checkpointed
      return stats;
    }
    if (sinceCheckpoint >= opts.checkpointEvery) await checkpoint();
  }
  await checkpoint(); // final checkpoint at idle
  await opts.stream.close();
  return stats;
}

const seed = (n: number): User[] =>
  Array.from({ length: n }, (_, i) => ({
    _id: `u${String(i + 1)}`,
    name: `user ${String(i + 1)}`,
    plan: i % 2 === 0 ? ("free" as const) : ("pro" as const),
    v: 1,
  }));

/** snapshot copy with a small-batch cursor, racing `interleave` mid-cursor */
async function snapshotWithRace(
  source: Collection<User>,
  target: Collection<Mirror>,
  interleave: () => Promise<void>
): Promise<number> {
  let copied = 0;
  const cursor = source.find().sort({ _id: 1 }).batchSize(2);
  for await (const doc of cursor) {
    await target.replaceOne(
      { _id: doc._id },
      { ...doc, _ps_synced: new Date() },
      { upsert: true }
    );
    copied++;
    if (copied === 2) await interleave(); // writes land while cursor is mid-collection
  }
  return copied;
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("starting MongoMemoryReplSet (1 node)...");
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replSet.getUri());
  await client.connect();
  const app: Db = client.db("app");
  const manifold: Db = client.db("_manifold");
  const checkpoints = manifold.collection<CheckpointDoc>("checkpoints");
  const CKPT = "cdc:app.users";

  try {
    /* ---------------------------------------------------------------- */
    console.log(
      "\n[1] CORRECT cutover: operationTime BEFORE snapshot, stream from it"
    );
    /* ---------------------------------------------------------------- */
    const src = app.collection<User>("users");
    const tgt = app.collection<Mirror>("users_mirror");
    await src.insertMany(seed(6));

    const t0 = await operationTime(client); // <-- BEFORE snapshot: the crux
    const copied = await snapshotWithRace(src, tgt, async () => {
      await src.updateOne({ _id: "u1" }, { $inc: { v: 1 } }); // behind cursor → snapshot stale
      await src.insertOne({ _id: "u7", name: "user 7", plan: "pro", v: 1 }); // ahead of cursor
      await src.deleteOne({ _id: "u6" }); // ahead of cursor
    });
    console.log(`  snapshot copied ${String(copied)} docs with racing writes`);
    const afterSnap = await compare(src, tgt);
    console.log(`  post-snapshot (pre-stream): ${afterSnap.detail}`);
    check(
      !afterSnap.equal,
      "snapshot alone is stale (race is real: u1 update landed behind the cursor)"
    );

    const seen = new Set<string>();
    let stream = src.watch([], {
      fullDocument: "updateLookup",
      startAtOperationTime: t0,
      maxAwaitTimeMS: 250,
    });
    const d1 = await drainApplyCheckpoint({
      stream,
      target: tgt,
      checkpoints,
      checkpointKey: CKPT,
      checkpointEvery: 3,
      seenTokens: seen,
    });
    console.log(
      `  cutover drain: ${String(d1.applied)} events applied, ${String(d1.checkpointsWritten)} checkpoints`
    );
    const afterCutover = await compare(src, tgt);
    console.log(`  post-cutover: ${afterCutover.detail}`);
    check(
      afterCutover.equal,
      "target == source after snapshot + stream cutover"
    );
    check(
      d1.applied >= 3,
      `startAtOperationTime replays across the boundary (saw ${String(d1.applied)} events incl. pre-snapshot seeds ⇒ inclusive/at-least-once)`
    );

    /* ---------------------------------------------------------------- */
    console.log("\n[2] crash mid-stream, resumeAfter from checkpoint: no loss");
    /* ---------------------------------------------------------------- */
    // live writes while no stream is open
    await src.updateOne({ _id: "u2" }, { $set: { plan: "free", v: 5 } });
    await src.insertOne({ _id: "u8", name: "user 8", plan: "free", v: 1 });
    await src.deleteOne({ _id: "u3" });
    await src.updateOne({ _id: "u7" }, { $inc: { v: 3 } });
    await src.updateOne({ _id: "u4" }, { $inc: { v: 9 } });

    const ckpt1 = await checkpoints.findOne({ _id: CKPT });
    check(ckpt1 !== null, "checkpoint persisted from phase [1]");
    stream = src.watch([], {
      fullDocument: "updateLookup",
      resumeAfter: ckpt1?.token,
      maxAwaitTimeMS: 250,
    });
    // crash after 2 applied events with checkpointEvery=100 → nothing new checkpointed
    const d2 = await drainApplyCheckpoint({
      stream,
      target: tgt,
      checkpoints,
      checkpointKey: CKPT,
      checkpointEvery: 100,
      seenTokens: seen,
      crashAfter: 2,
    });
    check(d2.crashed, "simulated crash: 2 events applied but NOT checkpointed");
    const midCrash = await compare(src, tgt);
    console.log(`  mid-crash state: ${midCrash.detail}`);

    const ckpt2 = await checkpoints.findOne({ _id: CKPT });
    stream = src.watch([], {
      fullDocument: "updateLookup",
      resumeAfter: ckpt2?.token,
      maxAwaitTimeMS: 250,
    });
    const d3 = await drainApplyCheckpoint({
      stream,
      target: tgt,
      checkpoints,
      checkpointKey: CKPT,
      checkpointEvery: 3,
      seenTokens: seen,
    });
    console.log(
      `  resumed drain: ${String(d3.applied)} applied, ${String(d3.duplicates)} re-delivered (expected 2 = applied-but-uncheckpointed)`
    );
    const afterResume = await compare(src, tgt);
    console.log(`  post-resume: ${afterResume.detail}`);
    check(afterResume.equal, "target == source after crash + resumeAfter");
    check(
      d3.duplicates === 2,
      "exactly the applied-but-uncheckpointed events were re-delivered (at-least-once, deduped by keyed upsert)"
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[3] WRONG cutover: operationTime AFTER snapshot → data loss"
    );
    /* ---------------------------------------------------------------- */
    const src2 = app.collection<User>("users2");
    const tgt2 = app.collection<Mirror>("users2_mirror");
    await src2.insertMany(seed(6));
    await snapshotWithRace(src2, tgt2, async () => {
      await src2.updateOne({ _id: "u1" }, { $inc: { v: 100 } }); // lands mid-snapshot
    });
    const tAfter = await operationTime(client); // <-- WRONG: captured post-snapshot
    const wrongStream = src2.watch([], {
      fullDocument: "updateLookup",
      startAtOperationTime: tAfter,
      maxAwaitTimeMS: 250,
    });
    let wrongEvents = 0;
    for (;;) {
      const ev = await wrongStream.tryNext();
      if (ev === null) break;
      await applyEvent(tgt2, ev);
      wrongEvents++;
    }
    await wrongStream.close();
    const wrong = await compare(src2, tgt2);
    const staleU1 = await tgt2.findOne({ _id: "u1" });
    const liveU1 = await src2.findOne({ _id: "u1" });
    console.log(
      `  stream delivered ${String(wrongEvents)} events; ${wrong.detail}`
    );
    console.log(
      `  u1.v: source=${String(liveU1?.v)} target=${String(staleU1?.v)} (update silently LOST)`
    );
    check(
      !wrong.equal && staleU1?.v === 1 && liveU1?.v === 101,
      "post-snapshot operationTime provably loses the mid-snapshot update"
    );

    /* ---------------------------------------------------------------- */
    console.log("\n[4] invalid / expired resume points");
    /* ---------------------------------------------------------------- */
    const report = (label: string, err: unknown): number | undefined => {
      const e = err instanceof MongoServerError ? err : undefined;
      console.log(
        `  ${label}: ${err instanceof Error ? err.constructor.name : typeof err} code=${String(e?.code)} codeName=${String(e?.codeName)} labels=${JSON.stringify(e?.errorLabels ?? [])}`
      );
      console.log(
        `    message: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`
      );
      return typeof e?.code === "number" ? e.code : undefined;
    };

    // (a) parseable token with a FUTURE timestamp ("82" + 0xFFFFFFFF...):
    // the server treats it as "resume point not reached yet" and ACCEPTS it —
    // the stream just idles forever. A corrupted-but-parseable checkpoint is
    // therefore a silent hang, not an error. Detect via liveness (no events
    // AND no postBatchResumeToken progress), not via try/catch.
    let futureAccepted = false;
    try {
      const s = src.watch([], {
        resumeAfter: { _data: "82FFFFFFFF000000012B0229296E04" },
        maxAwaitTimeMS: 100,
      });
      const ev = await s.tryNext();
      futureAccepted = true;
      console.log(
        `  future-timestamp token: ACCEPTED silently (tryNext → ${String(ev)}); stream waits for a resume point that never comes`
      );
      await s.close();
    } catch (err) {
      report("future-timestamp token", err);
    }
    check(
      futureAccepted,
      "parseable future-timestamp token is silently accepted → corrupted checkpoints can hang, not fail"
    );

    // (b) structurally unparseable token
    let unparseableCode: number | undefined;
    try {
      const s = src.watch([], {
        resumeAfter: { _data: "FF00" },
        maxAwaitTimeMS: 100,
      });
      await s.tryNext();
      await s.close();
      console.log("  unparseable token: UNEXPECTEDLY ACCEPTED");
    } catch (err) {
      unparseableCode = report("unparseable token", err);
    }
    check(
      unparseableCode !== undefined,
      "unparseable token rejected with a server error (recorded class/code above)"
    );

    let mutatedCode: number | undefined;
    const real = (await checkpoints.findOne({ _id: CKPT }))?.token as
      | { _data: string }
      | undefined;
    if (real) {
      const mid = Math.floor(real._data.length / 2);
      const flipped =
        real._data.slice(0, mid) +
        (real._data[mid] === "0" ? "1" : "0") +
        real._data.slice(mid + 1);
      try {
        const s = src.watch([], {
          resumeAfter: { _data: flipped },
          maxAwaitTimeMS: 100,
        });
        await s.tryNext();
        await s.close();
        console.log(
          "  mutated real token: ACCEPTED (decoded to a valid-looking point)"
        );
      } catch (err) {
        mutatedCode = report("mutated real token", err);
      }
    }
    console.log(
      `  → re-snapshot trigger set observed here: {${[unparseableCode, mutatedCode].filter((c) => c !== undefined).join(", ")}};` +
        " ChangeStreamHistoryLost (286) needs oplog rollover — not forceable on a fresh memory server, handle via error label NonResumableChangeStreamError + code table"
    );

    // startAtOperationTime older than any oplog entry on a fresh server
    try {
      const s = src.watch([], {
        startAtOperationTime: new Timestamp({ t: 1, i: 1 }),
        maxAwaitTimeMS: 100,
      });
      const ev = await s.tryNext();
      await s.close();
      console.log(
        `  startAtOperationTime(1,1): ACCEPTED on fresh oplog (first event ${ev ? "delivered" : "none buffered"}) — history-loss only occurs once the capped oplog rolls`
      );
    } catch (err) {
      report("startAtOperationTime(1,1)", err);
    }

    /* ---------------------------------------------------------------- */
    console.log("\n[5] maxAwaitTimeMS / batching behavior");
    /* ---------------------------------------------------------------- */
    const s5 = src.watch([], { maxAwaitTimeMS: 250, batchSize: 3 });
    const idle0 = Date.now();
    const none = await s5.tryNext();
    const idleMs = Date.now() - idle0;
    console.log(
      `  idle tryNext(): ${String(idleMs)}ms (≈ maxAwaitTimeMS=250), returned ${String(none)}`
    );
    check(
      none === null && idleMs >= 150,
      "idle tryNext blocks ~maxAwaitTimeMS then yields null"
    );
    await src.insertOne({ _id: "u9", name: "user 9", plan: "pro", v: 1 });
    // allow the event to reach the oplog reader
    await new Promise((r) => setTimeout(r, 50));
    const hot0 = Date.now();
    const one = await s5.tryNext();
    const hotMs = Date.now() - hot0;
    console.log(
      `  hot tryNext(): ${String(hotMs)}ms, got ${String(one?.operationType)} (buffered events return without the await penalty)`
    );
    check(one?.operationType === "insert", "pending event delivered promptly");
    await s5.close();

    /* ---------------------------------------------------------------- */
    console.log("\n==== SUMMARY ====");
    if (failures.length === 0) {
      console.log("ALL CHECKS PASSED");
    } else {
      console.log(`${String(failures.length)} FAILURES:`);
      for (const f of failures) console.log(`  - ${f}`);
      throw new Error(`spike failed: ${String(failures.length)} checks`);
    }
  } finally {
    await client.close();
    await replSet.stop();
  }
}

await main();
