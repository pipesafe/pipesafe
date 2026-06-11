import { PassThrough } from "../utils/errors";
import { Document } from "../utils/objects";

/**
 * `$count` produces a single document with one numeric field whose
 * name is the string passed to the stage.
 *
 * PassThrough forwards a branded `PipeSafeError` schema unchanged — without
 * it, an upstream error would be silently replaced by the count document.
 *
 * @example
 *   .count("total") // → { total: number }
 */
export type ResolveCountOutput<
  Schema extends Document,
  FieldName extends string,
> = PassThrough<
  Schema,
  FieldName extends "" ? Document : Record<FieldName, number>
>;
