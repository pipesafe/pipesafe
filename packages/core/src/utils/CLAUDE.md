# utils/ — shared type primitives

Six small TYPE modules with strict boundaries — do not grow a grab-bag here.
(The directory also holds the test plumbing: `tests.ts` +
`tests.typeAssertions.ts` — the Assert/Equal helpers — and
`useMemoryMongo.ts`, the runtime mongodb-memory-server vitest fixture.
They are deliberately NOT part of the six-module rule; don't add further
runtime code here.)

- **errors.ts** — `PipeSafeError` (the brand), `PassThrough` (the first
  early exit every resolver wraps in), `RequiresMsg` (brand-message
  skeleton). All compile-time error surfacing flows through these.
- **dispatch.ts** — operator-key classification (`OperatorKeyOf`,
  `HasOperatorKey`, `HasSingleOperatorKey`, `NotAnExpression`). Values are
  classified by `$`-key BEFORE any schema-parameterized work.
- **strings.ts** — dollar prefixing, path joining, character unions.
- **objects.ts** — `Document`, `Prettify`, union combinators, `MergeNested`,
  `OmitNeverValues` (THE Validate key-filter), `ForbidKeys` (the pattern-
  index vacuity guard). Readonly tolerance for operand re-checks lives in
  the REGISTRY (readonly operand positions in ExpressionSpec) — a
  Deep-Readonly/Mutable wrapper here was measured at +280k instantiations
  and rejected.
- **paths.ts** — dotted-path machinery. `SplitPath` is deliberately
  tail-recursive (accumulator parameter → ~1000-depth budget instead of
  ~50); parse paths with it, then fold the segments.
- **updates.ts** — `ApplySetUpdates` + helpers: the update/merge kernel
  (write values, preserving optionality semantics). Shared by `$set` and
  `$lookup`'s dotted `as` — stages must not import each other, so it lives
  here. Callers MUST dot-EXPAND first (`FlattenDotSet`, with an early-exit
  for non-dotted keys): the kernel has exactly one merge path and no
  dotted-key handling of its own.

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
