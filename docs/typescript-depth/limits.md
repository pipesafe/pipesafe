# TypeScript Instantiation Depth — Detailed Reference

PipeSafe's type system does heavy work at compile time: recursive path walks, distributive conditional types, and large mapped-type unions. That puts us close to TypeScript's three internal recursion ceilings. Hitting any of them produces:

```
TS2589: Type instantiation is excessively deep and possibly infinite.
```

This document explains what the compiler is actually doing, where the codebase already defends against it, and which idioms we use (and which we deliberately don't). Written to be read end-to-end the first time, then skimmed thereafter; pair it with `avoids.md` (the short list) and `fix-guide.md` (the runbook).

> Companion docs: [`avoids.md`](./avoids.md) · [`fix-guide.md`](./fix-guide.md)

---

## 1. The three ceilings

TypeScript's checker tracks three counters concurrently. Any one of them tripping bails the current instantiation, substitutes `errorType`, and reports TS2589. They're declared in `src/compiler/checker.ts` near the top of `createTypeChecker`.

| Counter              | Cap           | Triggered by                                                                                                                                                   | Reset on                                                                                             |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `instantiationDepth` | **100**       | Nested `instantiateTypeWithAlias` calls — each generic instantiation pushes the counter, and unwinding pops it.                                                | Function exit (it's a stack).                                                                        |
| `instantiationCount` | **5,000,000** | Every `instantiateType` call — additive across one check unit.                                                                                                 | `checkSourceElement` / `checkDeferredNode` / `checkExpression` reset it to 0.                        |
| `tailCount`          | **1,000**     | Tail-recursive evaluation of conditional types — checker walks a single conditional chain via `canTailRecurse` without going through normal `instantiateType`. | Breaking the tail (e.g. an intersection `& {}` makes the recursion non-tail and resets the counter). |

These are **separate ceilings**: a moderately deep recursion that's also wide can pass `instantiationDepth` and still trip `instantiationCount`; a narrow but very long tail-recursive chain can pass both and trip `tailCount`. The diagnostic message is identical for all three, so the same TS2589 in two different places can need totally different fixes.

The values above are hardcoded constants in the TypeScript compiler and have been stable for years. They are **not configurable** via `tsconfig.json`. Treat them as fixed laws of physics.

### What "bail-out" actually does

When a counter trips:

1. The checker stops descending. The in-flight type becomes `errorType` (effectively `any`).
2. A diagnostic is recorded at the source span that triggered the instantiation.
3. Surrounding type-checking continues — only the offending branch is poisoned.
4. **`tsc --generateTrace` events written before the bail-out are still flushed to disk.** This is why the trace-based diagnostic tool (`bun run depth-blame`) works even when the build is currently failing with TS2589.
5. **AST tools (`ts-morph`, `inspect-types.ts`) cannot see what blew up.** They read the same checker output we do, and the output post-bail is `any`. Use the trace, not the AST, when chasing TS2589.

### Recovery semantics

Counters are reset at well-defined re-entry points:

- `instantiationCount` resets on each top-level `checkSourceElement`, `checkDeferredNode`, or `checkExpression`. Practically: each top-level statement, each function body, each expression standalone. This is why **splitting a long expression into named intermediate `const`s with explicit type annotations can fix TS2589** — each intermediate hits a fresh counter.
- `instantiationDepth` is a stack and unwinds naturally.
- `tailCount` resets when the chain stops being tail-recursive. Inserting an intersection or other wrapper around the recursive call breaks `canTailRecurse` and zeroes the counter.

### Type alias caching

A separate, equally important mechanism: TypeScript caches the result of generic type instantiations keyed on (alias, type arguments). If you call `Foo<X>` twice with the same `X`, the second call is free. Caching is by **alias**, not by structural shape — so:

- Naming an intermediate result (`type Step1 = Foo<X>; type Step2 = Bar<Step1>`) caches it. The next file that produces the same `Step1` reuses it.
- Inlining the same expression two places does **not** cache (no alias to key on).
- Anonymous mapped types `{ [K in keyof T]: ... }` produced inside a recursive call don't cache effectively across instantiations.

Strategic aliasing is the cheapest depth fix in the toolbox.

---

## 2. The 12 mitigation techniques

Listed roughly in order of "first thing to try" → "exotic last resort." Each entry: how to recognise the situation, the code shape, why it works at the checker level, and a pointer to a current PipeSafe usage if any.

### 2.1 Tail-recursive accumulator

**Use when:** a recursive type builds its output by wrapping each step (`[H, ...Rec<Tail>]`) — head recursion. The recursion can't unwind until the deepest call returns, so the depth of the result equals the depth of the input.

```ts
// Head-recursive (bad): result type nests N deep for N inputs.
type Replace<T, V> =
  T extends [infer _, ...infer R] ? [V, ...Replace<R, V>] : [];

// Tail-recursive (good): accumulator carries the result forward.
type Replace<T, V, Acc extends V[] = []> =
  T extends [infer _, ...infer R] ? Replace<R, V, [...Acc, V]> : Acc;
```

**Why:** the checker's `canTailRecurse` optimisation turns the second form into iteration that consumes `tailCount` (limit 1000) instead of stacking `instantiationDepth` (limit 100). 10× more headroom, same semantics.

**Caveat:** the false branch must return `Acc` directly, not wrap it. Any wrapper around the recursive call (intersection, tuple, mapped type) defeats the optimisation.

### 2.2 Loop unrolling (process N elements per step)

**Use when:** you've already gone tail-recursive and still hit the 1000 cap.

```ts
// PipeSafe in production — packages/core/src/utils/core.ts:52-65
export type ExpandDottedKeyBatched<Key extends string, Value> =
  Key extends `${infer First}.${infer Second}.${infer Rest}` ?
    Rest extends `${string}.${string}` ?
      { [K in First]: { [K2 in Second]: ExpandDottedKeyBatched<Rest, Value> } }
    : { [K in First]: { [K2 in Second]: { [K3 in Rest]: Value } } }
  : Key extends `${infer First}.${infer Rest}` ?
    { [K in First]: { [K2 in Rest]: Value } }
  : { [K in Key]: Value };
```

**Why:** processes 2–3 segments per recursive call instead of one. Multiplies effective tail-count limit by N. The "Stage 2.1" comment in the source captures the ~50% depth reduction we measured.

**Caveat:** unrolling N steps emits N copies of each branch. Past N=3 the source becomes hard to maintain and the duplicated branches start meaningfully growing `instantiationCount` (the second ceiling). Don't unroll past 3 without measuring.

### 2.3 Counter-reset hack (`& {}` injection)

**Use when:** all three preceding tricks aren't enough — typically only relevant for synthetic types like multi-thousand-element tuples.

```ts
type Reset<T, V, Acc extends V[] = [], N extends unknown[] = []> =
  N["length"] extends 500 ?
    Reset<T, V, Acc, []> & {} // intersection breaks tail, resets tailCount
  : T extends [infer _, ...infer R] ? Reset<R, V, [...Acc, V], [...N, unknown]>
  : Acc;
```

**Why:** the `& {}` makes the recursive call no longer in tail position from `canTailRecurse`'s perspective. The checker abandons the tail-recursion fast-path, evaluates the intersection, and the next descent starts a fresh tail chain.

**Caveat:** slows the compiler. Materially. Only use when the alternative is "feature unshippable." Not currently used in PipeSafe; documented for completeness.

### 2.4 Cached intermediate aliases

**Use when:** the same expensive computation appears in multiple places, or a long chain has natural break-points.

```ts
type Step1<T> = HeavyTransformA<T>;
type Step2<T> = HeavyTransformB<Step1<T>>;
type Final<T> = HeavyTransformC<Step2<T>>;
```

**Why:** the checker caches `Step1<X>` after first computation. Reusing the alias is O(1); inlining is O(N) every time. This is the single highest-leverage technique in the codebase: the difference between "splits into 3 named aliases" and "one nested expression" can be 5×–20× in `instantiationCount`.

**See:** the `extends infer` chain at `packages/core/src/utils/core.ts:230-237, 252, 266, 450-462` is essentially this pattern in expression form.

### 2.5 Compute-before-pass

**Use when:** you find yourself writing `Foo<…> extends infer X ? Bar<…> extends infer Y ? Recurse<X, Y> : never : never`.

```ts
// Bad: each `extends infer` adds depth.
type Bad<S, V> =
  S extends "done" ? V
  : Calc<V> extends infer NV ?
    Check<NV> extends infer NS ?
      Bad<NS, NV>
    : never
  : never;

// Good: compute in the recursion's parameter list.
type Good<S, V> = S extends "done" ? V : Good<Check<Calc<V>>, Calc<V>>;
```

**Why:** parameter-position computation happens once, the result feeds the recursion, and the depth budget freed by exiting the inner conditional is available to the next level. Type-alias caching also dedupes the repeated `Calc<V>` calls.

### 2.6 Non-distribution wrapping (`[T] extends [U]`)

**Use when:** the conditional's `checkType` is a generic parameter that could be a union, and you want to test the union as a whole instead of distributing.

```ts
// Distributes: T = string | number tests each branch separately.
type IsString<T> = T extends string ? true : false; // boolean (not what you want)

// Doesn't distribute: tests the union as one type.
type IsString<T> = [T] extends [string] ? true : false; // false
```

**Why:** distribution multiplies work by union arity. For a union of N members and a recursive type that itself iterates, the cost is N × recursion-cost. Wrapping in single-element tuples disables distribution because tuple types aren't naked type parameters.

**See:** `packages/core/src/stages/match.ts:32-52` (`NumericOperand`, `SizeOperand`, `ArrayValueOperand`), `match.ts:83-86` (`RawMatchersForType`), `graphLookup.ts:11`. Also documented in `CLAUDE.md` "Distribution control."

**Caveat:** if you _want_ distribution (per-branch handling), don't wrap. PipeSafe uses both intentionally — `FilterUnion` distributes by design.

### 2.7 Deferred resolution with `extends infer`

**Use when:** an intermediate type is used in multiple branches of a downstream conditional, and you don't want to recompute it.

```ts
type T<X> =
  HeavyOp<X> extends infer R ?
    R extends string ? R | "default"
    : R extends number ? R | 0
    : never
  : never;
```

**Why:** `extends infer R` snapshots the result and shares it across the inner conditional branches. Without it, each branch re-evaluates `HeavyOp<X>`.

**See:** `packages/core/src/utils/core.ts:230-237, 252, 266, 450-462`; `packages/core/src/stages/group.ts:106`; `packages/core/src/stages/unset.ts:18, 33, 69`.

### 2.8 Stop-list (NonExpandable types)

**Use when:** a recursive walk over `keyof T` would otherwise drill into types that should be opaque (Date, BSON, function values).

```ts
// packages/core/src/utils/core.ts:84
export type NonExpandableTypes = Function | { _bsontype: string } | Date;

// Usage at fieldSelector.ts:16 and fieldReference.ts:22, 151
```

**Why:** without the stop-list, the recursion tries to walk into `Date`'s ~30 prototype methods, into function shapes (call signatures, properties), and into MongoDB BSON types. Each is a wide branch that explodes both `instantiationCount` and `instantiationDepth`.

**Caveat:** add new entries here whenever you introduce a new opaque type to the schema vocabulary (e.g. ObjectId, Decimal128, custom branded primitives).

### 2.9 Linked-list over wide tuples

**Use when:** you're tempted to build a tuple type with thousands of elements as state.

```ts
type List<T> = { data: T; prev: List<T> | null };
type Push<L, V> = { data: V; prev: L };
```

**Why:** a tuple of length N puts N members on the type. The checker materialises each. The 5M `instantiationCount` ceiling collapses around N≈3700. A linked-list object has constant width; depth in the type tree is the only growth axis.

**Caveat:** random-access (`L[42]`) is O(N) traversal, which itself recurses. Use for stack/queue access patterns only. Not currently needed in PipeSafe.

### 2.10 Template-literal encoding

**Use when:** you need a list of strings as state and don't need member-style access.

```ts
type Push<S extends string, T extends string> = `${T},${S}`;
```

**Why:** a single template literal is one type instantiation regardless of how many comma-separated tokens it contains. Pattern-matching with `infer` is constant-cost per extraction.

**Caveat:** parsing back out (`infer` chains) loses the cheap-storage advantage if you do it repeatedly. Best for write-mostly data.

### 2.11 `Prettify` is display, not depth

**Use when:** you want the IDE hover to show a flattened object instead of an intersection chain.

```ts
// packages/core/src/utils/core.ts:7-9
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
```

**Why it doesn't fix TS2589:** the underlying type — including all its complexity — is still computed. `Prettify` only changes how the hover text is rendered. It can in fact _increase_ `instantiationCount` because it adds a mapped-type pass over the result. From the Kysely docs (canonical source): _"While that does simplify the type when you hover over it in your IDE, it doesn't actually drop the complex type underneath."_

**When `Prettify` IS useful:**

- After a complex computation, to give callers a clean hover.
- At the top of a public API surface, to hide internal type machinery.
- **Never** as a TS2589 fix.

### 2.12 Escape-hatch assertion

**Use when:** a chain is provably correct at the type level but the chained representation is too expensive to keep around. Cut the chain with an explicit assertion that drops the heavy intermediate type.

```ts
// Hypothetical user code:
const stage1 = pipeline
  .lookup({ /* heavy */ })
  .group({ /* heavy */ });

// Insert a cast to a hand-written shape, severing the heavy generic chain.
const stage1Simple = stage1 as Pipeline<MyShape>;

const final = stage1Simple
  .match({ ... })
  .project({ ... });
```

**Why:** structurally compatible casts replace a complex computed type with a simple one. The downstream pipeline now uses `MyShape` instead of the giant intersection from upstream. Kysely exposes this as `$assertType`; PipeSafe doesn't have an equivalent first-class API yet (potential future feature).

**Caveat:** structural casts can mask real type errors. Only use after verifying the chain is correct, and prefer hand-written `MyShape` over `as any`.

---

## 3. How PipeSafe currently fights this

Active idioms in the codebase, by file:

**`packages/core/src/utils/core.ts`**

- `Prettify` (line 7) — display-flattening, used pervasively.
- `ExpandDottedKeyBatched` (line 52) — loop-unrolled (3-segment) replacement for the naïve recursive `ExpandDottedKey`.
- `NonExpandableTypes` (line 84) — stop-list for `Function`, BSON, `Date`.
- Heavy use of `extends infer` to break up multi-step computations: lines 130, 179, 196, 233, 252, 266, 450, 487, 564, 628, 636, 654, 677.
- `MergeNested` performs an early-exit `HaveSameKeys` check before the expensive bidirectional `extends` to avoid the recursive walk in the common case.
- `RemoveNeverFields` short-circuits on arrays.

**`packages/core/src/elements/`**

- `fieldSelector.ts` and `fieldReference.ts` — use `NonExpandableTypes` as a recursion stop. Both are fundamentally recursive walks over schema shape.
- `fieldReference.ts:145-176` — `InferNestedFieldReference*` family splits array/object recursion into named subtypes for caching.

**`packages/core/src/stages/match.ts`**

- Operand helpers (`NumericOperand`, `SizeOperand`, `ArrayValueOperand`, etc.) at lines 32–52 use `[T] extends [U]` non-distribution.
- `RawMatchersForType` at lines 83–86 preserves union types via tuple-wrapping.
- `FilterUnion` at lines 155–160 _intentionally_ distributes — it's filtering a schema union.

**`packages/core/src/stages/project.ts`**

- `ValidateProjectQuery` is a known hot spot. The comment at lines 109–113 documents that an early-exit was attempted and added ~600 instantiations without helping.

**`packages/core/src/stages/set.ts`**

- `ResolveSetOutput` early-exits if no dotted keys are present, skipping `FlattenDotSet`.

**`packages/core/src/stages/graphLookup.ts:11`**

- `GraphLookupElement` uses `[DepthField] extends [never]` non-distribution.

---

## 4. High-risk recursive types in this repo

These are the types most likely to cause the next TS2589 incident. Each entry: file:line, one-sentence description of why it recurses, and what the bail-out shape looks like.

| Type                                           | File:line                            | Why it recurses                                                                                                                                         | Limit usually tripped              |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `PathsIncludingArrayIndexes`                   | `elements/fieldSelector.ts:7-25`     | Walks tuple element types and object keys, joining with `Join<K, P>`. Exponential paths when arrays-of-objects-of-arrays nest.                          | `instantiationDepth`               |
| `FieldPath`                                    | `elements/fieldReference.ts:19-30`   | Same shape as above for `$`-prefixed references. Indexed across `keyof Schema` — distribution hazard.                                                   | `instantiationDepth` × union arity |
| `InferNestedFieldReference`                    | `elements/fieldReference.ts:145-154` | Recursively resolves `$`-references inside expression objects. Splits to `*Array` / `*Object` helpers but each branch can multiply branches for unions. | `instantiationCount`               |
| `GetFieldType`                                 | `elements/fieldSelector.ts:29-58`    | Type resolution for a single dotted/indexed path. Heavy branching on tuple/array cases.                                                                 | `instantiationDepth`               |
| `MergeNested`                                  | `utils/core.ts:392-423`              | Mutual recursion: descends both `A` and `B` when merging plain objects. Comment notes the early-exit is critical.                                       | `instantiationCount`               |
| `RemoveNeverFields`                            | `utils/core.ts:556-573`              | Walks object structure; called from `MergeSetPlainObjects` which itself recurses — stacked recursion.                                                   | `instantiationDepth`               |
| `ApplySetUpdates` / `*Selective` / `*Standard` | `utils/core.ts:643-702`              | Dispatches based on `HasDottedKeys`, then recurses on nested updates. Hot path for `set()`.                                                             | `instantiationCount`               |
| `RawMatchQuery` / `FilterUnion`                | `stages/match.ts:155-160`            | Filters schema union by query — distributes, then `DocumentMatchesQuery` maps over query keys per branch.                                               | `instantiationCount` × union arity |
| `ValidateProjectQuery`                         | `stages/project.ts:115-128`          | Double-mapped-type check for inclusion mode validation. ~3,600 instantiations baseline (per the inline comment).                                        | `instantiationCount`               |
| `ResolveMatchOutput`                           | `stages/match.ts:177-181`            | Wraps `FilterUnion` in `Prettify`; per-stage cost scales with schema union size.                                                                        | `instantiationCount`               |
| `ResolveSetOutput`                             | `stages/set.ts:51-65`                | Branches between `FlattenDotSet` and `ApplySetUpdates`; both expensive.                                                                                 | `instantiationCount`               |

---

## 5. Known TS2589 sites

`packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts:34-38` — the `set` test for an invalid `$naem` field reference triggers TS2589 (intentional in the sense that "fails to compile" is the assertion). The comment explicitly notes this is a depth-limit hit, not a `@ts-expect-error` mismatch.

The benchmarking harness (`packages/core/benchmarking/benchmark.ts`) parses `tsc` output for `ts(2589)` and `"possibly infinite"` and surfaces a `hasDepthError` flag (lines ~177, 200, 201). That's the existing safety net at the suite level. The new `bun run depth-blame` CLI is the per-expression counterpart for interactive debugging.

---

## 6. Diagnosis tools

- **`bun run depth-blame <varName> [file]`** — generates a TS trace for a single expression, runs `@typescript/analyze-trace` on it, and ranks hotspots scoped to PipeSafe-owned types. Survives an active TS2589 (the trace is written before the bail-out). See `fix-guide.md` for the full workflow.
- **`tsc -p path/to/tsconfig.json --generateTrace traceDir`** — raw TS-compiler tracing. Produces `trace.json` and `types.json` in `traceDir`. The depth-blame tool wraps this; you can also `npx analyze-trace traceDir` directly or load `trace.json` in Perfetto / `chrome://tracing`.
- **`tsc -p path/to/tsconfig.json --extendedDiagnostics`** — totals only: `Instantiations`, check time, memory. Use to see whether your refactor moved the needle.
- **`.claude/depth-viewer/index.html`** — local flame-graph viewer over a trace JSON file. Highlights PipeSafe-owned frames so it's obvious which of _our_ types is responsible.
- **`.claude/inspect-types.ts`** — works _before_ TS2589 fires. Useless after, because the checker has substituted `errorType`. Keep it for the day-to-day "what's the resolved type" question.

---

## 7. References

External:

- [Microsoft TypeScript Performance wiki](https://github.com/microsoft/TypeScript/wiki/Performance) — official docs on `--generateTrace`, `--extendedDiagnostics`, and the broader perf toolkit.
- [Microsoft TypeScript Performance-Tracing wiki](https://github.com/microsoft/TypeScript/wiki/Performance-Tracing) — analyse-trace usage.
- [`@typescript/analyze-trace`](https://github.com/microsoft/typescript-analyze-trace) — npm package that parses `trace.json` and reports hotspots.
- ["TypeScript Magic"](https://herringtondarkholme.github.io/2023/04/30/typescript-magic/) — the canonical deep dive on the three counters and the counter-reset hack.
- ["How to workaround the max recursion depth in TypeScript"](https://www.esveo.com/en/blog/how-to-workaround-the-max-recursion-depth-in-typescript/) — accumulator and unrolling techniques with concrete examples.
- [Kysely "excessively deep types" recipe](https://kysely.dev/docs/recipes/excessively-deep-types) — the `$assertType` escape hatch and the "Prettify isn't a fix" warning.

Internal:

- [`avoids.md`](./avoids.md) — quick-reference list of patterns to avoid and prefer.
- [`fix-guide.md`](./fix-guide.md) — step-by-step runbook for an active TS2589.
- [`lint-rules/`](./lint-rules) — rationale for each in-repo ESLint rule.
- `CLAUDE.md` (repo root) — "Compile-Time Errors" and "Distribution control" sections complement this doc.
