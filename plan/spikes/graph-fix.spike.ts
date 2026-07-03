/**
 * SPIKE: EPIC-A — dependency graph correctness fix (lookup edges are real edges).
 *
 * Purpose: empirically reproduce the three bugs named in
 * plan/01-current-state-and-gaps.md §5.1 and plan/04-transform-roadmap.md §2
 * against a real MongoDB (mongodb-memory-server), then demonstrate the
 * candidate fix — a unified dependency-edge extraction (from + lookup/unionWith
 * stage ancestors) shared by discovery, topological ordering, targets closure,
 * and cycle detection.
 *
 * Reproductions (BROKEN, current @pipesafe/manifold Project):
 *   (a) model_b `lookup`s model_c, where model_c is NOT a `from` ancestor of
 *       model_b and sits at from-depth 1 (model_c from model_d). Project
 *       discovers model_c but schedules model_b in stage 1 alongside model_d,
 *       BEFORE model_c materializes -> model_b joins against a missing
 *       collection and silently materializes empty lookup arrays.
 *   (b) run({ targets: ["model_b"] }) walks only the `from` chain, so the
 *       lookup dependency model_c (and its upstream model_d) is omitted.
 *   (c) a lookup-edge cycle (cyc_a lookups cyc_b, cyc_b from cyc_a) is never
 *       reported by validate(); in fact Project's constructor discovery
 *       (Project.ts:118-131) recurses infinitely and throws RangeError
 *       "Maximum call stack size exceeded" before detectCycle ever runs.
 *
 * How to run (from repo root; first run may download a mongod binary):
 *   bun run tsx plan/spikes/graph-fix.spike.ts
 *
 * Status: SPIKE, not production code. The "fixed" functions below are the
 * candidate shapes for GRAPH-1..GRAPH-4 in plan/trd/EPIC-A-dependency-graph-fix.md,
 * written standalone so nothing in packages/ is modified.
 *
 * FINDINGS (from executed run, 2026-07-03):
 *   (a) BROKEN plan = "Stage 1: model_d, model_b / Stage 2: model_c";
 *       start order [model_d, model_b, model_c]; materialized model_b docs
 *       had cDocs: [] (0 joined docs) despite matching keys existing —
 *       run reported success: true. Silent wrong data confirmed.
 *   (b) BROKEN plan({targets:["model_b"]}) = "Stage 1: model_b" only;
 *       run modelsRun = ["model_b"], model_c/model_d never executed,
 *       cDocs again empty. Confirmed.
 *   (c) BROKEN: new Project(...) with the lookup cycle threw
 *       RangeError: Maximum call stack size exceeded from constructor
 *       discovery — NOT a clean "cycle" ValidationError, and NOT the
 *       "validates cleanly, races at runtime" behavior plan/04 §2 predicts.
 *       The discovery walk itself must be made cycle-safe (4th fix site).
 *   FIXED: unified edges = "model_b depends on model_c [stage]",
 *       "model_c depends on model_d [from]"; plan = "Stage 1: model_d /
 *       Stage 2: model_c / Stage 3: model_b"; executed order
 *       [model_d, model_c, model_b]; model_b docs joined cDocs.length=1 each,
 *       with model_c's tag present. targetsClosure(["model_b"]) =
 *       {model_b, model_c, model_d}. Cycle case: discovery terminates
 *       (mark-before-visit) and detectCycleUnified returns
 *       cyc_b -> cyc_a -> cyc_b.
 */

import { MongoClient, Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Collection } from "@pipesafe/core";
import { Model, Project, isModel } from "@pipesafe/manifold";

// ============================================================================
// Fixture models
//
// Graph under test (edges point dependency -> dependent):
//
//   raw_d ──from──> model_d ──from──> model_c ──lookup──> model_b <──from── raw_b
//
// model_c is a *stage* (lookup) dependency of model_b and sits at from-depth 1,
// which is exactly the shape current tests never cover (their lookup targets
// are all from-depth 0, so staging is accidentally correct).
// ============================================================================

type RawD = { _id: string; value: number };
type RawB = { _id: string; cId: string };

const rawD = new Collection<RawD>({ collectionName: "raw_d" });
const rawB = new Collection<RawB>({ collectionName: "raw_b" });

const modelD = new Model({
  name: "model_d",
  from: rawD,
  pipeline: (p) => p.match({ value: { $gte: 0 } }),
  materialize: { type: "collection", mode: Model.Mode.Replace },
});

const modelC = new Model({
  name: "model_c",
  from: modelD,
  pipeline: (p) => p.set({ tag: "materialized_by_model_c" }),
  materialize: { type: "collection", mode: Model.Mode.Replace },
});

const modelB = new Model({
  name: "model_b",
  from: rawB,
  pipeline: (p) =>
    p.lookup({
      from: modelC,
      localField: "cId",
      foreignField: "_id",
      as: "cDocs",
    }),
  materialize: { type: "collection", mode: Model.Mode.Replace },
});

async function seed(db: Db): Promise<void> {
  await db.collection("raw_d").insertMany([
    { _id: "d1" as never, value: 1 },
    { _id: "d2" as never, value: 2 },
  ]);
  await db.collection("raw_b").insertMany([
    { _id: "b1" as never, cId: "d1" },
    { _id: "b2" as never, cId: "d2" },
  ]);
}

async function readModelB(db: Db): Promise<string> {
  const docs = await db.collection("model_b").find().toArray();
  return docs
    .map((d) => {
      const cDocs = (d as { cDocs?: unknown[] }).cDocs ?? [];
      return `${String(d._id)}: cDocs.length=${cDocs.length}`;
    })
    .join(", ");
}

// ============================================================================
// The candidate FIX, standalone (mirrors what lands in Project.ts)
// ============================================================================

type AnyModel = InstanceType<typeof Model>;

/** Edge kind — preserved for lineage / the plan/05 event-log manifest. */
type EdgeKind = "from" | "stage";

type DepEdge = { dep: AnyModel; kind: EdgeKind };

/**
 * GRAPH-1: single source of truth for a model's direct dependencies.
 * Unions the `from` edge with lookup/unionWith/facet stage ancestors.
 * A model can appear under both kinds (from + lookup on the same upstream).
 */
function directDeps(model: AnyModel): DepEdge[] {
  const edges: DepEdge[] = [];
  const upstream = model.getUpstreamModel();
  if (upstream) edges.push({ dep: upstream, kind: "from" });
  for (const ancestor of model.getAncestorsFromStages().filter(isModel)) {
    edges.push({ dep: ancestor, kind: "stage" });
  }
  return edges;
}

/**
 * Cycle-safe discovery: iterative worklist, mark-before-visit.
 * (Current Project constructor marks AFTER recursing, so any cycle
 * reachable through stage edges is an infinite recursion.)
 */
function discoverModels(leaves: AnyModel[]): Map<string, AnyModel> {
  const models = new Map<string, AnyModel>();
  const stack: AnyModel[] = [...leaves];
  while (stack.length > 0) {
    const model = stack.pop() as AnyModel;
    if (models.has(model.name)) continue;
    models.set(model.name, model); // mark BEFORE visiting deps
    for (const { dep } of directDeps(model)) stack.push(dep);
  }
  return models;
}

/** Unified dependency map over a subset of model names (deduped). */
function buildUnifiedDeps(
  models: Map<string, AnyModel>,
  names: string[]
): Map<string, string[]> {
  const nameSet = new Set(names);
  const deps = new Map<string, string[]>();
  for (const name of names) {
    const model = models.get(name);
    if (!model) continue;
    const depNames = new Set<string>();
    for (const { dep } of directDeps(model)) {
      if (nameSet.has(dep.name)) depNames.add(dep.name);
    }
    deps.set(name, [...depNames]);
  }
  return deps;
}

/** GRAPH-3: targets closure follows ALL edge kinds. */
function targetsClosure(
  models: Map<string, AnyModel>,
  targets: string[],
  exclude: string[] = []
): string[] {
  const excludeSet = new Set(exclude);
  const toRun = new Set<string>();
  const stack = [...targets];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (toRun.has(name) || excludeSet.has(name)) continue;
    const model = models.get(name);
    if (!model) throw new Error(`Target model "${name}" not found in project`);
    toRun.add(name);
    for (const { dep } of directDeps(model)) stack.push(dep.name);
  }
  return [...toRun];
}

/** GRAPH-2: cycle detection over all edge kinds. */
function detectCycleUnified(models: Map<string, AnyModel>): string[] | null {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  const dfs = (name: string): string[] | null => {
    visited.add(name);
    inStack.add(name);
    path.push(name);
    const model = models.get(name);
    if (model) {
      for (const { dep } of directDeps(model)) {
        if (!models.has(dep.name)) continue;
        if (!visited.has(dep.name)) {
          const cycle = dfs(dep.name);
          if (cycle) return cycle;
        } else if (inStack.has(dep.name)) {
          const start = path.indexOf(dep.name);
          return [...path.slice(start), dep.name];
        }
      }
    }
    path.pop();
    inStack.delete(name);
    return null;
  };

  for (const name of models.keys()) {
    if (!visited.has(name)) {
      const cycle = dfs(name);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Kahn-style staging, identical to Project.topologicalSort but over unified deps. */
function topoStages(deps: Map<string, string[]>): string[][] {
  const stages: string[][] = [];
  const remaining = new Map(deps);
  const completed = new Set<string>();
  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const [name, modelDeps] of remaining) {
      if (modelDeps.every((dep) => completed.has(dep))) ready.push(name);
    }
    if (ready.length === 0) {
      throw new Error(
        `Circular dependency detected among: ${[...remaining.keys()].join(", ")}`
      );
    }
    stages.push(ready);
    for (const name of ready) {
      completed.add(name);
      remaining.delete(name);
    }
  }
  return stages;
}

/** Minimal executor mirroring Project.executeModel for collection models. */
async function runStages(
  models: Map<string, AnyModel>,
  stages: string[][],
  client: MongoClient,
  dbName: string
): Promise<string[]> {
  const order: string[] = [];
  for (const stage of stages) {
    await Promise.all(
      stage.map(async (name) => {
        const model = models.get(name) as AnyModel;
        order.push(name);
        const db = client.db(model.getSourceDatabase() ?? dbName);
        await db
          .collection(model.getSourceCollectionName())
          .aggregate(model.buildPipeline())
          .toArray();
      })
    );
  }
  return order;
}

// ============================================================================
// Scenarios
// ============================================================================

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  await client.connect();

  try {
    // ------------------------------------------------------------------
    console.log("=== (a) BROKEN: lookup dep at from-depth 1 mis-staged ===");
    const project = new Project({ name: "spike", models: [modelB] });
    console.log(
      "discovered:",
      project
        .getModels()
        .map((m) => m.name)
        .join(", ")
    );
    console.log("plan:\n" + project.plan().toString());
    console.log("mermaid (note: NO model_c --> model_b edge):");
    console.log(project.toMermaid());

    const dbBrokenA = client.db("broken_a");
    await seed(dbBrokenA);
    const brokenOrder: string[] = [];
    const resA = await project.run({
      client,
      databaseName: "broken_a",
      onModelStart: (n) => brokenOrder.push(n),
    });
    console.log("start order:", brokenOrder.join(" -> "));
    console.log(
      "run success:",
      resA.success,
      "| modelsRun:",
      resA.modelsRun.join(", ")
    );
    console.log(
      "model_b output:",
      await readModelB(dbBrokenA),
      "  <-- EMPTY joins = bug"
    );

    // ------------------------------------------------------------------
    console.log("\n=== (b) BROKEN: targets misses lookup dependencies ===");
    console.log(
      'plan({targets:["model_b"]}):\n' +
        project.plan({ targets: ["model_b"] }).toString()
    );
    const dbBrokenT = client.db("broken_targets");
    await seed(dbBrokenT);
    const resB = await project.run({
      client,
      databaseName: "broken_targets",
      targets: ["model_b"],
    });
    console.log(
      "modelsRun:",
      resB.modelsRun.join(", "),
      " <-- model_c/model_d omitted"
    );
    console.log("model_b output:", await readModelB(dbBrokenT));

    // ------------------------------------------------------------------
    console.log("\n=== (c) BROKEN: lookup-edge cycle ===");
    // cyc_a lookups cyc_b; cyc_b's `from` is cyc_a. Pipelines are lazy, so the
    // circular JS reference is legal; the graph cycle is real.
    let cycB: InstanceType<typeof Model>;
    const cycA = new Model({
      name: "cyc_a",
      from: rawD,
      pipeline: (p) =>
        p.lookup({
          from: cycB,
          localField: "_id",
          foreignField: "_id",
          as: "loop",
        }),
      materialize: { type: "collection", mode: Model.Mode.Replace },
    });
    cycB = new Model({
      name: "cyc_b",
      from: cycA,
      pipeline: (p) => p.match({}),
      materialize: { type: "collection", mode: Model.Mode.Replace },
    });
    try {
      new Project({ name: "cycle-spike", models: [cycB] });
      console.log("Project constructed without error (cycle undetected!)");
    } catch (e) {
      const err = e as Error;
      console.log(
        `constructor threw ${err.constructor.name}: ${err.message.slice(0, 60)}`
      );
      console.log(
        " ^-- stack overflow in discovery, not a clean 'cycle' ValidationError"
      );
    }

    // ------------------------------------------------------------------
    console.log("\n=== FIXED: unified edge set ===");
    const models = discoverModels([modelB]);
    console.log("discovered:", [...models.keys()].join(", "));
    for (const [name, model] of models) {
      for (const { dep, kind } of directDeps(model)) {
        console.log(`edge: ${name} depends on ${dep.name} [${kind}]`);
      }
    }
    const allNames = [...models.keys()];
    const cycleCheck = detectCycleUnified(models);
    console.log("cycle:", cycleCheck ? cycleCheck.join(" -> ") : "none");
    const fixedStages = topoStages(buildUnifiedDeps(models, allNames));
    console.log(
      "plan:\n" +
        fixedStages.map((s, i) => `Stage ${i + 1}: ${s.join(", ")}`).join("\n")
    );
    const dbFixedA = client.db("fixed_a");
    await seed(dbFixedA);
    const fixedOrder = await runStages(models, fixedStages, client, "fixed_a");
    console.log("executed order:", fixedOrder.join(" -> "));
    console.log(
      "model_b output:",
      await readModelB(dbFixedA),
      "  <-- joins populated"
    );
    const sample = await dbFixedA
      .collection("model_b")
      .findOne({ _id: "b1" as never });
    console.log(
      "sample joined doc tag:",
      (sample as { cDocs?: { tag?: string }[] } | null)?.cDocs?.[0]?.tag
    );

    // ------------------------------------------------------------------
    console.log("\n=== FIXED: targets closure follows stage edges ===");
    const closure = targetsClosure(models, ["model_b"]);
    console.log('closure(["model_b"]):', closure.sort().join(", "));
    const targetStages = topoStages(buildUnifiedDeps(models, closure));
    const dbFixedT = client.db("fixed_targets");
    await seed(dbFixedT);
    const targetOrder = await runStages(
      models,
      targetStages,
      client,
      "fixed_targets"
    );
    console.log("executed order:", targetOrder.join(" -> "));
    console.log("model_b output:", await readModelB(dbFixedT));

    // ------------------------------------------------------------------
    console.log("\n=== FIXED: lookup cycle detected cleanly ===");
    const cycModels = discoverModels([cycB]);
    console.log(
      "discovery terminated; models:",
      [...cycModels.keys()].join(", ")
    );
    const cyc = detectCycleUnified(cycModels);
    console.log("cycle:", cyc ? cyc.join(" -> ") : "none (BUG if none)");
  } finally {
    await client.close();
    await mongod.stop();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

declare const process: { exitCode?: number };
