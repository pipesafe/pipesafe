# TypeScript Instantiation Depth — Quick Reference

One-page list of what to avoid, what to prefer, and what doesn't actually fix TS2589. Reach for [`limits.md`](./limits.md) for mechanism; [`fix-guide.md`](./fix-guide.md) when one is already firing.

> **TS2589 has three causes, not one.** The diagnostic is the same for `instantiationDepth` (cap 100), `instantiationCount` (cap 5,000,000), and `tailCount` (cap 1000). They need different fixes. Always run `bun run depth-blame` to see which one tripped before guessing.

---

## Don't write

- **Naked-`T extends U` conditionals over generics that could be unions.** Distribution multiplies the cost by the union arity. Use `[T] extends [U]` unless you _want_ per-branch handling. Already a documented PipeSafe convention.
- **Head-recursive type aliases.** `T extends [infer H, ...infer R] ? [H, ...Foo<R>] : []` stacks `instantiationDepth` linearly with input size. Rewrite with an accumulator so the recursive call is in tail position.
- **Long `extends infer` chains inside a recursive type.** Each `infer` step adds depth. Pull the computation into the recursive call's parameter list instead.
- **Inline mapped types over `keyof Schema` inside another recursive walk.** No alias = no cache. Lift the mapped type to a named alias so it's reused across instantiations.
- **Tuple types with N > ~3700 members as state.** Hits the 5M `instantiationCount` ceiling. Use a linked-list object (`{ data; prev }`) or a template-literal string instead.
- **`Mutable<T>` type alias inside `PipeSafeError<...>`.** TypeScript preserves alias names in error displays — the user sees `Mutable<...>` instead of the resolved shape. Use the inline `{ -readonly [K in keyof T]: T[K] }` mapped type. (Also covered in CLAUDE.md "Stripping `readonly`.")
- **`@ts-ignore` to silence a TS2589.** The underlying type becomes `any`, the IDE still chokes, and the cost moves to your users. Always fix the cause.

## Prefer

- **`[T] extends [U]`** for union-stable conditionals. Seen throughout `stages/match.ts` and `stages/graphLookup.ts`.
- **Accumulator-style tail recursion.** Recursive call is the last thing the false branch returns, no wrapper. See `SplitPath<S, Acc>` (`utils/paths.ts`) — parse tail-recursively into segments, then fold (`ExpandDottedKey`); CLAUDE.md "Hoisting patterns" pins this as the house style.
- **Named intermediate aliases** for any computation reused twice. The type-alias cache is the cheapest win available.
- **`extends infer` to share a result across multiple inner branches** (not to chain steps). Examples throughout `utils/objects.ts`, `utils/paths.ts`, and `utils/updates.ts`.
- **`NonExpandableTypes`** (`utils/objects.ts`) as a stop-list whenever a recursive walk could otherwise drill into Date / BSON / Function. Add new opaque types here as the schema vocabulary grows.

## Symptoms you're about to hit it

- IDE hover over a chained call goes blank or spins for >5 seconds.
- A new `set()` or `project()` argument silently resolves to `any` in autocomplete.
- `bun run build` time jumps by >1s after adding a single new operator.
- Adding one more `.lookup()` to an already-long chain produces TS2589 at the next step.
- A test in `*.typeAssertions.ts` starts failing because an `Expect<...>` resolved to `any` instead of the expected shape.

When you see these, run `bun run depth-blame <expr>` proactively — even before TS2589 fires. The trace will show which type is consuming the budget so you can fix it _before_ the next operator pushes you over the cliff.

## Don't reach for

- **`Prettify`/`Simplify` as a TS2589 fix.** It only changes hover display; the underlying type still fully evaluates and `Prettify` itself adds a mapped-type pass over the result. (Kysely docs are explicit on this.) Use it for cosmetics, not for budgets.
- **`@ts-expect-error` to mask TS2589.** Same problem as `@ts-ignore` — the type becomes `any` and downstream stages get garbage input.
- **Disabling `strict` or `noUncheckedIndexedAccess`.** Doesn't move the depth limits; just makes other errors louder later.
- **Bumping the depth limit via `tsconfig`.** The three counters are hardcoded in the TypeScript checker. They cannot be configured.
- **Counter-reset (`& {}` injection) as a default tool.** Real but exotic. It slows the compiler significantly. Don't reach for it before tail-recursion + unrolling + cached aliases.

## When something hits the limit

1. **Capture a minimal repro.** A single expression in a single file is enough; the smaller, the faster the trace.
2. **Run `bun run depth-blame <varName> [file]`.** Reads which counter tripped (depth / count / tail) and ranks PipeSafe-owned offenders.
3. **Read the top three.** They almost always include one of: `FilterUnion`, `FlattenDotSet`, `ApplySetUpdates*`, `InferNestedFieldReference*`, `ValidateProjectQuery`. Match the offender to the technique:
   - distributing over a union → §2.6 in `limits.md` (non-distribution wrapping).
   - deep recursive walk → §2.1, then §2.2 if needed.
   - many similar instantiations → §2.4 (cache via named alias).
   - chain of `extends infer` → §2.5 (compute-before-pass).
4. **Verify the fix.** Re-run `bun run depth-blame`; the offender's count should drop materially. Run `bun run build` to confirm TS2589 is gone and the type-assertion suite still passes.

Full runbook: [`fix-guide.md`](./fix-guide.md).
