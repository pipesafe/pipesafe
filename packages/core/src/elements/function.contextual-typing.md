# `$function` contextual param typing — design notes & the nested-typing prototype

This document records how unannotated `$function` body params get their types
(`FunctionSlots` in [`function.ts`](./function.ts)), and the full results of
the exploration into extending that to **nested** `$function`s — which works,
but was deliberately not shipped for compile-time reasons. It exists so the
next attempt doesn't have to re-derive any of this.

**TL;DR**

- `body: (a) => a * 2, args: ["$age"]` gets `a: number` with no annotation at
  **top-level keys** of `set` / `project` / `replaceRoot`.
- Nested `$function`s (inside `$add` / `$cond` / accumulators) and `match`
  `$expr` bodies need annotated params. Unannotated ones fail loudly as
  TS7006 — never silently `any`.
- Nested contextual typing was fully prototyped (three working designs, depth
  5, all container shapes). Measured cost: **~4× total typecheck** on this
  repo's suite (44s → ~3min), concentrated as **~2–5s per `$function` call
  site**. One annotation fixes a TS7006 in five keystrokes; the trade loses.

---

## 1. The core discovery

TypeScript does **not** resolve conditional types over a generic call's own
in-flight type parameter when computing contextual types for
context-sensitive expressions. Given

```ts
declare function f<const S>(s: { args: S["args"]; body: Conditional<S> }): S;
```

the `Conditional<S>` never resolves while `body`'s contextual type is being
computed, so unannotated params stay untyped. This is why
`DeepValidateFunctions` (a rewrite of the literal's own type) can _validate_
annotated bodies at any depth but can never _supply_ param types.

However — conditionals over a **separate, independently inferred type
parameter** DO resolve in contextual position:

```ts
declare function f<
  const S extends Query,            // the literal
  A extends Record<string, unknown> = {},  // capture variable
>(s: S & DeepValidateFunctions<D, S> & FunctionSlots<D, A>): ...;
```

By the time TS computes the body's contextual type, `A` is fixed (its
candidates came from checking the `args` sibling), and arbitrary conditional
logic over `A` resolves. That is the entire trick behind `FunctionSlots`.

### Load-bearing details (each verified by breaking it)

1. **A conditional's check position is itself an inference site.** The
   shield must be `[unknown] extends [NoInfer<A[K]>]` — without `NoInfer`,
   every plain value leaks into `A` and instantiates a slot it can't satisfy.
2. **The loose `body` slot in `FunctionExpression` must be the
   signature-less `Function` interface.** Any call signature there (the old
   `(...args: any[]) => unknown`) joins the contextual-type intersection;
   two differing signatures make `getContextualSignature` bail and params
   silently become `any`. Side effect of fixing this: positions with _no_
   slot now produce TS7006 instead of silent `any` — strictly better.
3. **Union-constrained stages can't take the extra variable.** Adding `A` to
   `match` (whose `MatchQuery` constraint is a union) makes `M` collapse to
   its constraint and pinned rejections (`$gte` on a string field) silently
   stop firing. `match` keeps validation only.
4. **Candidates must come from positions that complete BEFORE the body is
   checked** — i.e. the `args` sibling. Capturing an _ancestor_ of the body
   (naked `A[K]` over the whole value) is a chicken-and-egg dead end: the
   ancestor's type can't complete until the body is checked, so `A` has no
   candidate when the body's context is computed.

---

## 2. What ships: top-level slots

```ts
export type FunctionSlots<Schema, A extends Record<string, unknown>> = {
  [K in keyof A]: [unknown] extends [NoInfer<A[K]>] ? unknown
  : FunctionSlot<Schema, A[K]>;
};
```

`A` reverse-infers a per-key map of `$function` args — the slot's
`args: A[K]` is the **sole** inference site. Keys without a candidate stay
`unknown` and resolve to a pass-through, so plain values are unaffected.
Intersected as a third member on `set` / `project` / `replaceRoot`
(the `Pipeline` methods with object, non-union constraints).

### 2.1 The `ContainsFunction` early exit — slow only when used

`DeepValidateFunctions` is intersected at FIVE stage signatures, so every
call used to pay a deep structural relation of its whole literal against a
fresh rewritten copy — pure overhead for the overwhelmingly common
`$function`-free literal (measured ~10–20× slow-down on call-heavy files:
`Pipeline.typeAssertions` 0.2s → 4.4s). The validator is therefore gated:

```ts
type DeepValidateFunctions<S, V> =
  [ContainsFunction<V>] extends [true] ? DeepValidateFunctionsRewrite<S, V>
  : unknown;
```

`ContainsFunction` is a boolean probe — it walks the literal once but
creates no comparable structures, and resolving to `unknown` collapses the
intersection member (`X & unknown` simplifies away), so TypeScript skips
the relation entirely. Two details:

- arrays are probed via the **element union** (`V[number]`, distributed) —
  indexing a mapped tuple by `keyof V` would drag the mapped array
  prototype (`toString`, `slice`, ...) into instantiation per tuple;
- the gate also speeds up `$function`-BEARING files dramatically (the
  feature's own test file: 25s → 0.6s) because the rewrite-relation now
  runs only on the subtrees that actually contain a `$function`.

Benchmarked against the pre-PR base (both sides with built `dist/`,
`tsc --extendedDiagnostics` / `--generateTrace`):

| Metric                                     | Pre-PR base | With feature + gate |
| ------------------------------------------ | ----------- | ------------------- |
| Benchmark-config check (src+examples)      | 4.0s        | 5.5s                |
| Pre-existing `$function`-free files        | —           | +0.03s each (noise) |
| Chained `.project()` ops, ∆ instantiations | +0          | +0                  |
| Per `$function` call site                  | —           | ~20ms               |

Measurement pitfall for posterity: `examples/*.ts` import `@pipesafe/core`,
which resolves to the BUILT `dist/*.d.mts` — src-level changes don't affect
them until `bun run build`, and an unbuilt checkout type-checks them
against nothing (imports fail, everything is `any`, files check
"instantly"). Always rebuild both sides before comparing.

---

## 3. The nested prototype (works; not shipped)

### 3.1 Failure catalog — single-variable dispatch is impossible

Everything that tries to capture nested args with ONE variable per key
poisons inference, because `inferToConditionalType` enters **both** branches
of a conditional and conflicting candidates win or cancel:

| Attempt                                                                                | Failure mode                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Recursive reverse-mapped deep copy (`Cap<N> = {[K in keyof N]: Cap<N[K]>}`)            | no candidates at all                        |
| Naked `A` in the intersection (`Q & A & Slots`)                                        | no candidates (two naked vars)              |
| Shape dispatch (`N extends {$function} ? Slot<N> : {mapped}`)                          | both branches capture → garbage             |
| Key-name dispatch (`K extends "$function" ? ... : recurse`)                            | candidates from every key pollute           |
| Catch-all union members (`Slot<V> \| {}`, `\| unknown`, `\| Leaf` at container levels) | absorb/weaken deep candidate collection     |
| Index-signature hops (`Record<string, X>`)                                             | deliver no candidates                       |
| Conditional check without `NoInfer` (`[unknown] extends [A[K]]`)                       | check position leaks source values into `A` |

### 3.2 What works: one independent variable per depth/shape

Since separate type variables can't conflict, give each nesting depth (or
container shape) its own capture variable with a **pure chain** template —
no unions at container levels, leaf only at the chain's exact end:

```ts
// R = record-key hop (mapped type), A = array-element hop (ReadonlyArray)
type NotFn =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | readonly unknown[]
  | object; // `object`, NOT `{$function?: never}` — see 3.3

type NonRecord =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | Date
  | RegExp
  | ((...a: never[]) => unknown)
  | readonly unknown[];

type ShR<V, T> = // record hop: proceed only on record captures
  [unknown] extends [NoInfer<V>] ? unknown
  : [NoInfer<V>] extends [NonRecord] ? unknown
  : T;
type ShA<V, T> = // array hop: proceed only on tuple captures
  [unknown] extends [NoInfer<V>] ? unknown
  : [NoInfer<V>] extends [readonly unknown[]] ? T
  : unknown;
type Leaf<S, V> = // slot only for genuine args captures (tuples)
  [unknown] extends [NoInfer<V>] ? unknown
  : [NoInfer<V>] extends [readonly unknown[]] ? FunctionSlot<S, V> | NotFn
  : unknown;

type ChainR<S, A> = { [K in keyof A]: Leaf<S, A[K]> };
type ChainRR<S, A> = {
  [K in keyof A]: ShR<A[K], { [L in keyof A[K]]: Leaf<S, A[K][L]> }>;
};
type ChainRRA<S, A> = {
  [K in keyof A]: ShR<
    A[K],
    { [L in keyof A[K]]: ShA<A[K][L], readonly Leaf<S, A[K][L]>[]> }
  >;
};
type ChainRRR<S, A> = {
  [K in keyof A]: ShR<
    A[K],
    {
      [L in keyof A[K]]: ShR<
        A[K][L],
        { [M in keyof A[K][L]]: Leaf<S, A[K][L][M]> }
      >;
    }
  >;
};

// signature: set<const S, A1 = {}, A2 = {}, A3 = {}, A4 = {}>(
//   $set: S & DeepValidateFunctions<D, S>
//     & ChainR<D, A1> & ChainRR<D, A2> & ChainRRA<D, A3> & ChainRRR<D, A4>)
```

Verified working (pinned in the prototype):

- `{ k: { $add: [1, fn] } }` — unannotated `a: number` (the common case)
- `{ k: { $cond: { then: fn } } }` — record containers
- functions at multiple depths in one query; junk siblings (`{$gt: [...]}`,
  plain nested arrays, scalars) all pass without false rejections
- nested wrong annotations still rejected (and by `DeepValidateFunctions`
  regardless)
- a per-depth variant (5 levels of mapped hops) also works, including a
  straight 5-deep chain and `$cond` → `$concat` tuples

Wrong-shape sources simply produce no candidates → variable stays `unknown`
→ shield resolves to a pass-through. That property is what makes per-shape
variables safe to intersect freely.

### 3.3 Supporting fixes the prototype needed

- **Junk siblings inside a captured array** fail uniform element checks
  against `{$function?: never}` — it's a _weak type_ (all-optional) that
  rejects records sharing no properties with it. Use `object` as the
  acceptor instead. (An index-signature acceptor
  `{[k: string]: unknown; $function?: never}` fixes the check but kills
  inference — absorber.)
- **Readonly captures**: args captured through deeper variables arrive as
  readonly structures; expression operand types use mutable arrays
  (`$add: Operand[]`), so `readonly ["$age", 1]` fails
  `extends Expression<Schema>` and the arg leaks through unresolved. Fixed
  (and shipped) via `DeepMutable` normalization in `ResolveFunctionArg`.

## 4. Why it's not shipped: measured cost

Clean-cache `tsc --noEmit` on this package's suite:

| Design                         | Suite time |
| ------------------------------ | ---------- |
| Top-level slots only (shipped) | **41–44s** |
| Per-depth × 5 (mapped hops)    | 2m54s      |
| Shape chains R+RR+RRA+RRR      | 3m37s      |
| R+RRA only                     | 2m57s      |

`--generateTrace` showed ~3.8M type instantiations, dominated by 80k+ copies
each of `slice` / `toString` / `concat` / `indexOf`:

- every capture is a **fresh reverse-mapped type**, so relation checks
  against schema-sized unions miss TypeScript's cache every time;
- mapped-type hops (`{[L in keyof A[K]]: ...}` — non-homomorphic, keyof of
  an indexed access) **reverse-map tuples**, materializing every
  `Array.prototype` member per array per call.

The cost is fully concentrated at `$function` call sites (~2–5s each, paid
in editors and CI forever); files without `$function` are unaffected. Cheaper
arg resolution (skipping the `FieldReference` / `Expression` mega-unions —
shipped anyway as a cleanup) did not move the needle; neither did trimming
chains. The bottleneck is reverse-mapped candidate construction itself,
which is not reachable from userland.

Against that: a nested unannotated param is a _loud_ TS7006 at the exact
parameter, and one annotation — fully validated by `DeepValidateFunctions` —
fixes it.

## 5. Revisit criteria

Worth re-attempting if any of these change:

- TypeScript optimizes reverse-mapped type inference (tuple special-casing
  in `createReverseMappedType`, or relation-cache keying that survives fresh
  instantiations);
- a future TS feature allows inference-time dispatch by container kind
  (today both conditional branches receive candidates unconditionally);
- profiling shows the constant per-call cost dropped for unrelated reasons.

The prototype chains in §3.2 are complete — re-shipping is: paste the
chains into `function.ts`, add `A1..A4` to the three stage signatures,
flip the TS7006 pins in `function.typeAssertions.ts` to positive
assertions, and re-measure with `tsc --generateTrace` before believing it.
