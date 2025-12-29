/**
 * TMModel - DAG Pipeline Composition
 *
 * A model represents a named, materializable pipeline with typed input/output.
 * Models can depend on collections or other models, forming a DAG.
 */

import { TimeSeriesCollectionOptions } from "mongodb";
import { Document } from "../utils/core";
import { TMPipeline } from "../pipeline/TMPipeline";
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
  | { $out: Record<string, never> }
  | { $merge: MergeOptions<TOutput> };

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
 * from other TMModels (not just TMCollections).
 */
export type ModelConfig<
  TName extends string,
  TSource extends TMSource<Document>,
  TOutput extends Document,
  TMaterializeConfig extends MaterializeConfig<TOutput>,
> = {
  name: TName;
  /** Source collection or upstream model */
  from: TSource;
  /** Pipeline function - receives a "model" mode pipeline that can lookup from other models */
  pipeline: (
    p: TMPipeline<InferSourceType<TSource>, InferSourceType<TSource>, "model">
  ) => TMPipeline<InferSourceType<TSource>, TOutput, "model">;
  /** Materialization configuration - required */
  materialize: TMaterializeConfig;
};

// ============================================================================
// Model Type Helpers
// ============================================================================

/**
 * Extract the output document type from a TMModel.
 */
export type InferModelOutput<T> =
  T extends TMModel<any, any, infer O, any> ? O : never;

/**
 * Type predicate to check if a value is a TMModel.
 */
export function isTMModel(value: unknown): value is TMModel {
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
export class TMModel<
  TName extends string = string,
  TInput extends Document = Document,
  TOutput extends Document = Document,
  TMaterializeConfig extends
    MaterializeConfig<TOutput> = MaterializeConfig<TOutput>,
> implements TMSource<TOutput>
{
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

  /** TMSource discriminator */
  readonly sourceType = "model" as const;

  readonly name: TName;
  readonly materialize: TMaterializeConfig;

  // Phantom types for inference (not used at runtime)
  readonly __inputType!: TInput;
  readonly __outputType!: TOutput;

  private readonly _from: TMSource<TInput>;
  private readonly _pipelineFn: (
    p: TMPipeline<TInput, TInput, "model">
  ) => TMPipeline<TInput, TOutput, "model">;

  constructor(
    config: ModelConfig<TName, TMSource<TInput>, TOutput, TMaterializeConfig>
  ) {
    this.name = config.name;
    this._from = config.from as TMSource<TInput>;
    this._pipelineFn = config.pipeline as (
      p: TMPipeline<TInput, TInput, "model">
    ) => TMPipeline<TInput, TOutput, "model">;
    this.materialize = config.materialize;
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
  sourceIsModel(): boolean {
    return isTMModel(this._from);
  }

  /**
   * Get the upstream model if source is a model, otherwise undefined.
   */
  getUpstreamModel(): TMModel<string, any, TInput, any> | undefined {
    if (this.sourceIsModel()) {
      return this._from as TMModel<string, any, TInput, any>;
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
  getAncestorsFromStages(): TMSource<any>[] {
    return this._buildPipeline().getAncestorsFromStages();
  }

  /**
   * Internal: build the pipeline and return the TMPipeline instance.
   */
  private _buildPipeline(): TMPipeline<TInput, TOutput, "model"> {
    // Start with an empty "model" mode pipeline (allows lookup from other models)
    const startPipeline = new TMPipeline<TInput, TInput, "model">({
      pipeline: [],
    });

    // Execute pipeline function
    return this._pipelineFn(startPipeline);
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
    const outputCollection = this.getOutputCollectionName();
    const outputDb = this.getOutputDatabase();

    if (this.materialize.type === "view") {
      // Views are created separately, not via pipeline
      return null;
    }

    if (this.materialize.type === "collection") {
      const mode = this.materialize.mode;

      if ("$out" in mode) {
        return outputDb ?
            { $out: { db: outputDb, coll: outputCollection } }
          : { $out: outputCollection };
      }

      if ("$merge" in mode) {
        const into =
          outputDb ?
            { db: outputDb, coll: outputCollection }
          : outputCollection;

        return {
          $merge: {
            into,
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
