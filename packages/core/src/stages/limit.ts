import { Document } from "../utils/objects";
import { PassThrough } from "../utils/errors";

/**
 * `$limit` is a passthrough stage: it does not change the document schema,
 * only the number of documents flowing through the pipeline. PassThrough
 * additionally forwards a branded `PipeSafeError` schema unchanged.
 */
export type ResolveLimitOutput<Schema extends Document> = PassThrough<
  Schema,
  Schema
>;
