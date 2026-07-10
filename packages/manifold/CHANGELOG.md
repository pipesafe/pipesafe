# @pipesafe/manifold

## 2.0.0

### Major Changes

- f488fa7: Type-system standardisation. Every stage now follows one convention —
  `XxxQuery` (acceptance) / `ValidateXxxQuery` (rejection, where needed) /
  `ResolveXxxOutput` (output schema), Schema-first, with `PassThrough` error
  forwarding on every non-terminal resolver — backed by an operator-key
  dispatch kernel, a single expression/accumulator registry
  (`ExpressionSpec` / `AccumulatorSpec`), and a shared operand kernel.

  New validation at chained call sites: unknown field references, malformed
  expression objects, invalid operands of registered operators, and
  operator/accumulator names outside the registry + explicit allow-lists
  (`UnimplementedExpressionOps`, `UnimplementedAccumulators`) all brand with
  a `PipeSafeError` at the offending value — including `$set`/`$project`
  values at any literal depth, `$group` `_id` and accumulator operands
  (`$sum`/`$avg` numeric; `$min`/`$max` BSON-comparable), and typo'd
  operator names. Valid-but-unmodeled MongoDB stays accepted (allow-listed
  by name, `unknown` inference), as do `$$`-system variables and widened
  values; expression values inside generic-schema pipeline helpers now
  compile.

  Fixes: `$count` forwards upstream error schemas; `{_id: 1, name: 0}`
  projections no longer falsely brand as mixed-mode; `$cond` no longer
  strips `null`/`undefined` from branches; the `$unwind` brand fires at
  chained call sites; `$`-keyed objects no longer pass as object literals;
  `$set` rejections no longer emit a spurious TS2589; `as const` operands
  type-check (readonly operand positions); dotted `$lookup` `as` paths nest
  in the output schema. `$$`-system variables now infer as `unknown` instead
  of silently dropping the field from the output schema (`$$REMOVE` still
  removes), and are accepted in `$group` `_id`/accumulator positions
  (`$max: "$$NOW"` compiles); `$concat` validates its operands (typo'd
  `$`-refs and non-string refs brand instead of shipping); the
  trigonometry operators and `$toUUID` are allow-listed (no longer falsely
  brand as typos); unknown dotted `$project` inclusion keys brand instead of
  silently resolving to a `never` leaf.

  Breaking: `@pipesafe/manifold` now requires `@pipesafe/core` 2.x
  (peer dependency `>=2.0.0 <3.0.0`); `ResolveCountOutput` gained a `Schema`
  first type parameter; `MergeOptions` is REMOVED — use `MergeQuery`
  (deprecated aliases are no longer shipped; renames land in majors);
  several internal type names changed. Whole-project type instantiations
  drop ~40% for equivalent pipelines; a CI budget gate
  (`bun run budget:check`) now guards type-level performance.

## 1.0.0

### Minor Changes

- 41114be: Add typed `$merge` terminal stage to `Pipeline` (mirrors `.out()` semantics) and unify `Model.Mode.Upsert`/`Append` output construction in manifold to delegate to the new builder. `MergeOptions` now lives in `@pipesafe/core`; manifold re-exports it for back-compat.

### Patch Changes

- Updated dependencies [41114be]
- Updated dependencies [7cf13c1]
- Updated dependencies [48539ad]
- Updated dependencies [c530d6d]
  - @pipesafe/core@1.0.0

## 0.8.0

### Minor Changes

- 079eeec: Tag user-supplied `MongoClient` instances with PipeSafe driver metadata at every entry point (`Collection`, `Database`, `Pipeline`, `Project`), not just the `pipesafe.connect()` singleton. Tagging is idempotent so wrapping the same client in multiple PipeSafe constructs will not duplicate entries in the server-side handshake log.

## 0.7.0

### Minor Changes

- 1647d74: Switch build tooling from raw tsc to tsdown (powered by Rolldown) with unbundle mode. Produces dual ESM/CJS output preserving source file structure for better tree-shaking. Dependencies auto-externalized from package.json.

### Patch Changes

- 4fd4b30: Add default export condition to package.json exports for broader bundler compatibility
- 1647d74: Move mongodb from dependencies to peerDependencies to prevent duplicate MongoClient types when consumers link PipeSafe locally or use a different mongodb resolution path

## 0.6.0

### Minor Changes

- 6cec201: Rename tmql monorepo to PipeSafe

  Breaking changes:
  - Package renamed from `tmql` to `@pipesafe/core`
  - Package renamed from `tmql-orchestration` to `@pipesafe/manifold`
  - All class prefixes removed: `TMPipeline` → `Pipeline`, `TMCollection` → `Collection`, etc.
  - Singleton renamed from `tmql` to `pipesafe`

## 0.5.1

### Patch Changes

- 36a681f: Sync package versions after initial tmql-orchestration publish
