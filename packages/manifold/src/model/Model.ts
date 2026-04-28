/**
 * Model - DAG Pipeline Composition
 *
 * A model represents a named, materializable pipeline with typed input/output.
 * Models can depend on collections or other models, forming a DAG.
 */

import { TimeSeriesCollectionOptions } from "mongodb";
import {
  Document,
  Pipeline,
  Source,
  InferSourceType,
  FieldSelector,
  FieldSelectorsThatInferTo,
  TopLevelField,
  MergeOptions,
} from "@pipesafe/core";

// ============================================================================
// Time-Series Options
// ============================================================================

/**
 * Type-safe extension of MongoDB's TimeSeriesCollectionOptions.
 * Constrains timeField to Date fields and metaField to string keys.
 */
export type TypedTimeSeriesOptions<TDoc extends Document> = Omit<
  TimeSeriesCollectionOptions,
  "timeField" | "metaField"
> & {
  /** Must be a field of type Date in TDoc */
  timeField: TopLevelField<FieldSelectorsThatInferTo<TDoc, Date>>;
  /** Must be a string key in TDoc */
  metaField?: TopLevelField<FieldSelector<TDoc>>;
  /** TTL - auto-expire documents after N seconds */
  expireAfterSeconds?: number;
};

// ============================================================================
// Collection Mode
// ============================================================================

/**
 * Materialization mode for collection-typed models.
 *
 * Note: `MergeOptions` here omits `into` because the model owns its output
 * collection name and database (via `name` and `materialize.db`). The `into`
 * field is filled in automatically when building the output stage.
 */
export type CollectionMode<TOutput extends Document> =
  | { $out: Record<string, never> }
  | { $merge: Omit<MergeOptions<TOutput>, "into"> };

// ============================================================================
// Materialization Configuration
// ============================================================================

/**
 * Materialization configuration.
 */
export type MaterializeConfig<TOutput extends Document = Document> =
  | { type: "view"; db?: string }
  | {
      type: "collection";
      db?: string;
      mode: CollectionMode<TOutput>;
      timeseries?: TypedTimeSeriesOptions<TOutput>;
    };

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Model configuration - source can be a collection OR another model.
 * When source is a model, this creates an implicit DAG edge.
 *
 * Pipelines inside models use `mode: "model"` which allows lookup/unionWith
 * from other Models (not just Collections).
 */
export type ModelConfig<
  TName extends string,
  TSource extends Source<Document>,
  TOutput extends Document,
  TMaterializeConfig extends MaterializeConfig<TOutput>,
> = {
  name: TName;
  /** Source collection or upstream model */
  from: TSource;
  /** Pipeline function - receives a "model" mode pipeline that can lookup from other models */
  pipeline: (
    p: Pipeline<
      InferSourceType<TSource>,
      InferSourceType<TSource>,
      "model",
      never
    >
  ) => Pipeline<InferSourceType<TSource>, TOutput, "model", string>;
  /** Materialization configuration - required */
  materialize: TMaterializeConfig;
};

// ============================================================================
// Model Type Helpers
// ============================================================================

/**
 * Extract the output document type from a Model.
 */
export type InferModelOutput<T> =
  T extends Model<any, any, infer O, any> ? O : never;

/**
 * Type predicate to check if a value is a Model.
 */
export function isModel(value: unknown): value is Model {
  return (
    typeof value === "object" &&
    value !== null &&
    "sourceType" in value &&
    (value as { sourceType: unknown }).sourceType === "model"
  );
}

/**
 * A named, materializable pipeline with typed input/output.
 * Models form a DAG through their `from` property.
 */
export class Model<
  TName extends string = string,
  TInput extends Document = Document,
  TOutput extends Document = Document,
  TMaterializeConfig extends MaterializeConfig<TOutput> =
    MaterializeConfig<TOutput>,
> implements Source<TOutput> {
  /** Preset modes for common materialization patterns */
  static readonly Mode = {
    /** Replace entire collection using $out */
    Replace: { $out: {} },
    /** Upsert by _id using $merge */
    Upsert: {
      $merge: { on: "_id", whenMatched: "replace", whenNotMatched: "insert" },
    },
    /** Append only (fail on match) using $merge */
    Append: {
      $merge: { on: "_id", whenMatched: "fail", whenNotMatched: "insert" },
    },
  } as const;

  /** Source discriminator */
  readonly sourceType = "model" as const;

  readonly name: TName;
  readonly materialize: TMaterializeConfig;

  // Phantom types for inference (not used at runtime)
  readonly __inputType!: TInput;
  readonly __outputType!: TOutput;

  private readonly _from: Source<TInput>;
  private readonly _pipelineFn: (
    p: Pipeline<TInput, TInput, "model", never>
  ) => Pipeline<TInput, TOutput, "model", string>;

  constructor(
    config: ModelConfig<TName, Source<TInput>, TOutput, TMaterializeConfig>
  ) {
    this.name = config.name;
    this._from = config.from as Source<TInput>;
    this._pipelineFn = config.pipeline as (
      p: Pipeline<TInput, TInput, "model">
    ) => Pipeline<TInput, TOutput, "model">;
    this.materialize = config.materialize;
  }

  /**
   * Get the source (collection or upstream model).
   */
  getSource(): Source<TInput> {
    return this._from;
  }

  /**
   * Check if the source is a model (vs a collection).
   */
  sourceIsModel(): boolean {
    return isModel(this._from);
  }

  /**
   * Get the upstream model if source is a model, otherwise undefined.
   */
  getUpstreamModel(): Model<string, any, TInput, any> | undefined {
    if (this.sourceIsModel()) {
      return this._from as Model<string, any, TInput, any>;
    }
    return undefined;
  }

  /**
   * Get the source collection name.
   */
  getSourceCollectionName(): string {
    return this._from.getOutputCollectionName();
  }

  /**
   * Get the source database name.
   */
  getSourceDatabase(): string | undefined {
    return this._from.getOutputDatabase();
  }

  /**
   * Get the output collection name (where this model materializes).
   */
  getOutputCollectionName(): string {
    return this.name;
  }

  /**
   * Get the database name for output (if specified).
   */
  getOutputDatabase(): string | undefined {
    if ("db" in this.materialize) {
      return this.materialize.db;
    }
    return undefined;
  }

  /**
   * Build the pipeline stages for this model.
   */
  getPipelineStages(): Document[] {
    return this._buildPipeline().getPipeline();
  }

  /**
   * Get ancestor sources from lookup/unionWith stages.
   * These are sources referenced in the pipeline but not via the `from` property.
   */
  getAncestorsFromStages(): Source<any>[] {
    return this._buildPipeline().getAncestorsFromStages();
  }

  /**
   * Internal: build the pipeline and return the Pipeline instance.
   */
  private _buildPipeline(): Pipeline<TInput, TOutput, "model", string> {
    // Start with an empty "model" mode pipeline (allows lookup from other models)
    const startPipeline = new Pipeline<TInput, TInput, "model", never>({
      pipeline: [],
    });

    // Execute pipeline function
    return this._pipelineFn(startPipeline);
  }

  /**
   * Build the complete aggregation pipeline including output stage.
   *
   * Delegates to `Pipeline#out` / `Pipeline#merge` so the emitted output
   * document goes through the same builders users would call.
   */
  buildPipeline(): Document[] {
    const userPipeline = this._buildPipeline();

    if (this.materialize.type === "view") {
      // Views are created separately, not via pipeline
      return userPipeline.getPipeline();
    }

    if (this.materialize.type === "collection") {
      const mode = this.materialize.mode;
      const outputCollection = this.getOutputCollectionName();
      const outputDb = this.getOutputDatabase();
      const target =
        outputDb ? { db: outputDb, coll: outputCollection } : outputCollection;

      if ("$out" in mode) {
        return userPipeline.out(target).getPipeline();
      }

      if ("$merge" in mode) {
        return userPipeline
          .merge({ ...mode.$merge, into: target })
          .getPipeline();
      }
    }

    return userPipeline.getPipeline();
  }
}
