# stages/ — one module per aggregation stage

## The trio convention

Every stage module exports, with **Schema always the first type parameter**:

- `XxxQuery<Schema>` — what the user may write. Scalar stages export a
  schema-free alias (`LimitQuery = number`, `SkipQuery = number`,
  `CountQuery = string`) — the Pipeline method references the module's
  type, never an inline scalar (wiring pinned in
  `stages.contract.typeAssertions.ts`).
- `ValidateXxxQuery<Schema, Q, ...>` — the rejection surface (`set`,
  `project`, `group` — all via the `Q & ValidateXxxQuery<Schema, Q>`
  intersection at the parameter position). Validate members re-use the
  Query/operand-kernel building blocks and the shared nested walk in
  `elements/validation.ts`, never re-spelling a constraint.
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
  expression registry: one entry + one resolver arm if operand-dependent —
  plus add the name to the `ACCUMULATOR_OPERATORS` const array — the
  AUTHORITATIVE list, whose `satisfies readonly (keyof AccumulatorSpec)[]`
  surfaces a missing registry entry at the array declaration (a registry
  key absent from the array is caught by the completions suite) — and
  DELETE the key from
  `UnimplementedAccumulators` (the by-name allow-list; never widen it to
  `` `$${string}` ``).

## When adding a stage

Touch: the new trio module here, the `Pipeline` method, a
`<stage>.typeAssertions.ts`, ONE per-stage block in
`stages.contract.typeAssertions.ts` (the file is grouped by stage; a
block holds the stage's PassThrough, method-wiring, and Query-alias
pins together), and — if the stage adds any cursor position a user
completes at — its exact ideals in `packages/core-completions-tests`.
Follow the completion-safety invariants (root CLAUDE.md): all-finite
string arms (`FieldReference`/`SystemVariable`, no `` `$${string}` ``
catch-alls), `FieldSelectorKeys<Schema, unknown>` hint on
index-signature queries, no bare non-plain object types in value
unions. Nothing compile-enforces the contract entries — don't skip
them.

## Verifying

`bun run typecheck:packages` (from the root; the root `bun run typecheck`
does NOT check package sources), `bun run test:ci` (includes the
exact-ideal completions suite), and `bun run budget:check`. The regression
guards that must never be weakened:
`stages.contract.typeAssertions.ts`,
`../pipeline/Pipeline.callSite.typeAssertions.ts`, and the completion
ideals in `packages/core-completions-tests`.
