# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `bun run build` - Compiles TypeScript to JavaScript in `dist/`
- **Watch**: `bun run watch` - Runs TypeScript compiler in watch mode
- **Lint**: `bun run lint` - Run ESLint
- **Format**: `bun run format` - Run Prettier
- **Type Inspection**: `bun run tsx .claude/inspect-types.ts <variableName> [fileName]` - Debug and see actual inferred types
- **Local MongoDB Testing**: `bun run tsx .claude/local-mongodb.ts` - Start in-memory MongoDB with test data and run example pipelines

## Changesets

This project uses [changesets](https://github.com/changesets/changesets) for versioning. When adding features or fixes that affect the public API:

1. Create a changeset file in `.changeset/` with format:

   ```markdown
   ---
   "tmql": minor # or patch/major
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

**tmql** (Typed Mongo Query Language) is a TypeScript MongoDB aggregation pipeline builder that provides full type safety.

### Core Classes

- **TMPipeline**: The main aggregation pipeline builder class located in `src/pipeline/TMPipeline.ts` with three generic types:
  - `StartingDocs`: The original document schema (union types supported)
  - `PreviousStageDocs`: The current document schema after previous pipeline stages (defaults to StartingDocs)
  - `Mode`: Lookup mode - `"runtime"` (default) or `"model"` for DAG pipelines

  Each pipeline method returns a new `TMPipeline` instance with updated types to maintain type safety throughout the chain.

- **TMModel**: Located in `src/model/TMModel.ts`. A named, materializable pipeline with typed input/output. Models can depend on collections or other models, forming a DAG. Generic parameters:
  - `TName`: Model name literal (e.g., `"stg_events"`)
  - `TInput`: Input document type from source
  - `TOutput`: Output document type after pipeline
  - `TMat`: Materialization config type

  Static presets for materialization modes:
  - `TMModel.Mode.Replace` - Uses `$out` to replace entire collection
  - `TMModel.Mode.Upsert` - Uses `$merge` with `on: "_id"`, upsert semantics
  - `TMModel.Mode.Append` - Uses `$merge` with `whenMatched: "fail"`, insert only

- **TMProject**: Located in `src/project/TMProject.ts`. DAG orchestrator that manages models, resolves dependencies, validates the graph, and executes models in topological order. Models are provided at construction time and validated immediately (immutable after creation). Auto-discovers all dependencies (upstream via `from` and lookup via `lookup`/`unionWith` stages) - just specify leaf models.

- **TMSource**: Located in `src/source/TMSource.ts`. Unified interface that both `TMCollection` and `TMModel` implement, allowing them to be used interchangeably as pipeline sources.

### Type System Architecture

The type system is organized into modular building blocks located in `src/elements/`:

#### Core Type Modules (`src/elements/`)

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

#### Utility Types (`src/utils/core.ts`)

- **Type Utilities**:
  - `DollarPrefixed<T>` / `WithoutDollar<T>`: Dollar prefix manipulation
  - `Prettify<T>`: Improves TypeScript intellisense display
  - `Join<K, P>`: Dot notation path joining
  - `IndexStr<A>`: Array index string generation for tuples
  - `NoDollarString`: String type that cannot start with `$`
  - `NonExpandableTypes`: Types that should not be recursively expanded (Function, BSON types, Date)

### Pipeline Stages

Located in `src/stages/`:

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
- Modular architecture: type utilities separated into `src/elements/` for reusability
- Examples in `examples/*.ts` demonstrate example pipeline use cases
- Assertions in `src/*/*.typeAssertions.ts` are used as tests for type functionality
- The `custom()` method allows escape hatches for unsupported aggregation stages while maintaining type flow

## Type Inspection Tools & Debugging

When debugging complex type inference issues in this project, these approaches are most effective:

### IDE LSP for Instant Type Feedback

**For iterative type-checking work**, use the IDE's TypeScript LSP instead of repeatedly running the build. This provides instant feedback without compilation overhead:

```bash
# In Claude Code, use getDiagnostics to check types instantly
# Much faster than: bun run build
```

**When to use LSP diagnostics:**

- Fixing type assertions and test expectations
- Debugging type inference issues in `*.typeAssertions.ts` files
- Iteratively refining type definitions
- Any TypeScript-heavy work with frequent changes

**When to use full build (`bun run build`):**

- Final verification before committing
- Ensuring nothing breaks in full project context
- CI/CD validation

This is especially effective for work like adding type tests where you need tight feedback loops.

### Type Inspection with ts-morph

While the LSP tells you when types don't match, you need to **see the actual inferred type** to fix test expectations. Use the dedicated `inspect-types.ts` tool:

```bash
# Run type inspection for variables/types/functions
bun run tsx .claude/inspect-types.ts <variableName> [fileName]

# Examples:
bun run tsx .claude/inspect-types.ts IfNullStringResult src/stages/set.typeAssertions.ts
bun run tsx .claude/inspect-types.ts CondMixedTypesResult src/stages/set.typeAssertions.ts
```

**Typical workflow for fixing type assertions:**

1. LSP shows: "Type 'false' does not satisfy the constraint 'true'" (type mismatch detected)
2. Run `inspect-types.ts` to see the actual inferred type
3. Update the expected type in the test to match
4. LSP confirms the types now match

The `.claude/inspect-types.ts` file:

- Loads the project with proper tsconfig.json configuration
- Shows resolved TypeScript types in readable format
- Reports TypeScript diagnostics and errors
- Essential for understanding what complex generic types actually resolve to

### Debugging Complex Generic Types

For the TMPipeline's complex generics (`StartingDocs`, `PreviousStageDocs`):

1. **Check type narrowing**: Focus on `ResolveMatchOutput` and `FilterUnion` in `src/stages/match.ts`
2. **Check field resolution**: Verify `GetFieldType` and `InferFieldSelector` in `src/elements/fieldSelector.ts`
3. **Prettify output**: Use the `Prettify<T>` utility from `src/utils/core.ts` to simplify complex intersections

### Common Type Issues & Solutions

- **`never` type in pipeline stages**: Usually indicates impossible type conditions in match operations or field resolution
- **Union type filtering**: Check that `FilterUnion` is properly evaluating each union member
- **Dotted field inference**: Use `FlattenDotSet` from `src/utils/core.ts` to properly expand nested structures

### Local MongoDB Testing

For testing aggregation pipelines against real MongoDB behavior, use the `.claude/local-mongodb.ts` utility:

```bash
# Run with example pipelines
bun run tsx .claude/local-mongodb.ts

# Or import in test files
import { setupLocalMongo } from './.claude/local-mongodb';

const { db, collection, seedTestData, testPipeline, cleanup } = await setupLocalMongo();
await seedTestData(); // Populates with Speaker/Attendee test data
await testPipeline([{ $match: { type: "attendee" } }]);
await cleanup();
```

**The `.claude/local-mongodb.ts` utility provides:**

- In-memory MongoDB instance (no Docker required)
- Pre-seeded test data with Speaker/Attendee union types
- `testPipeline()` helper for running and displaying aggregation results
- Automatic cleanup and shutdown
- Perfect for verifying MongoDB quirks (e.g., array index behavior in $set)

**Key features:**

- Uses `mongodb-memory-server` for isolated testing
- Type-safe collection with `PersonDocument` union type
- Includes 5 example pipelines demonstrating common patterns
- First run downloads MongoDB binary (~70MB, cached for future runs)

## Important: Always Use Project tsconfig When Type Checking

When testing TypeScript type assertions or checking for type errors, **always use the project's tsconfig.json** to ensure consistent behavior with the IDE and build process.

### ❌ DON'T do this:

```bash
# This uses default TypeScript settings, not the project's config
npx tsc --noEmit src/stages/set.typeAssertions.ts
bun run tsx some-file.ts  # May not catch all type issues
```

### ✅ DO this instead:

```bash
# Use the project's tsconfig for the entire project
npx tsc --noEmit --project tsconfig.json

# Or use the build command which uses tsconfig
bun run build

# For running type inspection with bun/tsx, the tool already works correctly:
bun run tsx .claude/inspect-types.ts <variableName> <fileName>
```

## Why This Matters

The project uses strict TypeScript settings in `tsconfig.options.json`:

- `exactOptionalPropertyTypes: true` - Affects how optional properties work
- `noUncheckedIndexedAccess: true` - Affects indexed access behavior
- `strict: true` and many other strict checks
- Custom module resolution and target settings

Running `tsc` on individual files without the project config will:

1. Use TypeScript's default settings (less strict)
2. Miss important type checking rules
3. Give different results than the IDE (which uses the project config)
4. Lead to false positives/negatives in type assertion tests

## Key Insight

The IDE (VS Code) automatically uses the project's tsconfig.json, which is why it shows the correct types and no errors when the types are actually working. Always validate against the full project build or using `--project tsconfig.json` to match IDE behavior.

## Type Assertion Tests

When the type assertion tests in `*.typeAssertions.ts` files show no errors in the IDE but fail when running `tsc` directly on the file, it means the types are actually correct but the test methodology was wrong. Always use the project build to verify type assertions.

## Claude Code Workflow: Pre-Commit Validation Pattern

When working in GitHub Actions workflows (e.g., as a Claude Code agent), follow this pre-commit validation pattern to match the local development workflow and enable self-healing before committing changes.

### The Pattern

**Before committing any changes, always run these commands in order:**

```bash
# 1. Type check (catches type errors)
bun run build

# 2. Auto-fix linting issues
bun run lint:fix

# 3. Auto-fix formatting issues
bun run format:fix

# 4. Run tests
bun run test:ci

# 5. Stage any auto-fixes that were applied
git add -A

# 6. Then commit with descriptive message
git commit -m "feat: your change description"

# 7. Push to remote
git push origin HEAD
```

### Why This Matters

This validation sequence mirrors the local `.lefthook.yml` pre-commit hooks and provides several benefits:

1. **Catches errors before commit**: Type errors and test failures are detected before creating the commit, not after pushing to CI
2. **Self-healing**: Auto-fix commands (`lint:fix`, `format:fix`) automatically repair style issues and include fixes in the same commit
3. **Single clean commit**: All changes and fixes are bundled together, avoiding noisy follow-up "fix linting" commits
4. **Consistent with local development**: Developers with lefthook installed get the same validation locally

### Commands Explained

- `bun run build`: Runs TypeScript compiler with project's strict tsconfig.json settings - this is your primary type check
- `bun run lint:fix`: Runs ESLint with auto-fix enabled - repairs code style issues
- `bun run format:fix`: Runs Prettier with write mode - ensures consistent formatting
- `bun run test:ci`: Runs the full test suite in CI mode - validates functionality
- `git add -A`: Stages any files that were auto-fixed by lint:fix or format:fix

### Example Workflow

```bash
# Make your code changes
# ... edit files ...

# Validate before committing
bun run build          # ✅ Type check passes
bun run lint:fix       # ✅ Auto-fixed 3 linting issues
bun run format:fix     # ✅ Auto-formatted 2 files
bun run test:ci        # ✅ All 100 tests pass

# Stage everything (including auto-fixes)
git add -A

# Commit with co-author if triggered by a user
git commit -m "feat: add new expression operators

Co-authored-by: Tim Vyas <timvyas@users.noreply.github.com>"

# Push to remote
git push origin HEAD
```

### What Happens If Validation Fails

If any validation step fails:

1. **Type check fails** (`bun run build`): Fix type errors before committing
2. **Tests fail** (`bun run test:ci`): Fix failing tests before committing
3. **Lint/format**: These auto-fix, so just stage the fixes with `git add -A`

Do NOT commit until all validation passes. This prevents pushing broken code and matches the local development experience where commits are blocked until hooks pass.
