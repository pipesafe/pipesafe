# EPIC-F — State Artifacts & Selectors (TRD)

## Overview

Manifold needs dbt's stickiest workflow surface: a versioned **manifest** artifact (the serialized graph), a **run-results** artifact (per-invocation outcomes), and the selection features they unlock — `state:modified+`, `--defer`, `retry`, and a selector grammar. The core primitive is a **canonical-JSON sha256 hash of the built stage array**, which beats dbt's raw-text `same_body` comparison because manifold pipelines are structured data. This TRD turns plan/04 §4 and §7 into tickets, grounded in an executed spike.

Links: `plan/04-transform-roadmap.md` §4, §7, §9; `plan/05-orchestration-and-el-roadmap.md` §5 (host seam); `plan/spikes/manifest-artifact.spike.ts` (illustrative sketch, unexecuted); **`plan/spikes/pipeline-hash.spike.ts` (EXECUTED, 22/22 checks)**; research brief `dbt.md` §6.

Parallel TRDs referenced below: **EPIC-A graph fix** (lookup edges become real dependency edges), **EPIC-E incremental** (watermark context, microbatch), **EPIC-G event log** (`_manifold.events` run-state), **EPIC-H testing** (test nodes appear in the manifest), **EPIC-I CLI**.

## Spike findings

`bun run tsx plan/spikes/pipeline-hash.spike.ts` — all 22 checks pass. Highlights (F-numbers match the spike header):

- **F1 — no new read API is needed, but the existing one is unsafe to hand out.** `Pipeline.getPipeline()` and `Model.getPipelineStages()`/`buildPipeline()` are public and return the built stage array. However `getPipeline()` returns the **live internal array** (a pushed stage was visible on re-read), and stage objects are **shared across chained Pipeline instances** (shallow `[...spread]` in `_chain`) — verified by identity check. A serialization consumer that mutates what it got corrupts the builder.
- **F2 — terminal pipelines are unreadable at the type level.** After `.merge()`/`.out()`, `PreviousStageDocs = never`, so `getPipeline()` types as `never` and needs `as unknown as Document[]`. Model works around this internally; artifact writers should not have to.
- **F3 — `buildPipeline()` is env-resolved.** Spike output: `{"$merge":{"on":"_id",...,"into":{"db":"prod_analytics","coll":"stg_events"}}}`. Hashing `buildPipeline()` would make prod-vs-CI manifests differ on every model. Hash `getPipelineStages()` (no output stage) plus a separate unrendered `configHash` — confirms plan/04's "unrendered" rule empirically.
- **F4 — "canonical JSON for free" is an overstatement; flagging a contradiction with plan/04 §4 and the manifest-artifact sketch.** RegExp survives into real stage arrays as a live `RegExp` (`.match({ name: /foo/i })`), and naive `JSON.stringify` serializes it as `{}`: the spike **demonstrated two different regexes hashing identical**, and a `Date` colliding with its own ISO string. The sketch's `canonicalize()` in `manifest-artifact.spike.ts` handles only `Date` — insufficient. The canonicalizer must emit tagged forms (`$regex`/`$options` with sorted flags, `$date`, `$oid`, generic `_bsontype` fallback).
- **F5 — functions must be rejected, not ignored.** Functions can enter stages via `custom()` payloads (e.g. `$where`); `JSON.stringify` silently drops them — the spike demonstrated `[{ $match: { $where: fn } }]` colliding with `[{ $match: {} }]`. The canonical hash throws `TypeError` instead. No closures appear in stages built by the typed builders themselves.
- **F6 — the hash behaves.** Insensitive to object-key insertion order; **identical across separate OS processes** (`sha256:v1:57442823…3ec31892` from parent and spawned child); sensitive to `$gt: 5 → 6`; `custom()` stages (plain documents, including `ObjectId`) hash deterministically.
- **F7 — selection is pure data.** `state:modified` (hash diff of two snapshots of a real 3-model DAG detected exactly the edited model), `state:modified+` descendant expansion (correctly pulled in `daily_metrics` **via its lookup edge on `user_dim`'s childMap entry from `from`-edge** — both edge kinds walked), and retry-failed selection (error + `partialSuccess` models, failed microbatch windows only) all ran as pure functions over `{pipelineHash, configHash, childMap}` + a run-results doc. No runtime classes needed by consumers.
- **F8 — deps are extractable today.** `getUpstreamModel()` + `getAncestorsFromStages().filter(isModel)` gave correct `deps`/`lookupDeps` per node. The EPIC-A fix is needed inside `Project`, not for manifest emission.

**Dead ends / surprises:** none fatal; the surprise was how bad naive JSON is (three silent-collision classes: RegExp, Date-vs-string, dropped functions). Also `getPipeline()`'s liveness — undocumented and easy to misuse.

## Tickets

### STATE-1: Public pipeline serialization contract in @pipesafe/core

- **Priority** P1 | **Estimate** S | **Depends on** —
- **Context**: Spike findings F1/F2: stages are readable but via a live, mutation-hazardous array that types as `never` on terminal pipelines.
- **Design**: Add `Pipeline.toStages(): readonly Document[]` in `packages/core/src/pipeline/Pipeline.ts` — deep structural copy (preserving `Date`/`RegExp`/BSON instances, not JSON round-trip), callable regardless of `PreviousStageDocs` (declared on a `Pipeline<any, any, any, any>`-safe overload, no `never` conditional). Document `getPipeline()` as internal-ish/live. Model (`packages/manifold/src/model/Model.ts`) gains nothing new but its docs state: `getPipelineStages()` = unresolved user stages (hash input), `buildPipeline()` = resolved executable pipeline.
- **Acceptance criteria**: mutating `toStages()` result never affects the builder or chained descendants; terminal pipelines serialize without casts; changeset (`@pipesafe/core` minor).
- **Test plan**: unit tests mirroring spike checks F1/F1b/F2; type assertion that `toStages()` compiles after `.merge()`.
- **Open questions**: also `Object.freeze` in dev builds?

### STATE-2: Canonical pipeline hash implementation + versioning

- **Priority** P1 | **Estimate** S | **Depends on** STATE-1
- **Context**: The comparison primitive for everything else. Spike F4–F6 give the exact rules and a working reference implementation (`canonicalJson`/`canonicalPipelineHash` in the spike).
- **Design**: `packages/manifold/src/state/hash.ts`: sorted object keys; drop `undefined`-valued keys; tagged forms `{$date}`, `{$regex,$options}` (flags sorted), `{$oid}`, generic `{$bson,$value}` via `_bsontype`, `{$undefined}` in arrays, `{$nonFinite}`; **throw on functions**. Output format `sha256:v<HASH_VERSION>:<hex>`; `HASH_VERSION` bumps on any canonicalization change and the manifest records it so consumers never diff across hash versions (treat as "all modified"). Consider `bson`'s `EJSON.stringify({relaxed:false})` for tagging — but it does not sort keys, so we keep our own canonicalizer.
- **Acceptance criteria**: all spike §3 properties as unit tests (order-insensitivity, cross-process stability, semantic sensitivity, RegExp/Date/ObjectId discrimination, function rejection).
- **Test plan**: port spike checks; golden-hash fixture pinned in a test to catch accidental canonicalization drift.
- **Open questions**: does `canonicalJson` belong in Apache-licensed core (useful generally) with only the artifact writers in ELv2 manifold? Default: manifold, revisit with plan/06.

### STATE-3: Manifest writer (`.manifold/manifest.json`)

- **Priority** P1 | **Estimate** M | **Depends on** STATE-1, STATE-2, **EPIC-A graph fix** (childMap must include lookup edges), EPIC-H (test nodes)
- **Context**: The host-seam artifact (plan/05 §5). Schema sketched in `manifest-artifact.spike.ts` and validated shape-wise by the executed spike's mini-manifest.
- **Design**: `packages/manifold/src/state/manifest.ts`; `Project.writeManifest(dir)` (and used by EPIC-I CLI). Schema v1: `metadata {manifoldVersion, coreVersion, hashVersion, generatedAt, invocationId, projectName}`; per model: `pipelineHash` (over `getPipelineStages()`), `configHash` (over materialize config with `db` stripped — spike F3), `materialize` summary, `output {db: null | string, collection}` (unresolved), `deps`, `lookupDeps`, `sourceCollections`, `tags`; `tests` nodes (EPIC-H); precomputed `parentMap`/`childMap` over the union of both edge kinds.
- **Acceptance criteria**: manifest for the example DAG is byte-identical across runs (modulo metadata); prod-vs-CI manifests of the same code diff empty; lookup deps present.
- **Test plan**: snapshot test on `packages/manifold/examples/model-dag-example.ts` graph; diff test with different `defaultDatabase`.
- **Open questions**: where do `tags` live on `ModelConfig` (new field — small core-adjacent API addition)?

### STATE-4: Run-results writer as a projection of the EPIC-G event log

- **Priority** P1 | **Estimate** M | **Depends on** **EPIC-G event log**; EPIC-E (batch results)
- **Context**: Two proposed stores overlap: `run-results.json` (this epic) and `_manifold.events` (EPIC-G). **Decision: the event log is the source of truth; `run-results.json` is a derived, file-shaped projection of one invocation's events**, written at invocation end (and rebuildable from the log). One writer, two sinks; identical status vocabulary (`success | error | skipped | partialSuccess`).
- **Design**: `packages/manifold/src/state/runResults.ts`. Schema per `manifest-artifact.spike.ts` §2: `invocationOptions` verbatim (dbt's retry trick), per-model `{status, startedAt, executionTimeMs, mergeStats?, error?, batches?}`. Today's `ProjectRunResult`/`ModelRunStats` (`packages/manifold/src/project/Project.ts`) are too thin — extend `ModelRunStats`, keep backward compat.
- **Acceptance criteria**: `retry` (STATE-5) can be computed from the file alone; file contents reconstructable from `_manifold.events` for the same `invocationId`.
- **Test plan**: run example project against `mongodb-memory-server`, assert file schema; failure-injection run asserts `error`/`skipped` statuses.
- **Open questions**: `partialSuccess` requires microbatch (EPIC-E) — land field as optional now.

### STATE-5: state:modified / defer / retry selection engine

- **Priority** P1 | **Estimate** L | **Depends on** STATE-3, STATE-4, **EPIC-A graph fix**
- **Context**: Spike §4–5 proved the algorithms as pure functions; this ticket productionizes them behind `Project.run()`.
- **Design**: `packages/manifold/src/state/selection.ts`: `selectStateModified(current, previous)` → `Map<name, "body"|"configs"|"added">`; `expandDescendants`; `resolveDeferBindings(selected, prodManifest, prodEnv)` → per-model `{db, collection}` overrides applied at source-resolution time (Model source reads remapped — needs a `SourceBindingOverride` hook where `Model.getSourceCollectionName()`/lookup targets resolve); `computeRetrySelection(runResults)` incl. failed microbatch windows. New `RunOptions`: `{ state?: string, defer?: boolean, select?: (string | Model)[] }`.
- **Acceptance criteria**: slim-CI flow works end-to-end on memory server: edit one model → only it and descendants rebuild, unchanged upstream read from "prod" db; `retry` after injected failure re-runs only failed/skipped.
- **Test plan**: integration test scripting the spike §4 scenario through real `Project.run`; hash-version-mismatch manifests → everything selected + warning.
- **Open questions**: defer for **lookup** targets requires rewriting the `from` collection name inside built `$lookup` stages — structured stages make this safe, but decide rewrite-at-build vs rewrite-at-resolve.

### STATE-6: Selector grammar

- **Priority** P1 | **Estimate** M | **Depends on** STATE-5 (for `state:`/`result:` methods), **EPIC-A graph fix** (graph ops); consumed by EPIC-I CLI
- **Context**: plan/04 §7 — daily-touch surface, string grammar for CLI parity plus typed refs programmatically.
- **Design**: `packages/manifold/src/state/selectors.ts`: parser for `name`, `tag:x`, `+model`, `model+`, `+model+`, `n+model`, `state:modified[.body|.configs]`, `result:error`, unions (space/comma), `exclude`. Programmatic API accepts `Model` references (typed, refactor-safe): `project.run({ select: [dailyMetrics, "+stg_events"] })`.
- **Acceptance criteria**: grammar covered by table-driven tests; typo'd model reference is a compile error in the typed path and a clear runtime error in the string path.
- **Test plan**: unit tests per operator; property test that `+m+` ⊇ `+m` ∪ `m+`.
- **Open questions**: named selector definitions in project config — defer to P2.

### STATE-7: Watermark / checkpoint storage location

- **Priority** P2 (decision needed at P1 time) | **Estimate** S | **Depends on** **EPIC-E incremental**, EPIC-G
- **Context**: Incremental models need per-model watermarks; microbatch needs per-window checkpoints. dbt derives watermarks from the target (`max(event_time)`); EPIC-G proposes `_manifold` collections.
- **Design/Decision**: runtime state lives in MongoDB (`_manifold.state`, keyed by model name), **never in the manifest** — manifest = code state, database = data state; artifacts stay diffable across environments. Watermark-by-query (max over target) is the default, stored checkpoint the optimization.
- **Acceptance criteria**: ADR-style note in the manifest schema doc; EPIC-E consumes the same collection.
- **Open questions**: **hash-stability contradiction to resolve with EPIC-E** — plan/04 §4 says runtime-resolved values are "not baked in", but a naively built incremental pipeline embeds the resolved watermark in its `$match`, changing `pipelineHash` every run. EPIC-E's `ctx` must support a canonical build mode emitting a placeholder (e.g. `{$_manifoldWatermark: "receivedAt"}`) for hashing.

### STATE-8: Artifact stability guarantees & schema versioning (host seam)

- **Priority** P2 | **Estimate** M | **Depends on** STATE-3, STATE-4; cross-ref plan/05 §5, EPIC-I
- **Context**: dbt treats artifact schemas as a public semver'd contract (schemas.getdbt.com) — that is what made `dagster-dbt` possible. Same posture here.
- **Design**: `schemaVersion` integer per artifact, independent of package versions; upgrade shims (`packages/manifold/src/state/upgrades/`) that lift older manifests on read; published JSON Schema files; documented compat policy (additive = same version, breaking = bump + shim). `hashVersion` handled per STATE-2.
- **Acceptance criteria**: reading a v1 manifest with a v2 reader works via shim; JSON Schema validation test for every writer output.
- **Test plan**: fixture manifests per version; CI check that writer output validates against the published schema.
- **Open questions**: publish schemas in-repo vs a docs site (plan/06).
