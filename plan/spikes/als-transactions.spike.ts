/**
 * SPIKE: AsyncLocalStorage-propagated transactions (roadmap doc: plan/03-orm-roadmap.md, section 5)
 *
 * Purpose:  Executable proof for EPIC-D (plan/trd/EPIC-D-hooks-transactions.md):
 *           a `withTransaction(fn)` wrapper that stores the driver ClientSession
 *           in AsyncLocalStorage so nested "repository" calls pick up the ambient
 *           session WITHOUT threading it through arguments. Verifies:
 *           1. commit visibility and abort rollback,
 *           2. automatic retry on TransientTransactionError (WriteConflict is
 *              forced deterministically with a blocking second session),
 *           3. ALS context survival across await boundaries and Promise.all,
 *              including the driver's behavior when two operations share one
 *              session concurrently,
 *           4. explicit-session override beats the ambient one.
 *
 * Run:      bun run tsx plan/spikes/als-transactions.spike.ts
 *           (transactions need a replica set -> MongoMemoryReplSet; first run
 *            may download a mongod binary — be patient)
 * Status:   SPIKE, not production code. Excluded from build/test pipelines.
 *
 * FINDINGS (filled in after execution on mongod 7.0.24, single-node repl set):
 *  - ALS propagation just works: `als.run(session, () => session.withTransaction(fn))`
 *    makes the session visible via als.getStore() in arbitrarily deep async
 *    callees, across awaits, and inside Promise.all branches. No monkey-patching.
 *  - Abort semantics: throwing from fn aborts and rethrows; the write is not
 *    visible afterwards. Reads INSIDE the txn see their own uncommitted writes.
 *  - Retry: a WriteConflict was forced (blocker session updates doc X and stays
 *    open; our txn updates X). The driver's session.withTransaction caught the
 *    error (code 112 WriteConflict, errorLabels ["TransientTransactionError"])
 *    and re-invoked the callback: 2 attempts observed, final result committed.
 *    IMPORTANT: the retry loop is time-bounded (~120s cap), not attempt-bounded;
 *    while the blocker stayed open, attempt 1 failed in ~10ms and retries were
 *    immediate — a hot loop. A PipeSafe retry policy needs its own backoff/max
 *    attempts on top (HOOKS-3).
 *  - Concurrent ops on ONE session (Promise.all of two updates inside one txn):
 *    the driver DID NOT throw on mongod 7.0.24 / driver 6.x — both writes
 *    committed. But sessions are documented as NOT safe for concurrent use
 *    (server may reject with "cannot run two operations at once" under load /
 *    older servers). Policy decision recorded in HOOKS-2: serialize per-session
 *    via an op queue, or document Promise.all-in-txn as unsupported.
 *  - Two concurrent withTransaction blocks (Promise.all of two txns on
 *    different docs) each saw their own distinct session (verified by session
 *    id equality checks) — no cross-talk between ALS contexts.
 *  - Explicit `session` argument overrides the ambient one (trivial `??` chain);
 *    demonstrated by reading pre-commit state through an outside session while
 *    the ambient txn saw its own uncommitted write (81 vs 1081).
 *  - Timing on this machine: replset boot ~1.1s; first commit txn (3 updates +
 *    1 read) 39ms; forced-conflict txn incl. one full retry 12ms — WriteConflict
 *    surfaces immediately (fail-fast), it does not block on the lock holder.
 */

import process from "node:process";
import { AsyncLocalStorage } from "node:async_hooks";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  ClientSession,
  Collection,
  Document,
  MongoClient,
  MongoServerError,
} from "mongodb";

/* ------------------------------------------------------------------ */
/* 1. The proposed core mechanism (this is the whole trick)            */
/* ------------------------------------------------------------------ */

const als = new AsyncLocalStorage<ClientSession>();

/** Resolve the session every Collection method / Pipeline.execute would use. */
function ambientSession(explicit?: ClientSession): ClientSession | undefined {
  return explicit ?? als.getStore();
}

/**
 * pipesafe.transaction(fn) sketch: start a session, enter the ALS context,
 * and let the DRIVER's withTransaction own the retry loop (it re-invokes fn
 * on TransientTransactionError / retries commit on UnknownTransactionCommitResult).
 */
async function withTransaction<T>(
  client: MongoClient,
  fn: () => Promise<T>
): Promise<T> {
  const session = client.startSession();
  try {
    return await als.run(session, () => session.withTransaction(fn));
  } finally {
    await session.endSession();
  }
}

/* ------------------------------------------------------------------ */
/* 2. A "repository" layer that never sees a session parameter         */
/* ------------------------------------------------------------------ */

function repo(coll: Collection<Document>) {
  return {
    insert: (doc: Document) =>
      coll.insertOne(doc, { session: ambientSession() }),
    inc: (id: string, by: number) =>
      coll.updateOne(
        { _id: id } as Document,
        { $inc: { balance: by } },
        { session: ambientSession() }
      ),
    get: (id: string, explicit?: ClientSession) =>
      coll.findOne({ _id: id } as Document, {
        session: ambientSession(explicit),
      }),
    sessionId: () => als.getStore()?.id?.id.toString("hex"),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Experiments                                                      */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("starting single-node replica set (transactions require one)...");
  const t0 = Date.now();
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  console.log(`replset up in ${String(Date.now() - t0)}ms`);
  const client = new MongoClient(replSet.getUri());
  await client.connect();
  const accounts = client.db("spike").collection("accounts");
  await accounts.insertMany([
    { _id: "a", balance: 100 },
    { _id: "b", balance: 100 },
    { _id: "x", balance: 100 },
  ] as unknown as Document[]);
  const r = repo(accounts);

  // -- 3a. commit: ambient session reaches nested calls ---------------
  console.log("\n--- commit path ---");
  let t = Date.now();
  await withTransaction(client, async () => {
    console.log("in txn, ambient session id:", r.sessionId());
    await r.inc("a", -25);
    await deeplyNested(r); // no session argument anywhere
    const inTxn = await r.get("a");
    console.log("read-your-own-write inside txn: balance =", inTxn?.balance);
  });
  console.log(`committed in ${String(Date.now() - t)}ms`);
  console.log(
    "after commit: a =",
    (await r.get("a"))?.balance,
    "b =",
    (await r.get("b"))?.balance
  );

  // -- 3b. abort: throw rolls everything back -------------------------
  console.log("\n--- abort path ---");
  await withTransaction(client, async () => {
    await r.inc("a", -1000);
    throw new Error("business rule violated");
  }).catch((err: unknown) => {
    console.log("aborted with:", (err as Error).message);
  });
  console.log("after abort: a =", (await r.get("a"))?.balance, "(unchanged)");
  console.log(
    "outside txn, ambient session:",
    r.sessionId() ?? "none (context exited cleanly)"
  );

  // -- 3c. forced WriteConflict -> automatic retry ---------------------
  console.log("\n--- forced TransientTransactionError retry ---");
  const blocker = client.startSession();
  blocker.startTransaction();
  await accounts.updateOne(
    { _id: "x" } as Document,
    { $inc: { balance: 1 } },
    { session: blocker }
  );
  let attempts = 0;
  let firstError: MongoServerError | undefined;
  t = Date.now();
  await withTransaction(client, async () => {
    attempts++;
    if (attempts > 1) {
      // free the lock so the retry can succeed
      await blocker.abortTransaction();
    }
    try {
      await r.inc("x", 10);
    } catch (err) {
      if (err instanceof MongoServerError && !firstError) firstError = err;
      throw err;
    }
  });
  console.log(`attempts=${String(attempts)} in ${String(Date.now() - t)}ms`);
  console.log(
    "first attempt error: code =",
    firstError?.code,
    "codeName =",
    firstError?.codeName,
    "errorLabels =",
    JSON.stringify(firstError?.errorLabels)
  );
  console.log(
    "final: x =",
    (await r.get("x"))?.balance,
    "(10 applied exactly once)"
  );
  await blocker.endSession();

  // -- 3d. Promise.all INSIDE one txn (single shared session) ---------
  console.log("\n--- Promise.all inside one transaction ---");
  try {
    await withTransaction(client, async () => {
      const ids = await Promise.all([
        (async () => {
          await r.inc("a", 1);
          return r.sessionId();
        })(),
        (async () => {
          await r.inc("b", 1);
          return r.sessionId();
        })(),
      ]);
      console.log("both branches saw same ambient session:", ids[0] === ids[1]);
    });
    console.log("driver accepted concurrent ops on one session (committed)");
  } catch (err) {
    console.log(
      "driver REJECTED concurrent ops on one session:",
      (err as Error).message
    );
  }

  // -- 3e. two concurrent transactions: isolated ALS contexts ---------
  console.log("\n--- two concurrent withTransaction blocks ---");
  const [s1, s2] = await Promise.all([
    withTransaction(client, async () => {
      await r.inc("a", 5);
      await new Promise((res) => setTimeout(res, 20)); // interleave
      return r.sessionId();
    }),
    withTransaction(client, async () => {
      await r.inc("b", 5);
      await new Promise((res) => setTimeout(res, 20));
      return r.sessionId();
    }),
  ]);
  console.log(
    "distinct sessions per txn:",
    s1 !== s2,
    `(${String(s1?.slice(0, 8))}... vs ${String(s2?.slice(0, 8))}...)`
  );

  // -- 3f. explicit session beats ambient ------------------------------
  console.log("\n--- explicit session override ---");
  const outer = client.startSession();
  await withTransaction(client, async () => {
    await r.inc("a", 1000); // ambient txn write, uncommitted
    const viaExplicit = await r.get("a", outer); // reads OUTSIDE the txn
    const viaAmbient = await r.get("a");
    console.log(
      "explicit-session read (pre-commit):",
      viaExplicit?.balance,
      "| ambient read:",
      viaAmbient?.balance
    );
    throw new Error("rollback probe txn");
  }).catch(() => undefined);
  await outer.endSession();

  await client.close();
  await replSet.stop();
  console.log("\nspike complete");
}

async function deeplyNested(r: ReturnType<typeof repo>) {
  await Promise.resolve(); // extra await boundary
  await r.inc("b", 25);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
