# EPIC-E — Incremental & Microbatch Models (TRD)

**Overview**

Today `Model.Mode.Upsert`/`Append` recompute and merge the whole source every run; there is no "only process documents since last run" (see [../04-transform-roadmap.md](../04-transform-roadmap.md) §3, P0). This epic adds dbt-equivalent incremental models — **(user-supplied delta filter) + (framework-supplied apply strategy)** — as `Model.Mode.Incremental`, plus time-window `Model.Mode.Microbatch` (P0.5) and grain inference from a terminal `$group` (§8, pulled forward because it directly de-risks the `on:` config). API shape follows [../spikes/incremental-model-api.spike.ts](../spikes/incremental-model-api.spike.ts) (illustrative sketch); the runtime mechanics below are pinned by two **executed** spikes:

- [../spikes/incremental-exec.spike.ts](../spikes/incremental-exec.spike.ts) — 29/29 checks against mongodb-memory-server ^10 (standalone mongod 7.0.24).
- [../spikes/grain-inference.spike.ts](../spikes/grain-inference.spike.ts) — tsc-clean under the repo's strict flags using real `@pipesafe/core` types, plus a runnable grain extractor.

**Spike findings** (empirical; each drove a design decision)

1. **`on:` requires a pre-existing unique index — hard failure otherwise.** `$merge` with `on: "eventId"` and no unique index aborts: `MongoServerError: Cannot find index to verify that join fields will be unique` (code 51183). `on: "_id"` needs nothing. → INC-4 makes index-ensure a framework obligation before the first incremental merge.
2. **`whenMatched: "fail"` cannot implement append.** On a duplicate it aborts mid-stream and non-transactionally — we observed a new doc land _before_ the abort (`before=4 after=5`): `$merge failed due to a DuplicateKey error :: E11000…`. Confirms plan/04 §3's correction: **append = `whenMatched: "keepExisting" + whenNotMatched: "insert"`** — verified idempotent over full-source reruns. The existing `Model.Mode.Append` preset (`whenMatched: "fail"`) is therefore _not_ reusable as the incremental append strategy and its docs should warn about partial writes.
3. **Surprise — code 66 `ImmutableField`.** Merging on a non-`_id` key when the pipeline doc carries an `_id` different from the matched target doc's fails: `$merge failed to update the matching document, did you attempt to modify the _id…`. (This hung the first spike run.) → whenever `on ≠ "_id"`, the executor must auto-append `{ $unset: "_id" }` before `$merge` (consequence: target `_id` is server-generated; documented). Applies to `whenMatched: "merge"` _and_ `"replace"`.
4. **`whenMatched: "replace"` vs `"merge"` matters for partial deltas.** `"merge"` preserves target-only fields ($set semantics); `"replace"` drops them (verified: a `{eventId, status}` delta erased `day` under replace). → strategy `merge` exposes `mergeFields`/whenMatched choice; default `"replace"` for full-doc recomputes.
5. **There is no delete via `$merge`.** `whenMatched: "delete"` is rejected at parse time (`Enumeration value 'delete' … is not a valid value`). `deleteInsert` = client-side `deleteMany` on the delta key set, then `$merge` insert — and it is **non-atomic**: we observed the empty window between delete and insert. Same caveat dbt documents.
6. **Late-arriving data is silently lost by a plain `$gt` watermark** (verified), and a lookback rescan is a safe fix _because merge-on-key is idempotent_ (verified: overlap reprocessing produced no dupes). → `lookback` config on Incremental, not only Microbatch.
7. **Microbatch mechanics all verified**: out-of-order window execution converges; window replay is idempotent; **merge-only replay leaves zombie docs when source docs were deleted** — delete-window-then-merge removes them; a mid-window failure retried with the delete+merge recipe converges. This confirms plan/04 §3's delete-window-then-`$merge` choice and makes per-window retry safe.
8. **Edge cases**: `$merge` into the same collection as the source works (≥4.4); `whenNotMatched: "discard"` gives an "update-only" late-data policy. Everything runs on a **standalone** memory server — vitest integration tests need no replica set.
9. **Grain inference — type level is half-possible.** With real core types, `.group({_id: {day: "$day", userId: "$userId"}, …})` infers `TOutput["_id"]` as `{ readonly day: Date; readonly userId: string }` — grain _component names_ are derivable (`keyof TOut["_id"]`). But Pipeline's generics erase _stage identity_: a `$set` fabricating an `_id` object is indistinguishable from `$group`, so uniqueness-by-construction is provable only at **runtime** from the built stage array (`getPipeline()` suffices; no new core exports needed). Two sub-findings: (a) **readonly leakage** — `<const G>` carries `readonly` into output types; incremental type helpers must tolerate it; (b) post-`$group` the grain lives _inside_ `_id` and core's `MergeOptions` correctly rejects `on: "day"` / `"_id.day"` — so **the inferred `on:` for grouped models is `"_id"`** (whole-object equality; no extra index needed).
10. **Forced design change vs plan/04 §3 sketch**: the sketch shows `ctx.watermark("receivedAt")` as if it returned a value, but `Model._buildPipeline()` calls the pipeline function synchronously — the watermark isn't known at build time. Resolution: `watermark()` returns a typed **sentinel** (`{"$$manifoldWatermark": field}` cast to the field's type); the executor deep-scans built stages, runs the max-query per referenced field, and splices values in. Bonus: the _unresolved_ stage array is what EPIC-F should hash (stable across runs, dbt's `unrendered_config` analog). The sketch's `targetAggregate()` escape hatch is deferred (async — incompatible with sync build; revisit under EPIC-F/G).
11. **Contradiction flags**: plan/04 §3's example config uses `on: ["eventId"]` for a _staging_ model — fine — but the same section implies `on` is generally a field list; for grouped models it must be `["_id"]` (finding 9). And plan/04's `Model.Mode.Append` mapping table (§1) describes `whenMatched: "fail"` as "insert-only merge" — accurate for one-shot loads, unsafe for incremental reruns (finding 2). No other contradictions found.

Grain spike runtime output (excerpt):

```
terminal $group grain: {"kind":"group","components":{"day":"$day","userId":"$userId"},"on":"_id"}
grain through trailing $match/$sort/$limit: {"kind":"group","components":{...},"on":"_id"}
validate on:['eventId'] vs grouped grain: {"ok":false,"reason":"Model's terminal $group defines the grain {day, userId} under '_id'; …"}
```

---

**Tickets**

### INC-1: `IncrementalContext` + `Model.Mode.Incremental` config surface

- **Priority** P0 | **Estimate** L | **Depends on** — (API-only; EPIC-A graph fix lands independently)
- **Context**: The typed replacement for dbt's `is_incremental()` / `{{ this }}`. Must be backward compatible: existing single-arg pipeline fns keep compiling.
- **Design**: New `packages/manifold/src/model/incremental.ts`: `IncrementalContext<TOutput>` with `readonly isIncremental: boolean` and `watermark<K extends TopLevelField<FieldSelectorsThatInferTo<TOutput, Date | number | string>>>(field: K): InferFieldSelector<TOutput, K>` returning the sentinel `{"$$manifoldWatermark": K}` cast to the field type (finding 10). `IncrementalConfig<TOutput>`: `{ strategy: "append" | "merge" | "deleteInsert"; on?: readonly TopLevelField<FieldSelector<TOutput>>[]; mergeFields?: …; lookback?: { unit: "hour"|"day"; amount: number }; onSchemaChange?: "ignore" | "fail" }`. `Model.Mode.Incremental<TOutput>(config)` added beside existing presets in `packages/manifold/src/model/Model.ts`; `ModelConfig.pipeline` gains an optional second `ctx` parameter. Helpers must strip/tolerate `readonly` on output shapes (finding 9a).
- **Acceptance criteria**: sketch's worked example compiles verbatim (modulo real expression types); `ctx.watermark("naem")` and boolean fields are compile errors; existing `Model.test.ts` untouched and green; instantiation-count benchmark within budget (plan/04 §9 risk).
- **Test plan**: `Model.incremental.typeAssertions.ts` (see INC-9); unit test that a built pipeline contains the unresolved sentinel.
- **Open questions**: expose `ctx.watermark` for `string` fields (ObjectId-as-string watermarks)? Sketch says yes; keep.

### INC-2: Incremental executor — watermark resolution + append/merge strategies

- **Priority** P0 | **Estimate** L | **Depends on** INC-1, INC-4; coordinate with **EPIC-A** (lookup edges must order deps before an incremental model reads them)
- **Context**: `Project.executeModel` (`packages/manifold/src/project/Project.ts:361`) currently just drains one aggregate.
- **Design**: New `packages/manifold/src/project/incrementalExecutor.ts`. Per run: (1) `isIncremental` = target collection exists ∧ has ≥1 doc ∧ ¬`fullRefresh`; (2) build pipeline with ctx; (3) scan stages for sentinels → one `$group/$max` per field against the target (spike §1: `null` on empty/missing target ⇒ first run); apply `lookback` by subtracting from the resolved value (finding 6); (4) splice values; (5) append strategy stage: `append` → `$merge {on, whenMatched:"keepExisting", whenNotMatched:"insert"}`; `merge` → `whenMatched: "replace"` (default) or `"merge"`, `mergeFields` compiles to a `whenMatched` `$set` pipeline; (6) auto-`$unset: "_id"` when `on ≠ ["_id"]` (finding 3); (7) first run / `fullRefresh` executes the same pipeline minus delta match (ctx.isIncremental=false) with the same merge stage (never `$out` — keeps index, avoids dropping).
- **Acceptance criteria**: spike sections 1–4 reproduced by the executor; rerun of same delta is a no-op state-wise; `ModelRunStats` gains merge counts if cheaply available.
- **Test plan**: vitest on memory server (INC-9): first run, incremental run, rerun idempotency, update-in-place, `mergeFields` partial update, `_id`-unset path.
- **Open questions**: read watermark from target vs. stored state — default is target max-query (stateless, dbt-identical); see INC-8.

### INC-3: `deleteInsert` strategy

- **Priority** P1 | **Estimate** M | **Depends on** INC-2
- **Context**: Faster at scale; required for parity with dbt's `delete+insert`. No `$merge` delete action exists (finding 5).
- **Design**: In `incrementalExecutor.ts`: run the delta pipeline with a `$project` of the `on` keys to collect the delta key set (cursor batches, not `toArray()` on huge sets); `deleteMany({ on-key ∈ keys })`; re-run delta pipeline with `$merge {whenMatched:"fail", whenNotMatched:"insert"}` (safe post-delete). Docs must state the non-atomic window verbatim (spike §5), matching plan/04 §9's "atomicity contract" requirement.
- **Acceptance criteria**: converges to identical state as `merge` strategy on the spike fixture; docs section on atomicity.
- **Test plan**: port spike §5; add a concurrent-reader test documenting (not asserting away) the window.
- **Open questions**: chunk deletes for >100k keys? (follow-up; note in code).

### INC-4: Unique-index management for `on:` keys

- **Priority** P0 | **Estimate** S | **Depends on** INC-1
- **Context**: Finding 1 — first merge hard-fails without it (code 51183).
- **Design**: In `incrementalExecutor.ts` pre-flight: if `on ≠ ["_id"]`, `createIndex({...on: 1}, { unique: true })` (idempotent) before first merge; surface a clear error if creation fails on non-unique existing data. Note plan/04 §9's race on concurrent first runs — mitigate with `createIndex` idempotency + retry-once.
- **Acceptance criteria**: fresh target + compound `on` works first run; pre-existing duplicate data yields an actionable error naming the fields.
- **Test plan**: vitest: no-index failure (assert 51183 without pre-flight), pre-flight success, compound key, dirty-data error.
- **Open questions**: drop the index on `fullRefresh` with changed `on`? (yes — record decision in code comment).

### INC-5: `onSchemaChange` policy

- **Priority** P1 | **Estimate** M | **Depends on** INC-2
- **Context**: plan/04 §9: drift between models is compile-time; drift between `TOutput` and _existing materialized docs_ is runtime. `ignore` (Mongo-natural) default, `fail` optional.
- **Design**: `incremental.ts` config already carries it (INC-1). For `fail`: on incremental runs, sample N target docs (`$sample`), compare top-level key/BSON-type sets against a shape derived from the first delta batch; mismatch → error naming added/removed keys and suggesting `fullRefresh`. No `sync` modes (Mongo needs none).
- **Acceptance criteria**: `ignore` never blocks; `fail` blocks on a removed/renamed field with a message that names it; full-refresh clears it.
- **Test plan**: vitest with a model whose transform changes shape between runs.
- **Open questions**: use collection `$jsonSchema` validator when present instead of sampling?

### INC-6: `fullRefresh` escape hatch

- **Priority** P0 | **Estimate** S | **Depends on** INC-2
- **Context**: dbt `--full-refresh` semantics; also the documented remedy for INC-5.
- **Design**: `RunOptions.fullRefresh?: boolean` in `Project.ts` (plus per-model `fullRefresh: false` lock in `IncrementalConfig` to protect huge tables, as dbt allows). Forces `ctx.isIncremental = false`; executor deletes target contents (`deleteMany({})`, preserving indexes) then runs the full pipeline with the merge stage.
- **Acceptance criteria**: after a poisoned target, `run({ fullRefresh: true })` converges to the from-scratch state; locked models refuse with a clear error.
- **Test plan**: vitest: poison → full refresh → equality with fresh build; lock refusal.
- **Open questions**: none.

### INC-7: `Model.Mode.Microbatch`

- **Priority** P0.5 | **Estimate** XL | **Depends on** INC-2, INC-4; **EPIC-G event log** for per-window status persistence & retry; **EPIC-F artifacts** for `batches[]` in run-results
- **Context**: dbt 1.9's flagship, cheaper on structured pipelines (plan/04 §3). All apply mechanics verified (finding 7).
- **Design**: `MicrobatchConfig<TOutput>` per the sketch (`eventTime` constrained to Date fields, `batchSize: "hour"|"day"|"month"|"year"`, `lookback` (default 1), `begin`). New `packages/manifold/src/project/microbatchExecutor.ts`: compute window list = [max(begin, target-max-eventTime − lookback windows), now) split by `batchSize`; backfill via `RunOptions.eventTimeStart/End`. Per window: **prepend** `{$match: {[eventTime]: {$gte: start, $lt: end}}}` to built stages (array prepend — spike §9 confirms the splice point), `deleteMany` the window on the target, then `$merge {on, whenMatched:"replace", whenNotMatched:"insert"}` — delete-first is mandatory to purge source-deleted docs (finding 7). Windows run sequentially v1 (parallelism is EPIC-G/doc-05 territory); each window's success/failure reported per-window via `onModelComplete`-style callback and recorded for retry (EPIC-G). Pairs with `timeseries` config (`TypedTimeSeriesOptions` already in `Model.ts`).
- **Acceptance criteria**: spike §7 behaviors reproduced through the public API: out-of-order convergence, replay idempotency, zombie removal, failed-window retry re-running only failed windows (given EPIC-G state).
- **Test plan**: vitest porting spike §7; backfill-range test; lookback-reprocessing test.
- **Open questions**: pushing the window filter into `lookup`/`unionWith` upstream reads (dbt's `resolve_event_time_filter`) — v2; document that v1 filters only the `from` read. Interaction with `deleteInsert`-style non-atomicity per window must be documented.

### INC-8: Watermark/state handoff

- **Priority** P1 | **Estimate** M | **Depends on** INC-2, INC-7; **EPIC-F artifacts** (run-results `batches[]`), **EPIC-G event log** (authoritative run/batch statuses)
- **Context**: Default watermark is a live max-query on the target (stateless, verified cheap). Microbatch retry and `whenNotMatched:"discard"` late-data policies need durable per-window state.
- **Design**: `packages/manifold/src/state/watermarkStore.ts`: interface `{ getBatches(model): BatchRecord[]; recordBatch(...) }` with two impls: in-memory (default) and a `_manifold_state` collection document per model `{ model, lastWatermark?, batches: [{start, end, status, at}] }`. EPIC-F's run-results consumes the same records; EPIC-G's event log is the write path when present (this ticket only defines the interface + collection fallback).
- **Acceptance criteria**: killing a microbatch run mid-way and re-running executes only unfinished/failed windows; no state store configured ⇒ behavior degrades to full recompute of the requested range (correct, just slower).
- **Test plan**: vitest simulating a failed window (spike §7 recipe) with the collection store.
- **Open questions**: where `_manifold_state` lives (default db vs. per-model db) — align with EPIC-F artifact location decision.

### INC-9: Grain inference & `on:` validation

- **Priority** P2 (pull into P1 if cheap) | **Estimate** M | **Depends on** INC-1; independent of executor
- **Context**: Fusion's `PlanGrainInfo` analog (plan/04 §8). Spike proves: runtime inference from `getPipeline()` works, survives trailing `$match/$sort/$limit/$skip/$sample`; type level can enumerate grain components but not prove stage identity (finding 9).
- **Design**: `packages/manifold/src/model/grain.ts` — port the spike's `inferGrain(stages)` and `validateOnAgainstGrain(on, grain)` verbatim as a starting point. Wire into `Project.validate()`: for incremental/microbatch models with a terminal `$group`, a user `on` ≠ `["_id"]` is a validation **error** (message from the spike: names the grain components); omitted `on` defaults to `["_id"]` for grouped models and errors as "required" otherwise. Extend the shape-preserving walk to track `$project`/`$set` flattenings of `_id.*` in a follow-up.
- **Acceptance criteria**: the classic misconfig (`on: ["eventId"]` over a `$group` by `{day,userId}`) fails at `Project` construction, not at `$merge` time; grouped model with omitted `on` runs with `on: "_id"`.
- **Test plan**: unit tests over stage arrays (no DB); a Project.validation test.
- **Open questions**: infer grain through `$replaceRoot`? (defer); expose the inferred grain in EPIC-F's manifest for docs/lineage.

### INC-10: Test suites — vitest integration + typeAssertions

- **Priority** P0 (tracks each ticket) | **Estimate** M | **Depends on** INC-1…INC-7
- **Context**: The spike is the specification; convert it into durable tests. Standalone memory server suffices (finding 8) — reuse `useMemoryMongo.ts` patterns.
- **Design**: `packages/manifold/src/project/Project.incremental.test.ts` + `Project.microbatch.test.ts` porting spike sections 0–8 through the public `Model`/`Project` API; `packages/manifold/src/model/Model.incremental.typeAssertions.ts` pinning: watermark field-name typo → compile error; non-Date/number/string watermark field rejected; `on` typo'd field rejected; readonly-output tolerance (finding 9a); `@ts-expect-error` call-site pins mirroring `Pipeline.callSite.typeAssertions.ts` conventions.
- **Acceptance criteria**: `bun run test:ci` green; typeAssertions compile as part of build; every spike finding number is referenced by at least one test.
- **Test plan**: is the ticket.
- **Open questions**: none.
