# EPIC-H — Testing Framework (TRD)

## Overview

Bring dbt's testing model to manifold with a typed edge dbt cannot match: **data tests** are aggregation pipelines returning failing documents (0 rows = pass) whose field arguments are `FieldSelector<TOutput>`-typed, and **unit tests** mock a model's inputs with fixtures **type-checked against `TInput`/`TOutput` at authoring time**. Tests become first-class DAG nodes so `build` interleaves them with models and skips descendants on error. This TRD turns plan/04 §5 into tickets, grounded in an executed spike against real packages and a real MongoDB.

Links: `plan/04-transform-roadmap.md` §5 (also §2, §9); **`plan/spikes/typed-unit-tests.spike.ts` (EXECUTED, 7/7 runtime checks + tsc-verified type assertions)**; research brief `dbt.md` §3; `plan/05-orchestration-and-el-roadmap.md` §5 (build/CLI seam).

Parallel TRDs referenced: **EPIC-A graph fix** (test edges need the corrected graph), **EPIC-F state artifacts** (test nodes in the manifest; slim CI), **EPIC-G event log** (test results as events), **EPIC-I CLI** (`manifold test|build`).

## Spike findings

`bun run tsx plan/spikes/typed-unit-tests.spike.ts` (MongoDB memory server 7.0.24); type claims verified with a strict single-file `tsc --noEmit` run (flags in the spike header). H-numbers match the spike header.

- **H1 — the dbt convention ports directly and stays typed.** All four built-ins ran end-to-end: `unique` = `$group` by key + `$match {count: {$gt: 1}}` (output: `[{"_id":"e1","count":2}]`); `not_null` = `$match {field: {$eq: null}}` (also catches _missing_ fields — MongoDB semantics, desirable); `accepted_values` = `$nin`; `relationships` = `$lookup` + `$match {as: {$size: 0}}` + `unset` (found exactly the orphan `"ghost"`).
- **H2 — the type system pushes back on not_null, correctly.** `.match({ eventId: { $eq: null } })` on a non-nullable `string` field is a **compile error** (verified via `@ts-expect-error` + tsc). Consequence: typed generic tests probe fields _as declared_; hunting for out-of-contract data on non-nullable fields needs the framework to build raw stages internally (typed `FieldSelector` surface, untyped stage construction inside). This is a real design constraint for TEST-2, not a bug.
- **H3 — a dead end that wasn't.** We assumed the typed `lookup` would reject a `string | null` local field against `string _id` and drafted a `custom()` fallback — empirically wrong: the fully-typed `relationships` pipeline compiles with or without the `$ne: null` pre-match. No escape hatch needed (mild leniency note: nullable local fields join without complaint).
- **H4 — typed unit tests work as advertised.** Fixtures declared as `StgInput[]` fail compilation on a wrong-shaped row (`amount: "twelve"` — `@ts-expect-error` verified; note the directive must sit on the offending _property_ line, not above the object literal). `Model.getPipelineStages()` replays the transformation; an order-insensitive canonical diff produced actionable `missing`/`unexpected` output on an injected mismatch.
- **H5 — `$documents` is the better fixture path.** Db-level `db.aggregate([{ $documents: fixtures }, ...stages])` ran the model stages with **no collection and no `_id` injection** — actual output matched expected `TOutput[]` exactly as authored. Temp-collection seeding (`insertMany`) works everywhere but injects `ObjectId _id`, which leaked into results and required normalization before diffing. Verdict: `$documents` primary (MongoDB ≥ 5.1), temp collection fallback.
- **H5b — core gap discovered.** `.project({ _id: 0, ... })` is a compile error when the schema doesn't declare `_id` (brand: `Field '_id' is not on the schema.`), so a model **cannot strip the physical `_id` in-pipeline**. The unit-test runner (and `$merge`-mode users generally) must handle the implicit `_id` outside the type system. Worth a core follow-up ticket outside this epic.
- **H6 — missing generic plumbing.** Manifold exports `InferModelOutput` but **no `InferModelInput`**; the public phantom `Model["__inputType"]` works today and is what the spike used.

No contradictions with plan/04 §5 found; H2/H5b are refinements the plan doesn't anticipate.

## Tickets

### TEST-1: Tests as first-class DAG nodes

- **Priority** P1 | **Estimate** L | **Depends on** **EPIC-A graph fix** (synthetic test edges sit on the corrected graph); manifest emission via **EPIC-F** STATE-3; results via **EPIC-G event log**
- **Context**: dbt's `build` semantics: tests attach to a model, run after it, and an _error_-severity failure skips the model's descendants (`add_test_edges`).
- **Design**: `ModelConfig` gains `tests?: ModelTest<TOutput>[]` (`packages/manifold/src/model/Model.ts`); `Project` materializes each as a node `test:<model>.<name>` with an edge from its model (plus edges to any other source it reads, e.g. `relationships` foreign source). Config: `severity: "warn" | "error"` (default error), `warnIf`/`errorIf` count thresholds, `where` pre-filter (typed `MatchQuery<TOutput>`), `storeFailures` → failing docs `$merge`d into `_manifold_test_failures.<testId>`. `project.run()` unchanged; new `project.build()` interleaves and skips descendants on error-severity failure.
- **Acceptance criteria**: failing error-severity test skips descendants (run-results show `skipped`); warn severity doesn't; `storeFailures` collection populated; test nodes appear in manifest with `pipelineHash`.
- **Test plan**: memory-server integration on the example DAG with an injected duplicate; unit tests for threshold logic.
- **Open questions**: test node naming scheme stability (manifest key = selector token).

### TEST-2: Built-in generic tests API

- **Priority** P1 | **Estimate** M | **Depends on** TEST-1 (config shape); standalone runner usable before it
- **Context**: Spike H1–H3: all four built-ins run typed today; `not_null` on non-nullable fields needs internal raw-stage construction (H2).
- **Design**: `packages/manifold/src/testing/generic.ts` exporting `t.unique(field)`, `t.notNull(field)`, `t.acceptedValues(field, values)`, `t.relationships(field, source, foreignField)` — `field: FieldSelector<TOutput>` (typo = compile error), `values` typed to the field's type. Internally build stage arrays directly (spike shapes), not through the typed builder, so declared-type constraints (H2) can't block violation-hunting; the typed surface is the API boundary. Each returns `{ name, buildStages(target): Document[] }`.
- **Acceptance criteria**: spike part (a) behaviors reproduced via the API; `t.unique("typo")` fails compilation (type-assertion test).
- **Test plan**: port spike seed data into `packages/manifold/src/testing/*.test.ts`; type assertions file for field-selector errors.
- **Open questions**: composite-key `unique(["a","b"])`; should `relationships` auto-exclude nulls (spike does; dbt does via separate not_null) — yes, document it.

### TEST-3: Singular (custom) tests

- **Priority** P2 | **Estimate** S | **Depends on** TEST-1
- **Context**: dbt's one-off tests; manifold version is just a named pipeline builder.
- **Design**: `t.custom(name, (p: Pipeline<TOutput, TOutput>) => Pipeline<TOutput, Document>)` — full typed pipeline over the model's output, returning failing docs. Escape hatch to `custom()` stages inside remains available.
- **Acceptance criteria**: custom test with `$expr`/`$$NOW`-style logic runs and reports; participates in severity/storeFailures identically.
- **Test plan**: one integration case (e.g. "no future events").
- **Open questions**: none.

### TEST-4: Typed unit-test runner

- **Priority** P1 | **Estimate** L | **Depends on** — (parallel to TEST-1); **EPIC-F** STATE-2 hash optionally links unit-test coverage to pipeline versions
- **Context**: The flagship differentiator (spike H4–H6): fixtures that don't compile when wrong, executed on real engine semantics without real data.
- **Design**: `packages/manifold/src/testing/unit.ts`: `unitTest(model, { given: TInput[], lookups?: { [source]: docs[] }, expect: TOutput[] })`. Execution: db-level `aggregate([{ $documents: given }, ...model.getPipelineStages()])` in a scratch database (H5); **temp-collection fallback** for MongoDB < 5.1 with `_id` normalization (strip driver-injected `_id` unless `TOutput` declares one — H5/H5b). Models containing `lookup`/`unionWith` need their foreign sources mocked: seed named collections in the scratch db (collection names are db-relative, so no stage rewriting needed) — `$documents` covers only the primary input. Order-insensitive canonical diff with `missing`/`unexpected` reporting (spike shape). Add `InferModelInput<M>` export to manifold (H6). Ships as a plain function usable from any test framework (bun test, vitest).
- **Acceptance criteria**: spike part (b) reproduced via API on both paths; bad fixture is a compile error (type-assertion file); a lookup-bearing model tests green with mocked foreign docs.
- **Test plan**: memory-server integration incl. lookup mocking; type assertions for `given`/`expect` shape errors; failure-output snapshot.
- **Open questions**: ordered comparison opt-in for `$sort`-terminated models; should the runner spin up its own memory server or require an injected client (lean toward injected, with a `withMemoryServer()` helper)?

### TEST-5: CLI & reporting integration

- **Priority** P2 | **Estimate** M | **Depends on** **EPIC-I CLI**, TEST-1/2/4, **EPIC-G event log** (event shapes)
- **Context**: plan/05 §5: `manifold test` / `manifold build --json` stream NDJSON per node; test results are events.
- **Design**: test start/pass/warn/fail events reuse EPIC-G `ManifoldEvent` shapes; run-results `testResults` per model (EPIC-F STATE-4); exit codes: 0 pass, 1 error-severity failure, distinct code for warn-only.
- **Acceptance criteria**: `manifold build --json` output parseable line-by-line; failure counts and `storeFailures` collection names included.
- **Test plan**: CLI snapshot test on the example project.
- **Open questions**: JUnit XML export for CI systems — cheap, decide at implementation.

### TEST-6: Slim CI recipe (docs + fixture repo path)

- **Priority** P2 | **Estimate** S | **Depends on** **EPIC-F** STATE-5 (state:modified+, defer), TEST-1 (`build`)
- **Context**: The composed workflow that makes everything above sticky: PR CI builds only changed models + descendants, runs their tests, defers unchanged upstreams to prod.
- **Design**: documented recipe + example GitHub Actions workflow: nightly job uploads `.manifold/` artifacts; PR job runs `manifold build --select state:modified+ --defer --state ./prod-artifacts` against an ephemeral database; unit tests run pre-deploy with no database dependency beyond memory server / `$documents`.
- **Acceptance criteria**: recipe executes end-to-end in the repo's own CI against memory server; documented in the docs site plan (plan/06).
- **Test plan**: CI dry-run job in this repo.
- **Open questions**: none — pure composition of prior tickets.
