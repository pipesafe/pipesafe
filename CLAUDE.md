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
