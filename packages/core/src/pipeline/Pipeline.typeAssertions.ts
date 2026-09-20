/**
 * Type assertions for Pipeline stage chaining
 *
 * These tests verify that each stage can see fields added by previous stages.
 * This validates that PreviousStageDocs is correctly passed through the pipeline.
 *
 * Pattern: .set() a new field, then use that field in the next stage
 */

import { InferOutputType, Pipeline } from "./Pipeline";
import { Collection } from "../collection/Collection";
import { Assert, Equal } from "../utils/tests";
import { PipeSafeError } from "../utils/errors";
import { ResolveMatchOutput } from "../stages/match";
import { ResolveSetOutput } from "../stages/set";
import { ResolveProjectOutput } from "../stages/project";
import { ResolveUnwindOutput } from "../stages/unwind";
import { ResolveReplaceRootOutput } from "../stages/replaceRoot";
import { ResolveSkipOutput } from "../stages/skip";
import { ResolveLimitOutput } from "../stages/limit";
import { ResolveSortOutput } from "../stages/sort";
import { ResolveSampleOutput } from "../stages/sample";
import { ResolveUnsetOutput } from "../stages/unset";
import { ResolveGroupOutput } from "../stages/group";
import { ResolveLookupOutput } from "../stages/lookup";
import { ResolveUnionWithOutput } from "../stages/unionWith";
import { ResolveFacetOutput } from "../stages/facet";

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

const _p = new Pipeline<TestDoc, TestDoc>();

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
const _otherCollection = {} as Collection<OtherDoc>;

const _setThenLookup = _p.set({ lookupKey: "$_id" }).lookup({
  from: _otherCollection,
  localField: "lookupKey", // Uses lookupKey from previous set
  foreignField: "refId",
  as: "related",
});

// =============================================================================
// Test: .lookup() with `let` — bindings infer against the OUTER schema and
// resolve, accurately typed, inside every sub-pipeline stage; `$$ROOT`
// there is the FOREIGN document.
// =============================================================================
const _lookupWithLet = _p.lookup({
  from: _otherCollection,
  as: "picked",
  let: { outerName: "$name", bonus: "$value" },
  pipeline: (p) =>
    p.set({
      fromOuter: "$$outerName",
      boosted: { $add: ["$$bonus", 1] },
      foreignId: "$$ROOT._id",
    }),
});
type _LookupLetSubOutput = Assert<
  Equal<
    InferOutputType<typeof _lookupWithLet>["picked"],
    {
      _id: string;
      refId: string;
      data: string;
      fromOuter: string;
      boosted: number;
      foreignId: string;
    }[]
  >
>;

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
  _lookupWithLet,
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

// ============================================================================
// Short-circuit propagation
// ============================================================================
// Each `Resolve<Stage>Output<Schema, ...>` is wrapped in `PassThrough<Schema,
// ...>`. When Schema is already a branded `PipeSafeError`, every stage is a
// no-op so the user sees the original upstream error, not a fresh constraint
// failure piled on top.

type _Err = PipeSafeError<"upstream">;

// Each stage's Resolve type, fed an error schema, produces the same error.
type _MatchPassthrough = Assert<
  Equal<ResolveMatchOutput<_Err, { x: 1 }>, _Err>
>;
type _SetPassthrough = Assert<Equal<ResolveSetOutput<_Err, { x: 1 }>, _Err>>;
type _ProjectPassthrough = Assert<
  Equal<ResolveProjectOutput<_Err, { x: 1 }>, _Err>
>;
type _UnwindPassthrough = Assert<
  Equal<ResolveUnwindOutput<_Err, "x", never>, _Err>
>;
type _ReplaceRootPassthrough = Assert<
  Equal<ResolveReplaceRootOutput<_Err, { newRoot: "$x" }>, _Err>
>;
type _SkipPassthrough = Assert<Equal<ResolveSkipOutput<_Err>, _Err>>;
type _LimitPassthrough = Assert<Equal<ResolveLimitOutput<_Err>, _Err>>;
type _SortPassthrough = Assert<Equal<ResolveSortOutput<_Err>, _Err>>;
type _SamplePassthrough = Assert<Equal<ResolveSampleOutput<_Err>, _Err>>;
type _UnsetPassthrough = Assert<Equal<ResolveUnsetOutput<_Err, "x">, _Err>>;
type _GroupPassthrough = Assert<
  Equal<ResolveGroupOutput<_Err, { _id: null }>, _Err>
>;
type _LookupPassthrough = Assert<
  Equal<ResolveLookupOutput<_Err, "joined", { id: string }>, _Err>
>;
type _UnionWithPassthrough = Assert<
  Equal<ResolveUnionWithOutput<_Err, { id: string }>, _Err>
>;
type _FacetPassthrough = Assert<Equal<ResolveFacetOutput<_Err, {}>, _Err>>;

// Distributive case: Schema = Doc | PipeSafeError → output keeps the error
// branch and computes for the doc branch. Each branch is independent.
type _DocOrErr = { x: number } | _Err;
type _MatchDistributes = Assert<
  Equal<ResolveMatchOutput<_DocOrErr, { x: 1 }>, { x: number } | _Err>
>;

// Negative: a fully valid schema does NOT produce a brand at the leaf.
type _ValidNoLeak = ResolveMatchOutput<{ x: number; y: string }, { x: 1 }>;
type _ValidNoLeakAssert = Assert<Equal<_ValidNoLeak, { x: number; y: string }>>;

export type {
  _LookupLetSubOutput,
  _MatchPassthrough,
  _SetPassthrough,
  _ProjectPassthrough,
  _UnwindPassthrough,
  _ReplaceRootPassthrough,
  _SkipPassthrough,
  _LimitPassthrough,
  _SortPassthrough,
  _SamplePassthrough,
  _UnsetPassthrough,
  _GroupPassthrough,
  _LookupPassthrough,
  _UnionWithPassthrough,
  _FacetPassthrough,
  _MatchDistributes,
  _ValidNoLeakAssert,
};
