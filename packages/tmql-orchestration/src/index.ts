/**
 * tmql-orchestration
 *
 * DAG composition and orchestration layer for tmql.
 * Provides TMModel and TMProject for building data pipelines.
 */

// DAG Composition
export { TMModel, isTMModel } from "./model/TMModel";
export { TMProject } from "./project/TMProject";

// Type inference helpers
export type { InferModelOutput } from "./model/TMModel";
export type {
  MaterializeConfig,
  MergeOptions,
  CollectionMode,
  TypedTimeSeriesOptions,
  ModelConfig,
} from "./model/TMModel";
export type {
  ProjectConfig,
  RunOptions,
  ModelRunStats,
  ProjectRunResult,
  ExecutionPlan,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "./project/TMProject";
