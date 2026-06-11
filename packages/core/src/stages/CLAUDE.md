# stages/ — one module per aggregation stage

## The trio convention

Every stage module exports, with **Schema always the first type parameter**:

- `XxxQuery<Schema>` — what the user may write (skip for scalar stages like
  `limit`).
- `ValidateXxxQuery<Schema, Q, ...>` — only when the stage needs a mapped
  validation wrapper at the parameter position (currently `project`).
- `ResolveXxxOutput<Schema, Q>` — the output schema. MUST wrap its body in
  `PassThrough<Schema, ...>` so upstream `PipeSafeError`s forward verbatim
  (terminal stages `out`/`merge` have no resolver and are exempt).

Standard generic names: `Schema`, `Q` (literal query), `Foreign` (joined
schemas). Trailing defaulted cache parameters are fine; keep them on inner
aliases behind `PassThrough` (defaults evaluate eagerly).

## Rules that aren't obvious from the code

- Do NOT re-prove `Q extends XxxQuery<Schema>` inside a resolver — the
  Pipeline method's constraint already validated it, and the re-check
  instantiates the full query type per call. Use cheap structural narrowing
  (`Q extends { newRoot: infer N }`, `keyof Q & LogicalMatchOperators`,
  `$`-string checks) where the body needs it.
- Brands go at VALUE positions (the offending key's value), not around the
  whole parameter — that keeps TS reporting TS2322 at the bad value instead
  of TS2353 on some valid key.
- Brand messages are built with `RequiresMsg` (utils/errors.ts); keep the
  "Operator/Accumulator/Stage '<x>' requires <constraint>." skeleton.
- Accumulators register in `AccumulatorSpec` (group.ts), mirroring the
  expression registry: one entry + one resolver arm if operand-dependent.

## When adding a stage

Touch: the new trio module here, the `Pipeline` method, a
`<stage>.typeAssertions.ts`, and entries in
`stages.contract.typeAssertions.ts` (PassThrough + method-wiring pins).
Nothing compile-enforces the contract entries — don't skip them.

## Verifying

`cd packages/core && bunx tsc --noEmit` (the root typecheck does NOT check
package sources). The regression guards that must never be weakened:
`stages.contract.typeAssertions.ts` and
`../pipeline/Pipeline.callSite.typeAssertions.ts`.
