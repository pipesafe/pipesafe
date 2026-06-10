/**
 * Stage contract conformance assertions (Phase 0 of
 * docs/type-standardisation-plan.md).
 *
 * Pins the per-stage contract:
 *   1. Every non-terminal `Resolve*Output` forwards a `PipeSafeError` schema
 *      verbatim (PassThrough). Resolver-level assertions for 14 stages
 *      already live in Pipeline.typeAssertions.ts ("Short-circuit
 *      propagation" block) — this file adds the missing stages and the
 *      method-level matrix; it does not duplicate that block.
 *   2. Each Pipeline method's *return type* forwards an error schema —
 *      observable proof that the method is wired to its module's resolver.
 *   3. Target dispatch semantics for expressions (operator-key dispatch,
 *      spec §3.4). These pin behavior that does NOT exist yet and are
 *      ExpectAssertFailure until Phase 4 lands.
 *
 * Known gaps recorded here (see spec §4 Phase 0):
 *   - count: resolver never sees the schema (F2) → method-level marker is
 *     ExpectAssertFailure until Phase 3.
 *   - sort: Pipeline.sort doesn't reference ResolveSortOutput, but the gap
 *     is behaviorally unobservable (ResolveSortOutput<S> ≡ S); the
 *     method-level assertion below passes either way. Wiring is Phase 1
 *     hygiene.
 *   - unwind: the UnwindPath brand never fires at the chained call site;
 *     this is a hover-quality gap with no acceptance difference, pinned by
 *     a callSite fixture added in Phase 1 (Pipeline.callSite.typeAssertions.ts).
 */

import { Pipeline, InferOutputType } from "../pipeline/Pipeline";
import { Assert, Equal, ExpectAssertFailure } from "../utils/tests";
import { PipeSafeError } from "../utils/core";
import { ResolveCountOutput } from "./count";
import { ResolveGraphLookupOutput } from "./graphLookup";
import { InferExpression } from "../elements/expressions";

type _Err = PipeSafeError<"upstream">;

// ============================================================================
// 1. Resolver-level PassThrough — stages missing from Pipeline.typeAssertions
// ============================================================================

// graphLookup delegates to ResolveLookupOutput, which forwards errors.
type _GraphLookupPassthrough = Assert<
  Equal<ResolveGraphLookupOutput<_Err, "related", { id: string }>, _Err>
>;

// GAP(F2): count's resolver has no schema parameter, so it cannot forward an
// upstream error — it unconditionally produces the count document. Phase 3
// changes the signature to ResolveCountOutput<Schema, FieldName>; this pin
// then flips to Assert<Equal<ResolveCountOutput<_Err, "total">, _Err>>.
type _CountCurrentBehavior = Assert<
  Equal<ResolveCountOutput<"total">, Record<"total", number>>
>;

// ============================================================================
// 2. Method-level error forwarding ("the method is wired to its resolver")
// ============================================================================
// Chain each easily-callable method on a pipeline whose schema is already a
// branded error; the output type must still be that error. Methods whose
// parameters cannot be constructed against an error schema without
// contortions (unwind, lookup, graphLookup, unionWith) are covered at the
// resolver level only.

const _pErr = new Pipeline<_Err, _Err>();

const _errMatch = _pErr.match({});
type _MatchMethodForwards = Assert<
  Equal<InferOutputType<typeof _errMatch>, _Err>
>;

const _errSet = _pErr.set({});
type _SetMethodForwards = Assert<Equal<InferOutputType<typeof _errSet>, _Err>>;

const _errProject = _pErr.project({});
type _ProjectMethodForwards = Assert<
  Equal<InferOutputType<typeof _errProject>, _Err>
>;

const _errGroup = _pErr.group({ _id: null });
type _GroupMethodForwards = Assert<
  Equal<InferOutputType<typeof _errGroup>, _Err>
>;

const _errReplaceRoot = _pErr.replaceRoot({ newRoot: {} });
type _ReplaceRootMethodForwards = Assert<
  Equal<InferOutputType<typeof _errReplaceRoot>, _Err>
>;

const _errSort = _pErr.sort({});
type _SortMethodForwards = Assert<
  Equal<InferOutputType<typeof _errSort>, _Err>
>;

const _errLimit = _pErr.limit(10);
type _LimitMethodForwards = Assert<
  Equal<InferOutputType<typeof _errLimit>, _Err>
>;

const _errSkip = _pErr.skip(10);
type _SkipMethodForwards = Assert<
  Equal<InferOutputType<typeof _errSkip>, _Err>
>;

const _errSample = _pErr.sample({ size: 1 });
type _SampleMethodForwards = Assert<
  Equal<InferOutputType<typeof _errSample>, _Err>
>;

const _errFacet = _pErr.facet({});
type _FacetMethodForwards = Assert<
  Equal<InferOutputType<typeof _errFacet>, _Err>
>;

// GAP(F2): count replaces an upstream error with { total: number }. This is
// the observable form of the missing PassThrough. Flips to Assert in Phase 3.
const _errCount = _pErr.count("total");
type _CountMethodGap = ExpectAssertFailure<
  Equal<InferOutputType<typeof _errCount>, _Err>
>;

// ============================================================================
// 3. Target dispatch semantics (spec §3.4) — red until Phase 4
// ============================================================================
// These pin the operator-key dispatch behavior the registry rebuild must
// deliver. All three are ExpectAssertFailure today by design.

type _DispatchSchema = { items: number[]; name: string };

// (a) Forgiving dispatch: a wrong operand must not change the inferred kind.
// { $size: 12 } is a malformed $size, but it IS a $size — target inference
// is `number` (the brand fires at the input position instead).
type _DispatchForgiving = ExpectAssertFailure<
  Equal<InferExpression<_DispatchSchema, { $size: 12 }>, number>
>;

// (b) `$`-less objects are literals, not expressions: target is the
// NotAnExpression sentinel. The sentinel type doesn't exist until Phase 4
// (utils/dispatch.ts); its structural shape is pinned here and the alias
// below is replaced by the real import when it lands.
// TODO(Phase 4): import NotAnExpression from "../utils/dispatch".
type _NotAnExpressionShape = { readonly "~pipesafe.notAnExpression": true };
type _DispatchLiteralSentinel = ExpectAssertFailure<
  Equal<InferExpression<_DispatchSchema, { notAnOp: 1 }>, _NotAnExpressionShape>
>;

// (c) Multi-operator objects brand with the exactly-one-operator message.
type _MultiOperatorTarget =
  PipeSafeError<`Expression objects must have exactly one operator.`>;
type _DispatchMultiOperator = ExpectAssertFailure<
  Equal<
    InferExpression<_DispatchSchema, { $add: [1, 2]; $size: "$items" }>,
    _MultiOperatorTarget
  >
>;

export {
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
  _CountCurrentBehavior,
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
  _CountMethodGap,
  _DispatchForgiving,
  _DispatchLiteralSentinel,
  _DispatchMultiOperator,
};
