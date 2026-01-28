import { FieldSelector } from "../elements/fieldSelector";
import { Document } from "../utils/core";

export type SortDirection = 1 | -1;

export type SortValue = SortDirection | { $meta: "textScore" | "indexKey" };

/**
 * Sort specification: field selectors map to 1 (ascending), -1 (descending), or $meta
 */
export type SortQuery<Schema extends Document> = {
  [K in FieldSelector<Schema>]?: SortValue;
} & {
  [key: string]: SortValue;
};

export type ResolveSortOutput<Schema extends Document> = Schema;
