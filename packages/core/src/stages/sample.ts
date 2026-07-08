import { Document } from "../utils/objects";
import { PassThrough } from "../utils/errors";

/**
 * Options for `$sample`. Mirrors the MongoDB shape so values can be
 * copy-pasted from the MongoDB documentation.
 */
export type SampleQuery = { size: number };

/**
 * `$sample` is a passthrough stage: it randomly selects `size` documents
 * but does not change the document schema. PassThrough additionally forwards
 * a branded `PipeSafeError` schema unchanged.
 */
export type ResolveSampleOutput<Schema extends Document> = PassThrough<
  Schema,
  Schema
>;
