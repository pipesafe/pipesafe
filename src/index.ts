/**
 * Typed Mongo Query Language (tmql)
 *
 * Main entry point for the tmql library.
 * Provides type-safe MongoDB aggregation pipeline building.
 */

export { tmql } from "./singleton/tmql";

export { TMPipeline } from "./pipeline/TMPipeline";
export type { InferOutputType, LookupMode } from "./pipeline/TMPipeline";

export { TMCollection } from "./collection/TMCollection";
export type { InferCollectionType } from "./collection/TMCollection";

// DAG Pipeline Composition
export { TMModel, TMProject, createModel } from "./model";
export type {
  // Model types
  ModelConfig,
  MaterializeConfig,
  TypedTimeSeriesOptions,
  // Mode types
  CollectionMode,
  MergeOptions,
  // Model helpers
  ModelName,
  ModelInput,
  ModelOutput,
  ModelMaterialize,
  IsEphemeral,
  InferModelOutput,
} from "./model";
export type {
  // Project types
  ProjectConfig,
  RunOptions,
  ModelRunStats,
  ProjectRunResult,
  ExecutionPlan,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "./model";
// TMSource - unified source type for model-aware lookups
export type { TMSource, InferSourceType } from "./source/TMSource";

// Re-export core types for convenience
export type { Document, Prettify } from "./utils/core";
export type {
  FieldSelector,
  FieldSelectorsThatInferTo,
  TopLevelField,
} from "./elements/fieldSelector";
