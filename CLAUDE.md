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
│   │   │   ├── stages/          # Pipeline stage implementations
│   │   │   ├── elements/        # Type system building blocks
│   │   │   ├── collection/      # Collection wrapper
│   │   │   ├── source/          # Source interface
│   │   │   ├── utils/           # Type utilities
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

- `@pipesafe/manifold` has `@pipesafe/core` as a **peer dependency** (`>=0.5.0 <1.0.0`)
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

- **document.ts**: Base `Document` type (`Record<string, any>`)

- **fieldSelector.ts**: Field selectors for use as keys in queries (e.g., in `$match`)
  - `PathsIncludingArrayIndexes<T>`: Recursive path traversal supporting array indices
  - `FieldSelector<Schema>`: All valid field paths including dotted notation and array indices
  - `GetFieldType<Schema, Path>`: Type resolution for a field path
  - `InferFieldSelector<Schema, Selector>`: Infers the type at a given field selector
  - Array index access supported (e.g., `"items.0.name"`)

- **fieldReference.ts**: Field references for use in expression values (prefixed with `$`)
  - `FieldPath<T>`: Recursive path traversal without array indices
  - `FieldReference<Schema>`: Dollar-prefixed field paths (e.g., `"$user.name"`)
  - `GetFieldTypeWithoutArrays<Schema, Path>`: Type resolution traversing through arrays
  - `InferFieldReference<Schema, Ref>`: Infers the type at a given field reference
  - `InferNestedFieldReference<Schema, Obj>`: Recursively resolves field references in nested structures
  - Array traversal without indices (field references apply to all array elements)

- **literals.ts**: Literal value type constraints

- **arrayOperator.ts**: Array operation type utilities

#### Utility Types (`packages/core/src/utils/core.ts`)

- **Type Utilities**:
  - `DollarPrefixed<T>` / `WithoutDollar<T>`: Dollar prefix manipulation
  - `Prettify<T>`: Improves TypeScript intellisense display
  - `Join<K, P>`: Dot notation path joining
  - `IndexStr<A>`: Array index string generation for tuples
  - `NoDollarString`: String type that cannot start with `$`
  - `NonExpandableTypes`: Types that should not be recursively expanded (Function, BSON types, Date)

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
  - **Type Narrowing**: `ResolveMatchOutput<Query, Schema>` filters union types based on query
  - **Union Support**: `FilterUnion<Union, Query>` validates each union member against query fields
  - Advanced query validation with `MatchersForType<T>` and `ComparatorMatchers<T>`

TODO: Document the rest of the stages

## Development Patterns

- Use `bun` as the package manager (specified in package.json)
- TypeScript strict mode is enabled
- Modular architecture: type utilities separated into `packages/core/src/elements/` for reusability
- Examples in `examples/*.ts` demonstrate example pipeline use cases
- Assertions in `packages/core/src/*/*.typeAssertions.ts` are used as tests for type functionality
- The `custom()` method allows escape hatches for unsupported aggregation stages while maintaining type flow

## TypeScript Instantiation Depth

PipeSafe's deep type machinery regularly flirts with TS's three internal recursion ceilings (`instantiationDepth`=100, `instantiationCount`=5,000,000, `tailCount`=1,000). When you see `TS2589 "Type instantiation is excessively deep"`, **read the docs before guessing at fixes** — the same diagnostic has three different causes that need three different techniques, and several "obvious" workarounds (`Prettify`, `@ts-ignore`) don't actually help.

- [`docs/typescript-depth/limits.md`](docs/typescript-depth/limits.md) — detailed reference: the three counters, twelve mitigation techniques, what the codebase already does, and a catalogue of high-risk recursive types.
- [`docs/typescript-depth/avoids.md`](docs/typescript-depth/avoids.md) — one-page quick reference: don't-write list, prefer list, dead-ends.
- [`docs/typescript-depth/fix-guide.md`](docs/typescript-depth/fix-guide.md) — runbook for diagnosing an active TS2589 with `bun run depth-blame`.

Diagnostic tooling:

- `bun run depth-blame <varName> [file]` — single-expression trace ranking PipeSafe-owned hotspots. Works even when the build is currently failing (the trace is flushed before tsc bails). AST tools (`inspect-types.ts`, `ts-morph`) cannot, because they see `errorType` post-bail.
- `bun run depth-view` — interactive Vite + React app under `tools/depth-viewer/`. Pick any file → symbol → see source snippet, inferred type, walk depth, registry-attributed entries, kind breakdown, and (for value declarations) the initializer-call chain with declared vs resolved return types per step.
- `bun run depth-view:build` — refresh the dataset that the viewer and query CLI both read. Sources the full (non-sampled) `types.json` registry from `--generateTrace` and walks the AST with the TypeScript Compiler API.
- `bun run depth-view:query <cmd>` — CLI over the same dataset for programmatic use. Subcommands: `top` (rank by `entriesCreated` / `callSites` / `depth` / `uniqueTypes`), `symbol <name>`, `refs <name>`, `file <path>`, `meta`. Default output is a human-readable table; pass `--format json` for parseable output. The dataset lives at `tools/depth-viewer/public/data/index.json` if you want to read it directly.

The depth-view dataset is deterministic and machine-independent (counts, not wall-clock). Useful for: ranking refactor targets (`bun run depth-view:query top`), diagnosing a specific TS2589 (`symbol <const>` → see its chain), reverse-lookup callers of a hot type (`refs <name>`), and PR-level regression checks (diff two dataset snapshots). See [`docs/typescript-depth/limits.md`](docs/typescript-depth/limits.md) for the underlying mechanics.

## Type Debugging Tools

### Workflow for Type Assertions

1. **Use IDE/LSP for fast iteration** - The TypeScript LSP provides instant feedback without running builds
2. **When types don't match**, use `inspect-types.ts` to see the actual inferred type:
   ```bash
   bun run tsx .claude/inspect-types.ts <variableName> [fileName]
   # Example:
   bun run tsx .claude/inspect-types.ts IfNullStringResult src/stages/set.typeAssertions.ts
   ```
3. **Compare actual vs expected** and determine which is correct:
   - If the **actual type is correct** → update the test expectation
   - If the **expected type is correct** → fix the implementation
4. **Run `bun run build`** for final validation before committing

### Local MongoDB Testing

Test aggregation pipelines against real MongoDB behavior:

```bash
bun run tsx .claude/local-mongodb.ts
```

Uses `mongodb-memory-server` for isolated testing with pre-seeded test data.

### Common Type Issues

- **`never` type in pipeline stages**: Usually indicates impossible type conditions in match operations
- **Union type filtering**: Check `FilterUnion` in `packages/core/src/stages/match.ts`
- **Dotted field inference**: Use `FlattenDotSet` from `packages/core/src/utils/core.ts`

### TypeScript Config

Always use the project's tsconfig.json for type checking. The project uses strict settings (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc.) that differ from TypeScript defaults. Use `bun run build` for validation, not `tsc` on individual files.

## Compile-Time Errors: `PipeSafeError<Msg>`

Compile-time validation errors are surfaced through a single branded interface:

```ts
interface PipeSafeError<Msg extends string> {
  readonly "~pipesafe.error": Msg;
}
```

Defined in `packages/core/src/utils/core.ts`. Single type parameter — the literal `Msg` is the entire surface area. Embed dynamic context (operator names, key names, path segments) into the message via template literals; do not add a separate `Ctx` parameter.

### Message format

All brand messages follow one skeleton, keyed off MongoDB nomenclature:

```
Operator           '$op' requires <constraint>.
Accumulator        '$op' requires <constraint>.
Stage              '$stage' <constraint>.
Field              'name' is not on the schema.
Foreign collection has no <constraint>.
```

Conventions:

- Trailing period.
- No parenthetical "what would work" hints — those belong in docs, not the brand.
- Quote `$op` / field names with single quotes.
- Use **Operator** for `$match` / expression operators, **Accumulator** for `$group` operands (`$sum`, `$avg`, etc.), **Stage** for `$project` / `$unwind` etc., **Foreign collection** for `$lookup` constraints where the joined schema is the cause (the stage was used correctly; the schema is missing a compatible field).
- Pick the subject by what the user needs to fix: the operator/accumulator/stage they wrote, the field they referenced, or the foreign collection's schema they joined against.

### Where brands fire

- `match.ts` — `ComparatorMatchers<T>` operand helpers (`NumericOperand`, `SizeOperand`, etc.)
- `group.ts` — `NumericAccumulatorOperand`, `MinMaxAccumulatorOperand`
- `expressions.ts` — `ArithmeticOperandFor`, `StringOperandFor`, `ArrayOperandFor`, `DateOperand`
- `project.ts` — `ValidateProjectQuery` (unknown-key inclusion + mixed mode), `ResolveFieldValue`
- `unwind.ts` — `UnwindPath`
- `fieldReference.ts` — `GetFieldTypeWithoutArrays` (inline brand for unknown field paths)
- `lookup.ts` — `LookupForeignFieldOrError` (no foreign field with a compatible type, with passthrough for upstream errors)

### Pipeline method signature patterns

Different stages need different patterns to make brands fire at the chained call site:

- **Direct typing** (`(\$q: Q<Schema>)` — no generic): `sort`. Use when the query type is a finite-key mapped type and the return type doesn't need the literal query.
- **Validation-mapped wrapper** (`<const P>(\$q: ValidateXQuery<Schema, P>)`): `project`. Use for stages with `[key: string]:` index signatures where direct typing alone wouldn't trigger excess-property checking. Output type still uses the literal `P` for narrowing.
- **Generic constraint** (`<const M extends Q<Schema>>(\$q: M)`): `match`, `set`, `group`, `replaceRoot`, `facet`. Default pattern. Inner-value brands (e.g. `$gte` on a string) fire from the constraint check; call-site excess-property checking is suppressed but the resulting "is not assignable to PipeSafeError" message is still readable.

### Error code: prefer TS2322 over TS2353

When designing a brand site, place the `PipeSafeError` at a **value position** (the value of an offending key) so TypeScript reports `TS2322 "Type X is not assignable to type 'PipeSafeError<...>'"`. Wrapping the whole parameter type in `PipeSafeError` produces `TS2353 "Object literal may only specify known properties, and 'X' does not exist..."` which highlights an arbitrary valid key and misleads the reader.

### Distribution control

When a conditional returns a `PipeSafeError` for an incompatible type, use `[T] extends [...]` (single-element tuple wrapping) instead of naked `T extends ...`. The non-distributive form rejects mixed-typed unions with one error rather than producing a per-branch union of brands that TS displays awkwardly (e.g. showing only one arbitrary union member as the field type).

### Stripping `readonly` from displayed types

When a `<const P>`-inferred literal is used as the brand's `Ctx` (or as part of the error type's display), TypeScript carries `readonly` modifiers from the const generic into the hover text. Wrap with an inline `{ -readonly [K in keyof T]: T[K] }` mapped type at the call site — a reusable `Mutable<T>` alias does NOT work because TS preserves type alias names in error displays. (Note: the current `PipeSafeError<Msg>` interface no longer carries a `Ctx`, so this only applies if you ever bring it back.)

### Known limitations

- **`Pipeline.group`'s call-site brand surfacing** for `$sum: '$stringField'` etc. is silent. The brands exist in the type system (covered by `group.typeAssertions.ts`) but don't fire at chained call sites because `GroupQuery`'s `[key: string]:` index signature suppresses operand validation, and wrapping `Pipeline.group`'s parameter in a validation type interferes with TS's resolution of legitimate compound-`_id` patterns like `_id: { date: { $dateToString: ... } }`. Tracked as a follow-up. Annotating the literal as `GroupQuery<Schema>` directly still fires the brand.

### Regression guard

`packages/core/src/pipeline/Pipeline.callSite.typeAssertions.ts` pins the desired call-site rejection behavior for each stage with `@ts-expect-error` directives. Do not remove cases without replacing them — they're how we know future signature changes don't silently re-introduce holes.
