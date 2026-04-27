import { FieldReferencesThatInferTo } from "../elements/fieldReference";
import { Document } from "../utils/core";

type TimeSeriesGranularity =
  | { granularity: "seconds" | "minutes" | "hours" }
  | { bucketMaxSpanSeconds: number; bucketRoundingSeconds: number };

type TimeSeriesSpec<Schema extends Document> = {
  timeField: FieldReferencesThatInferTo<Schema, Date>;
  metaField?: Exclude<FieldReferencesThatInferTo<Schema, any>, "$_id">;
} & TimeSeriesGranularity;

export type OutQuery<Schema extends Document> =
  | string
  | { db: string; coll: string; timeseries?: TimeSeriesSpec<Schema> };
