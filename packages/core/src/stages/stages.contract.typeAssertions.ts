/**
 * Stage contract conformance assertions — GROUPED BY STAGE.
 *
 * Each stage block below pins everything this file asserts about that
 * stage, so adding a stage means adding ONE block (and nothing else in
 * this file):
 *
 *   1. Resolver-level PassThrough — a `PipeSafeError` schema forwards
 *      verbatim. Only for stages NOT already covered by the "Short-circuit
 *      propagation" block in Pipeline.typeAssertions.ts (14 stages live
 *      there; this file does not duplicate them).
 *   2. Method-level error forwarding — the Pipeline method's RETURN type
 *      forwards an error schema: observable proof the method is wired to
 *      its module's resolver. Methods whose parameters cannot be
 *      constructed against an error schema without contortions (unwind,
 *      lookup, graphLookup, unionWith) are covered at the resolver level
 *      only.
 *   3. Query-alias wiring (§7.2) — the method's parameter references the
 *      module's Query type (scalar stages export schema-free aliases).
 *      These pins break if a parameter drifts from its module's alias
 *      (e.g. widening to `number | string`); identical-alias drift is
 *      caught by review/grep, which is why the aliases exist at all.
 *
 * Cross-stage OPERATOR-KEY DISPATCH semantics (forgiving inference, the
 * NotAnExpression sentinel, the exactly-one-operator brand, readonly
 * dependent-arm patterns) live in the final section — they are properties
 * of the expression kernel, not of any one stage.
 *
 * Notes:
 *   - sort's method-level assertion passes trivially because
 *     ResolveSortOutput<S> ≡ S; it pins the wiring, not behavior.
 *   - unwind's call-site brand is pinned by a fixture in
 *     Pipeline.callSite.typeAssertions.ts (a hover-quality concern, with no
 *     acceptance difference at the type level).
 */

import { Pipeline, InferOutputType } from "../pipeline/Pipeline";
import { Assert, Equal } from "../utils/tests";
import { NotAnExpression } from "../utils/dispatch";
import { PipeSafeError } from "../utils/errors";
import { CountQuery, ResolveCountOutput } from "./count";
import { LimitQuery } from "./limit";
import { SkipQuery } from "./skip";
import { ResolveGraphLookupOutput } from "./graphLookup";
import { InferExpression } from "../elements/expressions";
import { InferNestedFieldReference } from "../elements/fieldReference";

type _Err = PipeSafeError<"upstream">;

const _pErr = new Pipeline<_Err, _Err>();

// ============================================================================
// match
// ============================================================================

const _errMatch = _pErr.match({});
type _MatchMethodForwards = Assert<
  Equal<InferOutputType<typeof _errMatch>, _Err>
>;

// ============================================================================
// set
// ============================================================================

const _errSet = _pErr.set({});
type _SetMethodForwards = Assert<Equal<InferOutputType<typeof _errSet>, _Err>>;

// ============================================================================
// project
// ============================================================================

const _errProject = _pErr.project({});
type _ProjectMethodForwards = Assert<
  Equal<InferOutputType<typeof _errProject>, _Err>
>;

// ============================================================================
// group
// ============================================================================

const _errGroup = _pErr.group({ _id: null });
type _GroupMethodForwards = Assert<
  Equal<InferOutputType<typeof _errGroup>, _Err>
>;

// ============================================================================
// replaceRoot
// ============================================================================

const _errReplaceRoot = _pErr.replaceRoot({ newRoot: {} });
type _ReplaceRootMethodForwards = Assert<
  Equal<InferOutputType<typeof _errReplaceRoot>, _Err>
>;

// ============================================================================
// sort
// ============================================================================

const _errSort = _pErr.sort({});
type _SortMethodForwards = Assert<
  Equal<InferOutputType<typeof _errSort>, _Err>
>;

// ============================================================================
// limit
// ============================================================================

const _errLimit = _pErr.limit(10);
type _LimitMethodForwards = Assert<
  Equal<InferOutputType<typeof _errLimit>, _Err>
>;
type _LimitUsesModuleQuery = Assert<
  Equal<Parameters<Pipeline<Document>["limit"]>[0], LimitQuery>
>;

// ============================================================================
// skip
// ============================================================================

const _errSkip = _pErr.skip(10);
type _SkipMethodForwards = Assert<
  Equal<InferOutputType<typeof _errSkip>, _Err>
>;
type _SkipUsesModuleQuery = Assert<
  Equal<Parameters<Pipeline<Document>["skip"]>[0], SkipQuery>
>;

// ============================================================================
// sample
// ============================================================================

const _errSample = _pErr.sample({ size: 1 });
type _SampleMethodForwards = Assert<
  Equal<InferOutputType<typeof _errSample>, _Err>
>;

// ============================================================================
// facet
// ============================================================================

const _errFacet = _pErr.facet({});
type _FacetMethodForwards = Assert<
  Equal<InferOutputType<typeof _errFacet>, _Err>
>;

// ============================================================================
// count
// ============================================================================

// count forwards an upstream error verbatim — its resolver takes the schema
// precisely so PassThrough can do this.
type _CountPassthrough = Assert<Equal<ResolveCountOutput<_Err, "total">, _Err>>;

const _errCount = _pErr.count("total");
type _CountMethodForwards = Assert<
  Equal<InferOutputType<typeof _errCount>, _Err>
>;
type _CountUsesModuleQuery = Assert<
  Equal<Parameters<Pipeline<Document>["count"]>[0], CountQuery>
>;

// ============================================================================
// graphLookup
// ============================================================================

// graphLookup delegates to ResolveLookupOutput, which forwards errors.
type _GraphLookupPassthrough = Assert<
  Equal<ResolveGraphLookupOutput<_Err, "related", { id: string }>, _Err>
>;

// ============================================================================
// Operator-key dispatch semantics (cross-stage: the expression kernel)
// ============================================================================

type _DispatchSchema = { items: number[]; name: string };

// (a) Forgiving dispatch: a wrong operand does not change the inferred kind.
// { $size: 12 } is a malformed $size, but it IS a $size — inference is
// `number`; the operand brand fires at the input position instead.
type _DispatchForgiving = Assert<
  Equal<InferExpression<_DispatchSchema, { $size: 12 }>, number>
>;

// (b) `$`-less objects are literals, not expressions: the NotAnExpression
// sentinel (utils/dispatch.ts) tells callers to treat the value as a literal.
type _DispatchLiteralSentinel = Assert<
  Equal<InferExpression<_DispatchSchema, { notAnOp: 1 }>, NotAnExpression>
>;

// (c) Multi-operator objects brand with the exactly-one-operator message.
type _MultiOperatorTarget =
  PipeSafeError<`Expression objects must have exactly one operator.`>;
type _DispatchMultiOperator = Assert<
  Equal<
    InferExpression<_DispatchSchema, { $add: [1, 2]; $size: "$items" }>,
    _MultiOperatorTarget
  >
>;

// (d) Forgiving dispatch holds through the NESTED-VALUE hot path
// (InferNestedFieldReference), not just direct InferExpression calls. The
// PR #102 review showed that reverting InferNestedFieldReference to a
// full-union `Obj extends Expression<Schema>` membership test left every
// assertion green while costing +8% whole-project instantiations AND
// changing this semantics: a malformed-but-keyed expression would fall
// through to literal treatment instead of keeping its operator's declared
// result kind. This pin makes that revert a compile failure.
type _NestedDispatchSchema = { ts: Date; n: number };
type _NestedForgiving = Assert<
  Equal<
    InferNestedFieldReference<
      _NestedDispatchSchema,
      { out: { $dateToString: { format: 1; date: "$ts" } } }
    >,
    { out: string }
  >
>;

// (e) Literal-dependent inference survives `<const>` READONLY tuple
// inference at chained call sites: the registry's operand positions are
// readonly, so const call sites infer readonly operand tuples — the
// dependent arms' patterns must be readonly too, or the arm silently
// falls through and the RESOLVER DROPS THE FIELD (caught in review round
// 3: .set({ flag: { $cond: [...] } }) compiled with `flag` missing from
// the output schema).
const _condPipeline = new Pipeline<{ age: number }>().set({
  flag: { $cond: [{ $gt: ["$age", 18] }, "adult", "minor"] },
});
type _CondFieldSurvives = Assert<
  Equal<InferOutputType<typeof _condPipeline>["flag"], "adult" | "minor">
>;

const _ifNullPipeline = new Pipeline<{ n?: number }>().set({
  v: { $ifNull: ["$n", 0] },
});
type _IfNullFieldSurvives = Assert<
  Equal<InferOutputType<typeof _ifNullPipeline>["v"], number | 0>
>;

export {
  _condPipeline,
  _ifNullPipeline,
  _errMatch,
  _errSet,
  _errProject,
  _errGroup,
  _errReplaceRoot,
  _errSort,
  _errLimit,
  _errSkip,
  _errSample,
  _errFacet,
  _errCount,
};

export type {
  _GraphLookupPassthrough,
  _CountPassthrough,
  _MatchMethodForwards,
  _SetMethodForwards,
  _ProjectMethodForwards,
  _GroupMethodForwards,
  _ReplaceRootMethodForwards,
  _SortMethodForwards,
  _LimitMethodForwards,
  _SkipMethodForwards,
  _SampleMethodForwards,
  _FacetMethodForwards,
  _CountMethodForwards,
  _DispatchForgiving,
  _DispatchLiteralSentinel,
  _DispatchMultiOperator,
  _NestedForgiving,
  _LimitUsesModuleQuery,
  _SkipUsesModuleQuery,
  _CountUsesModuleQuery,
  _CondFieldSurvives,
  _IfNullFieldSurvives,
};
