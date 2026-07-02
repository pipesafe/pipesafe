/**
 * SPIKE: typed EL connector API — `ExternalSource<T>` as an async generator.
 *
 * Purpose: illustrate the P2 EL design from plan/05-orchestration-and-el-roadmap.md
 * (§6): dlt's form factor (library code in the user's runtime) carrying
 * Fivetran's proven semantics (UPSERT/UPDATE/DELETE/TRUNCATE ops + opaque
 * checkpointed state), with MongoDB change streams as first-class CDC in both
 * directions and checkpoint state persisted in `_manifold.sourceState`.
 * The loader lands ops into a collection that implements manifold's Source<T>,
 * so a connector's TypeScript type flows through $match/$group at compile time.
 *
 * Status: ILLUSTRATIVE SKETCH ONLY. Not part of any build or test target
 * (plan/ is excluded from tsconfig); dependency-free — no imports from
 * `mongodb`, `@pipesafe/core`, or `@pipesafe/manifold`. Driver/manifold types
 * are stubbed inline.
 */

/* ------------------------------------------------------------------ */
/* Stand-ins                                                           */
/* ------------------------------------------------------------------ */

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

interface MiniBulkWriter<T> {
  /** stands in for driver bulkWrite: replaceOne{upsert} / updateOne{$set} / soft-delete */
  bulkWrite(ops: LoadOp<T>[]): Promise<{ upserted: number; modified: number }>;
}
interface MiniStateStore {
  get(sourceName: string): Promise<JsonValue | null>;
  /** atomic write — real impl: findOneAndUpdate on _manifold.sourceState */
  set(sourceName: string, state: JsonValue): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* 1. Op vocabulary — Fivetran's four record ops, verbatim             */
/* ------------------------------------------------------------------ */

/**
 * Why these four: they are the minimal proven contract (Fivetran's
 * connector_sdk.proto RecordType) and map 1:1 onto Mongo bulk ops.
 * System fields `_ps_synced` / `_ps_deleted` are a documented contract,
 * exactly like Fivetran's `_fivetran_*` columns.
 */
export type SourceOp<T, K extends keyof T = keyof T> =
  /** full document; delete+insert semantics via replaceOne{upsert:true} */
  | { op: "upsert"; doc: T }
  /** partial; only changed fields — updateOne{$set: patch} */
  | { op: "update"; key: Pick<T, K>; patch: Partial<T> }
  /** soft delete — sets _ps_deleted: true, never removes */
  | { op: "delete"; key: Pick<T, K> }
  /** start-of-resync sweep: soft-delete everything synced before `before` */
  | { op: "truncate"; before: Date }
  /**
   * Opaque connector-owned cursor state (Fivetran state_json / Airbyte STATE).
   * The runner persists it ONLY after the preceding batch is durably written —
   * see runSync(); the connector cannot cause premature checkpointing.
   */
  | { op: "checkpoint"; state: JsonValue };

/** what the loader actually executes against the landing collection */
type LoadOp<T> = SourceOp<T> & { _ps_synced: Date };

/* ------------------------------------------------------------------ */
/* 2. The connector interface                                          */
/* ------------------------------------------------------------------ */

export interface ExternalSource<T> {
  readonly name: string;
  /** landing collection; implements core's Source<T> so it joins the DAG */
  readonly into: { db?: string; collection: string };
  /**
   * One sync: resume from `state` (null on first run / after re-snapshot),
   * yield ops, interleave checkpoints at least every N minutes or M docs.
   * At-least-once + keyed idempotent ops ⇒ replays after a crash are safe.
   */
  pull(state: JsonValue | null): AsyncGenerator<SourceOp<T>>;
}

/* ------------------------------------------------------------------ */
/* 3. The runner: durable-write-then-checkpoint invariant              */
/* ------------------------------------------------------------------ */

export async function runSync<T>(
  source: ExternalSource<T>,
  writer: MiniBulkWriter<T>,
  stateStore: MiniStateStore,
  opts: { batchSize: number } = { batchSize: 1000 }
): Promise<void> {
  const state = await stateStore.get(source.name);
  let batch: LoadOp<T>[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await writer.bulkWrite(batch); // must resolve before any checkpoint persists
    batch = [];
  };

  for await (const op of source.pull(state)) {
    if (op.op === "checkpoint") {
      await flush(); // INVARIANT: checkpoint is unreachable before durable delivery
      await stateStore.set(source.name, op.state);
    } else {
      batch.push({ ...op, _ps_synced: new Date() });
      if (batch.length >= opts.batchSize) await flush();
    }
  }
  await flush(); // trailing rows without a final checkpoint replay next run — safe (keyed upserts)
}

/* ------------------------------------------------------------------ */
/* 4. MongoDB-as-source: change-stream CDC connector                   */
/* ------------------------------------------------------------------ */

/** typed change events — the shape neither Fivetran nor Airbyte can type at dev time */
type MiniChangeEvent<T> =
  | {
      operationType: "insert" | "replace" | "update";
      fullDocument: T;
      documentKey: { _id: unknown };
    }
  | { operationType: "delete"; documentKey: { _id: unknown } };

interface MiniChangeStream<T> {
  [Symbol.asyncIterator](): AsyncIterator<MiniChangeEvent<T>>;
  /** driver's postBatchResumeToken — the natural checkpoint */
  resumeToken: JsonValue;
}

export function changeStreamSource<T extends { _id: unknown }>(cfg: {
  name: string;
  into: { collection: string };
  /** real impl: coll.watch([], { resumeAfter, fullDocument: "updateLookup" }) */
  watch: (resumeAfter: JsonValue | null) => MiniChangeStream<T>;
  /** initial snapshot / re-snapshot: chunked find() over the collection */
  snapshot: () => AsyncGenerator<T>;
}): ExternalSource<T> {
  return {
    name: cfg.name,
    into: cfg.into,
    async *pull(state) {
      let resumeAfter = state;
      if (resumeAfter === null) {
        // First run OR recovery from ChangeStreamHistoryLost (risk §8.3):
        // truncate stale rows, full re-snapshot, then tail from "now".
        yield { op: "truncate", before: new Date() };
        for await (const doc of cfg.snapshot()) yield { op: "upsert", doc };
      }
      let stream: MiniChangeStream<T>;
      try {
        stream = cfg.watch(resumeAfter);
      } catch {
        // resume token aged out of the oplog → recurse with null state
        yield* this.pull(null);
        return;
      }
      let sinceCheckpoint = 0;
      for await (const ev of stream) {
        if (ev.operationType === "delete") {
          yield {
            op: "delete",
            key: { _id: ev.documentKey._id } as Pick<T, keyof T>,
          };
        } else {
          yield { op: "upsert", doc: ev.fullDocument };
        }
        if (++sinceCheckpoint >= 500) {
          yield { op: "checkpoint", state: stream.resumeToken };
          sinceCheckpoint = 0;
        }
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* 5. Schema drift: compile-time brand + runtime contract              */
/* ------------------------------------------------------------------ */

/**
 * Dev-time (the third pole vs Fivetran/dlt): the connector's T is the same
 * type downstream Models consume — remove a field from T and every dependent
 * $match/$group fails `tsc` with the existing brand, before deploy:
 *
 *   interface PipeSafeError<Msg extends string> { readonly "~pipesafe.error": Msg }
 *   // e.g. Field 'plan' is not on the schema.
 *
 * Run-time (dlt's schema contracts, for documents that defy the declared T):
 */
export type DriftPolicy =
  | "evolve" // accept unknown fields (Mongo is schemaless; default)
  | "freeze" // reject the batch, fail the sync
  | "discardRow" // drop non-conforming documents, count them in run results
  | "discardValue"; // strip unknown fields, keep the document

export interface SourceContract {
  onUndeclaredField: DriftPolicy;
  /** maps to Fivetran's Allow all / Allow columns / Block all per-connection policy */
}

/* ------------------------------------------------------------------ */
/* 6. Egress: the ONE warehouse path (explicitly minimal)              */
/* ------------------------------------------------------------------ */

/**
 * Not a destination framework. A cursor (or change stream) over a Model's
 * output collection → Parquet files in object storage → the warehouse's own
 * `COPY INTO`. Fivetran's batch-file design minus gRPC/encryption ceremony.
 * Everything else on the do-NOT-build list stays unbuilt: no connector
 * catalog, no hosted control plane, no Migrate algebra, no wire protocol.
 */
export interface ParquetEgress<T> {
  model: string; // manifold Model name; typed rows come from its TOutput
  path: (batch: { start: Date; end: Date }) => string; // e.g. s3://bucket/stg_events/2026-07-02.parquet
  mode: "full" | "incremental"; // incremental = cursor on _ps_synced / change stream
  rowType?: T; // phantom — Parquet schema derived from TOutput at compile time
}
