/**
 * PipeSafe Core
 *
 * Main entry point for the @pipesafe/core library.
 * Provides type-safe MongoDB aggregation pipeline building.
 */

// Core
export { pipesafe } from "./singleton/pipesafe";
export { Pipeline } from "./pipeline/Pipeline";
export { Collection } from "./collection/Collection";

// Type inference helpers
export type { InferOutputType, LookupMode } from "./pipeline/Pipeline";
export type { InferCollectionType } from "./collection/Collection";
export type { Source, InferSourceType } from "./source/Source";
export type { Document, Prettify } from "./utils/core";

// Re-export commonly used types from elements for advanced usage
export type {
  FieldSelector,
  GetFieldType,
  InferFieldSelector,
  FieldSelectorsThatInferTo,
  TopLevelField,
} from "./elements/fieldSelector";
export type {
  FieldReference,
  FieldPath,
  InferFieldReference,
} from "./elements/fieldReference";

// Type assertion utilities (for testing type inference)
export type {
  Assert,
  Equal,
  IsAssignable,
  NotImplemented,
  ExpectAssertFailure,
} from "./utils/tests";
export { expectType, assertTypeEqual } from "./utils/tests";

// Test utilities
export { useMemoryMongo } from "./utils/useMemoryMongo";
