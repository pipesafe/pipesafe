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
  CollectionMode,
  TypedTimeSeriesOptions,
  ModelConfig,
} from "./model/Model";
// MergeOptions is the deprecated alias of MergeQuery — both re-exported for
// manifold consumers until the next major.
export type { MergeQuery, MergeOptions } from "@pipesafe/core";
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
