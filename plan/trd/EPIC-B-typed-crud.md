# EPIC-B — Typed CRUD (TRD)

## Overview

**Goal.** Replace `Collection`'s raw-driver typing (`Filter<Docs>`, `UpdateFilter<Docs>`, `OptionalUnlessRequiredId<Docs>`) with PipeSafe's own type machinery, so `collection.find({ naem: "x" })` fails the way `pipeline.sort({ naem: 1 })` already does — full-depth dotted paths, branded `PipeSafeError` operand messages, union narrowing of results, and projection-shaped return types. This is the P0 "two divergent typing regimes" debt from [../01-current-state-and-gaps.md](../01-current-state-and-gaps.md) and [../03-orm-roadmap.md](../03-orm-roadmap.md) §2.

**Scope.** Compile-time typing of `find`/`findOne`/`insertOne`/`insertMany`/`updateOne`/`updateMany`/`replaceOne`/`deleteOne`/`deleteMany`/`countDocuments`/`findOneAnd*` on `packages/core/src/collection/Collection.ts`; a new typed update-operator module; the public export surface those signatures need; options/cursor typing (`projection`, `sort`, `limit`, `skip`, `orFail`, `sanitizeFilter`); an interceptor seam stub for EPIC-D; type-assertion and call-site regression tests; benchmarks; docs.

**Out of scope.** Runtime schema validation and `$jsonSchema` (plan/03 §3, EPIC-C), hooks/interceptor _implementations_ and transactions (plan/03 §4–5, EPIC-D), relations/populate sugar (plan/03 §6), migrations (§7), bulkWrite/index-management retyping (stays driver-typed behind the escape hatch for now).

**Differentiators protected** ([../02-competitive-landscape.md](../02-competitive-landscape.md)): literal Mongo syntax (filters/updates are real MongoDB documents, not a DSL), inference not codegen (result shapes computed from the literal arguments — Prisma's `GetFindResult` lesson without the generated `Payload`), branded errors (`PipeSafeError<Msg>` at the offending value, not driver-style permissive acceptance or Mongoose-style alias soup).

**Spikes.**

- [../spikes/typed-crud-real.spike.ts](../spikes/typed-crud-real.spike.ts) — executed against the real `@pipesafe/core` dist types (this TRD's evidence; typechecks clean under the repo's strict flags, tsc 5.9.3 and 6.0.2).
- [../spikes/orm-crud-api.spike.ts](../spikes/orm-crud-api.spike.ts) — the earlier illustrative sketch (stubbed types, not compiled against the repo). Two of its assumptions are corrected below.

Research briefs: `scratchpad/research/mongoose.md`, `prisma.md`, `pipesafe-current-state.md`.

## Spike findings

**What ran.** A `declare class TypedCollection<TDoc>` built from the real `MatchQuery`, `ResolveMatchOutput`, `ValidateProjectQuery`, `ResolveProjectOutput`, `FieldSelector`, `InferFieldSelector`, and `PipeSafeError` types, exercised over ~45 call sites (accepts compiled, rejects pinned with `@ts-expect-error`, result types locked with `Assert<Equal<...>>`), plus two probe files isolating the typo-key behavior and a raw-driver baseline for `--extendedDiagnostics`.

**F1 — The machinery is not publicly exported.** `packages/core/src/index.ts` (and `dist/index.d.mts`) export `FieldSelector`, `InferFieldSelector`, `FieldSelectorsThatInferTo`, `GetFieldType`, `PipeSafeError`, `Prettify` and the test helpers — but **not** `MatchQuery`, `ResolveMatchOutput`, `ValidateProjectQuery`, `ResolveProjectOutput`, `SetQuery`, or `UnsetQuery`, and `package.json` has only a `"."` export (no subpaths). The spike needed a tsconfig `paths` shim onto `dist/stages/*.d.mts`. Anything EPIC-B builds in `collection/` can import them internally, but third parties (and our own spikes/examples) cannot. → CRUD-1.

**F2 — CONTRADICTION with plan/03 §2: typo'd paths are NOT rejected by the prescribed signature.** plan/03 §2 says the pattern is `<const F extends MatchQuery<Schema>>(filter: F, options?)` and that a "typo'd path or `$gte` on string = PipeSafeError". Measured on tsc 5.9.3 (identical on 6.0.2):

| case                                                     | plain `<const F extends MatchQuery<S>>`            |
| -------------------------------------------------------- | -------------------------------------------------- |
| `$gte` on string / `$size` on non-array (operand brands) | rejects ✅                                         |
| `{ naem: "x" }` alone, schema with **no** array fields   | rejects (TS2353) ✅                                |
| `{ naem: "x" }` alone, schema **with** array fields      | **compiles**; result silently becomes `never[]` ❌ |
| `{ name: "x", naem: "y" }` (typo next to valid key)      | **compiles** on every schema shape ❌              |

Root cause: `FieldSelector` emits template-literal selectors for array indices (`` `tags.${number}` ``); mapped over them, `RawMatchQuery` acquires _pattern index signatures_, which make TypeScript treat **every** string key as "known" — defeating both the weak-type rule and excess-property checking. `Pipeline.match({ naem: "x" })` was verified to have the identical holes today (and `ResolveMatchOutput` then filters every union member out → the silent-`never` degradation `PipeSafeError` exists to prevent; pinned in the spike as `q2_plainConstraintHoles`).

**F3 — The fix, verified: intersection validation.** `find<const F extends MatchQuery<S>>(filter: F & ValidateMatchKeys<S, F>)`, where `ValidateMatchKeys` is a homomorphic mapped type branding unknown keys (`PipeSafeError<"Field 'naem' is not on the schema.">`) and recursing through `$and`/`$or`/`$nor` (the array hop must pass through a type _parameter_ so the mapped type maps tuple elements, not array methods — measured dead end otherwise). With the intersection: all four matrix rows reject, operand brands still fire from the constraint, `$or` recursion catches nested typos, and union narrowing still works. This is Prisma's `SelectSubset` move — validation through a mapped wrapper intersected with the inferred literal — applied to Mongo-literal filters.

**F4 — Union narrowing flows into CRUD results.** `orders.find({ status: "shipped" })` on `PendingOrder | ShippedOrder` returns exactly `ShippedOrder[]`; no discriminant → full union. Neither incumbent can run this demo (Mongoose's filter values are `ApplyBasicQueryCasting` — permissive by design; Prisma has no union schemas on Mongo).

**F5 — Projection reuse works, including from the nested options position.** `findOne(filter, { projection: { email: 1, "address.city": 1 } })` with `<const P>` + `ValidateProjectQuery<TDoc, P>` infers `P`, fires mixed-mode and unknown-key brands _inside_ `options`, and `ResolveProjectOutput` narrows the result to `{ _id: string; email: string; address: { city: string } }` (dotted-key expansion included). Exclusion mode drops keys. This delivers Prisma's `GetFindResult` ("query-shaped results") by pure inference.

**F6 — CONTRADICTION with plan/03 §2 + old sketch: key-restricted update operators are the wrong design.** Both plan/03 §2 and `orm-crud-api.spike.ts` prescribe `$inc?: { [P in FieldSelectorsThatInferTo<Schema, number>]?: number }`. Measured failures: (a) `$inc: { email: 1 }` is rejected only as an unreadable key-set mismatch, no branded message; (b) **optional numeric fields silently fall out of the key set** — `age?: number` infers `number | undefined`, which does not extend `number`, so `$inc: { age: 1 }` (legal MongoDB) is a false-positive rejection. Winning design (verified): map over **all** `FieldSelector` keys and brand at the **value** position (`NumericUpdateOperand`, `PushOperand`, ... with `Exclude<T, undefined>` before the tuple check), under a generic constraint, plus the F3 intersection for unknown paths/operators. All ten update reject-cases fire with readable messages; `$push` `$each` modifiers and dotted `$set` paths accept.

**F7 — Pre-existing wart surfaced: match.ts brands optional fields.** `users.find({ age: { $gte: 18 } })` on `age?: number` is rejected _today_ because `NumericOperand<number | undefined, "$gte">` fails its `[T] extends [number | Date]` check — `undefined` is never stripped. Same for `$size`/`$all`/`$elemMatch`/`$regex` helpers. Legal Mongo query, compile error; affects `Pipeline.match` too but CRUD makes it a front-door bug. Pinned in the spike; → CRUD-4.

**F8 — Insert typing is easy; unions need care.** A direct (non-generic) `InsertDoc<TDoc>` parameter gets full freshness checking: missing required field, wrong value type, and excess key all reject; `_id` optional at insert. Caveat: `Omit`-based `InsertDoc` does not distribute over union schemas — `TypedCollection<Order>` needs a distributive version.

**F9 — Compile cost is a non-issue at this scale.** `--extendedDiagnostics`, tsc 5.9.3: spike (machinery + ~45 call sites) — 6,530 types / 23,440 instantiations / 0.36 s check; raw-driver baseline (same call shapes on `Filter`/`UpdateFilter`) — 1,222 / 1,898 / 0.10 s. ~12x the driver but roughly 400–500 instantiations per validated call site — an order of magnitude below the ~3,600 that `project.ts` documents for one `$project` stage. plan/03 §2's compile-perf risk (soft contradiction) does not materialize; still benchmark wide schemas (CRUD-8).

## Tickets

### CRUD-1: Export the reusable query-type machinery from @pipesafe/core

- **Priority** P0 | **Estimate** S | **Depends on** —
- **Context** F1: `MatchQuery`, `ResolveMatchOutput`, `ValidateProjectQuery`, `ResolveProjectOutput`, `SetQuery`, `ResolveSetOutput`, `UnsetQuery` are internal-only; EPIC-B's public signatures will place them in user-visible positions, and downstream tooling/spikes need to name them.
- **Design** Add `export type { MatchQuery, RawMatchQuery, ResolveMatchOutput } from "./stages/match"`, `export type { ProjectQuery, ValidateProjectQuery, ResolveProjectOutput } from "./stages/project"`, `export type { SetQuery, ResolveSetOutput } from "./stages/set"`, `export type { UnsetQuery } from "./stages/unset"` to `packages/core/src/index.ts`. No subpath exports (keeps the `"."`-only exports map; tsdown bundle already emits per-module d.mts but the root is the contract).
- **Acceptance criteria** `import type { MatchQuery } from "@pipesafe/core"` compiles in a fresh consumer with `moduleResolution: bundler` and `nodenext`; changeset (`minor`) included; the spike's tsconfig `paths` shim becomes unnecessary.
- **Test plan** Extend an existing `*.typeAssertions.ts` (or `packages/core/src/index.typeAssertions.ts`, new) asserting the re-exports resolve and `Equal<MatchQuery<{a: 1}>, ...>` holds.
- **Open questions** Export `FilterUnion`/`MatchersForType` too, or keep the surface minimal until asked?

### CRUD-2: `ValidateMatchKeys` — unknown-key branding for filter literals

- **Priority** P0 | **Estimate** M | **Depends on** —
- **Context** F2/F3: the generic-constraint pattern cannot reject typo'd keys on array-bearing schemas (pattern index signatures), and never rejects a typo next to a valid key. Filters silently return `never`.
- **Design** In `packages/core/src/stages/match.ts`, add (verbatim from the spike):
  - `ValidateMatchArray<Schema, A> = { [I in keyof A]: ValidateMatchKeys<Schema, A[I]> }` (type-parameter hop required for tuple element mapping);
  - `ValidateMatchKeys<Schema, F>` mapping `$and`/`$or`/`$nor` → recursion, `FieldSelector<Schema> | "$expr"` → passthrough, else `PipeSafeError<`Field '${K & string}' is not on the schema.`>`.
  - Message format per CLAUDE.md (Field subject, single quotes, trailing period). Value-position branding → TS2322-style reporting.
- **Acceptance criteria** All four F2 matrix rows reject when composed as `F & ValidateMatchKeys<S, F>`; valid filters (incl. `$or`, dotted paths, array-index selectors) unchanged; union narrowing preserved.
- **Test plan** `match.typeAssertions.ts` additions (`AssertPipeSafeError` on the brand message, accepts via `Assert<Equal<...>>`); call-site cases land with CRUD-5's regression file.
- **Open questions** Should `$expr` stay `unknown`-typed passthrough (today's behavior) or route through `Expression<Schema>`? (Defer; separate stage-level ticket.)

### CRUD-3: Typed update-operator module (`stages/update.ts`)

- **Priority** P0 | **Estimate** M | **Depends on** —
- **Context** F6: new but formulaic machinery; the plan/03 key-restricted design is rejected by the spike (unreadable errors + optional-field false positives).
- **Design** New `packages/core/src/stages/update.ts`: operand helpers (`NumericUpdateOperand`, `MinMaxUpdateOperand`, `PushOperand` with `$each`/`$position`/`$slice`/`$sort`, `PullOperand`, `CurrentDateOperand`), all applying `Exclude<T, undefined>` before the non-distributive `[T] extends [...]` check; `UpdateQuery<Schema>` mapping **all** `FieldSelector<Schema>` keys per operator (`$set`, `$unset`, `$inc`, `$mul`, `$min`, `$max`, `$push`, `$addToSet`, `$pull`, `$currentDate`) with brands at value positions; `ValidateUpdateKeys<Schema, U>` for unknown paths and unknown `$operators`. `$set` values via `InferFieldSelector` in v1 — do **not** reuse `SetQuery` (that type accepts aggregation expressions like `$concat`, which plain `updateOne` does not evaluate; update-pipeline support is a later, explicit feature). Brand messages: `Operator '$inc' requires a field that infers to a number.` etc.
- **Acceptance criteria** Spike section Q5's accept/reject matrix reproduced in-repo; optional numeric fields updatable; no `FieldSelectorsThatInferTo`-based key restriction anywhere in the module.
- **Test plan** New `update.typeAssertions.ts` mirroring the spike (both designs' failure modes pinned as comments; the shipped design asserted with `AssertPipeSafeError` exact messages).
- **Open questions** `$setOnInsert`, `$rename`, `$pop`, positional `$`/`$[]` paths — v1 or follow-up? (Recommend follow-up; keep v1 to the ten operators above and let `raw()` cover the rest.)

### CRUD-4: Strip `undefined` in match.ts operand helpers (optional-field wart)

- **Priority** P0 | **Estimate** S | **Depends on** —
- **Context** F7: `{ age: { $gte: 18 } }` on `age?: number` is a compile error today in both `Pipeline.match` and any CRUD reuse — a false positive on a legal query.
- **Design** In `packages/core/src/stages/match.ts`, change `NumericOperand`, `SizeOperand`, `ArrayValueOperand`, `ArrayElementOperand`, `RegexOperand` to test `[Exclude<T, undefined>] extends [...]`. Keep non-distributive tuple form. Audit `group.ts`/`expressions.ts` operand helpers for the same pattern (separate ticket if widespread).
- **Acceptance criteria** `$gte`/`$size`/`$regex` etc. accepted on optional fields of the right base type; still branded on genuinely wrong types; existing assertions unchanged.
- **Test plan** `match.typeAssertions.ts`: flip the spike's pinned wart (its comment says exactly which `@ts-expect-error` to move); add optional-field accept cases per operator. `Pipeline.callSite.typeAssertions.ts` gains a positive case.
- **Open questions** Does any existing assertion _depend_ on the branding of optional fields (i.e. treat it as intended)? Grep before changing.

### CRUD-5: TypedCollection — retype Collection's CRUD surface

- **Priority** P0 | **Estimate** L | **Depends on** CRUD-1, CRUD-2, CRUD-3, CRUD-4
- **Context** The core deliverable. Signatures proven in the spike; runtime bodies are the existing thin driver passthroughs (lean-by-default — no hydration/casting, per plan/03's non-negotiables and Mongoose's own `lean()` performance guidance).
- **Design** Modify `packages/core/src/collection/Collection.ts`:
  - `find` / `findOne`: `<const F extends MatchQuery<Docs>, const P = undefined>(filter: F & ValidateMatchKeys<Docs, F>, options?: { projection?: ValidateProjectQuery<Docs, P>; sort?: ...; limit?; skip? })` returning `ProjectedResult<Docs, F, P>[]` / `| null`, where `ProjectedResult = [P] extends [undefined] ? Prettify<ResolveMatchOutput<F, Docs>> : ResolveProjectOutput<P, ResolveMatchOutput<F, Docs>>`.
  - `insertOne`/`insertMany`: distributive `InsertDoc<Docs>` (`Docs extends unknown ? Omit<Docs, "_id"> & { _id?: ... } : never`) — F8 union caveat.
  - `updateOne`/`updateMany`/`findOneAndUpdate`: `(filter: F & ValidateMatchKeys<Docs, F>, update: U & ValidateUpdateKeys<Docs, U>)` with `U extends UpdateQuery<Docs>`.
  - `replaceOne`/`findOneAndReplace`: replacement typed `InsertDoc<Docs>` minus `_id` (`WithoutId` semantics, ours).
  - `deleteOne`/`deleteMany`/`countDocuments`/`findOneAndDelete`/`distinct`: filter-only reuse.
  - `raw(): MongoCollection<Docs>` escape hatch (same philosophy as `Pipeline.custom()`); `bulkWrite` and index/collection management stay driver-typed.
  - Driver interop: internally cast our filter/update literals to `Filter<Docs>`/`UpdateFilter<Docs>` at the single call boundary (one `as` per method, commented).
- **Acceptance criteria** Spike sections Q2–Q6 and q2b reproduce against the real class; `aggregate()`/`Source` behavior untouched; no driver types in public CRUD parameter positions; changeset (`minor`, arguably `major` — see open question).
- **Test plan** New `packages/core/src/collection/Collection.typeAssertions.ts` (result-shape `Equal`s, union narrowing, projection shapes) + CRUD-10's call-site file.
- **Open questions** (1) Is stricter typing a breaking change for existing users passing driver-flavored filters (e.g. `{ _id: someObjectIdString }` relying on driver casting)? Recommend: ship as `minor` with `raw()` documented as the compatibility path, but decide with maintainers. (2) `findOneAndUpdate` result should reflect the _update_ applied (`ResolveSetOutput`-style) — v1 returns pre-image schema; note as follow-up.

### CRUD-6: Cursor, options, and safety affordances

- **Priority** P1 | **Estimate** M | **Depends on** CRUD-5
- **Context** `find` currently returns the driver's `FindCursor`; Mongoose v9's `orFail` and `sanitizeFilter` are cheap, loved safety features (mongoose.md §9) that fit lean-by-default.
- **Design** `packages/core/src/collection/FindResult.ts` (new): a thin thenable wrapper — `find(...)` returns `PromiseLike<Row[]>` plus `.cursor()` (typed `AsyncIterable<Row>`), `findOne(...)` returns `PromiseLike<Row | null>` plus `.orFail(): Promise<Row>` (throws `DocumentNotFoundError`). `sanitizeFilter?: boolean` option wraps `$`-prefixed nested objects in `$eq` at runtime (injection defense for user-supplied values). `sort` typed as `{ [K in FieldSelector<Docs>]?: 1 | -1 }` (direct typing, finite-key — same rationale as `Pipeline.sort`).
- **Acceptance criteria** `await users.findOne(f).orFail()` typechecks and throws on null; cursor iteration yields the narrowed row type; sanitizeFilter covered by a runtime test.
- **Test plan** typeAssertions for thenable result types; runtime tests via `.claude/local-mongodb.ts` harness (mongodb-memory-server) for orFail/sanitizeFilter behavior.
- **Open questions** Thenable-not-Promise (Mongoose's model) vs eager Promise + separate `findCursor()` method — pick during implementation; thenable recommended for the `.orFail()` chain.

### CRUD-7: Interceptor seam stub (hooks land in EPIC-D)

- **Priority** P1 | **Estimate** S | **Depends on** CRUD-5
- **Context** plan/03 §4 adopts the Prisma-extensions shape (typed query-description transformation), not kareem's invisible registry. EPIC-B only leaves the seam so EPIC-D doesn't have to re-thread every method.
- **Design** In `Collection.ts`: route every CRUD verb through a single private `dispatch(op: QueryDescription<Docs>)` where `QueryDescription` (new `packages/core/src/collection/QueryDescription.ts`) is a discriminated union `{ kind: "find" | "updateOne" | ... ; filter; update?; options? }` built from the (already-validated) literals. v1 `dispatch` just executes — no registration API is exported. One interceptor per operation kind, never one name across abstraction levels (Mongoose's `updateOne` document-vs-query wart, mongoose.md §3).
- **Acceptance criteria** All verbs flow through `dispatch`; public API unchanged; `QueryDescription` exported as `type` only.
- **Test plan** Runtime smoke test that behavior is unchanged; typeAssertion that `QueryDescription<User>["filter"]` is `MatchQuery<User>`-compatible.
- **Open questions** Should `aggregate()` execution eventually share the seam? (EPIC-D decision.)

### CRUD-8: Compile-perf benchmarks for CRUD typing

- **Priority** P1 | **Estimate** S | **Depends on** CRUD-2, CRUD-3
- **Context** F9 shows ~400–500 instantiations per call site on a modest schema; plan/03 flags update-operator mapped types as the perf risk. Guard it the way the stage types are guarded (measured counts in comments, harness in `packages/core/benchmarking/`).
- **Design** Add a CRUD scenario file to `packages/core/benchmarking/` (follow the existing harness layout): wide schema (~40 fields), deep schema (5 levels), array-heavy schema; measure `find`/`updateOne` call-site instantiations via `--extendedDiagnostics` deltas; record baselines in comments per house style.
- **Acceptance criteria** Baseline numbers committed; regression threshold documented (suggest: fail review if a CRUD call site exceeds ~2x the recorded baseline).
- **Test plan** The benchmark run itself; no assertions.
- **Open questions** —

### CRUD-9: Backport `ValidateMatchKeys` to `Pipeline.match`

- **Priority** P2 | **Estimate** M | **Depends on** CRUD-2
- **Context** F2 verified `Pipeline.match({ naem: "x" })` silently produces `never` today. CRUD ships the fix; aggregation should not stay weaker than CRUD.
- **Design** Change `Pipeline.match` to `(filter: M & ValidateMatchKeys<PreviousStageDocs, M>)`. Risk: interaction with `facet`/`lookup` sub-pipeline inference and with `$and`/`$or` literal inference inside `_chain` — validate against the full `match.typeAssertions.ts` corpus before committing (this is why it's a separate, deferrable ticket rather than part of CRUD-2).
- **Acceptance criteria** `Pipeline.callSite.typeAssertions.ts` gains firing `@ts-expect-error` cases for typo-alone and typo-next-to-valid on an array-bearing schema; zero regressions in existing assertions; changeset (`patch` or `minor`).
- **Test plan** Per CLAUDE.md regression-guard rules: add cases, never remove without replacement.
- **Open questions** Does the intersection change hover quality on complex `$or` literals? Inspect with `.claude/inspect-types.ts`.

### CRUD-10: Call-site regression file for the CRUD surface

- **Priority** P0 | **Estimate** S | **Depends on** CRUD-5
- **Context** CLAUDE.md mandates the `callSite.typeAssertions.ts` pattern: pin desired rejections with `@ts-expect-error` so future signature changes can't silently reopen holes — exactly how the F2 hole would have been caught.
- **Design** New `packages/core/src/collection/Collection.callSite.typeAssertions.ts` transcribing the spike's matrix: filter typo alone / next-to-valid / dotted / inside `$or`; `$gte`-on-string; `$size`-on-scalar; optional-field accepts (post-CRUD-4); all ten update rejects incl. `$becomes`; projection mixed-mode + unknown key _in options position_; insert missing/wrong/excess; union-narrowing `Equal` pins.
- **Acceptance criteria** File compiles with every directive satisfied; wired into the normal build (it is under `src/`, so `bun run build` picks it up).
- **Test plan** The file is the test.
- **Open questions** —

### CRUD-11: Docs and examples

- **Priority** P1 | **Estimate** S | **Depends on** CRUD-5, CRUD-6
- **Context** The head-to-head demos are the marketing: full-depth filter typing vs Mongoose v9's one-level `WithLevel1NestedPaths`; union narrowing on `find` (neither incumbent can); projection-shaped results without `prisma generate`.
- **Design** `packages/core/examples/typedCrud.ts` (new) walking find→project→update with intentional-error comments; README section; CLAUDE.md "Pipeline Stages"-style subsection documenting `stages/update.ts` and the intersection-validation signature pattern (it is a _fourth_ pattern alongside the three in CLAUDE.md — document it there).
- **Acceptance criteria** Example compiles in the repo build; CLAUDE.md pattern list updated; changeset docs entry.
- **Test plan** Example file compiles under root tsconfig (`packages/core/examples/**` is included).
- **Open questions** —

## Sequencing

CRUD-1 → CRUD-2/3/4 (parallel) → CRUD-5 → CRUD-10 (same PR as 5 ideally) → CRUD-6/7/8 → CRUD-11; CRUD-9 anytime after CRUD-2. Estimated total ≈ plan/03's 3–4 weeks, with the L ticket (CRUD-5) as the critical path.
