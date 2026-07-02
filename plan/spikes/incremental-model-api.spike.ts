/**
 * SPIKE: Incremental & microbatch Model API for @pipesafe/manifold
 *
 * Purpose:   Illustrate the proposed `Model.Mode.Incremental` /
 *            `Model.Mode.Microbatch` API from plan/04-transform-roadmap.md §3 —
 *            the typed equivalent of dbt's is_incremental() / {{ this }} /
 *            incremental_strategy / microbatch configs, mapped onto $merge.
 * Status:    ILLUSTRATIVE, NOT BUILT. Nothing here is imported by the packages.
 *            Types are simplified stand-ins for the real @pipesafe/core types.
 * Build:     Excluded from all builds — plan/ is outside every tsconfig
 *            `include` and outside packages/*. Dependency-free by design
 *            (all referenced types are stubbed inline below).
 */

// ============================================================================
// Inline stubs standing in for @pipesafe/core types (NOT the real ones)
// ============================================================================

type Document = Record<string, any>;

/** Stub of core's Pipeline — only what the sketch needs. */
interface PipelineStub<TIn extends Document, TOut extends Document = TIn> {
  match(
    query: Partial<Record<keyof TOut & string, unknown>>
  ): PipelineStub<TIn, TOut>;
  set<TAdd extends Document>(fields: TAdd): PipelineStub<TIn, TOut & TAdd>;
  getPipeline(): Document[];
}

/** Stub of core's Source (Collection | Model both implement it). */
interface SourceStub<TOut extends Document> {
  readonly sourceType: "collection" | "model";
  getOutputCollectionName(): string;
  readonly __outputType: TOut;
}

/** Top-level fields of TDoc whose type extends V (stands in for
 *  core's FieldSelectorsThatInferTo + TopLevelField). */
type FieldsOfType<TDoc extends Document, V> = {
  [K in keyof TDoc & string]: TDoc[K] extends V ? K : never;
}[keyof TDoc & string];

// ============================================================================
// 1. The incremental context — typed replacement for is_incremental()/{{this}}
// ============================================================================

/**
 * Passed as the second argument to the model's pipeline function.
 * `watermark()` compiles to a pre-run max-value query against the model's own
 * output collection (dbt: `select max(col) from {{ this }}`); the returned
 * placeholder is spliced into the delta $match at execution time.
 */
interface IncrementalContext<TOutput extends Document> {
  /** false on first run and under run({ fullRefresh: true }) — dbt's guard. */
  readonly isIncremental: boolean;

  /**
   * Max value of `field` currently in the target collection.
   * Field is constrained to Date | number | string fields of TOutput,
   * so `ctx.watermark("naem")` or a boolean field is a compile error.
   */
  watermark<K extends FieldsOfType<TOutput, Date | number | string>>(
    field: K
  ): TOutput[K];

  /** Escape hatch: an arbitrary read against the target's current contents. */
  targetAggregate<T>(stages: Document[]): Promise<T[]>;
}

// ============================================================================
// 2. Incremental materialization config (framework-supplied apply strategy)
// ============================================================================

/** How the recomputed delta is applied to the target. All map to $merge
 *  configurations (or deleteMany + $merge for deleteInsert). */
type IncrementalStrategy =
  /** Insert new docs; keep existing on key collision.
   *  $merge { whenMatched: "keepExisting", whenNotMatched: "insert" } */
  | "append"
  /** Upsert by key. $merge { on, whenMatched: "replace"|"merge", whenNotMatched: "insert" } */
  | "merge"
  /** deleteMany({ key ∈ delta keys }) then insert. Faster at scale; NOT atomic
   *  (documented contract, same caveat dbt ships). */
  | "deleteInsert";

interface IncrementalConfig<TOutput extends Document> {
  strategy: IncrementalStrategy;
  /**
   * The unique key (dbt's unique_key / $merge `on:`). Typed against TOutput's
   * top-level fields. OPTIONAL once grain inference lands (roadmap §8): the
   * framework derives it from the terminal $group `_id` and validates a
   * user-supplied value against that inferred grain.
   * The framework ensures a unique index on these fields before first $merge.
   */
  on?: readonly (keyof TOutput & string)[];
  /** For strategy "merge": update only these fields on match
   *  (dbt merge_update_columns). Compiles to whenMatched: [$set pipeline]. */
  mergeFields?: readonly (keyof TOutput & string)[];
  /** Runtime drift policy between TOutput and already-materialized docs.
   *  Compile-time drift between models is already a tsc error. */
  onSchemaChange?: "ignore" | "fail"; // default "ignore"
}

// ============================================================================
// 3. Microbatch config (roadmap §3, P0.5)
// ============================================================================

interface MicrobatchConfig<TOutput extends Document> {
  /** Event-time field; must be a Date field on the model's output. The runner
   *  AUTO-PREPENDS a $match on this field's window to the model pipeline and
   *  pushes the same window filter into upstream model/collection reads that
   *  declare an eventTime — dbt's resolve_event_time_filter, but as a plain
   *  stage-array prepend since pipelines are structured data. */
  eventTime: FieldsOfType<TOutput, Date>;
  batchSize: "hour" | "day" | "month" | "year";
  /** Reprocess N trailing batches each run to absorb late-arriving data. */
  lookback?: number; // default 1
  /** Earliest event time ever considered (bounds the first run / backfills). */
  begin: Date;
}
// Each batch is applied as an idempotent full-window replacement:
//   deleteMany({ [eventTime]: { $gte: windowStart, $lt: windowEnd } })
//   then aggregate(...batch-filtered stages, { $merge: { whenNotMatched: "insert" } })
// => batches are independent, parallelizable, and individually retryable.
// Per-batch status persists in run-results (manifest-artifact.spike.ts), so
// retry re-runs only failed windows. Batch scheduling/parallelism: doc 05.

// ============================================================================
// 4. Mode presets — additions alongside Replace / Upsert / Append
// ============================================================================

declare const ModelMode: {
  // Existing (packages/manifold/src/model/Model.ts:138)
  Replace: { $out: Record<string, never> };
  Upsert: {
    $merge: { on: "_id"; whenMatched: "replace"; whenNotMatched: "insert" };
  };
  Append: {
    $merge: { on: "_id"; whenMatched: "fail"; whenNotMatched: "insert" };
  };

  // Proposed
  Incremental<TOutput extends Document>(
    config: IncrementalConfig<TOutput>
  ): { incremental: IncrementalConfig<TOutput> };

  Microbatch<TOutput extends Document>(
    config: MicrobatchConfig<TOutput> & Pick<IncrementalConfig<TOutput>, "on">
  ): { microbatch: MicrobatchConfig<TOutput> };
};

/** ModelConfig gains a ctx parameter on the pipeline fn (backward compatible —
 *  existing single-arg pipeline fns keep working). */
interface IncrementalModelConfig<
  TName extends string,
  TIn extends Document,
  TOut extends Document,
> {
  name: TName;
  from: SourceStub<TIn>;
  pipeline: (
    p: PipelineStub<TIn>,
    ctx: IncrementalContext<TOut>
  ) => PipelineStub<TIn, TOut>;
  materialize: {
    type: "collection";
    db?: string;
    mode:
      | ReturnType<typeof ModelMode.Incremental<TOut>>
      | ReturnType<typeof ModelMode.Microbatch<TOut>>;
  };
}

/** Run options additions consumed by incremental/microbatch models.
 *  (Full RunOptions evolution — selectors, defer, retry — in doc 04 §4/§7.) */
interface IncrementalRunOptions {
  /** Ignore watermarks/batch state; rebuild from scratch (dbt --full-refresh). */
  fullRefresh?: boolean;
  /** Backfill a specific event-time range (microbatch models only). */
  eventTimeStart?: Date;
  eventTimeEnd?: Date;
}

// ============================================================================
// 5. Worked example
// ============================================================================

type RawEvent = {
  eventId: string;
  userId: string;
  receivedAt: Date;
  status: string;
};
type StgEvent = RawEvent & { day: Date };

declare const rawEvents: SourceStub<RawEvent>;
declare function defineModel<
  TName extends string,
  TIn extends Document,
  TOut extends Document,
>(
  config: IncrementalModelConfig<TName, TIn, TOut>
): SourceStub<TOut> & { name: TName };

// --- Plain incremental: user delta filter + merge strategy -----------------
const stgEvents = defineModel<"stg_events", RawEvent, StgEvent>({
  name: "stg_events",
  from: rawEvents,
  pipeline: (p, ctx) =>
    p
      // The typed is_incremental()/{{ this }} equivalent:
      .match(
        ctx.isIncremental ?
          { receivedAt: { $gt: ctx.watermark("receivedAt") } }
        : {}
      )
      .set({ day: new Date() /* stand-in for $dateTrunc expression */ }),
  materialize: {
    type: "collection",
    mode: ModelMode.Incremental<StgEvent>({
      strategy: "merge",
      on: ["eventId"], // ✅ typed; ["evntId"] would not compile
      mergeFields: ["status"], // only status updates on re-match
      onSchemaChange: "ignore",
    }),
  },
});

// --- Microbatch: window filter is injected, no manual delta filter needed ---
const dailyEvents = defineModel<"daily_events", RawEvent, StgEvent>({
  name: "daily_events",
  from: rawEvents,
  pipeline: (p) =>
    // No ctx.watermark needed: the runner prepends
    //   { $match: { receivedAt: { $gte: batchStart, $lt: batchEnd } } }
    // per batch, and pushes the same window into upstream reads.
    p.set({ day: new Date() }),
  materialize: {
    type: "collection",
    mode: ModelMode.Microbatch<StgEvent>({
      eventTime: "receivedAt", // ✅ must be a Date field of StgEvent
      batchSize: "day",
      lookback: 2,
      begin: new Date("2025-01-01"),
      on: ["eventId"],
    }),
  },
});

// Backfill example (illustrative call shape):
// await project.run({ targets: ["daily_events"],
//   eventTimeStart: new Date("2025-03-01"), eventTimeEnd: new Date("2025-04-01") });

export { stgEvents, dailyEvents };
export type {
  IncrementalContext,
  IncrementalConfig,
  MicrobatchConfig,
  IncrementalRunOptions,
};
