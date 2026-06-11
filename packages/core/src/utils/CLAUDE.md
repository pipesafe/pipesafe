# utils/ — shared type primitives

Five small modules with strict boundaries — do not grow a grab-bag here:

- **errors.ts** — `PipeSafeError` (the brand), `PassThrough` (the first
  early exit every resolver wraps in), `RequiresMsg` (brand-message
  skeleton). All compile-time error surfacing flows through these.
- **dispatch.ts** — operator-key classification (`OperatorKeyOf`,
  `HasOperatorKey`, `HasSingleOperatorKey`, `NotAnExpression`). Values are
  classified by `$`-key BEFORE any schema-parameterized work.
- **strings.ts** — dollar prefixing, path joining, character unions.
- **objects.ts** — `Document`, `Prettify`, union combinators, `MergeNested`.
- **paths.ts** — dotted-path machinery. `SplitPath` is deliberately
  tail-recursive (accumulator parameter → ~1000-depth budget instead of
  ~50); parse paths with it, then fold the segments.

## Gotchas

- `IsDottedKey` is THE dotted-key predicate — don't re-spell
  `` `${string}.${string}` `` as a boolean check elsewhere.
- `MergeNested` is order-dependent for optional fields; the dotted-key
  expansion merges via `UnionToIntersection` (commutative) for that reason.
- Non-distributive checks use `[A] extends [B]`; intentional distribution
  over union schemas uses `Schema extends unknown ?` with a comment.
- `HasSingleOperatorKey` routes through the `UnionToIntersection` alias on
  purpose: distribution only happens over naked type parameters, so the
  inlined trick silently fails.
