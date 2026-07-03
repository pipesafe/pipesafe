// SUPERSEDED in part by the executed event-log-exec.spike.ts (EPIC-G): this sketch's skip-propagation recipe wrongly releases grandchildren, and its transactional summary write was dropped — see plan/trd/README.md reconciliation ledger.
/**
 * SPIKE: manifold run-state — append-only event log + derived model summary.
 *
 * Purpose: illustrate the P0 design from plan/05-orchestration-and-el-roadmap.md
 * (§2 run-state & event log, §3 execution semantics, §4 staleness): everything —
 * resume-from-failure, onlyStale selection, retries, run history — is derived
 * from two collections in a `_manifold` MongoDB database. Events are the source
 * of truth; the per-model summary is a rebuildable cache (Dagster's
 * event_logs / asset_keys split, ported to Mongo).
 *
 * Status: ILLUSTRATIVE SKETCH ONLY. Not part of any build or test target
 * (plan/ is excluded from tsconfig); dependency-free — no imports from
 * `mongodb`, `@pipesafe/core`, or `@pipesafe/manifold`. Minimal structural
 * stand-ins are declared inline where a real type would come from the driver.
 */

/* ------------------------------------------------------------------ */
/* Stand-ins (real code uses the mongodb driver + manifold types)      */
/* ------------------------------------------------------------------ */

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

/** Minimal slice of a driver collection — enough to express the sketch. */
interface MiniCollection<T> {
  insertOne(doc: T): Promise<void>;
  findOne(filter: Partial<T>): Promise<T | null>;
  find(filter: object): { sort(s: object): { toArray(): Promise<T[]> } };
  updateOne(
    filter: object,
    update: object,
    opts?: { upsert?: boolean }
  ): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* 1. The event log (`_manifold.events`) — append-only                 */
/* ------------------------------------------------------------------ */

/**
 * How we know a source collection had (or didn't have) new data since the
 * last materialization. Two Mongo-native probes (doc 05 §4):
 *  - "watermark": max of a declared field (updatedAt / _id) — cheap indexed query.
 *  - "resumeToken": change-stream postBatchResumeToken; resuming and reading
 *    zero events proves the source is unchanged, with no schema cooperation.
 */
export type InputFingerprint =
  | { kind: "watermark"; field: string; value: JsonValue }
  | { kind: "resumeToken"; token: JsonValue };

interface EventBase {
  runId: string;
  ts: Date;
}

export type ManifoldEvent =
  | (EventBase & {
      type: "run_started";
      /** resolved selection, e.g. from `--select 'stg_events+' --only-stale` */
      selection: string[];
      /** full invocation args — dbt's trick making `retry` self-contained */
      invocationArgs: JsonValue;
      manifoldVersion: string;
    })
  | (EventBase & { type: "model_started"; model: string; attempt: number })
  | (EventBase & {
      type: "model_materialized";
      model: string;
      attempt: number;
      /** canonical-JSON hash of the compiled stage array — semantic code_version */
      pipelineHash: string;
      docsWritten: number;
      durationMs: number;
      /** fingerprint of each input (source collection or upstream model) at read time */
      inputFingerprints: Record<string, InputFingerprint>;
      materialization: "view" | "$out" | "$merge";
    })
  | (EventBase & {
      type: "model_failed";
      model: string;
      attempt: number;
      error: string;
      willRetry: boolean;
    })
  | (EventBase & {
      type: "model_skipped";
      model: string;
      /** transitive failure propagation (dbt's _skipped_children) or freshness skip */
      reason:
        | { kind: "upstream_failed"; cause: string }
        | { kind: "not_stale" };
    })
  | (EventBase & {
      type: "run_finished";
      status: "success" | "failed" | "partial";
      durationMs: number;
    });

/**
 * NOTE: this exact union is also the CLI's NDJSON stream (doc 05 §5) —
 * `manifold build --json` emits one event per line, so hosts (dagster-manifold,
 * Orchestra-style control planes) consume precisely what the log stores.
 */

/* ------------------------------------------------------------------ */
/* 2. The derived summary (`_manifold.models`) — rebuildable cache     */
/* ------------------------------------------------------------------ */

export interface ModelSummary {
  model: string;
  lastMaterialization: {
    runId: string;
    ts: Date;
    pipelineHash: string;
    inputFingerprints: Record<string, InputFingerprint>;
  } | null;
  lastStatus: "materialized" | "failed" | "skipped";
}

/**
 * Event append + summary update happen in one transaction (replica sets are
 * already required for change streams, so transactions are available).
 * Multi-writer safety (risk §8.2): a per-(run,model) lease via
 * findOneAndUpdate on a `_manifold.locks` collection guards executeModel.
 */
export async function recordMaterialized(
  events: MiniCollection<ManifoldEvent>,
  models: MiniCollection<ModelSummary>,
  e: Extract<ManifoldEvent, { type: "model_materialized" }>
): Promise<void> {
  // illustrative — real code wraps both writes in session.withTransaction()
  await events.insertOne(e);
  await models.updateOne(
    { model: e.model },
    {
      $set: {
        lastMaterialization: {
          runId: e.runId,
          ts: e.ts,
          pipelineHash: e.pipelineHash,
          inputFingerprints: e.inputFingerprints,
        },
        lastStatus: "materialized",
      },
    },
    { upsert: true }
  );
}

/* ------------------------------------------------------------------ */
/* 3. Derivation: staleness (`run({ onlyStale: true })`)               */
/* ------------------------------------------------------------------ */

export type StalenessVerdict =
  | {
      stale: true;
      reason:
        | "never_materialized"
        | "pipeline_changed"
        | "upstream_newer"
        | "source_has_new_data";
    }
  | { stale: false };

/**
 * Pure function over summaries + live probes — no daemon anywhere.
 * The host (cron / Dagster / Orchestra) supplies the trigger; manifold
 * supplies the skip decision. That split keeps SAO-style value in-product.
 */
export function isStale(
  self: ModelSummary,
  currentPipelineHash: string,
  upstreamSummaries: ModelSummary[],
  probedSourceFingerprints: Record<string, InputFingerprint>
): StalenessVerdict {
  const last = self.lastMaterialization;
  if (!last) return { stale: true, reason: "never_materialized" };
  if (last.pipelineHash !== currentPipelineHash)
    return { stale: true, reason: "pipeline_changed" };
  for (const up of upstreamSummaries) {
    if (up.lastMaterialization && up.lastMaterialization.ts > last.ts)
      return { stale: true, reason: "upstream_newer" };
  }
  for (const [source, current] of Object.entries(probedSourceFingerprints)) {
    const seen = last.inputFingerprints[source];
    if (!seen || JSON.stringify(seen) !== JSON.stringify(current))
      return { stale: true, reason: "source_has_new_data" };
  }
  return { stale: false };
}

/* ------------------------------------------------------------------ */
/* 4. Derivation: resume-from-failure                                  */
/* ------------------------------------------------------------------ */

/**
 * `project.run({ resumeFrom: runId })`: skip models that already have a
 * model_materialized event in that run with an unchanged pipeline hash.
 * Safe because materialization is idempotent ($out replaces; $merge upserts
 * on its `on:` key) — the "memoized step result" IS the collection.
 */
export async function modelsToSkipOnResume(
  events: MiniCollection<ManifoldEvent>,
  resumeFromRunId: string,
  currentHashes: Record<string, string>
): Promise<Set<string>> {
  const prior = await events
    .find({ runId: resumeFromRunId, type: "model_materialized" })
    .sort({ ts: 1 })
    .toArray();
  const skip = new Set<string>();
  for (const e of prior) {
    if (
      e.type === "model_materialized" &&
      currentHashes[e.model] === e.pipelineHash
    ) {
      skip.add(e.model);
    }
  }
  return skip;
}

/* ------------------------------------------------------------------ */
/* 5. Execution: node-granular ready queue (replaces level stages)     */
/* ------------------------------------------------------------------ */

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  factor: number; // exponential
}

/**
 * dbt GraphQueue in miniature (~230 lines in dbt): nodes become ready the
 * moment their last dependency completes — no level barriers. On failure,
 * all transitive dependents are marked skipped rather than aborting the run.
 * Edges MUST include lookup/unionWith deps (the doc-01 §5 graph bug fix
 * gates this: `from` edges alone schedule races).
 */
export async function runReadyQueue(
  nodes: string[],
  dependencies: Map<string, string[]>, // node -> upstream nodes (from + lookup edges)
  execute: (node: string) => Promise<void>,
  emit: (e: ManifoldEvent) => void,
  opts: { runId: string; maxParallel: number; retry: RetryPolicy }
): Promise<void> {
  const remaining = new Map(
    nodes.map((n) => [n, new Set(dependencies.get(n) ?? [])])
  );
  const dependents = new Map<string, string[]>();
  for (const [n, deps] of dependencies) {
    for (const d of deps)
      (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(n);
  }
  const failed = new Set<string>();
  const ready: string[] = nodes.filter((n) => remaining.get(n)!.size === 0);
  let inFlight = 0;

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (remaining.size === 0 && inFlight === 0) return resolve();
      while (inFlight < opts.maxParallel && ready.length > 0) {
        const node = ready.shift()!;
        remaining.delete(node);
        inFlight++;
        void runWithRetry(node).then((ok) => {
          inFlight--;
          for (const child of dependents.get(node) ?? []) {
            if (!remaining.has(child)) continue;
            if (!ok || failed.has(node)) {
              // transitive skip: propagate without executing
              failed.add(child);
              remaining.delete(child);
              emit({
                type: "model_skipped",
                runId: opts.runId,
                ts: new Date(),
                model: child,
                reason: { kind: "upstream_failed", cause: node },
              });
              for (const gc of dependents.get(child) ?? [])
                remaining.get(gc)?.delete(child);
            } else {
              const deps = remaining.get(child)!;
              deps.delete(node);
              if (deps.size === 0) ready.push(child);
            }
          }
          pump();
        });
      }
    };
    pump();
  });

  async function runWithRetry(node: string): Promise<boolean> {
    for (let attempt = 1; attempt <= opts.retry.maxAttempts; attempt++) {
      emit({
        type: "model_started",
        runId: opts.runId,
        ts: new Date(),
        model: node,
        attempt,
      });
      try {
        await execute(node); // one aggregation with $out/$merge — idempotent, safe to retry
        return true;
      } catch (err) {
        const willRetry = attempt < opts.retry.maxAttempts;
        emit({
          type: "model_failed",
          runId: opts.runId,
          ts: new Date(),
          model: node,
          attempt,
          error: String(err),
          willRetry,
        });
        if (willRetry) {
          const delay =
            opts.retry.backoffMs * opts.retry.factor ** (attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    failed.add(node);
    return false;
  }
}
