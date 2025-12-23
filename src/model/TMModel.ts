/**
 * TMModel - DAG Pipeline Composition
 *
 * A model represents a named, materializable pipeline with typed input/output.
 * Models can depend on collections or other models, forming a DAG.
 *
 * @see docs/rfc-001-dag-pipeline-composition.md
 */

import { TimeSeriesCollectionOptions } from "mongodb";
import { Document } from "../utils/core";
import { TMPipeline } from "../pipeline/TMPipeline";
import { TMCollection } from "../collection/TMCollection";
import {
  FieldSelector,
  FieldSelectorsThatInferTo,
  TopLevelField,
} from "../elements/fieldSelector";
import { TMSource, InferSourceType } from "../source/TMSource";

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
// Merge Options
// ============================================================================

/**
 * Type-safe $merge stage options.
 * MongoDB driver doesn't export typed $merge options.
 */
type TopLevelFieldOf<T extends Document> = TopLevelField<FieldSelector<T>>;

export type MergeOptions<TOutput extends Document> = {
  /** Field(s) to match on - must exist in output document */
  on: TopLevelFieldOf<TOutput> | TopLevelFieldOf<TOutput>[];
  /** Action when document matches existing */
  whenMatched?: "replace" | "merge" | "keepExisting" | "fail";
  /** Action when document doesn't match existing */
  whenNotMatched?: "insert" | "discard" | "fail";
};

export type CollectionMode<TOutput extends Document> =
  | "replace"
  | "append"
  | "upsert"
  | { $merge: MergeOptions<TOutput> };

// ============================================================================
// Materialization Configuration
// ============================================================================

/**
 * Materialization configuration.
 * `alias` is optional - defaults to the model's `name` (dbt convention).
 */
export type MaterializeConfig<TOutput extends Document = Document> =
  | { type: "ephemeral" }
  | { type: "view"; alias?: string; db?: string }
  | {
      type: "collection";
      alias?: string;
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
 * from other TMModels (not just TMCollections).
 */
export type ModelConfig<
  TName extends string,
  TSource extends TMSource<Document>,
  TOutput extends Document,
  TMat extends MaterializeConfig<TOutput>,
> = {
  name: TName;
  /** Source collection or upstream model */
  from: TSource;
  /** Pipeline function - receives a "model" mode pipeline that can lookup from other models */
  pipeline: (
    p: TMPipeline<InferSourceType<TSource>, InferSourceType<TSource>, "model">
  ) => TMPipeline<InferSourceType<TSource>, TOutput, "model">;
  materialize?: TMat;
};

// ============================================================================
// Model Type Helpers
// ============================================================================

export type ModelName<T> =
  T extends TMModel<infer N, any, any, any> ? N : never;
export type ModelInput<T> =
  T extends TMModel<any, infer I, any, any> ? I : never;
export type ModelOutput<T> =
  T extends TMModel<any, any, infer O, any> ? O : never;
export type ModelMaterialize<T> =
  T extends TMModel<any, any, any, infer M> ? M : never;

export type IsEphemeral<T extends TMModel<any, any, any, any>> =
  ModelMaterialize<T> extends { type: "ephemeral" } ? true : false;

// ============================================================================
// TMModel Class
// ============================================================================

/**
 * TMModel - A named, materializable pipeline with typed input/output.
 *
 * Models form a DAG through their `from` property. When `from` is another
 * model, that creates a dependency edge.
 *
 * @example
 * ```typescript
 * const stgEvents = new TMModel({
 *   name: "stg_events",
 *   from: RawEventsCollection,
 *   pipeline: (p) => p.match({ _deleted: { $ne: true } }),
 *   materialize: { type: "collection", mode: "replace" },
 * });
 *
 * const dailyMetrics = new TMModel({
 *   name: "daily_metrics",
 *   from: stgEvents, // DAG edge!
 *   pipeline: (p) => p.group({ _id: "$date", count: { $count: {} } }),
 *   materialize: { type: "collection", mode: "replace" },
 * });
 * ```
 */
export class TMModel<
  TName extends string = string,
  TInput extends Document = Document,
  TOutput extends Document = Document,
  TMat extends MaterializeConfig<TOutput> = MaterializeConfig<TOutput>,
> implements TMSource<TOutput>
{
  /** Runtime type identifier - survives minification */
  readonly type = "model" as const;

  /** TMSource discriminator */
  readonly sourceType = "model" as const;

  readonly name: TName;
  readonly materialize: TMat;

  // Phantom types for inference (not used at runtime)
  readonly __inputType!: TInput;
  readonly __outputType!: TOutput;

  private readonly _from: TMSource<TInput>;
  private readonly _pipelineFn: (
    p: TMPipeline<TInput, TInput, "model">
  ) => TMPipeline<TInput, TOutput, "model">;

  constructor(config: ModelConfig<TName, TMSource<TInput>, TOutput, TMat>) {
    this.name = config.name;
    this._from = config.from as TMSource<TInput>;
    this._pipelineFn = config.pipeline as (
      p: TMPipeline<TInput, TInput, "model">
    ) => TMPipeline<TInput, TOutput, "model">;
    this.materialize = (config.materialize ?? {
      type: "ephemeral",
    }) as TMat;
  }

  /**
   * Get the source (collection or upstream model).
   */
  getSource(): TMSource<TInput> {
    return this._from;
  }

  /**
   * Check if the source is a model (vs a collection).
   */
  isSourceModel(): boolean {
    return (
      typeof this._from === "object" &&
      this._from !== null &&
      "type" in this._from &&
      (this._from as any).type === "model"
    );
  }

  /**
   * Get the upstream model if source is a model, otherwise undefined.
   */
  getUpstreamModel(): TMModel<string, any, TInput, any> | undefined {
    if (this.isSourceModel()) {
      return this._from as TMModel<string, any, TInput, any>;
    }
    return undefined;
  }

  /**
   * Get the source collection name.
   * - If source is a collection: returns its name
   * - If source is a materialized model: returns the model's output collection
   * - If source is an ephemeral model: throws (must inline instead)
   */
  getSourceCollectionName(): string {
    if (this.isSourceModel()) {
      const upstreamModel = this._from as TMModel<string, any, TInput, any>;
      const outputCollection = upstreamModel.getOutputCollection();
      if (!outputCollection) {
        throw new Error(
          `Model "${this.name}" depends on ephemeral model "${upstreamModel.name}". ` +
            `Ephemeral models must be inlined, not referenced by collection name.`
        );
      }
      return outputCollection;
    }
    return (this._from as TMCollection<TInput>).getCollectionName();
  }

  /**
   * Check if this model is ephemeral (not materialized).
   */
  isEphemeral(): boolean {
    return this.materialize.type === "ephemeral";
  }

  /**
   * Get the output collection name (where this model materializes).
   * Returns undefined for ephemeral models.
   */
  getOutputCollection(): string | undefined {
    if (this.isEphemeral()) {
      return undefined;
    }

    // Use alias if provided, otherwise use model name
    if ("alias" in this.materialize && this.materialize.alias) {
      return this.materialize.alias;
    }

    return this.name;
  }

  /**
   * ITMSource implementation - alias for getOutputCollection().
   */
  getOutputCollectionName(): string | undefined {
    return this.getOutputCollection();
  }

  /**
   * Get the database name for output (if specified).
   */
  getOutputDatabase(): string | undefined {
    if (this.isEphemeral()) {
      return undefined;
    }
    if ("db" in this.materialize) {
      return this.materialize.db;
    }
    return undefined;
  }

  /**
   * Build the pipeline stages for this model.
   */
  getPipelineStages(): Document[] {
    // Start with an empty "model" mode pipeline (allows lookup from other models)
    const startPipeline = new TMPipeline<TInput, TInput, "model">({
      pipeline: [],
    });

    // If source is an ephemeral model, prepend its stages
    if (this.isSourceModel()) {
      const upstreamModel = this._from as TMModel<string, any, TInput, any>;
      if (upstreamModel.isEphemeral()) {
        const upstreamStages = upstreamModel.getPipelineStages();
        const withUpstream = new TMPipeline<TInput, TInput, "model">({
          pipeline: upstreamStages,
        });
        const result = this._pipelineFn(withUpstream);
        return result.getPipeline();
      }
    }

    // Execute pipeline function
    const result = this._pipelineFn(startPipeline);
    return result.getPipeline();
  }

  /**
   * Build the complete aggregation pipeline including output stage.
   */
  buildPipeline(): Document[] {
    const stages = this.getPipelineStages();

    // Add output stage based on materialization
    const outputStage = this.buildOutputStage();
    if (outputStage) {
      return [...stages, outputStage];
    }

    return stages;
  }

  /**
   * Build the $out or $merge stage based on materialization config.
   */
  private buildOutputStage(): Document | null {
    if (this.isEphemeral()) {
      return null;
    }

    const outputCollection = this.getOutputCollection()!;
    const outputDb = this.getOutputDatabase();

    if (this.materialize.type === "view") {
      // Views are created separately, not via pipeline
      return null;
    }

    if (this.materialize.type === "collection") {
      const mode = this.materialize.mode;

      if (mode === "replace") {
        // Use $out for full replacement
        return outputDb ?
            { $out: { db: outputDb, coll: outputCollection } }
          : { $out: outputCollection };
      }

      // All other modes use $merge
      const mergeInto =
        outputDb ? { db: outputDb, coll: outputCollection } : outputCollection;

      if (mode === "append") {
        return {
          $merge: {
            into: mergeInto,
            whenMatched: "fail",
            whenNotMatched: "insert",
          },
        };
      }

      if (mode === "upsert") {
        return {
          $merge: {
            into: mergeInto,
            on: "_id",
            whenMatched: "replace",
            whenNotMatched: "insert",
          },
        };
      }

      // Full $merge options
      if (typeof mode === "object" && "$merge" in mode) {
        return {
          $merge: {
            into: mergeInto,
            on: mode.$merge.on,
            whenMatched: mode.$merge.whenMatched ?? "replace",
            whenNotMatched: mode.$merge.whenNotMatched ?? "insert",
          },
        };
      }
    }

    return null;
  }
}

/**
 * Type helper to infer the output type of a model.
 */
export type InferModelOutput<T extends TMModel<any, any, any, any>> =
  T extends TMModel<any, any, infer O, any> ? O : never;

// ============================================================================
// Factory Function (for enhanced type inference)
// ============================================================================

/**
 * Create a new TMModel with enhanced type inference.
 *
 * This factory function uses TypeScript 5.0+ `const` type parameters
 * to automatically infer literal types for `name` and preserve
 * the exact shape of the materialization config.
 *
 * @example
 * ```typescript
 * // Type inference automatically captures literal "stg_events"
 * const stgEvents = createModel({
 *   name: "stg_events",
 *   from: RawEventsCollection,
 *   pipeline: (p) => p.match({ _deleted: { $ne: true } }),
 *   materialize: { type: "collection", mode: "replace" },
 * });
 *
 * // stgEvents.name is typed as "stg_events", not string
 * ```
 */
export function createModel<
  const TName extends string,
  const TFrom extends TMSource<any>,
  TOutput extends Document,
  const TMat extends MaterializeConfig<TOutput> = { type: "ephemeral" },
>(
  config: ModelConfig<TName, TFrom, TOutput, TMat>
): TMModel<TName, InferSourceType<TFrom>, TOutput, TMat> {
  return new TMModel(
    config as ModelConfig<
      TName,
      TMSource<InferSourceType<TFrom>>,
      TOutput,
      TMat
    >
  );
}
