/**
 * Type assertions for TMPipeline stage chaining
 *
 * These tests verify that each stage can see fields added by previous stages.
 * This validates that PreviousStageDocs is correctly passed through the pipeline.
 *
 * Pattern: .set() a new field, then use that field in the next stage
 */

import { TMPipeline } from "./TMPipeline";
import { TMCollection } from "../collection/TMCollection";

// =============================================================================
// Test Schema
// =============================================================================
type TestDoc = {
  _id: string;
  name: string;
  value: number;
  items: { id: string; price: number }[];
  createdAt: Date;
};

const _p = new TMPipeline<TestDoc, TestDoc>();

// =============================================================================
// Test: .set() then .set() - reference field from previous set
// =============================================================================
const _setThenSet = _p.set({ newField: "hello" }).set({ derived: "$newField" }); // Uses $newField from previous set

// =============================================================================
// Test: .set() then .match() - filter on new field
// =============================================================================
const _setThenMatch = _p
  .set({ status: "active" as const })
  .match({ status: "active" }); // Matches on status from previous set

// =============================================================================
// Test: .set() then .unset() - remove new field
// =============================================================================
const _setThenUnset = _p.set({ tempField: 123 }).unset("tempField"); // Unsets tempField from previous set

// =============================================================================
// Test: .set() then .group() - group by new field
// =============================================================================
const _setThenGroup = _p.set({ category: "test" }).group({
  _id: "$category", // Groups by category from previous set
  count: { $count: {} },
});

// =============================================================================
// Test: .set() then .project() - project new field
// =============================================================================
const _setThenProject = _p.set({ computed: { $add: ["$value", 10] } }).project({
  _id: 0,
  computed: 1, // Projects computed from previous set
  name: 1,
});

// =============================================================================
// Test: .set() then .sort() - sort by new field
// =============================================================================
const _setThenSort = _p
  .set({ sortKey: { $multiply: ["$value", -1] } })
  .sort({ sortKey: 1 }); // Sorts by sortKey from previous set

// =============================================================================
// Test: .set() then .unwind() - unwind new array field
// =============================================================================
const _setThenUnwind = _p.set({ tags: ["a", "b", "c"] }).unwind("$tags"); // Unwinds tags array from previous set

// =============================================================================
// Test: .set() then .replaceRoot() - use new field as root
// =============================================================================
const _setThenReplaceRoot = _p
  .set({ nested: { foo: "$name", bar: "$value" } })
  .replaceRoot({ newRoot: "$nested" }); // Uses nested from previous set

// =============================================================================
// Test: .set() then .lookup() - use new field as localField
// =============================================================================
type OtherDoc = { _id: string; refId: string; data: string };
const _otherCollection = {} as TMCollection<OtherDoc>;

const _setThenLookup = _p.set({ lookupKey: "$_id" }).lookup({
  from: _otherCollection,
  localField: "lookupKey", // Uses lookupKey from previous set
  foreignField: "refId",
  as: "related",
});

// =============================================================================
// Test: .group() then .set() - reference aggregated fields
// =============================================================================
const _groupThenSet = _p
  .group({
    _id: "$name",
    total: { $sum: "$value" },
  })
  .set({ doubled: { $multiply: ["$total", 2] } }); // Uses $total from group

// =============================================================================
// Test: Multiple chained .set() stages
// =============================================================================
const _chainedSets = _p
  .set({ field1: "a" })
  .set({ field2: "$field1" }) // Uses field1
  .set({ field3: "$field2" }) // Uses field2
  .set({ field4: "$field3" }); // Uses field3

// =============================================================================
// Test: .project() then .match() - match on projected fields
// =============================================================================
const _projectThenMatch = _p
  .project({
    _id: 1,
    computedName: { $literal: "computed" },
  })
  .match({ _id: { $exists: true } }) // Match works on projected output
  .match({ computedName: { $exists: true } }); // Can match on computed field from project

export {
  _setThenSet,
  _setThenMatch,
  _setThenUnset,
  _setThenGroup,
  _setThenProject,
  _setThenSort,
  _setThenUnwind,
  _setThenReplaceRoot,
  _setThenLookup,
  _groupThenSet,
  _chainedSets,
  _projectThenMatch,
};
