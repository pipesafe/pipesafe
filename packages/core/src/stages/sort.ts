import { FieldSelector } from "../elements/fieldSelector";
import { Document } from "../utils/objects";
import { PassThrough } from "../utils/errors";

export type SortDirection = 1 | -1;

export type SortValue = SortDirection | { $meta: "textScore" | "indexKey" };

/**
 * Sort specification: field selectors map to 1 (ascending), -1 (descending),
 * or $meta. Constrained to known schema fields — typos like
 * `pipeline.sort({ naem: 1 })` against a schema with `name` are now flagged
 * by TypeScript ("Object literal may only specify known properties, and
 * 'naem' does not exist in type 'SortQuery<Schema>'") rather than silently
 * accepted via a permissive index signature. MongoDB itself permits unknown
 * field names at runtime, but the typed API should match the user's schema.
 */
export type SortQuery<Schema extends Document> = {
  [K in FieldSelector<Schema>]?: SortValue;
};

export type ResolveSortOutput<Schema extends Document> = PassThrough<
  Schema,
  Schema
>;
