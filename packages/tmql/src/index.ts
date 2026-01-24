/**
 * Typed Mongo Query Language (tmql)
 *
 * Main entry point for the tmql core library.
 * Provides type-safe MongoDB aggregation pipeline building.
 */

// Core
export { tmql } from "./singleton/tmql";
export { TMPipeline } from "./pipeline/TMPipeline";
export { TMCollection } from "./collection/TMCollection";

// Type inference helpers
export type { InferOutputType, LookupMode } from "./pipeline/TMPipeline";
export type { InferCollectionType } from "./collection/TMCollection";
export type { TMSource, InferSourceType } from "./source/TMSource";
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
