import { Document } from "../utils/core";

/**
 * `$skip` is a passthrough stage: it does not change the document schema,
 * only which documents flow through the pipeline.
 */
export type ResolveSkipOutput<Schema extends Document> = Schema;
