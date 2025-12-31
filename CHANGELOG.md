# tmql

## 0.4.1

### Patch Changes

- d1ce198: Change license from MIT to Elastic License 2.0 (ELv2)

## 0.4.0

### Minor Changes

- 258c587: Add TMModel and TMProject for DAG-based pipeline composition
  - **TMModel**: Define named, materializable pipelines with typed input/output. Models form a DAG through their `from` property, enabling dependency tracking and ordered execution.
  - **TMProject**: Orchestrate multiple models with automatic topological sorting, validation, and parallel execution of independent stages.
  - **TMSource**: Unified interface allowing TMCollection and TMModel to be used interchangeably as pipeline sources.
  - **Auto-discovery**: All dependencies (both upstream `from` and `lookup`/`unionWith` references) are automatically discovered - just specify your leaf models.
  - **Materialization modes**: `TMModel.Mode.Replace` (`$out`), `TMModel.Mode.Upsert` (`$merge`), and `TMModel.Mode.Append` presets for common patterns.
  - **Execution features**: Dry run mode, target/exclude filtering, and progress callbacks (`onModelStart`, `onModelComplete`).
  - **Visualization**: Generate Mermaid diagrams of model dependencies with `project.toMermaid()`.

- 539e81e: Adds type definitions and inference for MongoDB date manipulation expression operators

## 0.3.1

### Patch Changes

- 35d7450: Add passthrough methods for common MongoDB database operations

## 0.3.0

### Minor Changes

- cde9e7e: Add collection methods passthrough to mongodb node driver

## 0.2.0

### Minor Changes

- e57735e: Implmented connection concept

## 0.1.1

### Patch Changes

- 9f6f317: Added support for $concat expressions in $set and $project stages
