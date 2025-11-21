/**
 * Typed Mongo Query Language (tmql)
 *
 * Main entry point for the tmql library.
 * Provides type-safe MongoDB aggregation pipeline building.
 */

export { TMPipeline } from "./pipeline/TMPipeline";
export type { InferOutputType } from "./pipeline/TMPipeline";

export { TMCollection } from "./collection/TMCollection";
export type { InferCollectionType } from "./collection/TMCollection";

// Re-export Document type for convenience
export type { Document } from "./utils/core";
