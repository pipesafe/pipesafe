# TS2589 Fix Guide — Runbook

You're staring at:

```
error TS2589: Type instantiation is excessively deep and possibly infinite.
```

This guide gets you from "the build is red" to "the build is green and I understand why." Pair with [`limits.md`](./limits.md) for mechanism and [`avoids.md`](./avoids.md) for the don't-list.

---

## Step 1 — Capture a minimal repro

Don't try to fix TS2589 in a 500-line user file. The failing call alone is plenty.

1. Make a scratch file (e.g. `packages/core/scratch.ts`, gitignored or just unused).
2. Copy in the smallest expression that produces the error. Schema declarations + the failing chained call.
3. Confirm the error reproduces on `bun run build`. If it doesn't, the cost is coming from elsewhere in the original file (likely an upstream chain). Add the prior calls back one at a time until it reappears.
4. Save the file path and the variable name. You'll feed both to the tool in step 2.

**Note:** TypeScript's `instantiationCount` resets per top-level statement. If your scratch repro has the failing call at the top level, you're seeing the worst case. If it's nested in a function body, it's also fine — the limit applies to that function's check unit.

---

## Step 2 — Run `depth-blame` on the failing expression

```sh
bun run depth-blame <varName> [filePath]
```

Defaults: `filePath` is the same scratch convention as `inspect-types.ts`.

What you get:

- **Which counter tripped.** One of:
  - `instantiationDepth` (cap 100) — recursion was too deep at one point.
  - `instantiationCount` (cap 5,000,000) — too much total type work.
  - `tailCount` (cap 1,000) — a tail-recursive conditional iterated too many times.
- **Top-N PipeSafe offenders** — ranked by self-time, scoped to types declared under `packages/core/src/**` and `packages/manifold/src/**`. Each line is `<typeName> <file>:<line>  <selfMs>ms  <count> calls`.
- **Top-N upstream call sites** — the operator chain that triggered the instantiations.
- **Path to the trace JSON** — feed it to the local viewer for a flame graph.

> The trace is written _before_ the bail-out, so the report is useful even when the build is currently failing. AST tools like `inspect-types.ts` are not — when the checker bails, they see `any`.

For the visual view: run `bun run depth-view` to open the interactive Vite app, then pick any file/symbol to drill into its instantiation cost.

---

## Step 3 — Match the offender to a technique

Read the top three offenders. The fix depends on _what they are_, not just _how expensive they are_. Decision tree:

### A. The offender is a distributive conditional over a schema union

**Tells:** the offender is something like `FilterUnion`, `ResolveMatchOutput`, or any helper whose `instantiationCount` scales with the size of the schema union; the trace shows N copies of the same alias, one per union member.

**Fix:** wrap the `checkType` and `extendsType` in single-element tuples — `[T] extends [U]` instead of `T extends U`. See [`limits.md` §2.6](./limits.md#26-non-distribution-wrapping-t-extends-u).

**Don't apply if** you _need_ per-branch handling (e.g. `FilterUnion` is intentionally distributive to filter the union; the cost there is unavoidable).

### B. The offender is a deep recursive walk

**Tells:** offender is `PathsIncludingArrayIndexes`, `FieldPath`, `InferNestedFieldReference*`, `MergeNested`, or similar; counter tripped is `instantiationDepth` (cap 100) or `tailCount` (cap 1000).

**Fix order:**

1. Convert head recursion to tail recursion — add an `Acc` parameter and put the recursive call at the end of the false branch with no wrapper. See [§2.1](./limits.md#21-tail-recursive-accumulator). This alone gives 10× headroom.
2. If still too deep, unroll 2–3 levels per step. See [§2.2](./limits.md#22-loop-unrolling-process-n-elements-per-step) — the retired `ExpandDottedKeyBatched` shape; the live codebase prefers `SplitPath` + fold (`utils/paths.ts`).
3. Counter-reset (`& {}`) is a last resort — it slows the compiler measurably. Reach for [§2.3](./limits.md#23-counter-reset-hack-amp-injection) only if 1 and 2 aren't enough.

### C. The offender appears many times with similar arguments

**Tells:** ranked list shows the same alias dozens of times with similar (or identical) instantiations; counter tripped is `instantiationCount`.

**Fix:** pull the repeated computation into a named alias so the type-alias cache works. See [§2.4](./limits.md#24-cached-intermediate-aliases). This is the highest-leverage refactor in the toolbox — single named alias can cut counts 5–20×.

### D. The chain has nested `extends infer` or stacked conditionals

**Tells:** the type definition is shaped like `Foo<…> extends infer X ? Bar<…> extends infer Y ? Recurse<X, Y> : never : never`; offender's recursion frames each carry depth-2 or depth-3 conditional descent.

**Fix:** compute the intermediate values in the recursive call's parameter list. See [§2.5](./limits.md#25-compute-before-pass).

### E. The chain itself is too long for the user

**Tells:** the user's code chains 10+ operators; the trace shows large but not pathological per-stage costs that simply add up; the same chain works fine when split across two `const`s with explicit type annotations.

**Fix:** in the user's code, split the chain. Each top-level `const` with an explicit type annotation gets a fresh `instantiationCount` budget. We don't have a `$assertType` API yet (see [§2.12](./limits.md#212-escape-hatch-assertion)) — for now, a structurally-equivalent cast at a chain boundary is the equivalent escape hatch. If we keep seeing this, that's the signal to ship a first-class `.assertOutput<T>()` Pipeline method.

### F. The offender is internal (e.g. lib.es5)

**Tells:** the top frames live in `lib.es*.d.ts` or `mongodb` types, not under `packages/`.

**Fix:** the cost is being _passed in_ to those types from one of ours. Look upstream. The depth-blame tool dims non-PipeSafe frames in the viewer; in the text output, scroll past them and find the first PipeSafe-owned frame. That's the responsible alias.

---

## Step 4 — Verify

After the fix:

1. **Re-run `bun run depth-blame`** on the same expression. The offender's `instantiationCount` should drop materially. If it didn't, the fix didn't address the actual cause — back to Step 3.
2. **`bun run build`.** TS2589 should be gone. If a different one fires somewhere else, treat it as a separate incident — repeat from Step 1 with the new expression.
3. **`bun run test:ci`.** Specifically watch the `*.typeAssertions.ts` files. A "fix" that produces `any` for what should have been a structured type will pass the build and silently fail the assertions.
4. **Add a regression case** to the relevant `*.typeAssertions.ts` if the offender was a public-facing type. Pin the resolved shape so a future refactor doesn't undo your fix.
5. **Update `limits.md` §3 ("How PipeSafe currently fights this")** if you introduced a new mitigation pattern. Future agents should be able to find it.

---

## Step 5 — When the fix is "the user shouldn't do this"

Some chains are correctly typed but pathologically expensive (10+ `lookup` stages on a wide schema, etc.). Three options in order of preference:

1. **Document a `.assertOutput<T>()` chain-cut idiom in user-facing docs.** Even without a first-class API, a `as Pipeline<MyShape>` cast works.
2. **Profile and optimise the offending operator.** If a single `lookup` is contributing 40% of the cost, that's a refactor candidate.
3. **File an issue.** Track the affected user pattern so we don't keep rediscovering it.

---

## Pre-flight: avoiding TS2589 before it fires

There is no custom lint plugin for these anti-patterns (yet) — the guardrails are:

- [`avoids.md`](./avoids.md) — the authoring-time don't-write list (head recursion, naked `T extends U` over unions, `Prettify`-as-fix, `Mutable<T>` inside `PipeSafeError`, inline mapped types inside recursive aliases).
- `bun run budget:check` — the CI instantiation-count gate; it fails the build when a change regresses total instantiations past the budget.
- `bun run depth-view:query top` — rank current per-symbol costs before and after a change to see where the budget went.

---

## Appendix: cheat-sheet card

```
TS2589 fired                                                      [stop, breathe]

→ bun run depth-blame <expr> [file]                          [diagnose, ranked offenders]
   ├─ Counter: instantiationDepth (cap 100)         → tail-recurse + maybe unroll
   ├─ Counter: instantiationCount (cap 5M)          → cache via named alias
   └─ Counter: tailCount (cap 1000)                 → break tail (& {}) reluctantly

→ Offender shape:
   ├─ Distributive over schema union                → [T] extends [U]
   ├─ Head recursion                                → add Acc, tail-position
   ├─ Repeated similar instantiations               → named intermediate alias
   ├─ Stacked extends infer                         → compute-before-pass
   └─ User chain too long                           → cast at boundary

→ Verify: depth-blame again, then bun run build, then bun run test:ci
→ Pin the fix: add to *.typeAssertions.ts
```
