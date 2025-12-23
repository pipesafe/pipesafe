/**
 * TMSource - Unified Source Type
 *
 * Shared type definitions for sources that can be used in pipelines.
 * This file exists to avoid circular imports between TMPipeline and TMModel.
 */

/**
 * Interface that both TMCollection and TMModel implement.
 * Allows them to be used interchangeably as pipeline sources.
 */
export interface TMSource<T = unknown> {
  /** Discriminator for runtime type checking */
  readonly sourceType: "collection" | "model";

  /**
   * Check if this source is ephemeral (has no backing collection).
   * Collections always return false. Ephemeral models return true.
   */
  isEphemeral(): boolean;

  /**
   * Get the collection name to query from.
   * - For collections: returns the collection name
   * - For materialized models: returns the output collection name
   * - For ephemeral models: returns undefined
   */
  getOutputCollectionName(): string | undefined;

  /** @internal Phantom type for inference - do not use directly */
  readonly __outputType: T;
}

/**
 * Infer document type from a TMSource.
 * Uses the __outputType phantom property on TMCollection and TMModel.
 */
export type InferSourceType<S> =
  S extends { __outputType: infer T } ? T : never;

/**
 * Get collection name from a TMSource.
 * Throws if source is an ephemeral model (no collection to query from).
 */
export function getSourceCollectionName(source: TMSource): string {
  if (source.isEphemeral()) {
    const name =
      "name" in source ? (source as { name: string }).name : "unknown";
    throw new Error(
      `Cannot use ephemeral model "${name}" in lookup/unionWith. ` +
        `Ephemeral models must be materialized first (use type: "collection" or "view").`
    );
  }
  return source.getOutputCollectionName()!;
}
