import { Document } from "../utils/core";

/**
 * `$count` produces a single document with one numeric field whose
 * name is the string passed to the stage.
 *
 * @example
 *   .count("total") // → { total: number }
 */
export type ResolveCountOutput<FieldName extends string> =
  FieldName extends "" ? Document : Record<FieldName, number>;
