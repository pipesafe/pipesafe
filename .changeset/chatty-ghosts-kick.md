---
"tmql": minor
---

Add TMModel and TMProject for DAG-based pipeline composition

- **TMModel**: Define named, materializable pipelines with typed input/output. Models form a DAG through their `from` property, enabling dependency tracking and ordered execution.
- **TMProject**: Orchestrate multiple models with automatic topological sorting, validation, and parallel execution of independent stages.
- **TMSource**: Unified interface allowing TMCollection and TMModel to be used interchangeably as pipeline sources.
- **Auto-discovery**: All dependencies (both upstream `from` and `lookup`/`unionWith` references) are automatically discovered - just specify your leaf models.
- **Materialization modes**: `TMModel.Mode.Replace` (`$out`), `TMModel.Mode.Upsert` (`$merge`), and `TMModel.Mode.Append` presets for common patterns.
- **Execution features**: Dry run mode, target/exclude filtering, and progress callbacks (`onModelStart`, `onModelComplete`).
- **Visualization**: Generate Mermaid diagrams of model dependencies with `project.toMermaid()`.
