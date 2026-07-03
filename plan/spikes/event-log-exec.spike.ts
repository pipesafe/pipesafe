/**
 * SPIKE (EXECUTED): `_manifold` event log + node-granular ready-queue executor.
 *
 * Purpose: empirically validate the P0 design in
 * plan/05-orchestration-and-el-roadmap.md (§2 run-state & event log, §3
 * execution semantics, §4 staleness) ahead of the EPIC-G TRD
 * (plan/trd/EPIC-G-event-log-executor.md). This is a runnable refinement of
 * the illustrative sketch plan/spikes/run-event-log.spike.ts (NOT modified);
 * divergences are recorded in the TRD's "Spike findings".
 *
 * How to run (repo root):
 *   bun run tsx plan/spikes/event-log-exec.spike.ts
 * First run may download a mongod binary (mongodb-memory-server ^10).
 * Uses MongoMemoryReplSet — transactions require a replica set.
 *
 * What it verifies:
 *   A. Monotonic per-run `seq` assignment under concurrent writers:
 *      findOneAndUpdate counter vs client timestamps (collision count) vs
 *      $natural read-back — measured, one approach picked.
 *   B. Transactional event+summary write vs non-transactional
 *      (event-append first, idempotent summary upsert second) — overhead
 *      measured; answers "is the transaction actually needed?".
 *   C. Ready-queue executor over a 9-node DAG (with real $lookup/$unionWith
 *      edges): bounded parallelism, per-node retry with exponential backoff,
 *      failure -> transitive skip propagation, mid-run crash (in-process
 *      state abandoned, DB kept), then resumeFrom(runId) rebuilt purely from
 *      the event log. Final event sequences printed.
 *   D. Staleness derivation: isStale() as a query over summaries + a live
 *      watermark probe; one worked example.
 *
 * Status: EXECUTED 2026-07-03 against mongodb-memory-server 10.x.
 * Findings summary (details + pasted output in the TRD):
 *   - Counter-based seq: 400/400 unique AND gapless per run under 8
 *     concurrent writers across 4 clients (~650 ev/s in-memory; the counter
 *     costs one extra round trip, ~2x vs bare inserts). Client timestamps:
 *     ~53% of events shared a ms-granularity ts — unusable as an ordering
 *     key. $natural order had 85-94 inversions vs counter-acquisition order
 *     (acquire-then-insert race) and is not a resumable key. PICK: counter.
 *   - SURPRISE: withTransaction(insert+upsert) measured ~0.86x of two plain
 *     acknowledged writes on a 1-node replset (single commit ack beats two
 *     write acks) — the transaction is affordable, but NOT required for
 *     correctness: append event first, then idempotent summary upsert; a
 *     crash between the two leaves a stale summary that is (a) rebuildable
 *     from events and (b) fails safe (model re-runs; materialization is
 *     idempotent). PICK: non-transactional event-first, because it also
 *     works on standalone mongod (transactions require a replset) and
 *     avoids TransientTransactionError handling. This refines plan/05 §2's
 *     "updated in the same transaction" line.
 *   - The sketch's skip propagation has a real bug: it deletes the skipped
 *     child from grandchildren's remaining-deps, which RELEASES grandchildren
 *     to run despite a failed ancestor. This spike uses explicit BFS skip.
 *   - Crash + resumeFrom works: resumed run skipped 4 materialized models,
 *     re-ran failed/skipped/in-flight ones, log reads coherently (a crashed
 *     run is simply a run with no run_finished event).
 */

import { createHash } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Collection, type Document } from "mongodb";

/* ================================================================== */
/* Event model (refined from run-event-log.spike.ts — adds `seq`)      */
/* ================================================================== */

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type InputFingerprint =
  | { kind: "watermark"; field: string; value: JsonValue }
  | { kind: "resumeToken"; token: JsonValue };

interface EventBase {
  runId: string;
  /** Per-run monotonic sequence from a counter doc — THE ordering key. */
  seq: number;
  ts: Date;
}

export type SkipReason =
  | { kind: "upstream_failed"; cause: string }
  | { kind: "not_stale" }
  | { kind: "resume_already_materialized"; sourceRunId: string };

export type ManifoldEvent =
  | (EventBase & {
      type: "run_started";
      selection: string[];
      resumeFrom?: string;
      invocationArgs: JsonValue;
      manifoldVersion: string;
    })
  | (EventBase & { type: "model_started"; model: string; attempt: number })
  | (EventBase & {
      type: "model_materialized";
      model: string;
      attempt: number;
      pipelineHash: string;
      docsWritten: number;
      durationMs: number;
      inputFingerprints: Record<string, InputFingerprint>;
      materialization: "view" | "$out" | "$merge";
    })
  | (EventBase & {
      type: "model_failed";
      model: string;
      attempt: number;
      error: string;
      willRetry: boolean;
      durationMs: number;
    })
  | (EventBase & { type: "model_skipped"; model: string; reason: SkipReason })
  | (EventBase & {
      type: "run_finished";
      status: "success" | "failed" | "partial";
      durationMs: number;
    });

export interface ModelSummary {
  _id: string; // model name
  lastMaterialization: {
    runId: string;
    ts: Date;
    pipelineHash: string;
    inputFingerprints: Record<string, InputFingerprint>;
  } | null;
  lastStatus: "materialized" | "failed" | "skipped";
  updatedAt: Date;
}

/* ================================================================== */
/* Storage layer                                                       */
/* ================================================================== */

class EventLog {
  readonly events: Collection<ManifoldEvent>;
  readonly models: Collection<ModelSummary>;
  private readonly counters: Collection<{ _id: string; seq: number }>;

  constructor(private readonly client: MongoClient) {
    const db = client.db("_manifold");
    this.events = db.collection<ManifoldEvent>("events");
    this.models = db.collection<ModelSummary>("models");
    this.counters = db.collection<{ _id: string; seq: number }>("counters");
  }

  async ensureIndexes(): Promise<void> {
    await this.events.createIndex({ runId: 1, seq: 1 }, { unique: true });
    await this.events.createIndex({ model: 1, ts: -1 });
    await this.events.createIndex({ type: 1, ts: -1 });
  }

  /** Monotonic per-run seq via findOneAndUpdate counter (approach A1). */
  async nextSeq(runId: string): Promise<number> {
    const doc = await this.counters.findOneAndUpdate(
      { _id: runId },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
    if (!doc) throw new Error("counter upsert returned null");
    return doc.seq;
  }

  async append(
    e: Omit<ManifoldEvent, "seq" | "ts"> & { ts?: Date }
  ): Promise<ManifoldEvent> {
    const seq = await this.nextSeq(e.runId);
    const full = { ...e, seq, ts: e.ts ?? new Date() } as ManifoldEvent;
    await this.events.insertOne(full);
    return full;
  }

  /**
   * Event-first, then idempotent summary upsert. NOT transactional — see
   * experiment B: a crash between the two writes leaves the summary stale,
   * which fails safe (staleness/resume re-run the model; materialization is
   * idempotent) and is rebuildable from the event log.
   */
  async recordMaterialized(
    e: Extract<ManifoldEvent, { type: "model_materialized" }>
  ): Promise<void> {
    await this.models.updateOne(
      { _id: e.model },
      {
        $set: {
          lastMaterialization: {
            runId: e.runId,
            ts: e.ts,
            pipelineHash: e.pipelineHash,
            inputFingerprints: e.inputFingerprints,
          },
          lastStatus: "materialized" as const,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  async runEvents(runId: string): Promise<ManifoldEvent[]> {
    return this.events.find({ runId }).sort({ seq: 1 }).toArray();
  }
}

/* ================================================================== */
/* Pipeline hash (canonical JSON, stable key order)                    */
/* ================================================================== */

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(v);
}

function pipelineHash(stages: Document[]): string {
  return createHash("sha256")
    .update(stableStringify(stages))
    .digest("hex")
    .slice(0, 12);
}

/* ================================================================== */
/* Toy DAG — 9 nodes, with real $lookup and $unionWith edges           */
/* ================================================================== */

interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  factor: number;
}

interface NodeSpec {
  name: string;
  /** ALL deps: `from` + lookup/unionWith edges (doc 01 §5 graph fix). */
  deps: string[];
  sourceCollection: string;
  stages: Document[];
  retry?: RetryPolicy;
  /** raw source collections to fingerprint at read time */
  fingerprintSources?: { collection: string; field: string }[];
}

const ANALYTICS = "analytics";

function mergeStage(into: string): Document {
  return {
    $merge: {
      into,
      on: "_id",
      whenMatched: "replace",
      whenNotMatched: "insert",
    },
  };
}

const DAG: NodeSpec[] = [
  {
    name: "stg_events",
    deps: [],
    sourceCollection: "events_raw",
    stages: [{ $match: {} }],
    fingerprintSources: [{ collection: "events_raw", field: "updatedAt" }],
  },
  {
    name: "stg_users",
    deps: [],
    sourceCollection: "users_raw",
    stages: [{ $match: {} }],
    fingerprintSources: [{ collection: "users_raw", field: "updatedAt" }],
  },
  {
    name: "stg_orders",
    deps: [],
    sourceCollection: "orders_raw",
    stages: [{ $match: {} }],
    fingerprintSources: [{ collection: "orders_raw", field: "updatedAt" }],
  },
  {
    // lookup-style edge: depends on stg_users via $lookup, NOT via `from`
    name: "enriched_events",
    deps: ["stg_events", "stg_users"],
    sourceCollection: "stg_events",
    stages: [
      {
        $lookup: {
          from: "stg_users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
    ],
    retry: { maxAttempts: 2, backoffMs: 30, factor: 2 },
  },
  {
    name: "order_facts",
    deps: ["stg_orders", "stg_users"], // stg_users is a lookup edge
    sourceCollection: "stg_orders",
    stages: [
      {
        $lookup: {
          from: "stg_users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
    ],
    retry: { maxAttempts: 3, backoffMs: 25, factor: 2 },
  },
  {
    name: "daily_metrics",
    deps: ["enriched_events"],
    sourceCollection: "enriched_events",
    stages: [{ $match: {} }],
  },
  {
    name: "user_ltv",
    deps: ["order_facts", "enriched_events"], // enriched_events = lookup edge
    sourceCollection: "order_facts",
    stages: [
      {
        $lookup: {
          from: "enriched_events",
          localField: "userId",
          foreignField: "userId",
          as: "events",
        },
      },
    ],
  },
  {
    name: "dashboard_summary",
    deps: ["daily_metrics", "user_ltv"], // user_ltv = unionWith edge
    sourceCollection: "daily_metrics",
    stages: [{ $unionWith: { coll: "user_ltv" } }, { $set: { unioned: true } }],
  },
  {
    name: "audit_log",
    deps: ["stg_events"],
    sourceCollection: "stg_events",
    stages: [{ $set: { audited: true } }],
  },
];

/* ================================================================== */
/* Ready-queue executor (replaces Project.ts level-based staging)      */
/* ================================================================== */

type NodeStatus = "succeeded" | "failed" | "skipped";

interface Chaos {
  /** model -> number of attempts to fail before succeeding (Infinity = always) */
  failAttempts?: Map<string, number>;
  /** models whose execute hangs forever (crash simulation) */
  hang?: Set<string>;
}

interface RunOutcome {
  statuses: Map<string, NodeStatus>;
  status: "success" | "failed" | "partial";
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 1, backoffMs: 0, factor: 1 };

function topoDepths(nodes: NodeSpec[]): Map<string, number> {
  const depth = new Map<string, number>();
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const visit = (n: NodeSpec): number => {
    const cached = depth.get(n.name);
    if (cached !== undefined) return cached;
    const d =
      n.deps.length === 0 ?
        0
      : 1 + Math.max(...n.deps.map((dep) => visit(byName.get(dep)!)));
    depth.set(n.name, d);
    return d;
  };
  nodes.forEach(visit);
  return depth;
}

async function executeRun(opts: {
  client: MongoClient;
  log: EventLog;
  runId: string;
  nodes: NodeSpec[];
  maxParallel: number;
  resumeFrom?: string;
  chaos?: Chaos;
}): Promise<RunOutcome> {
  const { client, log, runId, nodes, maxParallel, resumeFrom, chaos } = opts;
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const depths = topoDepths(nodes);
  const statuses = new Map<string, NodeStatus>();

  await log.append({
    type: "run_started",
    runId,
    selection: nodes.map((n) => n.name),
    ...(resumeFrom !== undefined ? { resumeFrom } : {}),
    invocationArgs: { maxParallel, resumeFrom: resumeFrom ?? null },
    manifoldVersion: "spike",
  });

  // -------- resume: skip models materialized in prior run w/ same hash ----
  const preDone = new Set<string>();
  if (resumeFrom !== undefined) {
    const prior = await log.runEvents(resumeFrom);
    for (const e of prior) {
      if (
        e.type === "model_materialized" &&
        byName.has(e.model) &&
        pipelineHash(byName.get(e.model)!.stages) === e.pipelineHash
      ) {
        preDone.add(e.model);
      }
    }
    for (const m of preDone) {
      statuses.set(m, "succeeded");
      await log.append({
        type: "model_skipped",
        runId,
        model: m,
        reason: {
          kind: "resume_already_materialized",
          sourceRunId: resumeFrom,
        },
      });
    }
  }

  // -------- in-degree tracking over remaining nodes -----------------------
  const remaining = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const n of nodes) {
    if (preDone.has(n.name)) continue;
    remaining.set(n.name, new Set(n.deps.filter((d) => !preDone.has(d))));
    for (const d of n.deps) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d)!.push(n.name);
    }
  }

  const ready: string[] = [...remaining.entries()]
    .filter(([, deps]) => deps.size === 0)
    .map(([n]) => n);
  const scheduled = new Set<string>(ready);
  let inFlight = 0;

  const pushReady = (name: string): void => {
    ready.push(name);
    ready.sort((a, b) => depths.get(a)! - depths.get(b)!); // dbt: shallowest first
    scheduled.add(name);
  };

  // BFS transitive skip (fixes the release-grandchildren bug in the sketch)
  const skipTransitively = async (cause: string): Promise<void> => {
    const queue = [...(dependents.get(cause) ?? [])];
    while (queue.length > 0) {
      const m = queue.shift()!;
      if (statuses.has(m) || !remaining.has(m)) continue;
      statuses.set(m, "skipped");
      remaining.delete(m);
      const idx = ready.indexOf(m);
      if (idx >= 0) ready.splice(idx, 1);
      await log.append({
        type: "model_skipped",
        runId,
        model: m,
        reason: { kind: "upstream_failed", cause },
      });
      queue.push(...(dependents.get(m) ?? []));
    }
  };

  const materialize = async (
    node: NodeSpec
  ): Promise<{
    docsWritten: number;
    fingerprints: Record<string, InputFingerprint>;
  }> => {
    if (chaos?.hang?.has(node.name)) {
      await new Promise<never>(() => undefined); // crash sim: never resolves
    }
    const failLeft = chaos?.failAttempts?.get(node.name) ?? 0;
    if (failLeft > 0) {
      chaos!.failAttempts!.set(node.name, failLeft - 1);
      throw new Error(`injected failure (${node.name})`);
    }
    const db = client.db(ANALYTICS);
    // probe input fingerprints at read time (watermark probe, doc 05 §4)
    const fingerprints: Record<string, InputFingerprint> = {};
    for (const fs of node.fingerprintSources ?? []) {
      const [top] = await db
        .collection(fs.collection)
        .find()
        .sort({ [fs.field]: -1 })
        .limit(1)
        .toArray();
      fingerprints[fs.collection] = {
        kind: "watermark",
        field: fs.field,
        value: (top?.[fs.field] as Date | undefined)?.toISOString() ?? null,
      };
    }
    await db
      .collection(node.sourceCollection)
      .aggregate([...node.stages, mergeStage(node.name)])
      .toArray();
    const docsWritten = await db.collection(node.name).countDocuments();
    return { docsWritten, fingerprints };
  };

  const runWithRetry = async (node: NodeSpec): Promise<boolean> => {
    const retry = node.retry ?? DEFAULT_RETRY;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      await log.append({
        type: "model_started",
        runId,
        model: node.name,
        attempt,
      });
      const t0 = performance.now();
      try {
        const { docsWritten, fingerprints } = await materialize(node);
        const e = (await log.append({
          type: "model_materialized",
          runId,
          model: node.name,
          attempt,
          pipelineHash: pipelineHash(node.stages),
          docsWritten,
          durationMs: Math.round(performance.now() - t0),
          inputFingerprints: fingerprints,
          materialization: "$merge",
        })) as Extract<ManifoldEvent, { type: "model_materialized" }>;
        await log.recordMaterialized(e);
        return true;
      } catch (err) {
        const willRetry = attempt < retry.maxAttempts;
        await log.append({
          type: "model_failed",
          runId,
          model: node.name,
          attempt,
          error: String(err),
          willRetry,
          durationMs: Math.round(performance.now() - t0),
        });
        if (willRetry) {
          const delay = retry.backoffMs * retry.factor ** (attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    return false;
  };

  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (remaining.size === 0 && inFlight === 0) {
        resolve();
        return;
      }
      while (inFlight < maxParallel && ready.length > 0) {
        const name = ready.shift()!;
        const node = byName.get(name)!;
        remaining.delete(name);
        inFlight++;
        void runWithRetry(node).then(async (ok) => {
          inFlight--;
          statuses.set(name, ok ? "succeeded" : "failed");
          if (!ok) {
            await skipTransitively(name);
          } else {
            for (const child of dependents.get(name) ?? []) {
              const deps = remaining.get(child);
              if (!deps) continue;
              deps.delete(name);
              if (deps.size === 0 && !scheduled.has(child)) pushReady(child);
            }
          }
          pump();
        });
      }
    };
    pump();
  });

  const vals = [...statuses.values()];
  const status: RunOutcome["status"] =
    vals.every((s) => s === "succeeded") ? "success"
    : vals.some((s) => s === "succeeded") ? "partial"
    : "failed";
  await log.append({
    type: "run_finished",
    runId,
    status,
    durationMs: Math.round(performance.now() - t0),
  });
  return { statuses, status };
}

/* ================================================================== */
/* Staleness derivation                                                */
/* ================================================================== */

type StalenessVerdict =
  | {
      stale: true;
      reason:
        | "never_materialized"
        | "pipeline_changed"
        | "upstream_newer"
        | "source_has_new_data";
    }
  | { stale: false };

async function isStale(
  client: MongoClient,
  log: EventLog,
  node: NodeSpec
): Promise<StalenessVerdict> {
  const self = await log.models.findOne({ _id: node.name });
  const last = self?.lastMaterialization ?? null;
  if (!last) return { stale: true, reason: "never_materialized" };
  if (last.pipelineHash !== pipelineHash(node.stages))
    return { stale: true, reason: "pipeline_changed" };
  const upstream = await log.models.find({ _id: { $in: node.deps } }).toArray();
  for (const up of upstream) {
    if (up.lastMaterialization && up.lastMaterialization.ts > last.ts)
      return { stale: true, reason: "upstream_newer" };
  }
  for (const fs of node.fingerprintSources ?? []) {
    const [top] = await client
      .db(ANALYTICS)
      .collection(fs.collection)
      .find()
      .sort({ [fs.field]: -1 })
      .limit(1)
      .toArray();
    const current =
      (top?.[fs.field] as Date | undefined)?.toISOString() ?? null;
    const seen = last.inputFingerprints[fs.collection];
    if (!seen || seen.kind !== "watermark" || seen.value !== current)
      return { stale: true, reason: "source_has_new_data" };
  }
  return { stale: false };
}

/* ================================================================== */
/* Experiments                                                         */
/* ================================================================== */

function banner(s: string): void {
  console.log(`\n${"=".repeat(70)}\n${s}\n${"=".repeat(70)}`);
}

async function experimentSeq(uri: string, log: EventLog): Promise<void> {
  banner("A. Monotonic seq under concurrent writers (400 events)");
  const WRITERS = 8;
  const PER_WRITER = 50;
  const clients = await Promise.all(
    Array.from({ length: 4 }, () => new MongoClient(uri).connect())
  );
  const logs = clients.map((c) => new EventLog(c));

  // A1: findOneAndUpdate counter
  const runId = "seq-test";
  let t0 = performance.now();
  await Promise.all(
    Array.from({ length: WRITERS }, (_, w) =>
      (async () => {
        for (let i = 0; i < PER_WRITER; i++) {
          await logs[w % logs.length]!.append({
            type: "model_started",
            runId,
            model: `writer${w}`,
            attempt: i,
          });
        }
      })()
    )
  );
  const counterMs = performance.now() - t0;
  const seqs = (await log.runEvents(runId)).map((e) => e.seq);
  const unique = new Set(seqs).size;
  const gapless =
    unique === seqs.length &&
    Math.min(...seqs) === 1 &&
    Math.max(...seqs) === seqs.length;
  console.log(
    `A1 counter:    ${seqs.length} events in ${counterMs.toFixed(0)}ms ` +
      `(${((seqs.length / counterMs) * 1000).toFixed(0)} ev/s) — ` +
      `unique=${unique}/${seqs.length}, gapless 1..N=${String(gapless)}`
  );

  // A2: client timestamps (no counter) — measure collision rate
  const tsColl = clients[0]!.db("_manifold").collection("ts_test");
  t0 = performance.now();
  await Promise.all(
    Array.from({ length: WRITERS }, (_, w) =>
      (async () => {
        const c =
          clients[w % clients.length]!.db("_manifold").collection("ts_test");
        for (let i = 0; i < PER_WRITER; i++) {
          await c.insertOne({ writer: w, i, ts: new Date() });
        }
      })()
    )
  );
  const tsMs = performance.now() - t0;
  const docs = await tsColl.find().toArray();
  const distinctTs = new Set(docs.map((d) => (d.ts as Date).getTime())).size;
  console.log(
    `A2 client ts:  ${docs.length} events in ${tsMs.toFixed(0)}ms ` +
      `(${((docs.length / tsMs) * 1000).toFixed(0)} ev/s) — ` +
      `distinct ts=${distinctTs}/${docs.length} ` +
      `(${(((docs.length - distinctTs) / docs.length) * 100).toFixed(0)}% ambiguous ordering)`
  );

  // A3: does $natural order match counter-acquisition order?
  const natural = await log.events
    .find({ runId })
    .sort({ $natural: 1 })
    .toArray();
  const inversions = natural.filter(
    (e, i) => i > 0 && e.seq < natural[i - 1]!.seq
  ).length;
  console.log(
    `A3 $natural:   ${inversions} inversions vs counter order out of ${natural.length} ` +
      `(acquire-counter-then-insert race) — $natural is not a resumable key anyway`
  );
  console.log(
    "VERDICT: per-run findOneAndUpdate counter (unique+gapless, ~1 extra RTT)"
  );
  await Promise.all(clients.map((c) => c.close()));
}

async function experimentTxn(
  client: MongoClient,
  log: EventLog
): Promise<void> {
  banner(
    "B. Transactional vs non-transactional event+summary write (150 each)"
  );
  const N = 150;
  const mkEvent = (runId: string, i: number) =>
    ({
      type: "model_materialized",
      runId,
      model: `m${i % 10}`,
      attempt: 1,
      pipelineHash: "abc",
      docsWritten: i,
      durationMs: 1,
      inputFingerprints: {},
      materialization: "$merge",
      seq: 0,
      ts: new Date(),
    }) satisfies ManifoldEvent;

  const summaryUpdate = (
    e: Extract<ManifoldEvent, { type: "model_materialized" }>
  ) =>
    ({
      $set: {
        lastMaterialization: {
          runId: e.runId,
          ts: e.ts,
          pipelineHash: e.pipelineHash,
          inputFingerprints: e.inputFingerprints,
        },
        lastStatus: "materialized" as const,
        updatedAt: new Date(),
      },
    }) as const;

  // identical writes in both branches; plain measured twice (warm-up check)
  const plain = async (runId: string): Promise<number> => {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const e = { ...mkEvent(runId, i), seq: await log.nextSeq(runId) };
      await log.events.insertOne(e);
      await log.models.updateOne({ _id: e.model }, summaryUpdate(e), {
        upsert: true,
      });
    }
    return performance.now() - t0;
  };

  const plainMs1 = await plain("txn-off-a");
  let t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const session = client.startSession();
    try {
      const e = { ...mkEvent("txn-on", i), seq: await log.nextSeq("txn-on") };
      await session.withTransaction(async () => {
        await log.events.insertOne(e, { session });
        await log.models.updateOne({ _id: e.model }, summaryUpdate(e), {
          upsert: true,
          session,
        });
      });
    } finally {
      await session.endSession();
    }
  }
  const txnMs = performance.now() - t0;
  const plainMs2 = await plain("txn-off-b");
  const plainMs = Math.min(plainMs1, plainMs2);
  console.log(
    `plain (event-first + idempotent upsert): ${(plainMs1 / N).toFixed(2)}ms/op ` +
      `(re-run after txn: ${(plainMs2 / N).toFixed(2)}ms/op)\n` +
      `withTransaction:                         ${(txnMs / N).toFixed(2)}ms/op ` +
      `(${(txnMs / plainMs).toFixed(2)}x vs best plain)`
  );
  console.log(
    "VERDICT: transaction NOT needed for correctness — event append first,\n" +
      "then idempotent summary upsert. Crash between the two => stale summary,\n" +
      "which fails safe (model re-runs; $merge/$out idempotent) and is\n" +
      "rebuildable from events. Overhead is small on a local replset, but the\n" +
      "non-txn path also works on standalone mongod (txns REQUIRE a replset)\n" +
      "and avoids TransientTransactionError retry handling."
  );
}

function fmtEvent(e: ManifoldEvent): string {
  const base = `  #${String(e.seq).padStart(2, "0")} ${e.type}`;
  switch (e.type) {
    case "run_started":
      return `${base} resumeFrom=${e.resumeFrom ?? "-"}`;
    case "model_started":
      return `${base} ${e.model} attempt=${e.attempt}`;
    case "model_materialized":
      return `${base} ${e.model} attempt=${e.attempt} docs=${e.docsWritten} hash=${e.pipelineHash} ${e.durationMs}ms`;
    case "model_failed":
      return `${base} ${e.model} attempt=${e.attempt} willRetry=${String(e.willRetry)}`;
    case "model_skipped":
      return `${base} ${e.model} reason=${e.reason.kind}${
        e.reason.kind === "upstream_failed" ? `(${e.reason.cause})` : ""
      }`;
    case "run_finished":
      return `${base} status=${e.status} ${e.durationMs}ms`;
  }
}

async function experimentExecutor(
  client: MongoClient,
  log: EventLog
): Promise<void> {
  banner("C. Ready-queue executor: retry, skip propagation, crash, resume");
  const db = client.db(ANALYTICS);
  const now = Date.now();
  await db.collection("events_raw").insertMany(
    Array.from({ length: 5 }, (_, i) => ({
      _id: i as unknown as Document["_id"],
      userId: i % 3,
      updatedAt: new Date(now - 60_000 + i * 1000),
    }))
  );
  await db.collection("users_raw").insertMany(
    Array.from({ length: 3 }, (_, i) => ({
      _id: i as unknown as Document["_id"],
      name: `user${i}`,
      updatedAt: new Date(now - 60_000),
    }))
  );
  await db.collection("orders_raw").insertMany(
    Array.from({ length: 4 }, (_, i) => ({
      _id: i as unknown as Document["_id"],
      userId: i % 3,
      total: 10 * i,
      updatedAt: new Date(now - 60_000),
    }))
  );

  // ---- Run 1: order_facts flaky (1 fail), enriched_events fails all
  // attempts (skips propagate), audit_log hangs => mid-run crash ----------
  const R1 = "run-001";
  const chaos: Chaos = {
    failAttempts: new Map([
      ["order_facts", 1],
      ["enriched_events", Infinity],
    ]),
    hang: new Set(["audit_log"]),
  };
  const r1Promise = executeRun({
    client,
    log,
    runId: R1,
    nodes: DAG,
    maxParallel: 3,
    chaos,
  });
  // Crash trigger: once every node except the hung one has a terminal event,
  // abandon the executor's in-process state (the DB keeps everything).
  const expectedTerminal = DAG.length - 1; // audit_log never terminates
  await new Promise<void>((resolve) => {
    const poll = async (): Promise<void> => {
      const evts = await log.runEvents(R1);
      const terminal = new Set(
        evts
          .filter(
            (e) =>
              e.type === "model_materialized" ||
              (e.type === "model_failed" && !e.willRetry) ||
              e.type === "model_skipped"
          )
          .map((e) => (e as { model: string }).model)
      );
      if (terminal.size >= expectedTerminal) resolve();
      else setTimeout(() => void poll(), 25);
    };
    void poll();
  });
  void r1Promise; // abandoned — simulated process crash (no run_finished)
  console.log(`\nRun 1 (${R1}) CRASHED mid-run. Event log:`);
  for (const e of await log.runEvents(R1)) console.log(fmtEvent(e));

  const r1Events = await log.runEvents(R1);
  const crashed = !r1Events.some((e) => e.type === "run_finished");
  console.log(
    `Coherence: run_finished absent=${String(crashed)} (crashed-run signature); ` +
      `audit_log has model_started but no terminal event (in-flight at crash)`
  );

  // ---- Resume: heal enriched_events, rebuild work from the log ----------
  const R2 = "run-002";
  console.log(`\nRun 2 (${R2}) = resumeFrom(${R1}):`);
  const t0 = performance.now();
  const outcome = await executeRun({
    client,
    log,
    runId: R2,
    nodes: DAG,
    maxParallel: 3,
    resumeFrom: R1,
  });
  console.log(
    `resumed run completed in ${(performance.now() - t0).toFixed(0)}ms`
  );
  for (const e of await log.runEvents(R2)) console.log(fmtEvent(e));
  console.log(`Run 2 status: ${outcome.status}`);

  // Verify every model materialized and outputs exist
  const missing: string[] = [];
  for (const n of DAG) {
    const count = await db.collection(n.name).countDocuments();
    if (count === 0) missing.push(n.name);
  }
  console.log(
    missing.length === 0 ?
      "All 9 output collections materialized with docs — DAG complete."
    : `MISSING outputs: ${missing.join(", ")}`
  );

  // Index sanity: resume query uses runId_1_seq_1
  const explain = (await log.events
    .find({ runId: R1 })
    .sort({ seq: 1 })
    .explain("queryPlanner")) as Document;
  const plan = JSON.stringify(explain.queryPlanner?.winningPlan ?? {});
  console.log(
    `Resume query winning plan uses IXSCAN runId_1_seq_1: ${String(plan.includes("runId_1_seq_1"))}`
  );
}

async function experimentStaleness(
  client: MongoClient,
  log: EventLog
): Promise<void> {
  banner("D. Staleness derivation (isStale over summaries + watermark probe)");
  const byName = new Map(DAG.map((n) => [n.name, n]));
  const before = await isStale(client, log, byName.get("stg_events")!);
  console.log(`stg_events before new data: ${JSON.stringify(before)}`);

  await client
    .db(ANALYTICS)
    .collection("events_raw")
    .insertOne({
      _id: 99 as unknown as Document["_id"],
      userId: 1,
      updatedAt: new Date(),
    });
  const after = await isStale(client, log, byName.get("stg_events")!);
  const users = await isStale(client, log, byName.get("stg_users")!);
  const daily = await isStale(client, log, byName.get("daily_metrics")!);
  console.log(`stg_events after insert:    ${JSON.stringify(after)}`);
  console.log(`stg_users (untouched):      ${JSON.stringify(users)}`);
  console.log(
    `daily_metrics (upstream not yet rematerialized): ${JSON.stringify(daily)}`
  );
  console.log(
    "=> onlyStale would select stg_events (source_has_new_data); after it\n" +
      "   rematerializes, daily_metrics flips stale via upstream_newer."
  );
}

/* ================================================================== */
/* Main                                                                */
/* ================================================================== */

async function main(): Promise<void> {
  console.log("Starting MongoMemoryReplSet (1 node)...");
  const t0 = performance.now();
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replSet.getUri();
  console.log(`replset up in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const client = await new MongoClient(uri).connect();
  const log = new EventLog(client);
  await log.ensureIndexes();

  try {
    await experimentSeq(uri, log);
    await experimentTxn(client, log);
    await experimentExecutor(client, log);
    await experimentStaleness(client, log);
  } finally {
    await client.close();
    await replSet.stop();
  }
  console.log("\nSpike complete.");
}

await main();
