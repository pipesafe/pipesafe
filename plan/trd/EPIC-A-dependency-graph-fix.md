# EPIC-A — Dependency Graph Correctness Fix (lookup/unionWith edges are real edges)

## Overview

**Goal.** Make `Project`'s execution graph agree with its discovery graph: dependency edges introduced by `lookup`/`unionWith`/`graphLookup`/`facet` sub-pipelines ("stage edges") must participate in topological ordering, targets selection, and cycle detection exactly like `from` edges do. This is the P0 prerequisite named in [01-current-state-and-gaps.md](../01-current-state-and-gaps.md) §5.1 and [04-transform-roadmap.md](../04-transform-roadmap.md) §2; every doc-04/doc-05 feature (incremental models, manifest `parentMap`, `state:modified+`, selectors, the event log) sits on this graph.

**Scope.** `packages/manifold/src/project/Project.ts` only, plus its vitest suites and a changeset. One small additive API (edge enumeration with kinds) for downstream lineage consumers.

**Out of scope.** The `custom()` lineage hole (raw `$lookup`s inside `custom()` are invisible to `Pipeline._ancestorsFromStages` — documented residual, per doc 04 §2); selector mini-language (`+model`, tags — doc 04 §7); run-state/event log (doc 05); any `@pipesafe/core` change (ancestor tracking in `Pipeline` already works, verified at Pipeline.ts:141-146, 296-299, 584-588, 628-635).

**Spike:** [graph-fix.spike.ts](../spikes/graph-fix.spike.ts) — executed against mongodb-memory-server.

## Current behavior (verified against Project.ts)

Four code sites consume dependency information, and they disagree:

1. **Discovery** (constructor, Project.ts:118-131): follows **both** `getUpstreamModel()` and `getAncestorsFromStages().filter(isModel)`, recursively. Correct edge set, but recursive with the model added to the map only _after_ recursing into ancestors (Project.ts:130) — so any cycle is infinite recursion, see finding (c).
2. **Ordering** (`buildDependencyGraph`, Project.ts:474-490): per model, pushes **only** `getUpstreamModel()` (:482-485). Stage edges are dropped, so `topologicalSort` (:495-526) stages a model concurrently with (or before) its lookup dependency.
3. **Targets** (`getModelsToRun`, Project.ts:443-469): `addWithDeps` (:449-460) recurses **only** through `getUpstreamModel()` (:456-459). Lookup dependencies are silently omitted from targeted runs.
4. **Cycles** (`detectCycle`, Project.ts:531-569, called from `validate` :224): DFS follows **only** `getUpstreamModel()` (:543). Also `validate`'s orphan warning (:234-243) counts downstream consumers via `from` only, and missing-ref checking (:212-221) checks only the upstream model.

Execution (`run`, :309-347) trusts the plan: stages sequential, models within a stage in `Promise.allSettled` parallel — so a mis-staged lookup dependency is a genuine race/ordering bug, not a theoretical one.

## Spike findings

Ran `bun run tsx plan/spikes/graph-fix.spike.ts` (mongodb-memory-server, real aggregations, `$out` materializations). Fixture: `raw_d → model_d → model_c` (from-chain), `model_b` from `raw_b` with `lookup({ from: model_c, localField: "cId", foreignField: "_id", as: "cDocs" })` — i.e. the lookup target at from-depth 1, the shape existing tests never cover.

**(a) Mis-ordering, empirical.** Discovery found all three models, but:

```
plan:
Stage 1: model_d, model_b
Stage 2: model_c
start order: model_d -> model_b -> model_c
run success: true | modelsRun: model_d, model_b, model_c
model_b output: b1: cDocs.length=0, b2: cDocs.length=0
```

`model_b` aggregated before `model_c`'s collection existed, materialized **empty joins for every document**, and the run reported `success: true`. Silent wrong data, no error. `toMermaid()` also renders no `model_c --> model_b` edge (it draws from `buildDependencyGraph`, :434-437), so the advertised lineage is wrong too.

**(b) Targets miss lookup deps.** `plan({ targets: ["model_b"] })` = `Stage 1: model_b` only; `run({ targets: ["model_b"] })` on a fresh database executed just `model_b` (`modelsRun: model_b`) and again produced `cDocs.length=0`.

**(c) Lookup cycle — surprise, contradicts both plan docs.** Built `cyc_a` (lookups `cyc_b`) and `cyc_b` (`from: cyc_a`) — legal JS because pipelines are lazy closures. `new Project({ models: [cyc_b] })` threw:

```
constructor threw RangeError: Maximum call stack size exceeded
```

**This contradicts plan/01 §5.1(c) ("`validate()` cannot detect cycles through lookup edges") and plan/04 §2(3) ("a lookup cycle validates cleanly and deadlocks (or races) at run time").** Neither happens: construction never reaches `validate()` because the discovery walk itself (marks visited _after_ recursing) loops forever. Consequently plan/04's "the fix is mechanical: in `buildDependencyGraph`, `getModelsToRun`, and `detectCycle`, union the two dep sources" is **incomplete — there is a fourth fix site**: constructor discovery must be made cycle-safe (iterative worklist / mark-before-visit) or the clean `cycle` ValidationError is unreachable. Integrator note: docs 01/04 should be reconciled to this. Corollary: the existing from-only `detectCycle` is effectively dead code — a from-only cycle can't even be constructed in JS (eager constructor arg), and stage-edge cycles crash before it runs.

**Fix demonstrated.** The spike implements the candidate design standalone (`directDeps` / `discoverModels` / `buildUnifiedDeps` / `targetsClosure` / `detectCycleUnified` / `topoStages`) and re-runs the same cases:

```
edge: model_b depends on model_c [stage]
edge: model_c depends on model_d [from]
plan: Stage 1: model_d / Stage 2: model_c / Stage 3: model_b
executed order: model_d -> model_c -> model_b
model_b output: b1: cDocs.length=1, b2: cDocs.length=1   (joined tag present)
closure(["model_b"]): model_b, model_c, model_d
cycle case: discovery terminated; cycle: cyc_b -> cyc_a -> cyc_b
```

No dead ends; one design consequence beyond the plan docs: because a model can depend on the same upstream via both `from` and a lookup, edges must be **deduplicated by name for ordering** but **kept per-kind for lineage** — hence `DependencyEdge.kind` below.

## Tickets

### GRAPH-1: Unified dependency-edge extraction (single source of truth)

- **Priority** P0 | **Estimate** S | **Depends on** —
- **Context** Four sites in Project.ts each re-derive dependencies and disagree (see above). Everything downstream (manifest `parentMap`/`lookupDeps` in doc 04 §4, event-log lineage in doc 05 §2) needs one authoritative extraction.
- **Design** New module `packages/manifold/src/project/graph.ts`:
  ```ts
  export type EdgeKind = "from" | "stage";
  export type DependencyEdge = {
    dependent: string;
    dependency: string;
    kind: EdgeKind;
  };
  /** Direct model dependencies of one model, both kinds, in declaration order. */
  export function directModelDeps(
    model: Model<any, any, any, any>
  ): { dep: Model; kind: EdgeKind }[];
  ```
  Implementation is the spike's `directDeps`: `getUpstreamModel()` as `kind: "from"` plus `getAncestorsFromStages().filter(isModel)` as `kind: "stage"`. Non-model ancestors (Collections) are excluded here but remain available for source-freshness lineage later (doc 05 §4). Refactor `buildDependencyGraph`, `getModelsToRun`, `detectCycle`, and constructor discovery to call it (the actual call-site changes land in GRAPH-2/3).
- **Acceptance criteria**
  - [ ] `directModelDeps` returns both edge kinds; same-name upstream reachable via both `from` and lookup yields two edges (one per kind).
  - [ ] No remaining direct `getUpstreamModel()`/`getAncestorsFromStages()` calls in Project.ts graph logic outside `graph.ts`.
  - [ ] `missing_ref` validation (Project.ts:212-221) covers stage deps too.
- **Test plan** Unit tests on `directModelDeps` with from-only, lookup-only, unionWith, facet-sub-pipeline, and dual-kind fixtures.
- **Open questions** Should `graphLookup`'s self-referential `from` (a model graph-looking-up itself) be filtered as a self-edge or reported as a cycle? Spike didn't cover it; propose: self-edges ignored for ordering, warned in `validate()`.

### GRAPH-2: Cycle-safe discovery and cycle detection over all edge kinds

- **Priority** P0 | **Estimate** M | **Depends on** GRAPH-1
- **Context** Spike finding (c): a stage-edge cycle stack-overflows constructor discovery (Project.ts:118-131) before `validate()` runs. This is the fourth fix site plan/04 §2 misses.
- **Design** (1) Replace recursive `addModelWithAncestors` with the spike's iterative mark-before-visit worklist (`discoverModels`). Note this changes map insertion order (leaf-first instead of ancestors-first) — nothing may depend on `getModels()` order; verify or sort. (2) Rewrite `detectCycle` (Project.ts:531-569) to iterate `directModelDeps` (spike's `detectCycleUnified`), preserving the existing `ValidationError { type: "cycle" }` shape and `A -> B -> A` message format. (3) Keep `topologicalSort`'s stall check (:509-513) as a defensive backstop. (4) Duplicate-name hardening: discovery's `Map` keyed by name silently drops a _distinct_ model object sharing a name (the `duplicate_name` check at :199-209 can never fire from discovery); detect identity-vs-name mismatch during discovery and surface `duplicate_name`.
- **Acceptance criteria**
  - [ ] Lookup-edge cycle (spike fixture) produces a thrown construction error listing `cycle` with the member names — no `RangeError`.
  - [ ] Deep linear DAGs (1,000+ models) construct without stack growth.
  - [ ] Two distinct models named identically → `duplicate_name` error.
- **Test plan** vitest in `Project.validation.test.ts`-style suite: 2-node stage cycle, 3-node mixed from/stage cycle, self-lookup, deep-chain smoke test.
- **Open questions** Should cycle detection report _all_ cycles or first-found (current behavior)? First-found is fine for P0.

### GRAPH-3: Ordering and targets closure over unified edges

- **Priority** P0 | **Estimate** M | **Depends on** GRAPH-1
- **Context** Spike findings (a)/(b): `buildDependencyGraph` (Project.ts:474-490) and `getModelsToRun` (:443-469) follow `from` only → mis-staged parallel execution and incomplete targeted runs.
- **Design** `buildDependencyGraph` = spike's `buildUnifiedDeps` (dedupe dep names via `Set`; restrict to the selected subset as today). `getModelsToRun` targets walk = spike's `targetsClosure` (iterative, all edge kinds, `exclude` still prunes traversal). Orphan warning (:234-243) counts stage edges as downstream consumption. `toMermaidFromDeps` (:574-592) then renders stage edges automatically; style them distinctly (`-.->` for `kind: "stage"`) using per-kind info from GRAPH-1 rather than the deduped name list.
- **Acceptance criteria**
  - [ ] Spike fixture plans as `[[model_d],[model_c],[model_b]]` and a real run yields populated joins (assert `cDocs.length === 1`).
  - [ ] `run({ targets: ["model_b"] })` executes `model_d, model_c, model_b`.
  - [ ] `exclude` on a stage dependency prunes it (documented: dependent then reads the stale/absent collection — matches current `from` exclude semantics).
  - [ ] Mermaid output contains the stage edge.
- **Test plan** Extend `Project.run.test.ts` with depth-1 lookup fixture (execution-order assertions via `onModelStart` + output assertions), targets subset, unionWith variant, dual-kind (from+lookup same upstream) staging.
- **Open questions** Should excluding a stage dependency warn at plan time? Propose a `ValidationWarning`-style note in `ExecutionPlan` later; not blocking.

### GRAPH-4: Regression test suite + fixtures pinning graph semantics

- **Priority** P0 | **Estimate** M | **Depends on** GRAPH-2, GRAPH-3
- **Context** Current tests pass only because every lookup target is from-depth 0 (plan/01 §5.1). Doc 04's whole phasing table keys off "§2's graph is correct" — pin it.
- **Design** New `packages/manifold/src/project/Project.graph.test.ts` + shared fixtures module (port the spike's model shapes): depth-1 lookup, lookup chain (B lookups C, C lookups D), unionWith dep, facet-sub-pipeline lookup dep, mixed-kind cycle, targets/exclude matrix, mermaid snapshot. Real-Mongo cases use mongodb-memory-server like existing suites; pure-graph cases assert on `plan()` only (fast).
- **Acceptance criteria**
  - [ ] Every spike scenario (a)-(c) exists as a failing-before/passing-after test.
  - [ ] Order-sensitive assertions use recorded `onModelStart` sequence, not stage arrays alone.
- **Test plan** Is the test plan. Run via package-scoped vitest; CI-safe with memory server.
- **Open questions** —

### GRAPH-5: Public edge enumeration API (lineage consumers)

- **Priority** P1 | **Estimate** S | **Depends on** GRAPH-1
- **Context** Doc 04 §4's manifest needs `deps` vs `lookupDeps` split and `parentMap`; doc 05 §5's manifest/event log consumes "deps (including lookup edges)". Today the only lineage surface is Mermaid text.
- **Design** `Project.getDependencyEdges(): DependencyEdge[]` (full project, both kinds, stable order) exported alongside `EdgeKind` from `@pipesafe/manifold`'s index. `ExecutionPlan` additionally exposes `edges` for the selected subset. No serialization format here — the manifest artifact (doc 04 ticket land) owns that.
- **Acceptance criteria**
  - [ ] Spike fixture returns `[{dependent:"model_c",dependency:"model_d",kind:"from"},{dependent:"model_b",dependency:"model_c",kind:"stage"}]` (order-normalized).
  - [ ] Types exported from package index; documented in README/CLAUDE.md model section.
- **Test plan** Unit assertions per fixture; type-level assertion that `EdgeKind` is the closed union.
- **Open questions** Add `"union"` as a distinct kind now vs folding into `"stage"`? Spike used two kinds; splitting later is a breaking enum change for consumers — decide before export (lean: keep `"from" | "stage"`, add a `via?: "$lookup" | "$unionWith" | ...` detail field later).

### GRAPH-6: Changeset, behavior-change docs, and plan-doc reconciliation notes

- **Priority** P0 | **Estimate** S | **Depends on** GRAPH-2, GRAPH-3
- **Context** This is a bug fix with observable behavior changes: plans gain stages, `targets` runs _more_ models, previously-constructing cyclic projects (which crashed with `RangeError`) now throw a clean validation error, Mermaid gains edges.
- **Design** Changeset for `@pipesafe/manifold` — recommend **minor**, not patch: `targets` executing additional models and re-staged plans can change users' operational expectations (wall-time, write volume) even though every change is toward correctness; per CLAUDE.md's changesets guidance, "backward-compatible behavior change users can observe" fits minor. Core is untouched (no changeset). Docs: README/CLAUDE.md Project section gains "dependency edges" subsection (kinds, exclude semantics, `custom()` residual hole). Include a note for the roadmap integrator: plan/01 §5.1(c) and plan/04 §2(3) describe lookup-cycle behavior incorrectly (see Spike findings) and plan/04's three-site fix list needs the discovery site added — this ticket does not edit plan docs itself.
- **Acceptance criteria**
  - [ ] `.changeset/*.md` with minor bump and migration-free upgrade notes ("targeted runs now include lookup/unionWith dependencies").
  - [ ] `custom()` limitation documented where `Project` is documented.
- **Test plan** N/A (docs); changeset format lint via existing tooling.
- **Open questions** If maintainers insist on patch (pure bug fix policy), acceptable — but release notes must still call out the `targets` expansion prominently.
