/**
 * PipeSafe Core
 *
 * Main entry point for the @pipesafe/core library.
 * Provides type-safe MongoDB aggregation pipeline building.
 */

// Core
export { pipesafe } from "./singleton/pipesafe";
export { tagClient } from "./singleton/tagClient";
export { Pipeline } from "./pipeline/Pipeline";
export { Collection } from "./collection/Collection";

// Type inference helpers
export type {
  InferOutputType,
  LookupMode,
  PipelineBuilder,
  LookupAllowedStages,
  UnionWithAllowedStages,
  FacetAllowedStages,
} from "./pipeline/Pipeline";
export type { InferCollectionType } from "./collection/Collection";
export type { Source, InferSourceType } from "./source/Source";
export type { Document, Prettify } from "./utils/objects";
export type {
  PipeSafeError,
  IsPipeSafeError,
  PassThrough,
} from "./utils/errors";

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

// Runtime operator-name lists — the same arrays the operator-key unions
// are derived from (grouped per kind, plus a spread combination each).
export {
  EQUALITY_MATCHERS,
  IN_MATCHERS,
  CONTINUOUS_MATCHERS,
  EXISTENCE_MATCHERS,
  SIZE_MATCHERS,
  ARRAY_ONLY_MATCHERS,
  ELEMENT_MATCHERS,
  REGEX_MATCHERS,
  NOT_MATCHERS,
  FIELD_MATCH_OPERATORS,
  LOGICAL_MATCH_OPERATORS,
  TOP_LEVEL_MATCH_OPERATORS,
} from "./stages/match";
export {
  ARRAY_EXPRESSION_OPERATORS,
  DATE_EXPRESSION_OPERATORS,
  ARITHMETIC_EXPRESSION_OPERATORS,
  STRING_EXPRESSION_OPERATORS,
  CONDITIONAL_EXPRESSION_OPERATORS,
  VARIABLE_EXPRESSION_OPERATORS,
  LITERAL_EXPRESSION_OPERATORS,
  COMPARISON_EXPRESSION_OPERATORS,
  EXPRESSION_OPERATORS,
} from "./elements/expressions";
export { ACCUMULATOR_OPERATORS } from "./stages/group";

// Stage type re-exports for advanced usage
export type { LimitQuery, ResolveLimitOutput } from "./stages/limit";
export type { SkipQuery, ResolveSkipOutput } from "./stages/skip";
export type { ResolveSampleOutput, SampleQuery } from "./stages/sample";
export type { CountQuery, ResolveCountOutput } from "./stages/count";

// Stage option types
export type { MergeQuery } from "./stages/merge";

// Type assertion utilities (for testing type inference)
export type {
  Assert,
  Equal,
  IsAssignable,
  NotImplemented,
  ExpectAssertFailure,
  AssertPipeSafeError,
} from "./utils/tests";
export { expectType, assertTypeEqual } from "./utils/tests";
