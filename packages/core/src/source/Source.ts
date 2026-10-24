/**
 * Source - Unified Source Type
 *
 * Shared type definitions for sources that can be used in pipelines.
 * This file exists to avoid circular imports between Pipeline and Model.
 */

import type { CollectionConfig } from "../database/config";

/**
 * Interface that both Collection and Model implement.
 * Allows them to be used interchangeably as pipeline sources.
 */
export interface Source<
  T = unknown,
  Db extends string | undefined = string | undefined,
> {
  /** Discriminator for runtime type checking */
  readonly sourceType: "collection" | "model";

  /** Collection to read from: a collection itself, or a model's output. */
  getOutputCollection(): CollectionConfig;

  /** @internal Phantom type for inference - do not use directly */
  readonly __outputType: T;

  /**
   * @internal Phantom database name: `undefined` resolves in the reading
   * pipeline's database, a literal is checked, `string` is unchecked.
   */
  readonly __outputDb: Db;
}

/** The database a Source lives in (see `Source.__outputDb`). */
export type InferSourceDb<S> =
  S extends { __outputDb: infer Db } ? Db : undefined;

/**
 * Infer document type from a Source.
 * Uses the __outputType phantom property on Collection and Model.
 */
export type InferSourceType<S> =
  S extends { __outputType: infer T } ? T : never;
