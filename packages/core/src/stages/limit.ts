import { Document } from "../utils/objects";
import { PassThrough } from "../utils/errors";

/**
 * `$limit` takes a positive document count. Schema-free scalar Query
 * (§3.1/§7.2): exported so `Pipeline.limit` references the module's type
 * rather than an inline scalar.
 */
export type LimitQuery = number;

/**
 * `$limit` is a passthrough stage: it does not change the document schema,
 * only the number of documents flowing through the pipeline. PassThrough
 * additionally forwards a branded `PipeSafeError` schema unchanged.
 */
export type ResolveLimitOutput<Schema extends Document> = PassThrough<
  Schema,
  Schema
>;
