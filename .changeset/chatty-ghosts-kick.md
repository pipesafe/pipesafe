---
"tmql": minor
---

Add TMModel and TMProject for DAG-based pipeline composition

- **TMModel**: Define named, materializable pipelines with typed input/output. Models form a DAG through their `from` property, enabling dependency tracking and ordered execution.
- **TMProject**: Orchestrate multiple models with automatic topological sorting, validation, and parallel execution of independent stages.
- **Materialization modes**: `TMModel.Mode.Replace` (`$out`) and `TMModel.Mode.Upsert` (`$merge`) presets for common patterns.
- **Execution features**: Dry run mode, target/exclude filtering, and progress callbacks (`onModelStart`, `onModelComplete`).
- **Visualization**: Generate Mermaid diagrams of model dependencies with `project.toMermaid()`.
