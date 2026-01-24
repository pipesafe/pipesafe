/**
 * Typed Mongo Query Language (tmql)
 *
 * Main entry point for the tmql library.
 * Provides type-safe MongoDB aggregation pipeline building.
 */

// Core
export { tmql } from "./singleton/tmql";
export { TMPipeline } from "./pipeline/TMPipeline";
export { TMCollection } from "./collection/TMCollection";

// DAG Composition
export { TMModel, isTMModel } from "./model/TMModel";
export { TMProject } from "./project/TMProject";

// Type inference helpers
export type { InferOutputType } from "./pipeline/TMPipeline";
export type { InferCollectionType } from "./collection/TMCollection";
export type { InferModelOutput } from "./model/TMModel";
export type { TMSource, InferSourceType } from "./source/TMSource";
export type { Document, Prettify } from "./utils/core";

// Type assertion utilities (for testing type inference)
export type {
  Assert,
  Equal,
  IsAssignable,
  NotImplemented,
  ExpectAssertFailure,
} from "./utils/tests";
export { expectType, assertTypeEqual } from "./utils/tests";
