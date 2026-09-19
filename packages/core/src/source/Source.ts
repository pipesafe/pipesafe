/**
 * Source - Unified Source Type
 *
 * Shared type definitions for sources that can be used in pipelines.
 * This file exists to avoid circular imports between Pipeline and Model.
 */

/**
 * Interface that both Collection and Model implement.
 * Allows them to be used interchangeably as pipeline sources.
 */
export interface Source<T = unknown> {
  /** Discriminator for runtime type checking */
  readonly sourceType: "collection" | "model";

  /**
   * Get the collection name to query from.
   * - For collections: returns the collection name
   * - For models: returns the output collection name
   */
  getOutputCollectionName(): string;

  /**
   * Get the database name for this source.
   * - For collections: returns the configured database name (or undefined for default)
   * - For models: returns the output database (or undefined for default)
   */
  getOutputDatabase(): string | undefined;

  /** @internal Phantom type for inference - do not use directly */
  readonly __outputType: T;
}

/**
 * Infer document type from a Source.
 * Uses the __outputType phantom property on Collection and Model.
 */
export type InferSourceType<S> =
  S extends { __outputType: infer T } ? T : never;
