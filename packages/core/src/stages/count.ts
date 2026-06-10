import { PassThrough } from "../utils/errors";
import { Document } from "../utils/objects";

/**
 * `$count` produces a single document with one numeric field whose
 * name is the string passed to the stage.
 *
 * PassThrough forwards a branded `PipeSafeError` schema unchanged — without
 * it, an upstream error would be silently replaced by the count document
 * (spec F2).
 *
 * NOTE: the `Schema` parameter was added in the stage-trio standardization
 * (docs/type-standardisation-plan.md §3.1/Phase 3). This is a breaking
 * change to the exported signature — a same-name compat alias for the old
 * single-parameter form is not possible (one exported name cannot carry two
 * arities, and a legacy `ResolveCountOutput<"total">` call cannot satisfy
 * `Schema extends Document`).
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
