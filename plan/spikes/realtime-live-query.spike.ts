/**
 * SPIKE: realtime live queries over change streams — the empirical ground for
 * plan/trd/EPIC-L-realtime-sdk.md ("typed live queries for MongoDB": a client
 * subscribes to a typed filter, gets the initial result set plus typed
 * incremental updates). EXECUTED, not a sketch.
 *
 * Purpose: answer four questions the TRD's design hangs on.
 *   [1] Does snapshot-then-stream (EPIC-J's pre-snapshot operationTime
 *       finding, change-stream-cdc.spike.ts scenario 1) carry over to a
 *       FILTERED live view with writes racing the initial query cursor?
 *   [2] Membership: an UPDATE can move a doc INTO or OUT OF the filtered
 *       set. What can change events alone tell you? Three server-side
 *       $match shapes tested: (a) naive fullDocument-predicate-only,
 *       (b) pre-images (fullDocumentBeforeChange) + $or predicate,
 *       (c) "passthrough" — inserts/replaces filtered, updates/deletes
 *       always delivered, membership resolved client-side.
 *   [3] Fan-out: one shared change stream dispatching to N in-process
 *       subscriber predicates vs N server-side-filtered streams — rough
 *       cost of both shapes at small N, and where resume tokens live.
 *   [4] Resume: drop the live view's stream, mutate offline (including
 *       leave-the-set updates), resume from the saved token — does the view
 *       reconverge WITHOUT re-running the initial query?
 *
 * How to run (repo root; first run may download a mongod binary):
 *   bun run tsx plan/spikes/realtime-live-query.spike.ts
 *
 * Status: EXECUTED 2026-07-07 against MongoMemoryReplSet (mongodb-memory-server
 * 10.2.x, mongodb driver 6.x, single-node replica set, mongod 7.0.24).
 * ALL CHECKS PASSED (17/17).
 *
 * Findings summary (details printed by each scenario):
 *  1. The EPIC-J cutover recipe carries over verbatim: capture operationTime
 *     BEFORE the initial filtered find(), seed the view from the cursor, then
 *     stream from startAtOperationTime — the view converged to a fresh query
 *     (racing update behind the cursor, mid-query membership enter, insert,
 *     and member delete all healed by replay). Replay across the boundary +
 *     idempotent view application is mandatory, exactly as in CDC.
 *  2. THE MEMBERSHIP VERDICT.
 *     (a) A naive server-side $match on the fullDocument predicate alone is
 *         WRONG: leave-the-set updates (post-image no longer matches) and
 *         ALL deletes (no fullDocument at all) are silently filtered out —
 *         the view retained both stale docs (1 event delivered where 3
 *         mattered).
 *     (b) With changeStreamPreAndPostImages enabled (collMod) and
 *         fullDocumentBeforeChange: "whenAvailable", $or-ing the predicate
 *         over fullDocument AND fullDocumentBeforeChange delivers exactly
 *         the relevant events (enter, leave, member-delete — delete events
 *         DO carry the before-image) and drops non-member noise: 3 events,
 *         view converged. Fully server-side filtering is therefore possible
 *         but ONLY with pre-images enabled on the source collection.
 *     (c) WITHOUT pre-images, correctness does NOT require a separate
 *         client-side membership map: pass updates/deletes through the
 *         server filter unconditionally, use updateLookup post-images, and
 *         the view itself IS the membership map — pred(postImage) false ⇒
 *         delete from view (idempotent no-op if absent); delete event ⇒
 *         delete by _id. Converged with 4 events (the extra one is
 *         non-member update noise, the price of no pre-images).
 *     ⇒ Design: passthrough (c) is the correct DEFAULT; pre-image shape (b)
 *       is a bandwidth/fan-out OPTIMIZATION unlocked per-collection by
 *       collMod, not a correctness requirement. Naive (a) must be
 *       unrepresentable in the API.
 *  3. Fan-out at N=8 over 240 inserts: one shared stream dispatching
 *     in-process drained in 64ms vs 438ms for 8 server-side-filtered
 *     streams drained sequentially (localhost-flattering absolutes; the
 *     structural costs are N oplog-scanning cursors server-side — confirmed
 *     1 vs 8 via serverStatus metrics.cursor.open.total — and N getMore/
 *     idle round-trips). Resume tokens: shared shape has ONE token for all
 *     subscribers (per-subscriber views must be derivable from it);
 *     per-subscriber shape has N independent tokens.
 *     SURPRISE en route: driver change streams are LAZY — no server cursor
 *     exists until the first next()/tryNext(). A stream "opened" before
 *     writes but first read after them starts at "now" and silently misses
 *     the writes (a first run delivered 0 of 240 events). Any subscription
 *     API must anchor the stream explicitly (startAtOperationTime /
 *     resumeAfter) or prime the cursor before acking the subscription.
 *  4. Resume works with the view: saving the last applied event's token,
 *     closing, mutating offline (insert, enter, leave, member update), then
 *     watch(resumeAfter: token) with the SAME passthrough pipeline
 *     reconverged the view to a fresh query with NO initial re-query.
 *     Caveat carried over from EPIC-J: resume tokens have the full failure
 *     taxonomy (codes 286/280/50811 + silent future-token hang), so
 *     re-query is the fallback whenever resume errors or the liveness
 *     watchdog fires; also updateLookup post-images are CURRENT-state, so
 *     intermediate views during replay may be ahead of event time —
 *     convergence at quiescence holds, per-event ordering of intermediate
 *     states is not guaranteed without post-images enabled.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  MongoClient,
  type ChangeStream,
  type ChangeStreamDocument,
  type Collection,
  type Db,
  type Document,
  type Filter,
  type Timestamp,
} from "mongodb";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                      */
/* ------------------------------------------------------------------ */

interface Sub {
  _id: string;
  plan: "free" | "pro";
  name: string;
  v: number;
}

interface FanDoc {
  _id: string;
  k: number;
}

type SubStream = ChangeStream<Sub, ChangeStreamDocument<Sub>>;

const failures: string[] = [];
function check(cond: boolean, label: string): void {
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures.push(label);
}

async function operationTime(client: MongoClient): Promise<Timestamp> {
  const res = await client.db("admin").command({ ping: 1 });
  return res.operationTime as Timestamp;
}

/**
 * The client-side live view: a Map keyed by _id, plus the query predicate.
 * The Map doubles as the membership record — removal on a non-matching
 * post-image or on delete is idempotent, so no separate membership map is
 * needed (scenario 2c proves this).
 */
class LiveView {
  readonly docs = new Map<string, Sub>();
  constructor(private readonly pred: (d: Sub) => boolean) {}

  seed(initial: Sub[]): void {
    for (const d of initial) this.docs.set(d._id, d);
  }

  apply(ev: ChangeStreamDocument<Sub>): "set" | "remove" | "noop" {
    switch (ev.operationType) {
      case "insert":
      case "replace":
      case "update": {
        const doc = ev.fullDocument;
        // updateLookup post-image gone: trailing delete event tombstones
        if (!doc) return "noop";
        if (this.pred(doc)) {
          this.docs.set(ev.documentKey._id, doc);
          return "set";
        }
        this.docs.delete(ev.documentKey._id); // leave-the-set (idempotent)
        return "remove";
      }
      case "delete":
        this.docs.delete(ev.documentKey._id);
        return "remove";
      default:
        return "noop";
    }
  }

  sorted(): Sub[] {
    return [...this.docs.values()].sort((a, b) => a._id.localeCompare(b._id));
  }
}

async function freshQuery(
  coll: Collection<Sub>,
  filter: Filter<Sub>
): Promise<Sub[]> {
  const docs = await coll.find(filter).toArray();
  return docs.sort((a, b) => a._id.localeCompare(b._id));
}

function viewEqualsQuery(view: LiveView, fresh: Sub[]): boolean {
  return JSON.stringify(view.sorted()) === JSON.stringify(fresh);
}

interface DrainResult {
  events: number;
  lastToken: Document | null;
}

/** drain a stream until idle, feeding each event to `onEvent` */
async function drainStream(
  stream: SubStream,
  onEvent: (ev: ChangeStreamDocument<Sub>) => void
): Promise<DrainResult> {
  let events = 0;
  let lastToken: Document | null = null;
  for (;;) {
    const ev = await stream.tryNext();
    if (ev === null) break;
    onEvent(ev);
    lastToken = ev._id as Document;
    events++;
  }
  return { events, lastToken };
}

/* the three server-side $match shapes under test (scenario 2) */
const PRED = { plan: "pro" } as const satisfies Filter<Sub>;
const isPro = (d: Sub): boolean => d.plan === "pro";

/** (a) naive: predicate on the post-image only — WRONG, proven below */
const naivePipeline: Document[] = [{ $match: { "fullDocument.plan": "pro" } }];

/** (b) pre-images: predicate on post-image OR before-image — exact */
const preImagePipeline: Document[] = [
  {
    $match: {
      $or: [
        { "fullDocument.plan": "pro" },
        { "fullDocumentBeforeChange.plan": "pro" },
      ],
    },
  },
];

/**
 * (c) passthrough: inserts/replaces filtered server-side; updates and
 * deletes always delivered, membership resolved client-side by the view.
 */
const passthroughPipeline: Document[] = [
  {
    $match: {
      $or: [
        { operationType: { $in: ["update", "delete"] } },
        { "fullDocument.plan": "pro" },
      ],
    },
  },
];

const seedSubs = (ids: [string, Sub["plan"]][]): Sub[] =>
  ids.map(([id, plan]) => ({ _id: id, plan, name: `sub ${id}`, v: 1 }));

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("starting MongoMemoryReplSet (1 node)...");
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replSet.getUri());
  await client.connect();
  const db: Db = client.db("app");
  const buildInfo = await db.admin().command({ buildInfo: 1 });
  console.log(`mongod ${String(buildInfo.version)}`);

  try {
    /* ---------------------------------------------------------------- */
    console.log(
      "\n[1] live-query cutover: operationTime BEFORE the initial filtered query (EPIC-J recipe)"
    );
    /* ---------------------------------------------------------------- */
    const live = db.collection<Sub>("live");
    await live.insertMany(
      seedSubs([
        ["u1", "pro"],
        ["u2", "pro"],
        ["u3", "pro"],
        ["u4", "free"],
        ["u5", "free"],
        ["u6", "free"],
      ])
    );

    const view1 = new LiveView(isPro);
    const t0 = await operationTime(client); // BEFORE the snapshot — the crux
    // initial query with a small-batch cursor, racing writes mid-cursor
    let copied = 0;
    const cursor = live.find(PRED).sort({ _id: 1 }).batchSize(1);
    for await (const doc of cursor) {
      view1.docs.set(doc._id, doc);
      copied++;
      if (copied === 1) {
        // land while the cursor is mid-result-set:
        await live.updateOne({ _id: "u1" }, { $inc: { v: 1 } }); // behind cursor → stale in view
        await live.updateOne({ _id: "u4" }, { $set: { plan: "pro" } }); // enters the set mid-query
        await live.insertOne({ _id: "u7", name: "sub u7", plan: "pro", v: 1 });
        await live.deleteOne({ _id: "u3" }); // member deleted mid-query
      }
    }
    console.log(
      `  initial query returned ${String(copied)} docs with racing writes`
    );
    const stale = viewEqualsQuery(view1, await freshQuery(live, PRED));
    check(
      !stale,
      "initial query alone is stale (race is real: u1 update landed behind the cursor)"
    );

    const s1: SubStream = live.watch(passthroughPipeline, {
      fullDocument: "updateLookup",
      startAtOperationTime: t0,
      maxAwaitTimeMS: 250,
    });
    const d1 = await drainStream(s1, (ev) => view1.apply(ev));
    console.log(
      `  stream replayed ${String(d1.events)} events from the pre-query operationTime`
    );
    check(
      viewEqualsQuery(view1, await freshQuery(live, PRED)),
      "live view == fresh query after snapshot + stream cutover (converged at quiescence)"
    );
    check(
      d1.events >= 4,
      "startAtOperationTime replays across the query boundary (inclusive, at-least-once ⇒ idempotent apply mandatory)"
    );
    await s1.close();

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[2] membership: can change events alone detect leave-the-set?"
    );
    /* ---------------------------------------------------------------- */
    // the standard mutation script for all three shapes:
    //   p1 pro→free (LEAVE) | p2 deleted (member DELETE)
    //   f1 free→pro (ENTER) | f2 $inc v  (non-member NOISE)
    const script = async (c: Collection<Sub>): Promise<void> => {
      await c.updateOne({ _id: "p1" }, { $set: { plan: "free" } });
      await c.deleteOne({ _id: "p2" });
      await c.updateOne({ _id: "f1" }, { $set: { plan: "pro" } });
      await c.updateOne({ _id: "f2" }, { $inc: { v: 1 } });
    };
    const seed4 = seedSubs([
      ["p1", "pro"],
      ["p2", "pro"],
      ["f1", "free"],
      ["f2", "free"],
    ]);

    /* (a) naive: $match on fullDocument predicate only */
    console.log("  (a) naive server filter: fullDocument predicate only");
    const mNaive = db.collection<Sub>("m_naive");
    await mNaive.insertMany(seed4);
    const viewA = new LiveView(isPro);
    viewA.seed(await freshQuery(mNaive, PRED));
    const tA = await operationTime(client);
    await script(mNaive);
    const sA: SubStream = mNaive.watch(naivePipeline, {
      fullDocument: "updateLookup",
      startAtOperationTime: tA,
      maxAwaitTimeMS: 250,
    });
    const dA = await drainStream(sA, (ev) => viewA.apply(ev));
    await sA.close();
    const freshA = await freshQuery(mNaive, PRED);
    console.log(
      `    delivered ${String(dA.events)} event(s); view has ${String(viewA.docs.size)} docs, fresh query has ${String(freshA.length)}`
    );
    check(
      dA.events === 1 && !viewEqualsQuery(viewA, freshA),
      "naive post-image-only filter SILENTLY DROPS leave-updates and deletes → stale view (only the enter event arrived)"
    );
    check(
      viewA.docs.has("p1") && viewA.docs.has("p2"),
      "the stale docs are exactly the leave (p1) and the delete (p2) — deletes carry no fullDocument at all"
    );

    /* (b) pre-images enabled: $or over post- and before-image */
    console.log(
      "  (b) pre-images (collMod changeStreamPreAndPostImages) + $or before/after predicate"
    );
    const mPre = db.collection<Sub>("m_pre");
    await mPre.insertMany(seed4);
    await db.command({
      collMod: "m_pre",
      changeStreamPreAndPostImages: { enabled: true },
    });
    const viewB = new LiveView(isPro);
    viewB.seed(await freshQuery(mPre, PRED));
    const tB = await operationTime(client);
    await script(mPre);
    const sB: SubStream = mPre.watch(preImagePipeline, {
      fullDocument: "updateLookup",
      fullDocumentBeforeChange: "whenAvailable",
      startAtOperationTime: tB,
      maxAwaitTimeMS: 250,
    });
    let deleteHadBeforeImage = false;
    const dB = await drainStream(sB, (ev) => {
      if (ev.operationType === "delete" && ev.fullDocumentBeforeChange) {
        deleteHadBeforeImage = true;
      }
      viewB.apply(ev);
    });
    await sB.close();
    console.log(
      `    delivered ${String(dB.events)} event(s) (noise update filtered server-side)`
    );
    check(
      dB.events === 3,
      "pre-image $or delivers exactly enter+leave+member-delete and drops non-member noise — exact server-side filtering"
    );
    check(
      deleteHadBeforeImage,
      "delete events DO carry fullDocumentBeforeChange once pre-images are enabled"
    );
    check(
      viewEqualsQuery(viewB, await freshQuery(mPre, PRED)),
      "view converged with pre-image filtering"
    );

    /* (c) passthrough: no pre-images, membership resolved by the view */
    console.log(
      "  (c) passthrough: updates/deletes always delivered; view is the membership map"
    );
    const mPass = db.collection<Sub>("m_pass");
    await mPass.insertMany(seed4);
    const viewC = new LiveView(isPro);
    viewC.seed(await freshQuery(mPass, PRED));
    const tC = await operationTime(client);
    await script(mPass);
    const sC: SubStream = mPass.watch(passthroughPipeline, {
      fullDocument: "updateLookup",
      startAtOperationTime: tC,
      maxAwaitTimeMS: 250,
    });
    const dC = await drainStream(sC, (ev) => viewC.apply(ev));
    await sC.close();
    console.log(
      `    delivered ${String(dC.events)} event(s) (incl. non-member noise — the cost of no pre-images)`
    );
    check(
      viewEqualsQuery(viewC, await freshQuery(mPass, PRED)),
      "passthrough + updateLookup converges WITHOUT pre-images and WITHOUT a separate membership map (idempotent remove)"
    );
    check(
      dC.events === 4 && dC.events > dB.events,
      "passthrough delivers strictly more events than the pre-image shape (noise passes) — pre-images are an optimization, not a correctness requirement"
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[3] fan-out: 1 shared stream + in-process dispatch vs N=8 server-side-filtered streams"
    );
    /* ---------------------------------------------------------------- */
    const fan = db.collection<FanDoc>("fan");
    const N = 8;
    const OPS = 240;

    const cursorsOpen = async (): Promise<number> => {
      const ss = await client.db("admin").command({ serverStatus: 1 });
      const metrics = ss.metrics as {
        cursor: { open: { total: number | { toString(): string } } };
      };
      return Number(metrics.cursor.open.total.toString());
    };

    // FINDING (cost a first run 0 events): driver change streams are LAZY —
    // no server cursor exists until the first next()/tryNext(). "Opened"
    // streams that first read after the writes start at "now" and miss them.
    // Anchor every fan-out stream at an explicit operationTime instead.
    const tFan = await operationTime(client);
    await fan.insertMany(
      Array.from({ length: OPS }, (_, i) => ({
        _id: `d${String(i)}`,
        k: i % N,
      }))
    );

    // shape A: ONE shared stream, dispatch to N predicates in-process
    const base0 = await cursorsOpen();
    const shared = fan.watch([], {
      startAtOperationTime: tFan,
      maxAwaitTimeMS: 50,
    });
    const countsA = new Array<number>(N).fill(0);
    const a0 = Date.now();
    let sharedEvents = 0;
    for (;;) {
      const ev = await shared.tryNext();
      if (ev === null) break;
      sharedEvents++;
      if (ev.operationType === "insert") {
        const k = ev.fullDocument.k;
        countsA[k] = (countsA[k] ?? 0) + 1;
      }
    }
    const aMs = Date.now() - a0;
    const sharedCursors = (await cursorsOpen()) - base0;
    const sharedToken = shared.resumeToken as Document;
    await shared.close();

    // shape B: N server-side-filtered streams (drained sequentially; each
    // pays its own getMore round-trips plus one idle getMore ≈ maxAwaitTimeMS)
    const base1 = await cursorsOpen();
    const perSub = Array.from({ length: N }, (_, i) =>
      fan.watch([{ $match: { "fullDocument.k": i } }], {
        startAtOperationTime: tFan,
        maxAwaitTimeMS: 50,
      })
    );
    const countsB = new Array<number>(N).fill(0);
    const b0 = Date.now();
    let perSubEvents = 0;
    for (let i = 0; i < N; i++) {
      const s = perSub[i];
      if (!s) continue;
      for (;;) {
        const ev = await s.tryNext();
        if (ev === null) break;
        perSubEvents++;
        countsB[i] = (countsB[i] ?? 0) + 1;
      }
    }
    const bMs = Date.now() - b0;
    const perSubCursors = (await cursorsOpen()) - base1;
    for (const s of perSub) await s.close();

    console.log(
      `  server cursors: shared shape ${String(sharedCursors)}, per-subscriber shape ${String(perSubCursors)} (each an independent oplog-scanning cursor)`
    );
    console.log(
      `  shape A (shared): ${String(sharedEvents)} events → ${String(N)} views in ${String(aMs)}ms; ONE resume token for all subscribers (present: ${String(sharedToken !== null && sharedToken !== undefined)})`
    );
    console.log(
      `  shape B (per-sub): ${String(perSubEvents)} events across ${String(N)} streams in ${String(bMs)}ms (incl. ${String(N)} idle getMores ≈ ${String(N * 50)}ms floor); N independent resume tokens`
    );
    check(
      countsA.every((c) => c === OPS / N) &&
        countsB.every((c) => c === OPS / N),
      `both shapes deliver the same per-subscriber result (${String(OPS / N)} events each)`
    );
    check(
      sharedEvents === OPS && perSubEvents === OPS,
      "shared shape transfers each event once over one cursor; per-sub shape re-reads the same oplog range once per cursor"
    );
    check(
      sharedCursors === 1 && perSubCursors === N,
      `server-side cursor cost is 1 vs N=${String(N)} (serverStatus metrics.cursor.open.total)`
    );
    check(
      aMs < bMs,
      `shared-stream dispatch drains faster than N server-filtered streams even at N=${String(N)} on localhost (${String(aMs)}ms < ${String(bMs)}ms)`
    );

    /* ---------------------------------------------------------------- */
    console.log(
      "\n[4] resume: drop the view's stream, mutate offline, resumeAfter token — no re-query"
    );
    /* ---------------------------------------------------------------- */
    // continue scenario 2c's view and its saved token
    check(
      dC.lastToken !== null,
      "scenario 2c saved a resume token with its last applied event"
    );
    // offline mutations, including membership changes the naive shape would lose
    await mPass.insertOne({ _id: "p3", name: "sub p3", plan: "pro", v: 1 });
    await mPass.updateOne({ _id: "f2" }, { $set: { plan: "pro" } }); // enter
    await mPass.updateOne({ _id: "f1" }, { $set: { plan: "free" } }); // leave (was pro after [2c])
    await mPass.updateOne({ _id: "p3" }, { $inc: { v: 4 } }); // member update

    const sR: SubStream = mPass.watch(passthroughPipeline, {
      fullDocument: "updateLookup",
      resumeAfter: dC.lastToken ?? undefined,
      maxAwaitTimeMS: 250,
    });
    const dR = await drainStream(sR, (ev) => viewC.apply(ev));
    await sR.close();
    console.log(
      `  resumed drain: ${String(dR.events)} events applied to the retained view`
    );
    check(
      dR.events >= 4,
      "offline events (insert, enter, leave, member update) were all replayed after resumeAfter"
    );
    check(
      viewEqualsQuery(viewC, await freshQuery(mPass, PRED)),
      "view reconverged from the resume token alone — NO initial re-query needed while the token resumes cleanly"
    );
    console.log(
      "  (re-query remains the fallback for the EPIC-J failure taxonomy: codes 286/280/50811 or liveness-watchdog timeout)"
    );

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
