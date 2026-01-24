/**
 * TMProject - DAG Orchestrator for TMModels
 *
 * Manages a collection of models, resolves dependencies,
 * and executes them in topological order.
 */

import { MongoClient } from "mongodb";
import { TMModel, isTMModel } from "../model/TMModel";
import { tmql } from "../singleton/tmql";

// ============================================================================
// Configuration Types
// ============================================================================

export type ProjectConfig = {
  name: string;
  models: TMModel<any, any, any, any>[];
  defaultDatabase?: string;
};

export type RunOptions = {
  /** Specific models to run (default: all) */
  targets?: string[];
  /** Models to exclude */
  exclude?: string[];
  /** Log plan without executing */
  dryRun?: boolean;
  /** MongoDB client (falls back to tmql singleton) */
  client?: MongoClient;
  /** Database name (falls back to project default) */
  databaseName?: string;
  /** Callbacks */
  onModelStart?: (name: string) => void;
  onModelComplete?: (name: string, stats: ModelRunStats) => void;
  onModelError?: (name: string, error: Error) => void;
};

export type ModelRunStats = {
  durationMs: number;
};

export type ProjectRunResult = {
  success: boolean;
  modelsRun: string[];
  modelsFailed: string[];
  stats: Record<string, ModelRunStats>;
  totalDurationMs: number;
};

export type ExecutionPlan = {
  /** Models grouped by parallel execution stage */
  stages: string[][];
  /** Total models in plan */
  totalModels: number;
  /** Render as Mermaid diagram */
  toMermaid(): string;
  /** Render as text */
  toString(): string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

export type ValidationError = {
  type: "cycle" | "missing_ref" | "duplicate_name";
  message: string;
  models: string[];
};

export type ValidationWarning = {
  type: "orphan";
  message: string;
  models: string[];
};

// ============================================================================
// TMProject Class
// ============================================================================

/**
 * TMProject - DAG orchestrator for TMModels.
 *
 * Models are provided at construction time and validated immediately.
 * The project is immutable after creation.
 *
 * @example
 * ```typescript
 * import { stgEvents, dailyMetrics } from "./models/analytics";
 *
 * const analyticsProject = new TMProject({
 *   name: "analytics",
 *   models: [stgEvents, dailyMetrics],
 * });
 *
 * // See execution plan
 * console.log(analyticsProject.toMermaid());
 *
 * // Run all models
 * await analyticsProject.run();
 * ```
 */
export class TMProject {
  readonly name: string;
  private readonly defaultDatabase: string | undefined;
  private readonly models: Map<string, TMModel<any, any, any, any>>;

  constructor(config: ProjectConfig) {
    this.name = config.name;
    this.defaultDatabase =
      config.defaultDatabase !== undefined ? config.defaultDatabase : undefined;

    // Build models map, auto-discovering all ancestors (including lookup and unionWith)
    this.models = new Map();
    const addModelWithAncestors = (model: TMModel<any, any, any, any>) => {
      if (this.models.has(model.name)) return;
      // First add upstream ancestor (from property)
      const upstream = model.getUpstreamModel();
      if (upstream) {
        addModelWithAncestors(upstream);
      }
      // Then add ancestors from lookup/unionWith stages (filter to models only)
      for (const ancestor of model.getAncestorsFromStages().filter(isTMModel)) {
        addModelWithAncestors(ancestor);
      }
      // Finally add this model
      this.models.set(model.name, model);
    };

    for (const model of config.models) {
      addModelWithAncestors(model);
    }

    // Validate immediately - fail fast
    const validation = this.validate();
    if (!validation.valid) {
      const errorMessages = validation.errors
        .map((e) => `  - ${e.message}`)
        .join("\n");
      throw new Error(
        `Project "${this.name}" has validation errors:\n${errorMessages}`
      );
    }
  }

  /**
   * Get a model by name.
   */
  getModel<TName extends string>(
    name: TName
  ): TMModel<TName, any, any, any> | undefined {
    return this.models.get(name) as TMModel<TName, any, any, any> | undefined;
  }

  /**
   * Get all models.
   */
  getModels(): TMModel<any, any, any, any>[] {
    return Array.from(this.models.values());
  }

  /**
   * Build an execution plan (topological sort).
   */
  plan(options: Pick<RunOptions, "targets" | "exclude"> = {}): ExecutionPlan {
    const { targets, exclude = [] } = options;

    // Get models to run
    const modelsToRun = this.getModelsToRun(targets, exclude);

    // Build dependency graph
    const deps = this.buildDependencyGraph(modelsToRun);

    // Topological sort into stages (parallel batches)
    const stages = this.topologicalSort(deps);

    return {
      stages,
      totalModels: stages.flat().length,
      toMermaid: () => this.toMermaidFromDeps(deps),
      toString: () =>
        stages
          .map((stage, i) => `Stage ${i + 1}: ${stage.join(", ")}`)
          .join("\n"),
    };
  }

  /**
   * Validate the DAG (check for cycles, missing refs, etc.).
   */
  validate(): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for duplicate names
    const names = new Set<string>();
    for (const model of this.models.values()) {
      if (names.has(model.name)) {
        errors.push({
          type: "duplicate_name",
          message: `Duplicate model name: "${model.name}"`,
          models: [model.name],
        });
      }
      names.add(model.name);
    }

    // Check for missing dependencies
    for (const model of this.models.values()) {
      const upstream = model.getUpstreamModel();
      if (upstream && !this.models.has(upstream.name)) {
        errors.push({
          type: "missing_ref",
          message: `Model "${model.name}" depends on "${upstream.name}" which is not in this project`,
          models: [model.name, upstream.name],
        });
      }
    }

    // Check for cycles
    const cycle = this.detectCycle();
    if (cycle) {
      errors.push({
        type: "cycle",
        message: `Circular dependency detected: ${cycle.join(" -> ")}`,
        models: cycle,
      });
    }

    // Check for orphan models (no downstream dependencies)
    const hasDownstream = new Set<string>();
    for (const model of this.models.values()) {
      const upstream = model.getUpstreamModel();
      if (upstream) {
        hasDownstream.add(upstream.name);
      }
    }
    const orphans = Array.from(this.models.values())
      .filter((m) => !hasDownstream.has(m.name))
      .map((m) => m.name);

    // Only warn if there are multiple orphans (leaf nodes are expected)
    if (orphans.length > 1) {
      warnings.push({
        type: "orphan",
        message: `Multiple leaf models with no downstream dependencies: ${orphans.join(", ")}`,
        models: orphans,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Execute the DAG (or subset of models).
   */
  async run(options: RunOptions = {}): Promise<ProjectRunResult> {
    const startTime = Date.now();
    const {
      targets,
      exclude,
      dryRun = false,
      client,
      databaseName,
      onModelStart,
      onModelComplete,
      onModelError,
    } = options;

    const planOptions: Pick<RunOptions, "targets" | "exclude"> = {};
    if (targets !== undefined) planOptions.targets = targets;
    if (exclude !== undefined) planOptions.exclude = exclude;
    const executionPlan = this.plan(planOptions);
    const modelsRun: string[] = [];
    const modelsFailed: string[] = [];
    const stats: Record<string, ModelRunStats> = {};

    if (dryRun) {
      console.log("Dry run - execution plan:");
      console.log(executionPlan.toString());
      return {
        success: true,
        modelsRun: [],
        modelsFailed: [],
        stats: {},
        totalDurationMs: Date.now() - startTime,
      };
    }

    // Get MongoDB client
    const mongoClient = client ?? tmql.client;
    if (!mongoClient) {
      throw new Error(
        "No MongoDB client available. Either pass one via options.client or call tmql.connect() first."
      );
    }

    const dbName = databaseName ?? this.defaultDatabase;

    // Execute stages sequentially, models within a stage in parallel
    for (const stage of executionPlan.stages) {
      const stageResults = await Promise.allSettled(
        stage.map(async (modelName) => {
          const model = this.models.get(modelName)!;
          const modelStart = Date.now();

          onModelStart?.(modelName);

          try {
            await this.executeModel(model, mongoClient, dbName);

            const modelStats: ModelRunStats = {
              durationMs: Date.now() - modelStart,
            };

            stats[modelName] = modelStats;
            modelsRun.push(modelName);
            onModelComplete?.(modelName, modelStats);

            return { success: true, modelName };
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            modelsFailed.push(modelName);
            onModelError?.(modelName, err);
            throw err;
          }
        })
      );

      // Check for failures
      const failures = stageResults.filter(
        (r) => r.status === "rejected"
      ) as PromiseRejectedResult[];
      if (failures.length > 0) {
        // Stop execution on failure
        break;
      }
    }

    return {
      success: modelsFailed.length === 0,
      modelsRun,
      modelsFailed,
      stats,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a single model.
   */
  private async executeModel(
    model: TMModel<any, any, any, any>,
    client: MongoClient,
    dbName: string | undefined
  ): Promise<void> {
    // Build pipeline with output stage
    const pipeline = model.buildPipeline();

    // Get source collection
    const sourceCollection = model.getSourceCollectionName();
    const outputDb = model.getOutputDatabase() ?? dbName;

    // Handle view creation separately
    if (model.materialize.type === "view") {
      const viewName = model.getOutputCollectionName();
      const viewDb = client.db(outputDb);

      // Drop existing view if exists
      try {
        await viewDb.dropCollection(viewName);
      } catch {
        // View might not exist
      }

      // Create view
      await viewDb.createCollection(viewName, {
        viewOn: sourceCollection,
        pipeline: model.getPipelineStages(),
      });

      return;
    }

    // Handle time-series collection creation
    if (
      model.materialize.type === "collection" &&
      "timeseries" in model.materialize &&
      model.materialize.timeseries
    ) {
      const collName = model.getOutputCollectionName();
      const db = client.db(outputDb);

      // Check if collection exists
      const collections = await db
        .listCollections({ name: collName })
        .toArray();
      if (collections.length === 0) {
        // Create time-series collection
        await db.createCollection(collName, {
          timeseries: {
            timeField: model.materialize.timeseries.timeField,
            metaField: model.materialize.timeseries.metaField,
            granularity: model.materialize.timeseries.granularity,
          },
          expireAfterSeconds: model.materialize.timeseries.expireAfterSeconds,
        });
      }
    }

    // Execute aggregation
    // Use source database for reading, output stage handles writing to correct db
    const sourceDb = model.getSourceDatabase() ?? dbName;
    const db = client.db(sourceDb);
    const collection = db.collection(sourceCollection);

    const cursor = collection.aggregate(pipeline);
    await cursor.toArray();
  }

  /**
   * Render the DAG as a Mermaid diagram.
   */
  toMermaid(): string {
    const deps = this.buildDependencyGraph(
      Array.from(this.models.values()).map((m) => m.name)
    );
    return this.toMermaidFromDeps(deps);
  }

  /**
   * Get models to run based on targets and exclusions.
   */
  private getModelsToRun(targets?: string[], exclude: string[] = []): string[] {
    const excludeSet = new Set(exclude);

    if (targets && targets.length > 0) {
      // Run specified targets and their dependencies
      const toRun = new Set<string>();
      const addWithDeps = (name: string) => {
        if (toRun.has(name) || excludeSet.has(name)) return;
        const model = this.models.get(name);
        if (!model) {
          throw new Error(`Target model "${name}" not found in project`);
        }
        toRun.add(name);
        const upstream = model.getUpstreamModel();
        if (upstream) {
          addWithDeps(upstream.name);
        }
      };
      targets.forEach(addWithDeps);
      return Array.from(toRun);
    }

    // Run all models except excluded
    return Array.from(this.models.keys()).filter(
      (name) => !excludeSet.has(name)
    );
  }

  /**
   * Build dependency graph: { modelName: [dependencies] }
   */
  private buildDependencyGraph(modelNames: string[]): Map<string, string[]> {
    const deps = new Map<string, string[]>();

    for (const name of modelNames) {
      const model = this.models.get(name);
      if (!model) continue;

      const modelDeps: string[] = [];
      const upstream = model.getUpstreamModel();
      if (upstream && modelNames.includes(upstream.name)) {
        modelDeps.push(upstream.name);
      }
      deps.set(name, modelDeps);
    }

    return deps;
  }

  /**
   * Topological sort into parallel stages.
   */
  private topologicalSort(deps: Map<string, string[]>): string[][] {
    const stages: string[][] = [];
    const remaining = new Map(deps);
    const completed = new Set<string>();

    while (remaining.size > 0) {
      // Find models with all dependencies satisfied
      const ready: string[] = [];
      for (const [name, modelDeps] of remaining) {
        if (modelDeps.every((dep) => completed.has(dep))) {
          ready.push(name);
        }
      }

      if (ready.length === 0 && remaining.size > 0) {
        throw new Error(
          `Circular dependency detected among: ${Array.from(remaining.keys()).join(", ")}`
        );
      }

      // Add to current stage
      stages.push(ready);

      // Mark as completed
      for (const name of ready) {
        completed.add(name);
        remaining.delete(name);
      }
    }

    return stages;
  }

  /**
   * Detect cycles in the dependency graph.
   */
  private detectCycle(): string[] | null {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (name: string): string[] | null => {
      visited.add(name);
      recStack.add(name);
      path.push(name);

      const model = this.models.get(name);
      if (model) {
        const upstream = model.getUpstreamModel();
        if (upstream && this.models.has(upstream.name)) {
          if (!visited.has(upstream.name)) {
            const cycle = dfs(upstream.name);
            if (cycle) return cycle;
          } else if (recStack.has(upstream.name)) {
            // Found cycle
            const cycleStart = path.indexOf(upstream.name);
            return [...path.slice(cycleStart), upstream.name];
          }
        }
      }

      path.pop();
      recStack.delete(name);
      return null;
    };

    for (const name of this.models.keys()) {
      if (!visited.has(name)) {
        const cycle = dfs(name);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  /**
   * Render dependency graph as Mermaid.
   */
  private toMermaidFromDeps(deps: Map<string, string[]>): string {
    const lines = ["graph TD"];

    // Define all nodes with labels first
    for (const [name] of deps) {
      const model = this.models.get(name);
      const matType = model?.materialize.type ?? "unknown";
      lines.push(`  ${name}["${name}<br/>(${matType})"]`);
    }

    // Then add edges
    for (const [name, modelDeps] of deps) {
      for (const dep of modelDeps) {
        lines.push(`  ${dep} --> ${name}`);
      }
    }

    return lines.join("\n");
  }
}
