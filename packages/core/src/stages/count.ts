import { PassThrough } from "../utils/errors";
import { Document } from "../utils/objects";

/**
 * `$count` takes the output field's name. Schema-free scalar Query
 * exported so `Pipeline.count` references the module's type
 * rather than an inline `string`.
 */
export type CountQuery = string;

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
