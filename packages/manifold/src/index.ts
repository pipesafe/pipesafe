/**
 * PipeSafe Manifold
 *
 * DAG composition and orchestration layer for @pipesafe/core.
 * Provides Model and Project for building data pipelines.
 */

// DAG Composition
export { Model, isModel } from "./model/Model";
export { Project } from "./project/Project";

// Type inference helpers
export type { InferModelOutput } from "./model/Model";
export type {
  MaterializeConfig,
  MergeOptions,
  CollectionMode,
  TypedTimeSeriesOptions,
  ModelConfig,
} from "./model/Model";
export type {
  ProjectConfig,
  RunOptions,
  ModelRunStats,
  ProjectRunResult,
  ExecutionPlan,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "./project/Project";
