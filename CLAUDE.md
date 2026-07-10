# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a **bun workspaces monorepo** with two packages under different licenses:

```
pipesafe/
├── packages/
│   ├── core/                    # Core library (Apache 2.0 - OSI-approved)
│   │   ├── src/
│   │   │   ├── pipeline/        # Pipeline - aggregation builder
│   │   │   ├── stages/          # Pipeline stage implementations (one trio per stage)
│   │   │   ├── elements/        # Type system building blocks (+ operand kernel)
│   │   │   ├── collection/      # Collection wrapper
│   │   │   ├── source/          # Source interface
│   │   │   ├── utils/           # errors/strings/objects/paths/dispatch/updates type utilities (+ test fixtures)
│   │   │   ├── singleton/       # Global pipesafe instance
│   │   │   └── database/        # Database utilities
│   │   ├── examples/            # Pipeline usage examples
│   │   ├── benchmarking/        # TypeScript performance benchmarks
│   │   └── LICENSE              # Apache License 2.0
│   │
│   └── manifold/                # DAG orchestration (ELv2 - commercial)
│       ├── src/
│       │   ├── model/           # Model - materializable pipelines
│       │   └── project/         # Project - DAG orchestrator
│       ├── examples/            # DAG usage examples
│       └── LICENSE              # Elastic License 2.0
│
└── package.json                 # Root workspace config (private)
```

### Licensing Rationale

- **@pipesafe/core (Apache 2.0)**: Core pipeline builder. Fully OSI-approved, can be used anywhere.
- **@pipesafe/manifold (ELv2)**: DAG execution and materialization features. Commercial-friendly but not OSI-approved.

### Package Dependencies

- `@pipesafe/manifold` has `@pipesafe/core` as a **peer dependency** pinned to core's
  current major (`>=2.0.0 <3.0.0`); widen it whenever core takes a major bump
- During development, `workspace:*` links them locally
- Users install both packages explicitly

## Development Commands

- **Build**: `bun run build` - Builds both packages via TypeScript project references
- **Build Watch**: `bun run build:watch` - Watch mode for both packages
- **Clean**: `bun run clean` - Remove dist directories
- **Lint**: `bun run lint` - Run ESLint
- **Format**: `bun run format` - Run Prettier
- **Tests**: `bun run test:ci` - Run all tests

Pre-commit hooks via lefthook automatically run format, lint, build, and tests before each commit. Hooks are installed automatically via the `prepare` script when running `bun install`.

## Changesets

This project uses [changesets](https://github.com/changesets/changesets) for versioning. When adding features or fixes that affect the public API:

1. Create a changeset file in `.changeset/` with format:

   ```markdown
   ---
   "@pipesafe/core": minor # or patch/major
   ---

   Brief description of the change
   ```

2. Use semantic versioning:
   - **patch**: Bug fixes, internal refactoring
   - **minor**: New features, new operators, backward-compatible changes
   - **major**: Breaking changes

3. The changeset will be included in the PR and automatically consumed during release.

Note: The interactive `bun run changeset` command doesn't work in non-TTY environments. Create the file manually following the format above.

## Architecture Overview

**PipeSafe** is a TypeScript MongoDB aggregation pipeline builder that provides full type safety.

### Core Classes

- **Pipeline**: The main aggregation pipeline builder class located in `packages/core/src/pipeline/Pipeline.ts` with three generic types:
  - `StartingDocs`: The original document schema (union types supported)
  - `PreviousStageDocs`: The current document schema after previous pipeline stages (defaults to StartingDocs)
  - `Mode`: Lookup mode - `"runtime"` (default) or `"model"` for DAG pipelines

  Each pipeline method returns a new `Pipeline` instance with updated types to maintain type safety throughout the chain.

- **Model**: Located in `packages/manifold/src/model/Model.ts`. A named, materializable pipeline with typed input/output. Models can depend on collections or other models, forming a DAG. Generic parameters:
  - `TName`: Model name literal (e.g., `"stg_events"`)
  - `TInput`: Input document type from source
  - `TOutput`: Output document type after pipeline
  - `TMat`: Materialization config type

  Static presets for materialization modes:
  - `Model.Mode.Replace` - Uses `$out` to replace entire collection
  - `Model.Mode.Upsert` - Uses `$merge` with `on: "_id"`, upsert semantics
  - `Model.Mode.Append` - Uses `$merge` with `whenMatched: "fail"`, insert only

- **Project**: Located in `packages/manifold/src/project/Project.ts`. DAG orchestrator that manages models, resolves dependencies, validates the graph, and executes models in topological order. Models are provided at construction time and validated immediately (immutable after creation). Auto-discovers all dependencies (upstream via `from` and lookup via `lookup`/`unionWith` stages) - just specify leaf models.

- **Source**: Located in `packages/core/src/source/Source.ts`. Unified interface that both `Collection` and `Model` implement, allowing them to be used interchangeably as pipeline sources.

### Type System Architecture

The type system is organized into modular building blocks located in `packages/core/src/elements/`:

#### Core Type Modules (`packages/core/src/elements/`)

- **fieldSelector.ts**: Field selectors for use as keys in queries (e.g., in `$match`)
  - `PathsIncludingArrayIndexes<T>`: Recursive path traversal supporting array indices
  - `FieldSelector<Schema>`: All valid field paths including dotted notation and array indices
  - `GetFieldType<Schema, Path>`: Type resolution for a field path (`never` for unknown
    paths — load-bearing for union narrowing; use `GetFieldTypeOrError` at
    user-surfacing call sites)
  - `InferFieldSelector<Schema, Selector>`: Infers the type at a given field selector
  - Array index access supported (e.g., `"items.0.name"`)

- **fieldReference.ts**: Field references for use in expression values (prefixed with `$`)
  - `FieldPath<T>`: Recursive path traversal without array indices
  - `FieldReference<Schema>`: Dollar-prefixed field paths (e.g., `"$user.name"`)
  - `GetFieldTypeWithoutArrays<Schema, Path>`: Type resolution traversing through arrays
    (brands unknown paths with `PipeSafeError` — asymmetric with `GetFieldType` on purpose)
  - `InferFieldReference<Schema, Ref>`: Infers the type at a given field reference
  - `InferNestedFieldReference<Schema, Obj>`: Recursively resolves field references in
    nested structures; routes `$`-keyed objects to `InferExpression` (operator-key dispatch)
  - `SchemaRefTypeMap<Schema>` (internal): one ref→type map per schema, alias-cached and
    filtered by `FieldReferencesThatInferTo` per target type
  - Array traversal without indices (field references apply to all array elements)

- **operands.ts**: THE operand kernel — `FieldOperand<T, Allowed, Msg, Result>` for
  field-position checks (non-distributive, brands incompatible field types) and
  `ExpressionOperand<Schema, T, Msg>` for expression-position operand sets. All
  brand-carrying operand helpers are one-liners over these; messages are built with
  `RequiresMsg` (utils/errors.ts).

- **expressions.ts**: THE expression registry — `ExpressionSpec<Schema>` maps each
  operator to `{ operand; returns; category }`, where `returns` is present only on
  fixed-return operators: OMITTING it declares the result literal-dependent
  (`LiteralDependentOps` is derived from the omission) and the inference lives in a
  matching `InferDependentExpression` arm (`$concatArrays`, `$arrayElemAt`, `$filter`,
  `$ifNull`, `$cond`, `$literal`; a missing arm degrades to `unknown`). Per-operator
  types, category key sets and unions (derived from the per-entry `category`),
  `Expression`, and the fixed-return arm of `InferExpression` are all derived.
  Valid-but-unmodeled operators are allow-listed by name in
  `UnimplementedExpressionOps` (never widen it to `` `$${string}` ``). Adding an
  operator = one registry entry + deleting its allow-list line (+ one dependent arm
  if applicable).

- **literals.ts**: Literal value type constraints

#### Utility Types (`packages/core/src/utils/`)

The former `utils/core.ts` grab-bag no longer exists — it was split along its seams:

- **errors.ts**: `PipeSafeError`, `IsPipeSafeError`, `PassThrough` (the tier-1 early
  exit), `RequiresMsg` (the brand-message skeleton template)
- **dispatch.ts**: operator-key dispatch kernel — `OperatorKeyOf`, `HasOperatorKey`,
  `HasSingleOperatorKey`, and the `NotAnExpression` sentinel
- **strings.ts**: `DollarPrefixed`/`WithoutDollar`, `Join`, `IndexStr`, `NoDollarString`
  and the character unions
- **objects.ts**: `Document`, `Prettify`, `NonExpandableTypes`, `UnionToIntersection`,
  `ExclusifyUnion`, `ExcludeUndefined`, `IsPlainObject`, `MergeNested`
- **paths.ts**: `SplitPath` (tail-recursive segment splitter), `ExpandDottedKey`
  (split + fold), `HasDottedKeys`, `RemoveDottedKeys`, `FlattenDotSet`
- **updates.ts**: `ApplySetUpdates` + helpers — THE dotted-key update/merge
  kernel, shared by `$set` and `$lookup`'s dotted `as` paths (stages must
  not import each other, so the shared machinery lives here)

### Pipeline Stages

Located in `packages/core/src/stages/`:

- **match.ts**: `$match` filtering with comprehensive type narrowing
  - **Query Types**: `MatchQuery<Schema>` with support for field selectors
  - **Operators Supported**:
    - Equality: `$eq`, `$ne`
    - Comparison: `$gt`, `$gte`, `$lt`, `$lte` (for numbers and dates)
    - Existence: `$exists`, `$type`
    - Arrays: `$size`, `$in`, `$nin`, `$all`, `$elemMatch`
    - Regex: Direct RegExp or `$regex` operator for strings
    - Logical: `$and`, `$or`, `$nor`, `$not`
    - Expressions: `$expr`
  - **Type Narrowing**: `ResolveMatchOutput<Schema, Query>` filters union types based on query
  - **Union Support**: `FilterUnion<Union, Query>` validates each union member against query fields
  - Advanced query validation with `MatchersForType<T>` and `ComparatorMatchers<T>`

TODO: Document the rest of the stages

## Development Patterns

- Use `bun` as the package manager (specified in package.json)
- TypeScript strict mode is enabled
- Suppressing prettier/lint findings is unacceptable — no `// prettier-ignore`
  or `// eslint-disable*` anywhere; restructure the code until the tools pass.
  In assertion files, put `@ts-expect-error` on the exact line the error
  reports (a directive binds to the next line only; a multi-line statement may
  need one per reporting line) — never collapse a statement onto one line to
  dodge the formatter
- Modular architecture: type utilities separated into `packages/core/src/elements/` for reusability
- Examples in `examples/*.ts` demonstrate example pipeline use cases
- Assertions in `packages/core/src/*/*.typeAssertions.ts` are used as tests for type functionality
- The `custom()` method allows escape hatches for unsupported aggregation stages while maintaining type flow

## Type Debugging Tools

### Workflow for Type Assertions

1. **Use IDE/LSP for fast iteration** - The TypeScript LSP provides instant feedback without running builds
2. **The real type gate is per-package**: `bun run typecheck:packages` (from the root; runs `tsc --noEmit --project tsconfig.typecheck.json` in core then manifold — manifold needs a fresh core `bun run build` first). Each package's `tsconfig.typecheck.json` re-includes `*.test.ts` (the build `tsconfig.json` excludes tests so they stay out of `dist` — do not point typecheck back at it). The root `bun run typecheck` resolves project references to built `dist/` declarations and does NOT re-check `packages/*/src` — including the `*.typeAssertions.ts` files
3. **When types don't match**, use `inspect-types.ts` to see the actual inferred type:
   ```bash
   bun run tsx .claude/inspect-types.ts <variableName> [fileName]
   # Example:
   bun run tsx .claude/inspect-types.ts IfNullStringResult src/stages/set.typeAssertions.ts
   ```
4. **Compare actual vs expected** and determine which is correct:
   - If the **actual type is correct** → update the test expectation
   - If the **expected type is correct** → fix the implementation
5. **Run `bun run build`** for final validation before committing

### Local MongoDB Testing

Test aggregation pipelines against real MongoDB behavior:

```bash
bun run tsx .claude/local-mongodb.ts
```

Uses `mongodb-memory-server` for isolated testing with pre-seeded test data.

### Common Type Issues

- **`never` type in pipeline stages**: Usually indicates impossible type conditions in match operations
- **Union type filtering**: Check `FilterUnion` in `packages/core/src/stages/match.ts`
- **Dotted field inference**: Use `FlattenDotSet` from `packages/core/src/utils/paths.ts`

### TypeScript Config

Always use the project's tsconfig.json for type checking. The project uses strict settings (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc.) that differ from TypeScript defaults. Use `bun run build` for validation, not `tsc` on individual files.

## Compile-Time Errors: `PipeSafeError<Msg>`

Compile-time validation errors are surfaced through a single branded interface:

```ts
interface PipeSafeError<Msg extends string> {
  readonly "~pipesafe.error": Msg;
}
```

Defined in `packages/core/src/utils/errors.ts`. Single type parameter — the literal `Msg` is the entire surface area. Embed dynamic context (operator names, key names, path segments) into the message via template literals; do not add a separate `Ctx` parameter.

### Message format

All brand messages follow one skeleton, keyed off MongoDB nomenclature:

```
Operator           '$op' requires <constraint>.
Operator           '$op' is not a recognized aggregation operator.
Accumulator        '$op' requires <constraint>.
Accumulator        '$op' is not a recognized accumulator.
Stage              '$stage' <constraint>.
Field              'name' is not on the schema.
Foreign collection has no <constraint>.
Expression objects must have exactly one operator.
```

Conventions:

- Trailing period.
- No parenthetical "what would work" hints — those belong in docs, not the brand.
- Quote `$op` / field names with single quotes.
- Use **Operator** for `$match` / expression operators, **Accumulator** for `$group` operands (`$sum`, `$avg`, etc.), **Stage** for `$project` / `$unwind` etc., **Foreign collection** for `$lookup` constraints where the joined schema is the cause (the stage was used correctly; the schema is missing a compatible field).
- Pick the subject by what the user needs to fix: the operator/accumulator/stage they wrote, the field they referenced, or the foreign collection's schema they joined against.

### Where brands fire

All operand brands are built from the kernel (`elements/operands.ts`) with messages
from `RequiresMsg` (utils/errors.ts):

- `match.ts` — `ComparatorMatchers<T>` operand helpers (`NumericOperand`, `SizeOperand`, etc.) — `FieldOperand` one-liners
- `group.ts` — `NumericAccumulatorOperand`, `MinMaxAccumulatorOperand` — `ExpressionOperand`-based
- `expressions.ts` — `ArithmeticOperand`, `StringOperand`, `ArrayOperand`, `DateOperand` (registry operand shapes)
- `project.ts` — `ValidateProjectQuery` (unknown-key inclusion + mixed mode), `ResolveFieldValue`
- `unwind.ts` — `UnwindPath` (wired into `Pipeline.unwind`'s constraint so it fires at chained call sites)
- `fieldReference.ts` — `GetFieldTypeWithoutArrays` (inline brand for unknown field paths)
- `fieldSelector.ts` — `GetFieldTypeOrError` (branded sibling of `GetFieldType` for user-surfacing call sites)
- `lookup.ts` — `LookupForeignFieldOrError` (no foreign field with a compatible type, with passthrough for upstream errors)
- `expressions.ts` `InferExpression` — the exactly-one-operator brand for multi-`$`-key objects

### Pipeline method signature patterns

Different stages need different patterns to make brands fire at the chained call site:

- **Direct typing** (`(\$q: Q<Schema>)` — no generic): `sort`. Use when the query type is a finite-key mapped type and the return type doesn't need the literal query.
- **Constraint + validation intersection** (`<const Q extends XxxQuery<Schema>>(\$q: Q & ValidateXxxQuery<Schema, Q>)`): `set`, `project`, `group`. THE pattern for stages with `[key: string]:` index signatures (which suppress per-value checks) — Q stays the raw inference/contextual-typing position while the key-filtered wrapper re-checks the literal and brands offending keys (a bare mapped wrapper breaks contextual typing of nested expression literals — group's compound-`_id` is the counterexample). Project's validate/resolve mode parameters default from the same alias — the second computation is an alias-cache hit, so the modes are NOT hoisted into method generics.
- **Generic constraint** (`<const M extends Q<Schema>>(\$q: M)`): `match`, `replaceRoot`, `facet`. Default pattern when the query type has finite, schema-derived keys. Inner-value brands (e.g. `$gte` on a string) fire from the constraint check; call-site excess-property checking is suppressed but the resulting "is not assignable to PipeSafeError" message is still readable.

### Error code: prefer TS2322 over TS2353

When designing a brand site, place the `PipeSafeError` at a **value position** (the value of an offending key) so TypeScript reports `TS2322 "Type X is not assignable to type 'PipeSafeError<...>'"`. Wrapping the whole parameter type in `PipeSafeError` produces `TS2353 "Object literal may only specify known properties, and 'X' does not exist..."` which highlights an arbitrary valid key and misleads the reader.

### Distribution control

When a conditional returns a `PipeSafeError` for an incompatible type, use `[T] extends [...]` (single-element tuple wrapping) instead of naked `T extends ...`. The non-distributive form rejects mixed-typed unions with one error rather than producing a per-branch union of brands that TS displays awkwardly (e.g. showing only one arbitrary union member as the field type).

### Stripping `readonly` from displayed types

When a `<const P>`-inferred literal is used as the brand's `Ctx` (or as part of the error type's display), TypeScript carries `readonly` modifiers from the const generic into the hover text. Wrap with an inline `{ -readonly [K in keyof T]: T[K] }` mapped type at the call site — a reusable `Mutable<T>` alias does NOT work because TS preserves type alias names in error displays. (Note: the current `PipeSafeError<Msg>` interface no longer carries a `Ctx`, so this only applies if you ever bring it back.)

### Known limitations

- **`Pipeline.group`'s call-site brand surfacing** for `$sum: '$stringField'` etc. now fires via the key-filtered `ValidateGroupQuery` intersection (`$group: G & ValidateGroupQuery<Schema, G>`). Two hard-won constraints, both pinned in `Pipeline.callSite.typeAssertions.ts`: the intersection form is REQUIRED (a bare mapped wrapper at the parameter position breaks contextual typing of compound-`_id` patterns like `_id: { date: { $dateToString: ... } }` — both the bare and concrete-`_id` variants were tried and failed), and the wrapper must be key-FILTERED so a fully-valid query validates against `{}` (a full-map intersection cost 3× whole-project check time). Validation covers `$sum`/`$avg` (numeric) and `$min`/`$max` (BSON-comparable: number, date, string, boolean); extending it = adding the key to `CheckedAccumulatorOps` after registering the operand in `AccumulatorSpec`.
- **Nested value validation** (`$set`/`$project` values and group `_id` at any literal depth) is handled by the shared kernel in `elements/validation.ts` (`ValidateNestedValue`): unknown refs, malformed expression objects (multi-operator, or operator keys mixed with plain keys), invalid operands of REGISTERED operators, AND operator/accumulator names outside registry + allow-list all brand at the chained call site. Valid-but-unmodeled MongoDB is enumerated BY NAME (`UnimplementedExpressionOps` in elements/expressions.ts, `UnimplementedAccumulators` in stages/group.ts — accepted with no operand validation; inference degrades them to `unknown`); never widen those lists to `` `$${string}` ``. `$$`-system variables and widened (non-literal) value types stay accepted. Remaining structural-only interiors: expression OPERAND interiors reached through permissive operand arms (`$cond`/`$ifNull` conditional operands, `$filter.cond`, `$let.in`— all`unknown`-typed in the registry) and `replaceRoot`'s bare `Document` arm.

### Regression guard

Two assertion files pin the standardized behavior — do not weaken either without
replacing the coverage:

- `packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts` pins the desired
  call-site rejection behavior for each stage with `@ts-expect-error` directives.
- `packages/core/src/stages/stages.contract.typeAssertions.ts` pins the per-stage
  contract: every resolver forwards `PipeSafeError` schemas (PassThrough), every
  Pipeline method is wired to its module's resolver, and the operator-key dispatch
  semantics (forgiving inference, `NotAnExpression` sentinel, exactly-one-operator
  brand). These markers have caught real bugs (e.g. a non-distributing
  `HasSingleOperatorKey`).

### The stage trio convention

Every file in `stages/` exports, with **Schema always the first type parameter**:

- `XxxQuery<Schema>` — what the user may write. Scalar stages export a
  schema-free alias (`LimitQuery = number`, `SkipQuery = number`,
  `CountQuery = string`); the Pipeline method always references the
  module's type.
- `ValidateXxxQuery<Schema, Q, ...>` — the rejection surface (`set`,
  `project`, `group`), wired via the `Q & ValidateXxxQuery<Schema, Q>`
  intersection. Re-uses the operand kernel and the shared nested walk in
  `elements/validation.ts`; never re-spells a constraint.
- `ResolveXxxOutput<Schema, Q>` — the output schema; MUST wrap its body in
  `PassThrough<Schema, ...>` (terminal stages `out`/`merge` are exempt — they have no
  resolver). Do NOT re-prove `Q extends XxxQuery<Schema>` inside the resolver: the
  method's parameter position already validated it (use cheap structural narrowing
  like `Q extends { newRoot: infer N }` where the body needs it).

Standard generic names: `Schema` (incoming docs), `Q` (literal query), `Foreign`
(joined schemas). Trailing defaulted/hoisted parameters may extend any trio signature.

### Operator-key dispatch (the early-exit ladder)

Decide what a value _is_ from its `$`-prefixed keys alone; only after dispatch,
resolve and validate against the schema. Never match a value against a
Schema-parameterized union to pick a branch (no `extends Expression<Schema>` /
`extends XxxQuery<Schema>` in inference positions — constraint positions on Pipeline
methods are where those belong).

| Tier | Check                                                                                                                                     | Lives in                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | Schema already a `PipeSafeError` → forward                                                                                                | `PassThrough` in every resolver                      |
| 2    | No `$`-prefixed key → literal (`NotAnExpression` sentinel)                                                                                | `OperatorKeyOf`/`HasOperatorKey` (utils/dispatch.ts) |
| 3    | Multi-`$`-key → exactly-one-operator brand; unregistered op → `unknown` inference (validation brands names outside registry + allow-list) | `InferExpression`                                    |
| 4    | Known operator → registry `returns` / dependent arm; operand brands validate input                                                        | `ExpressionSpec` / operand kernel                    |

Inference is **forgiving**: a malformed operand does not change the inferred kind —
`{ $size: 12 }` still infers `number`; the operand brand reports at the input position.

### Hoisting patterns (depth & recomputation)

- **Don't hoist what the alias cache already shares**: identical alias calls
  (same type args) are cache hits, so a computation used at both the parameter
  and return positions costs once either way. Method-level hoisted generics and
  an `ExpectedValue` cache parameter were both measured neutral and removed.
- **Defaulted cache parameters** on deep helpers replace re-spelled
  subexpressions that are NOT identical alias calls (`MergeSetPlainObjects`'
  `BaseObj`, `RemoveFieldPaths`' `TopOnly`/`Keys`). Keep them on inner aliases
  _behind_ `PassThrough` — defaults evaluate eagerly.
- **Distribution caveat**: a defaulted parameter computed from `Schema` is unsound if
  the body distributes a union schema (defaults substitute before distribution).
  Distribute first, then apply a cached helper alias per member — see
  `SchemaRefTypeMap` in fieldReference.ts.
- **Tail-recursive accumulators** (`SplitPath<S, Acc>`) get the ~1000-depth budget;
  parse paths tail-recursively, then fold the segments (`ExpandDottedKey`,
  `RemoveAtSegments`).
- Do NOT cache path unions as `Pipeline` class generics (hover blowup, threading
  churn; alias caching already dedupes per schema).

### Compat rule

There are NO deprecated aliases: renames ship in a major with the old name
deleted outright (the former `compat.ts` mechanism was removed along with
its `MergeOptions` alias). If a future rename ever needs a bridge, put the
alias next to the new name with `@deprecated` JSDoc naming the removal
major — do not resurrect a separate compat file.
