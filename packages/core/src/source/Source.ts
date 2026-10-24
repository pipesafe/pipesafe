/**
 * Source - Unified Source Type
 *
 * Shared type definitions for sources that can be used in pipelines.
 * This file exists to avoid circular imports between Pipeline and Model.
 */

import type { CollectionConfig, DbConfig } from "../database/config";

/**
 * Interface that both Collection and Model implement.
 * Allows them to be used interchangeably as pipeline sources.
 */
export interface Source<T = unknown> {
  /** Discriminator for runtime type checking */
  readonly sourceType: "collection" | "model";

  /**
   * Database to read from: a collection's configured db, or a model's output
   * db. Undefined defers to the caller's default (e.g. `Project.run({ db })`,
   * else the client's default database).
   */
  getOutputDb(): DbConfig | undefined;

  /** Collection to read from: a collection itself, or a model's output. */
  getOutputCollection(): CollectionConfig;

  /** @internal Phantom type for inference - do not use directly */
  readonly __outputType: T;
}

/**
 * Infer document type from a Source.
 * Uses the __outputType phantom property on Collection and Model.
 */
export type InferSourceType<S> =
  S extends { __outputType: infer T } ? T : never;
