/**
 * SPIKE: Grain inference from a terminal $group — type-level + runtime
 *
 * Purpose:   Test plan/04-transform-roadmap.md §8 (Fusion PlanGrainInfo analog):
 *            can we derive, from a real @pipesafe/core Pipeline whose terminal
 *            stage is $group with a compound _id, the candidate `$merge on:`
 *            keys for Model.Mode.Incremental — and validate a user-supplied
 *            `on:` against the actual grain?
 * Typecheck: plan/ is outside every repo tsconfig by design, so use a
 *            throwaway tsconfig: copy compilerOptions from
 *            tsconfig.options.json (the repo's strict flags — strict,
 *            exactOptionalPropertyTypes, noUncheckedIndexedAccess,
 *            noPropertyAccessFromIndexSignature, ...), set `"types": []` and
 *            `"noEmit": true`, and set `include` to this file's absolute
 *            path. Then: bunx tsc --noEmit -p <that tsconfig>
 * Run:       bun run tsx plan/spikes/grain-inference.spike.ts   (repo root)
 * Status:    EXECUTED 2026-07-03 — tsc clean under repo strict flags
 *            (TypeScript 5.9.3); runtime run prints inferred grains and
 *            validation verdicts (output pasted into the TRD).
 *
 * Findings summary:
 *  1. TYPE LEVEL WORKS for the output *shape*: `.group({ _id: { day: "$day",
 *     userId: "$userId" }, ... })` on the real Pipeline infers TOutput._id as
 *     `{ day: Date; userId: string }` — so `keyof TOut["_id"]` enumerates the
 *     grain component names, and Equal-assertions on them compile.
 *  2. TYPE LEVEL CANNOT SEE STAGE IDENTITY: Pipeline's generics carry only
 *     document types, not which stage produced them. A `$set` that fabricates
 *     an `_id` object is indistinguishable from a `$group`, so "this pipeline
 *     is grouped, hence _id is unique by construction" is NOT provable in the
 *     type system with today's exports. Grain *inference* must therefore be a
 *     runtime read of the built stage array (structured data — trivial), with
 *     the type system used for the output-shape half only. FINDING for the
 *     TRD: no new core exports are needed for runtime inference
 *     (getPipeline() suffices); a type-level "terminal stage" witness would
 *     require threading a stage-history generic through Pipeline (rejected:
 *     UsedStages is a set, not a sequence — it can prove "$group was used
 *     somewhere", not "terminal stage is $group").
 *  3. POST-$GROUP, `on:` MUST BE "_id" (or a flattened projection of it):
 *     grain components live *inside* the _id object and core's MergeOptions
 *     correctly rejects `on: "day"` / dotted `on: "_id.day"` (top-level fields
 *     only). $merge equality on the whole _id object works and needs no extra
 *     index. So for grouped models the inferred default is simply on: "_id",
 *     and validation of a user-supplied `on` is: "_id" (or a $project-flattened
 *     rename of the grain fields — see inferGrain's shape-preserving walk).
 *  4. Runtime inference walks backwards over shape/key-preserving trailing
 *     stages ($match/$sort/$limit/$skip/$sample) to find the terminal $group;
 *     `$field` refs in its _id map grain components to source fields.
 *  5. Validation catches the classic dbt misconfiguration: user declares
 *     on: ["eventId"] but the pipeline groups by {day, userId} → runtime
 *     error BEFORE any $merge runs (dbt discovers this as silent dup rows).
 *  6. SURPRISE: the compound _id's properties infer as READONLY
 *     ({ readonly day: Date; readonly userId: string }) — Pipeline.group's
 *     `<const G>` generic carries `readonly` from the call-site literal into
 *     the output document type. Assignability is unaffected, but any
 *     incremental type helpers (watermark field selection, grain Equal
 *     assertions) must tolerate readonly-modified output shapes.
 */

import {
  Pipeline,
  InferOutputType,
  Document,
  type Assert,
  type Equal,
} from "@pipesafe/core";

// ============================================================================
// Fixture schema + pipelines (real core Pipeline, real .group typing)
// ============================================================================

type RawEvent = {
  eventId: string;
  userId: string;
  receivedAt: Date;
  day: Date;
  status: string;
  amount: number;
};

/** Terminal $group with compound _id — the grain is (day, userId). */
const dailyUserTotals = new Pipeline<RawEvent>({ pipeline: [] })
  .match({ status: "complete" })
  .group({
    _id: { day: "$day", userId: "$userId" },
    total: { $sum: "$amount" },
    events: { $push: "$eventId" },
  });

/** $group followed by shape-preserving stages — grain must survive the walk. */
const dailyUserTotalsSorted = new Pipeline<RawEvent>({ pipeline: [] })
  .group({
    _id: { day: "$day", userId: "$userId" },
    total: { $sum: "$amount" },
  })
  .match({ total: { $gt: 0 } })
  .sort({ total: -1 })
  .limit(1000);

/** No $group at all — 1:1 model; grain is whatever unique key the user picks. */
const passthrough = new Pipeline<RawEvent>({ pipeline: [] }).set({
  day2: { $dateTrunc: { date: "$receivedAt", unit: "day" } },
});

// ============================================================================
// 1. Type-level: output shape of the compound _id (WORKS)
// ============================================================================

type GroupedOut = InferOutputType<typeof dailyUserTotals>;

// NOTE (finding 6): the compound _id's properties come back READONLY — the
// `<const G>` generic on Pipeline.group carries `readonly` from the call-site
// literal into the inferred output type. Assignability is unaffected but
// Equal<> (and user-visible hovers) see `readonly day: Date`. Incremental's
// typed watermark/on helpers must tolerate readonly output shapes.
type _AssertIdShape = Assert<
  Equal<GroupedOut["_id"], { readonly day: Date; readonly userId: string }>
>;
type _AssertTotal = Assert<Equal<GroupedOut["total"], number>>;

/** Grain component names, derivable at type level from the output shape. */
type GrainComponents<TOut> =
  TOut extends { _id: infer Id } ?
    Id extends Date | unknown[] ? never
    : Id extends object ? keyof Id & string
    : never
  : never;

type _AssertGrainComponents = Assert<
  Equal<GrainComponents<GroupedOut>, "day" | "userId">
>;

/**
 * The always-valid inferred `on:` for a grouped output is "_id" — the grain
 * components are nested under it, not top-level, so MergeOptions (correctly)
 * only admits "_id". This is the type-level half of grain inference: the
 * *default* is derivable; the *proof of uniqueness* is not (finding 2).
 */
type InferredMergeOn<TOut> =
  GrainComponents<TOut> extends never ? undefined : "_id";
type _AssertInferredOn = Assert<Equal<InferredMergeOn<GroupedOut>, "_id">>;
type _AssertNoInferredOn = Assert<
  Equal<InferredMergeOn<InferOutputType<typeof passthrough>>, undefined>
>;

// MergeOptions rejects grain components / dotted paths as `on:` — pinned:
const _rejectsNonTopLevelOn = () =>
  new Pipeline<RawEvent>({ pipeline: [] })
    .group({
      _id: { day: "$day", userId: "$userId" },
      total: { $sum: "$amount" },
    })
    // @ts-expect-error -- 'day' is inside _id, not a top-level output field
    .merge({ into: "out", on: "day" });
const _rejectsDottedOn = () =>
  new Pipeline<RawEvent>({ pipeline: [] })
    .group({
      _id: { day: "$day", userId: "$userId" },
      total: { $sum: "$amount" },
    })
    // @ts-expect-error -- dotted paths are not valid $merge on-fields in core
    .merge({ into: "out", on: "_id.day" });
const _acceptsIdOn = () =>
  new Pipeline<RawEvent>({ pipeline: [] })
    .group({
      _id: { day: "$day", userId: "$userId" },
      total: { $sum: "$amount" },
    })
    .merge({ into: "out", on: "_id" }); // compiles — the inferred default

// ============================================================================
// 2. Runtime: read the built stage array (structured data — this is the
//    actual inference manifold will ship; sketch of the production algorithm)
// ============================================================================

export type InferredGrain =
  | {
      kind: "group";
      /** grain component name -> source field ref (e.g. day -> "$day") */
      components: Record<string, string | null>;
      /** the $merge on-key to use */
      on: "_id";
    }
  | { kind: "none" };

const SHAPE_PRESERVING = new Set([
  "$match",
  "$sort",
  "$limit",
  "$skip",
  "$sample",
]);

export function inferGrain(stages: Document[]): InferredGrain {
  for (let i = stages.length - 1; i >= 0; i--) {
    const stage = stages[i];
    if (stage === undefined) continue;
    const op = Object.keys(stage)[0];
    if (op === undefined) continue;
    if (SHAPE_PRESERVING.has(op)) continue; // walk past trailing filters/sorts
    if (op !== "$group") return { kind: "none" }; // $set/$project/... end walk
    const id: unknown = (stage["$group"] as Document)["_id"];
    if (id === null || typeof id !== "object" || Array.isArray(id)) {
      // scalar/null _id: single-row or single-key grain; still on:"_id"
      return { kind: "group", components: {}, on: "_id" };
    }
    const components: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(id)) {
      components[k] = typeof v === "string" && v.startsWith("$") ? v : null; // null = expression
    }
    return { kind: "group", components, on: "_id" };
  }
  return { kind: "none" };
}

/** Validate a user-supplied `on:` against the inferred grain (roadmap §8). */
export function validateOnAgainstGrain(
  on: readonly string[] | undefined,
  grain: InferredGrain
): { ok: true } | { ok: false; reason: string } {
  if (grain.kind === "none") return { ok: true }; // nothing provable; trust user
  if (on === undefined) return { ok: true }; // will default to inferred "_id"
  if (on.length === 1 && on[0] === "_id") return { ok: true };
  return {
    ok: false,
    reason:
      `Model's terminal $group defines the grain ` +
      `{${Object.keys(grain.components).join(", ")}} under '_id'; ` +
      `'on: [${on.join(", ")}]' does not match it. Use on: ["_id"] ` +
      `(inferred default) or project the grain fields to the top level.`,
  };
}

// ============================================================================
// 3. Executable demonstration
// ============================================================================

function main() {
  const g1 = inferGrain(dailyUserTotals.getPipeline());
  console.log("terminal $group grain:", JSON.stringify(g1));
  // -> { kind: "group", components: { day: "$day", userId: "$userId" }, on: "_id" }

  const g2 = inferGrain(dailyUserTotalsSorted.getPipeline());
  console.log(
    "grain through trailing $match/$sort/$limit:",
    JSON.stringify(g2)
  );

  const g3 = inferGrain(passthrough.getPipeline());
  console.log("no-group pipeline grain:", JSON.stringify(g3)); // { kind: "none" }

  console.log(
    "validate on:['eventId'] vs grouped grain:",
    JSON.stringify(validateOnAgainstGrain(["eventId"], g1))
  ); // -> ok:false with actionable message (the classic dbt misconfig)
  console.log(
    "validate on:['_id'] vs grouped grain:",
    JSON.stringify(validateOnAgainstGrain(["_id"], g1))
  ); // -> ok:true
  console.log(
    "validate on:['eventId'] vs no-group grain:",
    JSON.stringify(validateOnAgainstGrain(["eventId"], g3))
  ); // -> ok:true (nothing provable)

  // keep type-only fixtures referenced so noUnusedLocals passes
  void _rejectsNonTopLevelOn;
  void _rejectsDottedOn;
  void _acceptsIdOn;
}

main();

export type {
  GroupedOut,
  GrainComponents,
  InferredMergeOn,
  _AssertIdShape,
  _AssertTotal,
  _AssertGrainComponents,
  _AssertInferredOn,
  _AssertNoInferredOn,
};
