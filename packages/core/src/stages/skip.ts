import { Document } from "../utils/objects";
import { PassThrough } from "../utils/errors";

/**
 * `$skip` is a passthrough stage: it does not change the document schema,
 * only which documents flow through the pipeline. PassThrough additionally
 * forwards a branded `PipeSafeError` schema unchanged.
 */
export type ResolveSkipOutput<Schema extends Document> = PassThrough<
  Schema,
  Schema
>;
