# 04 — Transform Layer Roadmap: Manifold as dbt for MongoDB

This document charts how `@pipesafe/manifold` evolves from a "rebuild-the-world" DAG runner (see doc 01) into a credible dbt competitor for MongoDB: incremental models, microbatch, state artifacts, tests, snapshots, and graph selection. Scope discipline: **this doc covers what a single `run` computes** — delta logic, test evaluation, state-based selection. **How runs are executed, scheduled, retried at the executor level, and observed lives in doc 05.** API sketches here are illustrative; runnable-shaped versions live in `plan/spikes/`.

## 1. Goal & positioning: dbt for MongoDB, without Jinja

dbt's core insight is that the dependency graph should be a free by-product of writing the transformation. Manifold already has this — `Project` auto-discovers edges from `from` and `lookup`/`unionWith` — and does it with **typed object references instead of stringly `ref()`**: a typo'd model reference is a compile error, not a parse-time surprise. Materializations also map cleanly: dbt's `table` is `$out` (`Model.Mode.Replace`), `merge` is `$merge` with `whenMatched: "replace"` (`Model.Mode.Upsert`), insert-only merge is `Model.Mode.Append`. MongoDB's `$merge` (`whenMatched: replace|keepExisting|merge|fail|[pipeline]` × `whenNotMatched: insert|discard|fail` × `on:`) is _richer_ than any single dbt strategy.

The strategic validation is dbt Fusion: dbt Labs spent an acquisition and a multi-year Rust rewrite (forked DataFusion, per-dialect ANTLR lexers, a typechecker bolted onto Jinja) to buy static comprehension of its transformation language. Manifold gets that comprehension free from TypeScript — pipeline output types are inferred stage-by-stage, renames break downstream models at compile time, and pipelines are structured data (deterministically hashable, statically analyzable). Our job is to _surface_ that comprehension as features (state selection, lineage, grain inference), not leave it implicit in `tsc`.

**Decision: adopt dbt vocabulary wholesale** — model, incremental, full refresh, microbatch, snapshot, unit test, `state:modified`, defer. 100k+ practitioners think in these terms; migration should be translation, not education.

## 2. Prerequisite fix (P0): lookup edges are real dependency edges

`Project.buildDependencyGraph` (`packages/manifold/src/project/Project.ts:474-490`) adds only the `from` edge per model, while _discovery_ (constructor, `Project.ts:118-131`) correctly follows `getAncestorsFromStages()`. Three concrete bugs follow: (1) a model that `lookup`s from a sibling can be scheduled **before or concurrently with** it — a correctness race; (2) `getModelsToRun` with `targets` (`Project.ts:443`) walks only the `from` chain, so targeted runs silently omit lookup dependencies; (3) `detectCycle` ignores lookup edges, so a lookup cycle validates cleanly and deadlocks (or races) at run time.

The fix is mechanical: in `buildDependencyGraph`, `getModelsToRun`, and `detectCycle`, union `getUpstreamModel()` with `getAncestorsFromStages().filter(isModel)`. Every feature below (targets computation, `state:modified+`, test edges, manifest `parentMap`) sits on this graph, so it ships first, with regression tests where a lookup target sits deeper than depth 0. Known residual hole to document: `custom()` stages don't thread ancestors, so hand-written `$lookup`s inside `custom()` remain invisible to the graph.

## 3. Incremental models (P0) and microbatch (P0.5)

This is the #1 gap. Today `Upsert`/`Append` merge the _whole recomputed source_ every run; there is no "only process documents since last run." Without it manifold loses every cost/latency conversation.

dbt's decomposition is the right one: **incremental = (user-supplied delta filter) + (framework-supplied apply strategy)**. The delta filter is dbt's `is_incremental()` + `{{ this }}` dance; manifold replaces it with a typed context callback:

```ts
const stgEvents = new Model({
  name: "stg_events",
  from: rawEvents,
  pipeline: (p, ctx) =>
    p
      .match(
        ctx.isIncremental ?
          { receivedAt: { $gt: ctx.watermark("receivedAt") } } // max in target
        : {}
      )
      .set({ day: { $dateTrunc: { date: "$receivedAt", unit: "day" } } }),
  materialize: {
    type: "collection",
    mode: Model.Mode.Incremental({
      strategy: "merge", // "append" | "merge" | "deleteInsert"
      on: ["eventId"], // unique_key; typed against TOutput
      mergeFields: ["status"], // merge_update_columns analog (optional)
      onSchemaChange: "ignore", // "ignore" | "fail" (see §9)
    }),
  },
});
```

`ctx.watermark(field)` is typed `FieldReferencesThatInferTo<TOutput, Date | number>` and compiles to a pre-run `max` query against the target (dbt's `select max(event_time) from {{ this }}`); `ctx.isIncremental` is false on first run and under `run({ fullRefresh: true })`, exactly dbt's guard semantics. Strategies map onto `$merge` configs the presets already use: `append` → `whenMatched: "fail"` is wrong for reprocessing, so append = `whenNotMatched: "insert", whenMatched: "keepExisting"`; `merge` → `on: keys, whenMatched: "merge"|"replace"`; `deleteInsert` → `deleteMany` on matched keys then insert (document the non-atomicity, as dbt does). Note `$merge` `on:` requires a unique index on the key fields — the framework creates it on first materialization.

**Microbatch (P0.5, differentiator).** dbt 1.9's newest flagship is _cheaper_ to build on aggregation pipelines than it was on SQL: config `{ eventTime, batchSize: "hour"|"day"|"month", lookback, begin }`; the runner splits the requested range into independent, idempotent time-window batches; the event-time `$match` is **auto-prepended** to the model's pipeline _and_ pushed into upstream reads (in dbt this required resolver surgery in `providers.py`; for us it's array prepend on structured stages). Each batch applies with delete-window-then-`$merge` — a full-window replacement, so retries and backfills are idempotent, batches parallelize, and a failed run retries only failed batches (per-batch results persist in run-results, §4; batch _scheduling/parallelism_ mechanics belong to doc 05). This pairs naturally with time-series collections (`TypedTimeSeriesOptions` already exists in `Model.ts`). Backfill: `run({ eventTimeStart, eventTimeEnd })`.

Full API sketch: `plan/spikes/incremental-model-api.spike.ts`.

## 4. State artifacts (P1): manifest + run-results

dbt's manifest is its public API — CI selection, `defer`, retry, and every orchestrator integration consume it. Manifold needs the equivalent, and can beat dbt on the core primitive: dbt compares models by **raw source text** (`same_body`), a chronic false-positive generator that Fusion needed a full SQL frontend to fix. Manifold pipelines are structured objects, so a **canonical-JSON hash of the built stage array** gives semantic, formatting-insensitive comparison for free.

```jsonc
// .manifold/manifest.json (schema versioned independently of runtime classes)
{
  "schemaVersion": 1,
  "metadata": {
    "manifoldVersion": "1.1.0",
    "generatedAt": "...",
    "invocationId": "...",
  },
  "models": {
    "stg_events": {
      "pipelineHash": "sha256:…", // canonical hash of built stages (delta filter in canonical form)
      "materialize": {
        "type": "collection",
        "mode": { "$merge": { "on": ["eventId"] } },
      }, // unresolved: no env db names
      "output": { "db": null, "collection": "stg_events" },
      "deps": ["raw_events"],
      "lookupDeps": [],
      "tags": ["staging"],
    },
  },
  "parentMap": { "daily_metrics": ["stg_events"] },
  "childMap": { "stg_events": ["daily_metrics"] },
}
```

Three dbt decisions copied verbatim: (1) store configs **unresolved** (dbt's `unrendered_config`) so env-specific database names don't pollute state diffs; (2) version the artifact schema explicitly with upgrade shims; (3) `run-results.json` stores the full invocation options so `retry` needs no external memory. Run-results per model: `{ status, startedAt, executionTimeMs, mergeStats, error?, batches?: [{start, end, status}] }` — `batches` is what makes microbatch retry re-run only failed windows.

What this unlocks: `--select state:modified+` (hash diff against a prior manifest, plus config diff), **defer** (unselected upstream reads remapped to the prod namespace recorded in the prod manifest — dbt's `merge_from_artifact`), and `retry` (re-run nodes whose last status ∈ {error, skipped}). That composes into the slim-CI recipe that is dbt's stickiest workflow: _build only what changed and its descendants, reading unchanged upstreams from prod_. Schema and selection logic: `plan/spikes/manifest-artifact.spike.ts`.

## 5. Testing (P1): data tests as pipelines, typed unit tests

dbt's convention — **a test is a query returning failing rows; zero rows = pass** — translates directly to aggregation, and the four built-in generics are typed one-liners:

```ts
tests: [
  t.unique("eventId"), // $group by key, $match count > 1
  t.notNull("userId"), // $match { userId: null } (+ $exists)
  t.acceptedValues("status", ["a", "b"]), // $match { status: { $nin: [...] } }
  t.relationships("userId", users, "_id"), // $lookup + $match empty join
  t.custom("no_future_events", (p) =>
    p.match({ receivedAt: { $gt: "$$NOW" } })
  ),
];
```

Field arguments are `FieldSelector<TOutput>` — a typo'd test column is a compile error, which dbt YAML cannot offer. Cross-cutting config mirrors dbt: `severity: "warn" | "error"`, `warnIf`/`errorIf` thresholds, `storeFailures` (failing docs `$merge`d into an audit collection `_manifold_test_failures.<test>`), `where` pre-filter. Tests are DAG nodes: a `build` command interleaves them and skips descendants when an upstream test errors (synthetic test edges, per dbt's `add_test_edges`; execution mechanics in doc 05).

**Typed unit tests are the flagship differentiator.** dbt 1.8 unit tests mock inputs with YAML/CSV fixtures that nothing validates until the warehouse runs them. Manifold fixtures are TypeScript values **type-checked against `TInput` and `TOutput` at authoring time** — a wrong-shaped fixture doesn't compile. This is _structurally impossible_ in dbt: it has no host type system to check against. Execution runs the pipeline against fixture docs via `$documents` (or a temp collection) on `mongodb-memory-server` or a live server — real engine semantics, no real data.

## 6. Snapshots / SCD2 (P2)

`Model.Mode.Snapshot({ key, strategy })` reproduces dbt's snapshot semantics on `$merge`: meta-fields `scdId`, `validFrom`, `validTo` (null = current), `updatedAt`; strategies `{ kind: "timestamp", updatedAt: field }` (compare source timestamp to stored `validFrom`) and `{ kind: "check", fields: [...] | "all" }` (compare field values via `$lookup` against the target); `hardDeletes: "ignore" | "invalidate" | "newRecord"`. Each run classifies docs insert/update/delete and applies one `$merge` pass closing intervals and inserting new current rows. The typed win dbt can't express: the materialized type is automatically `TOutput & ScdFields` — downstream models see the meta-fields in their schema.

## 7. Selectors & graph ops (P1/P2)

dbt's selector mini-language is the daily-touch surface; adapt it to both the CLI and the programmatic API. P1: exact name, `tag:staging`, graph operators `+model`, `model+`, `+model+`, `2+model`, `--exclude`, set union/intersection — all cheap once §2's graph is correct. `state:modified` (§4) plugs in as another selector method. P2: `@model` (CI env building), `result:error` from run-results, named selectors in config. Programmatically, selection accepts typed model references (`project.run({ select: [dailyMetrics, "+stg_events"] })`) — refactor-safe where dbt is stringly; strings remain for CLI parity.

## 8. Fusion-inspired extras (P2/P3)

- **Grain inference (P2, novel).** Fusion statically infers each model's grain from the outermost `GROUP BY` (`PlanGrainInfo`). Manifold reads the terminal `$group` `_id` from the built stage array to **auto-derive the `$merge on:` key** for incremental models — `on` becomes optional-with-inferred-default — and to _validate_ a user-supplied `on` against the actual grain, turning dbt's most common incremental misconfiguration into a build error or an inference.
- **Static field-level lineage (P3).** The type system already knows field provenance stage-by-stage; materialize it as an explicit artifact (Fusion's `CllEdge {fromNode, fromField, toNode, toField, op}` schema) in the manifest, feeding the docs site (doc 06) and impact analysis. Beats dbt Core v1 outright; matches Fusion's headline feature without a parser.

## 9. Phasing & risks

| Phase | Item                                                                     | Depends on  |
| ----- | ------------------------------------------------------------------------ | ----------- |
| P0    | Lookup/unionWith edges first-class in graph (§2)                         | —           |
| P0    | `Model.Mode.Incremental`: delta context, strategies, `on`, `fullRefresh` | §2          |
| P0.5  | Microbatch: windows, auto-injected filters, backfill range               | Incremental |
| P1    | Manifest + run-results artifacts; `state:modified`, defer, retry         | §2          |
| P1    | Data tests + `build` semantics; typed unit tests                         | §2          |
| P1    | Selectors: name/tag/graph ops/exclude                                    | §2          |
| P2    | Snapshots (SCD2); `state:` sub-selectors, `result:`; grain inference     | Manifest    |
| P3    | Field-level lineage artifact; ephemeral (stage-inlining) models          | Manifest    |

**Risks.**

- _Delta-detection expressiveness._ dbt users write arbitrary SQL in the `is_incremental()` block; our typed `ctx` initially supports watermark comparisons only. Mitigation: `ctx` returns typed values usable in any `match` expression, and `custom()` remains the escape hatch (accepting its lineage hole).
- _`$merge` edge cases._ `on:` requires a unique index (framework-managed, but racy on concurrent first runs); `whenMatched: "fail"` aborts mid-stream non-transactionally; delete+insert is non-atomic; cross-database `$out` lacks the atomic swap same-db `$out` gives free. Each strategy's docs must state its atomicity contract explicitly.
- _Schema drift._ Fivetran/dlt handle drift at runtime by mutating targets; dbt bolts on `on_schema_change`. Manifold's third pole: **drift between models is a compile-time error** — a pipeline change that alters `TOutput` breaks downstream models before anything runs. What remains runtime is drift between `TOutput` and _existing materialized documents_ (old-shape docs after a logic change): `onSchemaChange: "ignore"` (Mongo-natural, default) or `"fail"` (compare a sampled/`$jsonSchema` shape). Full-refresh is the documented remedy, and typed unit tests catch shape regressions pre-deploy.
- _Compile-cost ceiling._ Doc 01 notes TS2589 depth risks on large schemas; incremental/test surfaces add generics. Every new API goes through the existing instantiation-count benchmark harness before release.
