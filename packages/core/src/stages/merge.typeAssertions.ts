import { Assert, Equal, IsAssignable } from "../utils/tests";
import { MergeOptions, TopLevelFieldOf } from "./merge";
import type { Pipeline, InferOutputType } from "../pipeline/Pipeline";

/**
 * Type Resolution Behaviors for $merge Stage:
 *
 * 1. TERMINAL STAGE:
 *    `merge()` returns a Pipeline whose `PreviousStageDocs` is `never`,
 *    matching the existing terminal-stage behavior of `.out()`.
 *
 * 2. INTO TARGETS:
 *    `into` accepts either a collection name string or a `{ db, coll }` pair.
 *
 * 3. ON FIELD CONSTRAINTS:
 *    `on` is constrained to top-level fields of the pipeline's current document type.
 *    Dotted (nested) paths are rejected. Both single fields and arrays are accepted.
 *
 * 4. MATCH OPTIONS:
 *    `whenMatched` is restricted to the documented MongoDB literal union.
 *    `whenNotMatched` is restricted to the documented MongoDB literal union.
 *
 * 5. OPTIONAL CONFIG:
 *    `on`, `whenMatched`, `whenNotMatched`, and `let` are all optional;
 *    they match MongoDB's defaults when omitted.
 */

// ============================================================================
// Test Schemas
// ============================================================================

type EventDoc = {
  _id: string;
  eventType: string;
  timestamp: Date;
  user: { id: string; name: string };
};

type SimpleDoc = {
  _id: string;
  value: number;
};

// ============================================================================
// TopLevelFieldOf
// ============================================================================

// Test 1: TopLevelFieldOf returns top-level fields only (no dotted paths)
type EventTopLevel = TopLevelFieldOf<EventDoc>;
type ExpectedEventTopLevel = "_id" | "eventType" | "timestamp" | "user";
type _TopLevelFields = Assert<Equal<EventTopLevel, ExpectedEventTopLevel>>;

// Dotted path "user.id" is NOT a top-level field
type _DottedRejected = Assert<
  Equal<IsAssignable<"user.id", TopLevelFieldOf<EventDoc>>, false>
>;

// ============================================================================
// MergeOptions Shape
// ============================================================================

// Test 2: into as a string is accepted
const _intoString: MergeOptions<SimpleDoc> = { into: "metrics" };

// Test 3: into as { db, coll } is accepted
const _intoObject: MergeOptions<SimpleDoc> = {
  into: { db: "analytics", coll: "metrics" },
};

// Test 4: on as a single field
const _onSingle: MergeOptions<SimpleDoc> = { into: "x", on: "_id" };

// Test 5: on as an array of fields
const _onArray: MergeOptions<EventDoc> = {
  into: "x",
  on: ["_id", "eventType"],
};

// Test 6: incorrect field name in `on` is rejected
const _onInvalid: MergeOptions<SimpleDoc> = {
  into: "x",
  // @ts-expect-error - "missing" is not a top-level field of SimpleDoc
  on: "missing",
};

// Test 7: dotted path in `on` is rejected (must be top-level)
const _onDotted: MergeOptions<EventDoc> = {
  into: "x",
  // @ts-expect-error - "user.id" is a nested path, not top-level
  on: "user.id",
};

// Test 8: invalid whenMatched literal is rejected
const _whenMatchedInvalid: MergeOptions<SimpleDoc> = {
  into: "x",
  // @ts-expect-error - "upsert" is not a valid whenMatched action
  whenMatched: "upsert",
};

// Test 9: invalid whenNotMatched literal is rejected
const _whenNotMatchedInvalid: MergeOptions<SimpleDoc> = {
  into: "x",
  // @ts-expect-error - "skip" is not a valid whenNotMatched action
  whenNotMatched: "skip",
};

// Test 10: all valid whenMatched values
const _whenMatchedReplace: MergeOptions<SimpleDoc> = {
  into: "x",
  whenMatched: "replace",
};
const _whenMatchedMerge: MergeOptions<SimpleDoc> = {
  into: "x",
  whenMatched: "merge",
};
const _whenMatchedKeep: MergeOptions<SimpleDoc> = {
  into: "x",
  whenMatched: "keepExisting",
};
const _whenMatchedFail: MergeOptions<SimpleDoc> = {
  into: "x",
  whenMatched: "fail",
};

// Test 11: all valid whenNotMatched values
const _whenNotMatchedInsert: MergeOptions<SimpleDoc> = {
  into: "x",
  whenNotMatched: "insert",
};
const _whenNotMatchedDiscard: MergeOptions<SimpleDoc> = {
  into: "x",
  whenNotMatched: "discard",
};
const _whenNotMatchedFail: MergeOptions<SimpleDoc> = {
  into: "x",
  whenNotMatched: "fail",
};

// Test 12: let is accepted
const _withLet: MergeOptions<SimpleDoc> = {
  into: "x",
  let: { threshold: 10, label: "$value" },
};

// ============================================================================
// Pipeline Integration - Terminal Behavior
// ============================================================================

// Test 13: .merge() returns a Pipeline whose PreviousStageDocs is `never`
declare const samplePipeline: Pipeline<SimpleDoc, SimpleDoc, "runtime", never>;
const merged = samplePipeline.merge({ into: "metrics" });
type MergedOutput = InferOutputType<typeof merged>;
type _TerminalReturnsNever = Assert<Equal<MergedOutput, never>>;

// Test 14: $merge stage is recorded in UsedStages
type MergedStages = (typeof merged)["_usedStages"];
type _StageTracked = Assert<Equal<MergedStages, "$merge">>;

// Test 15: incorrect on field is rejected at the .merge() call site
samplePipeline.merge({
  into: "x",
  // @ts-expect-error - "missing" is not a top-level field
  on: "missing",
});

// Test 16: cross-db into shape is accepted at the .merge() call site
samplePipeline.merge({ into: { db: "analytics", coll: "metrics" } });

// Test 17: Backward compat - users may still pass raw $merge via .custom()
const _customMerge = samplePipeline.custom<SimpleDoc>([
  { $merge: { into: "metrics", on: "_id" } },
]);

// ============================================================================
// Satisfy linting
// ============================================================================

void _intoString;
void _intoObject;
void _onSingle;
void _onArray;
void _onInvalid;
void _onDotted;
void _whenMatchedInvalid;
void _whenNotMatchedInvalid;
void _whenMatchedReplace;
void _whenMatchedMerge;
void _whenMatchedKeep;
void _whenMatchedFail;
void _whenNotMatchedInsert;
void _whenNotMatchedDiscard;
void _whenNotMatchedFail;
void _withLet;
void merged;
void _customMerge;

export type {
  _TopLevelFields,
  _DottedRejected,
  _TerminalReturnsNever,
  _StageTracked,
};
