import { Document } from "../utils/core";
import { FieldSelector, TopLevelField } from "../elements/fieldSelector";

/**
 * Type-safe options for the `$merge` stage.
 *
 * @template TOutput The document shape entering the `$merge` stage.
 *                   `on` is constrained to top-level field names of this type.
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/
 */
export type MergeOptions<TOutput extends Document> = {
  /**
   * The output collection.
   * Either a collection name in the current database, or a `{ db, coll }` pair
   * targeting another database.
   */
  into: string | { db: string; coll: string };
  /**
   * Field(s) used to identify a matching document in the output collection.
   * Must reference top-level fields of the output document type.
   * Defaults to `_id` when omitted (per MongoDB).
   */
  on?:
    | TopLevelField<FieldSelector<TOutput>>
    | TopLevelField<FieldSelector<TOutput>>[];
  /** Action to take when a document in the pipeline matches an existing document. */
  whenMatched?: "replace" | "merge" | "keepExisting" | "fail";
  /** Action to take when a document in the pipeline does not match an existing document. */
  whenNotMatched?: "insert" | "discard" | "fail";
  /**
   * Variables accessible inside `whenMatched` pipeline expressions.
   * Passed through unchanged to MongoDB.
   */
  let?: Record<string, unknown>;
};
