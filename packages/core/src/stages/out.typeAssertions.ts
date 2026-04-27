import { Assert, Equal, IsAssignable } from "../utils/tests";
import { OutQuery } from "./out";

/**
 * Type Resolution Behaviors for $out Stage:
 *
 * FEATURES:
 * 1. STRING SHORTHAND:
 *    A bare string is accepted as the output collection name.
 *
 * 2. DB + COLL FORM:
 *    `{ db, coll }` writes to a specific database and collection.
 *    `timeseries` is optional and only applies when materialising a
 *    time-series collection.
 *
 * 3. TIME-SERIES `timeField`:
 *    Constrained to field references whose inferred type is `Date`.
 *    Nested Date fields (e.g. `"$audit.createdAt"`) are valid.
 *
 * 4. TIME-SERIES `metaField`:
 *    Optional. Accepts any field reference except `"$_id"`, mirroring
 *    MongoDB's restriction that `_id` cannot be used as the meta field.
 *
 * 5. GRANULARITY UNION:
 *    Time-series spec accepts EITHER a preset `granularity`
 *    ("seconds" | "minutes" | "hours") OR a custom bucket window via
 *    `bucketMaxSpanSeconds` + `bucketRoundingSeconds`.
 *
 * These tests use Assert<Equal> and Assert<IsAssignable> to validate
 * the input shape of the $out stage.
 */

// ============================================================================
// Test schema
// ============================================================================
type EventsSchema = {
  _id: string;
  timestamp: Date;
  receivedAt: Date;
  meta: { device: string; region: string };
  count: number;
};

// ============================================================================
// Test 1: String shorthand for output collection name
// ============================================================================
type StringFormTest = Assert<IsAssignable<"events", OutQuery<EventsSchema>>>;

// ============================================================================
// Test 2: { db, coll } form without timeseries
// ============================================================================
type DbCollFormTest = Assert<
  IsAssignable<{ db: "warehouse"; coll: "events" }, OutQuery<EventsSchema>>
>;

// ============================================================================
// Test 3: Time-series with granularity preset
// ============================================================================
type GranularityTest = Assert<
  IsAssignable<
    {
      db: "warehouse";
      coll: "events";
      timeseries: {
        timeField: "$timestamp";
        granularity: "seconds";
      };
    },
    OutQuery<EventsSchema>
  >
>;

// ============================================================================
// Test 4: Time-series with custom bucket window
// ============================================================================
type BucketParamsTest = Assert<
  IsAssignable<
    {
      db: "warehouse";
      coll: "events";
      timeseries: {
        timeField: "$timestamp";
        bucketMaxSpanSeconds: 3600;
        bucketRoundingSeconds: 60;
      };
    },
    OutQuery<EventsSchema>
  >
>;

// ============================================================================
// Test 5: Optional metaField referencing a non-_id field
// ============================================================================
type MetaFieldTest = Assert<
  IsAssignable<
    {
      db: "warehouse";
      coll: "events";
      timeseries: {
        timeField: "$timestamp";
        metaField: "$meta";
        granularity: "minutes";
      };
    },
    OutQuery<EventsSchema>
  >
>;

// ============================================================================
// Test 6: metaField rejects "$_id"
// ============================================================================
type MetaFieldExcludesIdTest = Assert<
  Equal<
    IsAssignable<
      {
        db: "warehouse";
        coll: "events";
        timeseries: {
          timeField: "$timestamp";
          metaField: "$_id";
          granularity: "seconds";
        };
      },
      OutQuery<EventsSchema>
    >,
    false
  >
>;

// ============================================================================
// Test 7: timeField rejects non-Date fields
// ============================================================================
type TimeFieldDateOnlyTest = Assert<
  Equal<
    IsAssignable<
      {
        db: "warehouse";
        coll: "events";
        timeseries: {
          timeField: "$count";
          granularity: "seconds";
        };
      },
      OutQuery<EventsSchema>
    >,
    false
  >
>;

// ============================================================================
// Test 8: Nested Date field paths are valid timeFields
// ============================================================================
type NestedSchema = {
  _id: string;
  audit: { createdAt: Date };
  meta: { source: string };
};

type NestedTimeFieldTest = Assert<
  IsAssignable<
    {
      db: "warehouse";
      coll: "events";
      timeseries: {
        timeField: "$audit.createdAt";
        granularity: "hours";
      };
    },
    OutQuery<NestedSchema>
  >
>;

export type {
  StringFormTest,
  DbCollFormTest,
  GranularityTest,
  BucketParamsTest,
  MetaFieldTest,
  MetaFieldExcludesIdTest,
  TimeFieldDateOnlyTest,
  NestedTimeFieldTest,
};
