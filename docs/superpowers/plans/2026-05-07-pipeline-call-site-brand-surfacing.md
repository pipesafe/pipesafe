# Pipeline Call-Site Brand Surfacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `PipeSafeError<...>` brand types added in PR #93 actually surface at user-facing Pipeline call sites — today they only fire when a user assigns a value to a directly-typed variable, not when chaining `.sort({ naem: 1 })` etc.

**Architecture:** Replace the `<const X extends Q>(query: X)` constraint pattern on Pipeline stage methods with `<const X>(query: X & Q)`. The intersection forces TypeScript to perform structural assignability and excess-property checking on the literal value while still letting `<const X>` capture the literal type for downstream output inference. This is the pattern Drizzle and Kysely use for their query builders.

**Tech Stack:** TypeScript 5.9 (project uses `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); Bun for tasks; Vitest for runtime tests; `*.typeAssertions.ts` files for compile-time assertions; tsdown for builds.

**Branch:** Off `claude/audit-ts-error-handling-review-fixes` (which is a continuation of PR #93's `claude/audit-ts-error-handling-KOWSP`). Open the eventual PR against `main`.

---

## Background

PR #93 introduced a `PipeSafeError<Msg, Ctx>` brand and wired it into operand and key positions across `match`, `set`, `group`, `project`, `unwind`, `sort`, and the expression operators. The `*.typeAssertions.ts` files prove the brand exists at the type layer. But a 10-case failure showcase ran during review revealed that **only 1 of 10 representative bad inputs produces a useful compile-time error at the chained call site**.

The root cause: every Pipeline stage method uses

```ts
sort<const S extends SortQuery<PreviousStageDocs>>($sort: S)
```

The `<const S extends Q>($q: S)` pattern infers `S` from the value, then checks `S extends Q` structurally. With mapped types and index signatures (which `SortQuery`, `GroupQuery`, `ProjectQuery` etc. all use), TypeScript **suppresses excess-property checking** in this position and lets a value with extra/wrong-typed keys satisfy `Q` via the index signature's broad value type.

A direct annotation makes the same brand fire correctly:

```ts
const _: SortQuery<User> = { naem: 1 }; // → TS2353 "'naem' does not exist in type 'SortQuery<User>'"
new Pipeline<User>().sort({ naem: 1 }); // → silent (no error)
```

The fix is to switch to:

```ts
sort<const S>($sort: S & SortQuery<PreviousStageDocs>)
```

The `&` intersection makes TS check the structural assignability of the value against `SortQuery<...>` directly (with excess-property checking), while `<const S>` still captures the literal type for `ResolveSortOutput<...>` etc.

## Affected methods

Methods using the broken pattern (verified at file Pipeline.ts on the review-fixes branch):

| Method        | Line | Generic                                                 |
| ------------- | ---- | ------------------------------------------------------- |
| `match`       | 193  | `<const M extends MatchQuery<PreviousStageDocs>>`       |
| `set`         | 206  | `<const S extends SetQuery<PreviousStageDocs>>`         |
| `unset`       | 219  | `<const U extends UnsetQuery<PreviousStageDocs>>`       |
| `group`       | 390  | `<const G extends GroupQuery<PreviousStageDocs>>`       |
| `project`     | 403  | `<const P extends ProjectQuery<PreviousStageDocs>>`     |
| `replaceRoot` | 416  | `<const R extends ReplaceRootQuery<PreviousStageDocs>>` |
| `sort`        | 434  | `<const S extends SortQuery<PreviousStageDocs>>`        |
| `facet`       | 611  | `<const F extends FacetQuery<PreviousStageDocs, Mode>>` |

Methods with multi-parameter generics (need separate evaluation in Task 9):

| Method        | Line |
| ------------- | ---- |
| `lookup`      | 232  |
| `graphLookup` | 313  |
| `count`       | 496  |
| `unionWith`   | 536  |

Methods that don't use the pattern (no change needed): `limit`, `skip`, `sample`, `out`, `merge`.

## Risk: output type inference

The current pattern's `extends` constraint guarantees `S extends SortQuery<Schema>` is true inside the return type. After the change, the return uses `S` (without the constraint), so `ResolveSortOutput<Schema, S>` could behave differently if `ResolveSortOutput` internally checks `Query extends SortQuery<Schema>`.

`ResolveSortOutput<Schema>` doesn't take `S`, so sort is safe. But `ResolveSetOutput<S, Schema>`, `ResolveGroupOutput<Schema, G>`, `ResolveProjectOutput<P, Schema>`, `ResolveMatchOutput<M, Schema>`, etc. all do.

Each of these `Resolve*Output` types contains a `Query extends Q<Schema> ? ... : never` check internally. If `S` (in the new intersection pattern) doesn't satisfy that check on its own, output inference falls back to `never` and downstream pipeline stages will fail.

**Mitigation:** wherever a `Resolve*Output<..., S>` is used in the return type, pass `S & Q<Schema>` instead. The intersection is the same one TypeScript already validated at the parameter, so it's free.

This is mechanical but easy to forget; the TDD-first approach below catches it because the `Pipeline.typeAssertions.ts` chained-stage tests will fail if output inference breaks.

## File Structure

- **Create:** `packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts`
  Permanent compile-time test file, one block per affected method, each pinning a representative call-site failure with `@ts-expect-error`. Becomes a regression guard for any future signature changes.

- **Modify:** `packages/core/src/pipeline/Pipeline.ts:193, 206, 219, 390, 403, 416, 434, 611`
  Eight method signatures changed. Each task lands one method.

- **Modify (verify only):** `packages/core/src/pipeline/Pipeline.typeAssertions.ts`
  Existing chained-stage tests act as guards for output type inference. They must keep passing.

- **Modify:** `.changeset/typed-error-dx.md`
  Document the call-site fix as the actual user-facing improvement.

---

## Task 0: Write the canary

**Files:**

- Create: `packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts`

This file pins the exact behavior we're trying to land. **Initially most cases will fail** (the `@ts-expect-error` directives on cases that currently pass silently will themselves fail with TS2578 "Unused '@ts-expect-error' directive"). That's the point — the file is the failing test that subsequent tasks fix one method at a time.

- [ ] **Step 1: Create the canary file**

```ts
/**
 * Call-site brand-surfacing assertions
 *
 * Each block exercises one Pipeline method with a wrong input. The
 * `@ts-expect-error` directive must fire — meaning the call site rejects
 * the bad input — for the test to pass. Initially most directives below
 * are unused (the bad input slips through), so this file fails. As each
 * method's signature is fixed, more directives become satisfied.
 *
 * This file is a regression guard against the `<const X extends Q>(q: X)`
 * pattern silently re-emerging for any stage method.
 */

import { Pipeline } from "./Pipeline";

type User = {
  _id: string;
  name: string;
  age: number;
  tags: string[];
  joinedAt: Date;
  status: "active" | "inactive";
};

// match — already works for $gte on string field; keep it as a positive
// regression check.
// @ts-expect-error  $gte requires numeric/date field
const _match_bad = new Pipeline<User>().match({ name: { $gte: "Alice" } });

// sort — typo'd field name should fail.
// @ts-expect-error  'naem' is not a field of User
const _sort_bad = new Pipeline<User>().sort({ naem: 1 });

// set — typo'd field reference should fail. (Note: the `$naem` typo
// also currently triggers TS2589 depth limit, which counts as "fails to
// compile" for our purposes.)
// @ts-expect-error  '$naem' is not a valid field reference on User
const _set_bad = new Pipeline<User>().set({ display: "$naem" });

// unset — typo'd key should fail.
// @ts-expect-error  'naem' is not a field of User
const _unset_bad = new Pipeline<User>().unset("naem");

// group — $sum on a string field reference should fail.
// @ts-expect-error  $sum requires numeric operand
const _group_bad = new Pipeline<User>().group({
  _id: "$status",
  total: { $sum: "$name" },
});

// project — mixed inclusion/exclusion should fail.
// @ts-expect-error  cannot mix inclusion and exclusion
const _project_mixed = new Pipeline<User>().project({ name: 1, age: 0 });

// project — including an unknown key should fail.
// @ts-expect-error  unknownKey is not a field of User
const _project_unknown = new Pipeline<User>().project({
  name: 1,
  unknownKey: 1,
});

// replaceRoot — newRoot referencing a missing field should fail.
// @ts-expect-error  '$missing' is not a valid field reference
const _replaceRoot_bad = new Pipeline<User>().replaceRoot({
  newRoot: "$missing",
});

// unwind — $unwind on a scalar field already errors with a structural
// message; keep it as a positive regression check.
// @ts-expect-error  $unwind requires an array field
const _unwind_bad = new Pipeline<User>().unwind("$name");

// facet — sub-pipeline using a typo'd field should fail.
// @ts-expect-error  'naem' is not a field inside the facet sub-pipeline
const _facet_bad = new Pipeline<User>().facet({
  bad: (p) => p.sort({ naem: 1 }),
});

export {
  _match_bad,
  _sort_bad,
  _set_bad,
  _unset_bad,
  _group_bad,
  _project_mixed,
  _project_unknown,
  _replaceRoot_bad,
  _unwind_bad,
  _facet_bad,
};
```

- [ ] **Step 2: Run typecheck to record the starting state**

Run: `bun run typecheck`

Expected: many TS2578 "Unused '@ts-expect-error' directive" failures — one per case the call site doesn't currently reject. Save the count for comparison after each task.

- [ ] **Step 3: Commit the canary**

```bash
git add packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts
git commit -m "test(core): add call-site brand-surfacing assertions

Failing intentionally — pins the user-facing behavior we want from PR #93.
Each subsequent task fixes one method's signature so its @ts-expect-error
directive becomes satisfied."
```

---

## Task 1: Fix `sort()` (pilot)

Sort is the simplest case: `ResolveSortOutput<Schema>` doesn't take the query as a generic, so there's no risk to output inference. Use it to validate the pattern before rolling out.

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:434-438`

- [ ] **Step 1: Verify the canary fails for sort specifically**

Run: `bun run typecheck 2>&1 | grep callSite | grep -E "_sort|sort_bad"`

Expected: at least one TS2578 mentioning `_sort_bad`.

- [ ] **Step 2: Change sort's signature to the intersection pattern**

In `packages/core/src/pipeline/Pipeline.ts:434-438`:

```ts
  sort<const S>(
    $sort: S & SortQuery<PreviousStageDocs>
  ): Pipeline<StartingDocs, PreviousStageDocs, Mode, UsedStages | "$sort"> {
    return this._chain<PreviousStageDocs, "$sort">([{ $sort }]);
  }
```

- [ ] **Step 3: Run typecheck and confirm the sort case is now satisfied**

Run: `bun run typecheck 2>&1 | grep callSite`

Expected: no `_sort_bad` failures. If any still appear, the pattern needs adjustment — investigate `SortQuery<PreviousStageDocs>` to see whether the mapped type is somehow still permissive.

- [ ] **Step 4: Run full typecheck to confirm no other tests broke**

Run: `bun run typecheck`

Expected: only the remaining (still-broken) call-site cases fail. The existing `Pipeline.typeAssertions.ts` chained tests (`_setThenSort` etc.) must still pass.

- [ ] **Step 5: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface SortQuery brand at sort() call site

Switch sort()'s signature from <const S extends SortQuery<...>>(\$sort: S)
to <const S>(\$sort: S & SortQuery<...>). The intersection forces TS to
check the value against SortQuery directly (with excess-property
checking), so a typo like \`pipeline.sort({ naem: 1 })\` now fails at
the call site instead of silently passing.

ResolveSortOutput<Schema> doesn't take the query as a generic so output
inference is unaffected."
```

---

## Task 2: Fix `unset()`

Unset takes a string or array of strings, which is even simpler than mapped-type queries.

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:219-228`

- [ ] **Step 1: Read the current signature**

Run: `sed -n '219,228p' packages/core/src/pipeline/Pipeline.ts`

- [ ] **Step 2: Apply the same intersection pattern**

The output type of unset uses `U` to compute which keys are removed. Pass `U & UnsetQuery<...>` to `ResolveUnsetOutput` if that's where it's used.

```ts
  unset<const U>(
    $unset: U & UnsetQuery<PreviousStageDocs>
  ): Pipeline<
    StartingDocs,
    ResolveUnsetOutput<U & UnsetQuery<PreviousStageDocs>, PreviousStageDocs>,
    Mode,
    UsedStages | "$unset"
  > {
    return this._chain<
      ResolveUnsetOutput<U & UnsetQuery<PreviousStageDocs>, PreviousStageDocs>,
      "$unset"
    >([{ $unset }]);
  }
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

Expected: `_unset_bad` directive now satisfied; no chain-test regressions.

- [ ] **Step 4: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface UnsetQuery brand at unset() call site"
```

---

## Task 3: Fix `match()`

Match's `_match_bad` case already passes today (the `$gte`-on-string brand was already firing at the call site for an unrelated reason — the brand is in a value-position constraint at a known key, which TS checks even with the broken pattern). The fix here is for completeness and to ensure other failure modes (typo'd top-level field, etc.) also surface.

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:193-204`

- [ ] **Step 1: Apply the intersection pattern**

```ts
  match<const M>(
    $match: M & MatchQuery<PreviousStageDocs>
  ): Pipeline<
    StartingDocs,
    ResolveMatchOutput<M & MatchQuery<PreviousStageDocs>, PreviousStageDocs>,
    Mode,
    UsedStages | "$match"
  > {
    return this._chain<
      ResolveMatchOutput<M & MatchQuery<PreviousStageDocs>, PreviousStageDocs>,
      "$match"
    >([{ $match }]);
  }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: `_match_bad` still satisfied; existing `Pipeline.typeAssertions.ts` discriminated-union narrowing tests (`SpeakerTest`, `AttendeeTest`, etc.) still pass.

- [ ] **Step 3: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface MatchQuery brand at match() call site"
```

---

## Task 4: Fix `set()`

Set is the trickiest because of its dotted-key flattening logic in `ResolveSetOutput<Query, Schema>`. The TS2589 depth limit hit during review investigation may resurface here under stricter checking.

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:206-217`

- [ ] **Step 1: Apply the intersection pattern**

```ts
  set<const S>(
    $set: S & SetQuery<PreviousStageDocs>
  ): Pipeline<
    StartingDocs,
    ResolveSetOutput<S & SetQuery<PreviousStageDocs>, PreviousStageDocs>,
    Mode,
    UsedStages | "$set"
  > {
    return this._chain<
      ResolveSetOutput<S & SetQuery<PreviousStageDocs>, PreviousStageDocs>,
      "$set"
    >([{ $set }]);
  }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: `_set_bad` directive satisfied. Existing `set.typeAssertions.ts` cases must still pass.

If TS2589 depth-limit errors fire on previously-passing chained-set tests, the change needs the additional `S extends SetQuery<...>` constraint:

```ts
  set<const S extends SetQuery<PreviousStageDocs>>(
    $set: S & SetQuery<PreviousStageDocs>
  ): ...
```

The `extends` constraint is redundant with the parameter intersection but gives TS a hint that flattens the conditional cascade in ResolveSetOutput. If both `<const S>` (alone) and `<const S extends Q>` (combined with `&`) work, prefer the simpler form.

- [ ] **Step 3: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface SetQuery brand at set() call site"
```

---

## Task 5: Fix `group()`

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:390-401`

- [ ] **Step 1: Apply the intersection pattern**

```ts
  group<const G>(
    $group: G & GroupQuery<PreviousStageDocs>
  ): Pipeline<
    StartingDocs,
    ResolveGroupOutput<PreviousStageDocs, G & GroupQuery<PreviousStageDocs>>,
    Mode,
    UsedStages | "$group"
  > {
    return this._chain<
      ResolveGroupOutput<PreviousStageDocs, G & GroupQuery<PreviousStageDocs>>,
      "$group"
    >([{ $group }]);
  }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: `_group_bad` directive satisfied; existing `group.typeAssertions.ts` `_id`-shape tests still pass; chained `_groupThenSet` test still passes.

- [ ] **Step 3: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface GroupQuery brand at group() call site"
```

---

## Task 6: Fix `project()`

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:403-414`

- [ ] **Step 1: Apply the intersection pattern**

```ts
  project<const P>(
    $project: P & ProjectQuery<PreviousStageDocs>
  ): Pipeline<
    StartingDocs,
    ResolveProjectOutput<P & ProjectQuery<PreviousStageDocs>, PreviousStageDocs>,
    Mode,
    UsedStages | "$project"
  > {
    return this._chain<
      ResolveProjectOutput<
        P & ProjectQuery<PreviousStageDocs>,
        PreviousStageDocs
      >,
      "$project"
    >([{ $project }]);
  }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: both `_project_mixed` and `_project_unknown` directives satisfied; existing inclusion/exclusion mode tests still pass.

- [ ] **Step 3: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface ProjectQuery brand at project() call site"
```

---

## Task 7: Fix `replaceRoot()`

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:416-427`

- [ ] **Step 1: Apply the intersection pattern**

```ts
  replaceRoot<const R>(
    $replaceRoot: R & ReplaceRootQuery<PreviousStageDocs>
  ): Pipeline<
    StartingDocs,
    ResolveReplaceRootOutput<
      R & ReplaceRootQuery<PreviousStageDocs>,
      PreviousStageDocs
    >,
    Mode,
    UsedStages | "$replaceRoot"
  > {
    return this._chain<
      ResolveReplaceRootOutput<
        R & ReplaceRootQuery<PreviousStageDocs>,
        PreviousStageDocs
      >,
      "$replaceRoot"
    >([{ $replaceRoot }]);
  }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: `_replaceRoot_bad` directive satisfied.

- [ ] **Step 3: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface ReplaceRootQuery brand at replaceRoot() call site"
```

---

## Task 8: Fix `facet()`

Facet is recursive — its sub-pipelines are themselves Pipelines, so the call-site brand-surfacing transitively requires the other methods to be fixed first. That's why this is Task 8.

**Files:**

- Modify: `packages/core/src/pipeline/Pipeline.ts:611-633`

- [ ] **Step 1: Read the current facet signature**

Run: `sed -n '611,635p' packages/core/src/pipeline/Pipeline.ts`

- [ ] **Step 2: Apply the intersection pattern**

```ts
  facet<const F>(
    $facet: F & FacetQuery<PreviousStageDocs, Mode>
  ): Pipeline<
    StartingDocs,
    ResolveFacetOutput<
      PreviousStageDocs,
      F & FacetQuery<PreviousStageDocs, Mode>
    >,
    Mode,
    UsedStages | "$facet"
  > {
    return this._chain<
      ResolveFacetOutput<
        PreviousStageDocs,
        F & FacetQuery<PreviousStageDocs, Mode>
      >,
      "$facet"
    >([{ $facet }]);
  }
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

Expected: `_facet_bad` directive satisfied (recursive sort fix from Task 1 makes the inner `.sort({ naem: 1 })` reject); existing `facet.typeAssertions.ts` tests still pass.

- [ ] **Step 4: Run runtime tests**

Run: `bun run test:ci`

Expected: 56 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts
git commit -m "fix(core): surface FacetQuery brand at facet() call site"
```

---

## Task 9: Audit the multi-parameter generic methods

`lookup`, `graphLookup`, `count`, and `unionWith` use multi-parameter generic patterns that aren't a literal `<const X extends Q>(query: X)` shape. They may or may not have the same hole. Investigate and decide.

**Files:**

- Modify (possibly): `packages/core/src/pipeline/Pipeline.ts:232, 313, 496, 536`

- [ ] **Step 1: Read each method's current signature**

Run:

```bash
sed -n '232,250p;313,330p;496,510p;536,560p' packages/core/src/pipeline/Pipeline.ts
```

- [ ] **Step 2: For each method, write a minimal failing call into the canary file**

Add to `Pipeline.callSite.typeAssertions.ts`:

```ts
// lookup — typo'd localField should fail.
// @ts-expect-error  'naem' is not a field of User
const _lookup_bad = new Pipeline<User>().lookup({
  from: someCollection, // an existing User-shaped collection
  localField: "naem",
  foreignField: "id",
  as: "joined",
});

// count — typo'd output field name is harder to test (string parameter,
// not object); skip if the only failure mode is "any string accepted".

// unionWith — wrong-shaped Source should fail.
// @ts-expect-error  Source schema mismatch
const _unionWith_bad = new Pipeline<User>().unionWith(
  {} as Pipeline<{ unrelated: number }>
);
```

- [ ] **Step 3: Run typecheck and see which directives fire**

Run: `bun run typecheck 2>&1 | grep callSite`

If a directive is "unused", that method has the same hole. If it fires, the method's existing pattern works.

- [ ] **Step 4: For each method that has the hole, apply the intersection pattern**

The same `<const X>(...: X & Q)` substitution applies. Multi-parameter signatures take more care — preserve the other generics (e.g. lookup's `NewKey extends string`).

- [ ] **Step 5: Run typecheck and runtime tests**

Run: `bun run typecheck && bun run test:ci`

Expected: typecheck clean; 56 runtime tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/Pipeline.ts \
        packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts
git commit -m "fix(core): surface brands at lookup/unionWith call sites

Same intersection-pattern fix as the single-generic methods, applied to
the multi-parameter signatures."
```

---

## Task 10: Run the full failure showcase end-to-end

Sanity check: build a representative bad pipeline (the 10-case showcase used during review), confirm each case now produces a clean PipeSafeError-bearing message, and document one before/after pair.

**Files:**

- Temporarily create: `packages/core/benchmarking/failure-showcase.ts` (deleted at end of task)

- [ ] **Step 1: Create the showcase file**

```ts
import { Pipeline } from "@pipesafe/core";

type User = {
  _id: string;
  name: string;
  age: number;
  tags: string[];
  joinedAt: Date;
  status: "active" | "inactive";
};

const _bad1 = new Pipeline<User>().set({ display: "$naem" });
const _bad2 = new Pipeline<User>().match({ name: { $gte: "Alice" } });
const _bad3 = new Pipeline<User>().group({
  _id: "$status",
  total: { $sum: "$name" },
});
const _bad4 = new Pipeline<User>().set({ computed: { $add: ["$name", 1] } });
const _bad5 = new Pipeline<User>().project({ name: 1, age: 0 });
const _bad6 = new Pipeline<User>().project({ name: 1, unknownKey: 1 });
const _bad7 = new Pipeline<User>().unwind("$name");
const _bad8 = new Pipeline<User>().sort({ naem: 1 });
const _bad9 = new Pipeline<User>().set({
  combined: { $concat: ["$name", "$age"] },
});
const _bad10 = new Pipeline<User>().set({
  formatted: { $dateToString: { format: "%Y", date: "$name" } },
});

export {
  _bad1,
  _bad2,
  _bad3,
  _bad4,
  _bad5,
  _bad6,
  _bad7,
  _bad8,
  _bad9,
  _bad10,
};
```

- [ ] **Step 2: Run typecheck and capture errors**

Run:

```bash
cd packages/core && rm -f tsconfig.tsbuildinfo
npx tsc --noEmit -p tsconfig.benchmark.json --pretty false 2>&1 \
  | grep failure-showcase > /tmp/showcase-after.txt
wc -l /tmp/showcase-after.txt
cat /tmp/showcase-after.txt
```

Expected: at least 9 of 10 cases now fire PipeSafeError-bearing messages. Case #1 (`$naem` typo) may still fire TS2589 for unrelated depth reasons; that's documented in the canary as acceptable.

- [ ] **Step 3: Pick one before/after pair to paste into the PR description**

Suggested pair:

```
Before (main):
  TS2353: Object literal may only specify known properties, and '$gte'
  does not exist in type 'RegExp | { $exists?: boolean; $type?: ...;
  $eq?: string; $ne?: string; $in?: string[]; $nin?: string[];
  $regex?: unknown; } | { $not: { ... } } | { $not: Notted<{ ... }> }'.

After (this branch):
  TS2322: Type 'string' is not assignable to type
  'PipeSafeError<"Operator '$gte' is not allowed on this field
  (numeric/date only)", string>'.
```

- [ ] **Step 4: Delete the showcase file**

```bash
rm packages/core/benchmarking/failure-showcase.ts
```

The permanent regression guard is `Pipeline.callSite.typeAssertions.ts`, not this temporary file.

- [ ] **Step 5: Verify clean tree**

Run: `git status --short`

Expected: only the canary file from earlier tasks; no stray showcase file.

---

## Task 11: Update the changeset

The original changeset said brands surface in IDE hovers — true for typed variables, misleading for chained calls. Now that it's actually true, refine the wording.

**Files:**

- Modify: `.changeset/typed-error-dx.md`

- [ ] **Step 1: Read the current changeset**

Run: `cat .changeset/typed-error-dx.md`

- [ ] **Step 2: Add a section after "Round 2" describing the call-site surfacing**

Append before the "Infrastructure:" header:

```markdown
Call-site brand surfacing:

- `Pipeline` stage methods (`match`, `set`, `unset`, `group`, `project`,
  `replaceRoot`, `sort`, `unwind`, `facet`, plus `lookup` / `unionWith`)
  switched from `<const X extends Q>($q: X)` to `<const X>($q: X & Q)`.
  The intersection pattern (used by Drizzle, Kysely) makes TypeScript
  perform structural assignability and excess-property checking on the
  literal value, so the brand types added in Round 1/2 actually fire at
  the chained call site. Before this change a typo like
  `pipeline.sort({ naem: 1 })` silently passed; now it errors with
  `'naem' does not exist in type 'SortQuery<...>'`.
```

- [ ] **Step 3: Commit**

```bash
git add .changeset/typed-error-dx.md
git commit -m "docs(core): document call-site brand surfacing in changeset"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full pre-merge battery**

Run:

```bash
bun run lint && bun run typecheck && bun run build && bun run test:ci
```

Expected: all four pass cleanly.

- [ ] **Step 2: Re-read the canary**

Run: `cat packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts`

Confirm: every `@ts-expect-error` directive is satisfied (the file compiles cleanly with no TS2578).

- [ ] **Step 3: Spot-check the IDE experience**

Open `packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts` in VS Code. Hover over each `_xxx_bad` constant. Confirm hover shows a useful, literal error message that names the operator/field and explains the problem.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 5: Open a PR**

PR description should:

- Link to the original PR #93 and the review comment thread that motivated this work.
- Paste the before/after pair captured in Task 10 Step 3.
- Note the `<const X>($q: X & Q)` pattern is the same one Drizzle and Kysely use (cite the SYNTHESIS.md audit).
- Flag that this is a behavioral change for any code that was relying on the silent pass — pre-v1, audience small, but worth a heads-up.

---

## Self-review checklist

**Spec coverage:**

- ✅ All 8 single-generic methods have a task (Tasks 1-8)
- ✅ Multi-parameter methods evaluated (Task 9)
- ✅ Output type inference risk explicitly addressed (passing `S & Q` into `Resolve*Output`)
- ✅ Permanent regression guard created (canary file)
- ✅ End-to-end showcase verification (Task 10)
- ✅ Changeset updated (Task 11)
- ✅ Final lint/typecheck/build/test (Task 12)

**No placeholders:**

- ✅ All file paths exact
- ✅ All code blocks complete
- ✅ Each task has runnable commands with expected output

**Type consistency:**

- ✅ `S & Q<Schema>` substituted everywhere `S` was used in return types (per the output-inference risk note)
- ✅ Method names match across tasks
- ✅ Generic parameter names (`M`, `S`, `U`, `G`, `P`, `R`, `F`) match the existing conventions in Pipeline.ts
