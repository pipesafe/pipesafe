/**
 * PipeSafe Manifold
 *
 * Transformation layer for @pipesafe/core: Model and Project for batch DAG
 * execution, plus the event-driven foundation (change-stream subscriptions
 * and dispatch strategies - scaffold) that reactive transformations and
 * @pipesafe/intake's ingestion consumers build on.
 */

// DAG Composition
export { Model, isModel } from "./model/Model";
export { Project } from "./project/Project";

// Event-driven foundation (scaffold - see packages/intake/ARCHITECTURE.md)
export type {
  ChangeSubscription,
  ChangeOperation,
} from "./events/Subscription";
export type {
  DispatchConfig,
  DispatchStrategy,
  WatcherBridgeDispatch,
  ChangeStreamWatcherDispatch,
  LedgerPollerDispatch,
} from "./events/Dispatch";

// Type inference helpers
export type { InferModelOutput } from "./model/Model";
export type {
  MaterializeConfig,
  CollectionMode,
  TypedTimeSeriesOptions,
  ModelConfig,
} from "./model/Model";
export type { MergeQuery } from "@pipesafe/core";
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
