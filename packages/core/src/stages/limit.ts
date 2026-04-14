import { Document } from "../utils/core";

/**
 * `$limit` is a passthrough stage: it does not change the document schema,
 * only the number of documents flowing through the pipeline.
 */
export type ResolveLimitOutput<Schema extends Document> = Schema;
