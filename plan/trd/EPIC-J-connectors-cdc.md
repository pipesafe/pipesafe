# EPIC-J — Typed connectors & change-stream CDC

**Overview.** Build the EL story from [plan 05 §6](../05-orchestration-and-el-roadmap.md): dlt's form factor (library code in the user's runtime) carrying Fivetran's op/checkpoint semantics, with MongoDB change streams as first-class CDC and the connector's TypeScript type flowing into the existing DAG through core's `Source<T>`. Priority P2. Related docs: [plan 05](../05-orchestration-and-el-roadmap.md) §6/§8, [plan 06](../06-architecture-packaging-licensing.md) §1 (connectors ship Apache; interface in core); sketch: [source-connector-api.spike.ts](../spikes/source-connector-api.spike.ts); executed spike: [change-stream-cdc.spike.ts](../spikes/change-stream-cdc.spike.ts).

## Spike findings

[`change-stream-cdc.spike.ts`](../spikes/change-stream-cdc.spike.ts) was **executed 2026-07-03** against a single-node `MongoMemoryReplSet` (mongodb-memory-server 10.2.x, driver 6.21.0). All checks pass. Key output:

```
[1] CORRECT cutover: operationTime BEFORE snapshot, stream from it
  PASS: snapshot alone is stale (race is real: u1 update landed behind the cursor)
  post-cutover: source 6 docs hash=08920075c6859433 | target 6 docs hash=08920075c6859433
  PASS: target == source after snapshot + stream cutover
[2] crash mid-stream, resumeAfter from checkpoint: no loss
  resumed drain: 5 applied, 2 re-delivered (expected 2 = applied-but-uncheckpointed)
  post-resume: source 6 docs hash=f281234991e06d07 | target 6 docs hash=f281234991e06d07
[3] WRONG cutover: operationTime AFTER snapshot → data loss
  stream delivered 0 events; u1.v: source=101 target=1 (update silently LOST)
[4] invalid / expired resume points
  future-timestamp token: ACCEPTED silently (tryNext → null)
  unparseable token: MongoServerError code=50811 codeName=Location50811 labels=[]
  mutated real token: MongoServerError code=280 codeName=ChangeStreamFatalError
    labels=["NonResumableChangeStreamError"]  "resume token was not found"
[5] idle tryNext(): 254ms (≈ maxAwaitTimeMS=250); hot tryNext(): 2ms
```

Findings that force design changes:

1. **Snapshot-then-stream ordering is empirically the crux.** Capturing `operationTime` _before_ the snapshot and starting the stream with `startAtOperationTime` produced target == source (matching sha256 content hashes) despite an update landing _behind_ the snapshot cursor; capturing it _after_ the snapshot silently lost that update (scenario 3, `u1.v` stale). `startAtOperationTime` behaved **inclusively** — pre-snapshot seed writes were re-delivered — so cross-boundary replay is guaranteed and keyed idempotent upserts are mandatory.
2. **Write-before-checkpoint works exactly as designed.** Persisting the last applied event's `_id` to `_manifold.checkpoints` only after the target write, then crashing with 2 applied-but-uncheckpointed events, re-delivered exactly those 2 on `resumeAfter` — no loss, no target duplication.
3. **The re-snapshot trigger surface is broader than plan 05 states.** Plan 05 §6 says "auto re-snapshot on `ChangeStreamHistoryLost`" (code 286). Observed reality: a mutated-but-parseable token fails with **code 280 `ChangeStreamFatalError`** (label `NonResumableChangeStreamError`), thrown lazily on the first `getMore`, _not_ at `watch()`; an unparseable token fails with **code 50811 and no error label**; and — the surprise — a parseable token with a **future timestamp is silently accepted** and the stream idles forever. Policy must therefore match on label **plus** a code set {286, 280, 50811}, wrap the _iteration loop_ (not just `watch()`), and add a liveness bound for the hang case. **Contradiction with `source-connector-api.spike.ts`**: its `changeStreamSource` catches errors around `cfg.watch(...)` only — insufficient on all three counts; genuine 286 could not be forced on a memory server (fresh oplog never rolls; `startAtOperationTime(1,1)` succeeded), so 286 handling is designed from the documented label, and an integration test against a tiny capped oplog on real mongod is a follow-up.
4. **Idle cost model confirmed:** `tryNext()` blocks ~`maxAwaitTimeMS` (254ms measured at 250) when idle and returns in ~2ms when events are buffered; `batchSize` caps a single `getMore`. Checkpoint cadence must be dual (every N events **or** T seconds via `stream.resumeToken`), since an events-only cadence (the sketch's "every 500") never checkpoints a quiet stream — whether `resumeToken` advances on empty batches went unverified (open question, CONN-3).
5. `fullDocument: "updateLookup"` post-images arrived for every update here, but the nullable case must be a no-op (the trailing delete event tombstones the target anyway).

## Tickets

### CONN-1: `ExternalSource<T>` contract in core

- **Priority** P2 | **Estimate** M | **Depends on** — (interface only; EPIC-G event log referenced by name for run reporting)
- **Context**: the seam that makes a connector's type flow through `$match`/`$group` at compile time — the claim no other EL tool can make.
- **Design**: in `packages/core/src/source/` (Apache, per plan 06 §1): `SourceOp<T>` = Fivetran's four ops verbatim (`upsert` full doc / `update` key+patch / `delete` key, soft / `truncate` before-date) plus `checkpoint { state: JsonValue }`; `ExternalSource<T> = { name; into; pull(state): AsyncGenerator<SourceOp<T>> }` as sketched in `source-connector-api.spike.ts`. The loader (in `@pipesafe/manifold` or a small Apache runner — decide with plan 06) lands ops via `bulkWrite` (`replaceOne{upsert}` / `updateOne $set` / `$set _ps_deleted`) into a landing collection that implements `Source<T>`, joining the DAG. System fields `_ps_synced`/`_ps_deleted` are documented contract.
- **Acceptance criteria**: a toy in-memory source syncs into a collection consumed by a `Model` with full type inference; replaying the same op stream is a no-op (idempotence test); `truncate` soft-deletes only docs synced before its timestamp.
- **Test plan**: type assertions (`externalSource.typeAssertions.ts`) for op-shape inference; runtime tests on memory server for each op → bulk-op mapping and replay idempotence.
- **Open questions**: package placement of the runner (core vs manifold vs `@pipesafe/connectors-runtime`) — licensing follows plan 06 (connectors Apache).

### CONN-2: checkpoint store

- **Priority** P2 | **Estimate** S | **Depends on** CONN-1; EPIC-G event log (same `_manifold` database)
- **Context**: Fivetran's `state_json` invariant — persist only after durable delivery — made unreachable-by-construction in the runner.
- **Design**: one collection, **`_manifold.sourceState`** (plan 05 §6's name; the spike used `_manifold.checkpoints` — unify on `sourceState`, findings note the divergence): `{ _id: sourceName, state: JsonValue, ts }`, `findOneAndUpdate` upsert. The runner flushes the pending batch's `bulkWrite` before persisting any `checkpoint` op (see `runSync` in the sketch, validated by spike scenario 2). Dual checkpoint cadence (N ops or T seconds) is the runner's job, not the connector's.
- **Acceptance criteria**: kill-and-restart test proves no loss and target-level dedup (port spike scenario 2 into a vitest); checkpoint never observed ahead of delivered data under injected write failures.
- **Test plan**: fault-injection wrapper around `bulkWrite` (fail after k ops), assert restart converges; concurrent-sync guard (per-source lease) test.
- **Open questions**: state history retention (keep last N states for debugging?) — default no.

### CONN-3: change-stream source (Mongo as source)

- **Priority** P2 | **Estimate** L | **Depends on** CONN-1, CONN-2; spike (executed)
- **Context**: resume tokens are the natural checkpoint; the spike settled the correctness questions.
- **Design**: `changeStreamSource<T>` producing snapshot + tail per the spike's **proven ordering**: capture `operationTime` (via `admin.command({ping:1})`), emit `truncate` + chunked snapshot upserts (batched `bulkWrite`, not per-doc as the spike's toy did), then stream with `startAtOperationTime` at that captured time; subsequent runs use `resumeAfter` from `_manifold.sourceState`. `fullDocument: "updateLookup"`; null post-image → no-op (finding 5). **Re-snapshot policy** (supersedes both plan 05's 286-only rule and the sketch's watch-scoped try/catch): wrap the whole iterate loop; on `MongoServerError` with label `NonResumableChangeStreamError` **or** code ∈ {286, 280, 50811} → clear state, `truncate`, re-snapshot (Fivetran's exact behavior); plus a staleness watchdog for the silently-accepted future-token hang (no event **and** no token progress for a configured bound → treat as non-resumable). `invalidate` events (drop/rename) → re-snapshot. Tunables: `maxAwaitTimeMS`, `batchSize`, checkpoint cadence.
- **Acceptance criteria**: spike scenarios 1–4 pass as CI tests; fabricated-token and invalidate paths converge to a correct target without operator action; wrong-ordering regression test stays red if someone "optimizes" the optime capture.
- **Test plan**: port the spike to vitest fixtures; add an `invalidate` (collection drop) test; real-mongod capped-oplog test for genuine 286 as a follow-up (not runnable on memory server — spike finding 3).
- **Open questions**: does `stream.resumeToken` (postBatchResumeToken) advance on empty batches, enabling cheap freshness probes and idle checkpoints? Unverified — verify during implementation (also feeds EPIC-G's token-based freshness probe).

### CONN-4: continuous Mongo-to-Mongo CDC materialization

- **Priority** P2 | **Estimate** L | **Depends on** CONN-3; EPIC-G event union (needs a `model_cdc_progress`-style event — new event type to negotiate with EPIC-G)
- **Context**: the uncontested lane — Airbyte's Mongo destination is archived, Fivetran has none; and neither can run _inside_ Mongo. A Model fed by a change stream instead of batch runs.
- **Design**: a streaming materialization mode alongside `Model.Mode.Replace/Upsert/Append`: source change stream → apply the Model's (restricted) pipeline per-batch → keyed `$merge`-equivalent bulk upsert into the output collection. v1 restriction: stateless stages only (`$match`/`$set`/`$project`/`$unset`) — no `$group`/`$lookup` across the stream (incremental-view maintenance is out of scope; document why). Runs under a host-supplied loop (CLI `manifold stream <model>` later; **no daemon** per plan 05 §4 — the process is user-hosted). Emits EPIC-G events for observability; checkpoint via CONN-2.
- **Acceptance criteria**: a filtered projection Model mirrors a source collection continuously; equality harness (spike's hash comparison) passes after churn + crash/restart; downstream batch Models see the CDC output as an ordinary upstream.
- **Test plan**: memory-server soak test (random ops + kills, converge, compare hashes); type test that a disallowed stage in streaming mode is a compile-time `PipeSafeError`.
- **Open questions**: exact event type names with EPIC-G; per-event vs micro-batch pipeline application (start micro-batch).

### CONN-5: schema-drift policy — compile-time pole + runtime knobs

- **Priority** P2 | **Estimate** M | **Depends on** CONN-1
- **Context**: Fivetran = protocol event; dlt = runtime contract; PipeSafe adds the third pole — drift as a `tsc` failure before deploy (source `T` changed → downstream `$match` on a removed field fails with the existing `PipeSafeError` brand, e.g. `Field 'plan' is not on the schema.`).
- **Design**: runtime `SourceContract` per landing table: `onUndeclared: "evolve" | "freeze" | "discardRow" | "discardValue"` (dlt's names; maps onto Fivetran's allow-all/allow-columns/block-all), enforced by the loader against the declared `T` via a cheap structural check; violations counted into run results and EPIC-G events (`freeze` fails the sync). Dev-time: a `sampleAndDiff` utility comparing sampled documents against `T` for CI warnings (no type generation in this ticket).
- **Acceptance criteria**: each policy verified against a non-conforming doc stream; `freeze` fails with a typed error naming the offending field; counts appear in run results.
- **Test plan**: table-driven runtime tests; type assertions proving the compile-time pole fires through a Model chain.
- **Open questions**: per-field policies (Fivetran's column toggles) — defer; validator integration (Standard Schema, plan 06 §4) — defer to ORM epic.

### CONN-6: REST/paginated-API source template

- **Priority** P3 | **Estimate** M | **Depends on** CONN-1, CONN-2
- **Context**: dlt's REST toolkit is its long-tail answer; ours is a typed template, not a catalog (≤5 exemplar sources total, plan 05 §6).
- **Design**: `restSource<T>({ page, cursorOf, keyOf, contract })` — user supplies a typed `fetchPage(cursor)` returning `{ items: T[]; next: Cursor | null }`; the template yields `upsert` ops keyed by `keyOf`, emits `checkpoint { cursor }` per page boundary (safe: pages are replayable), handles rate-limit backoff hooks. Ships in `@pipesafe/connectors-rest` (Apache).
- **Acceptance criteria**: an example (GitHub issues or Stripe-shaped fixture) syncs incrementally across two runs, resuming from the cursor; mid-page crash replays only that page.
- **Test plan**: mock HTTP fixtures; resume + replay tests; backoff hook unit test.
- **Open questions**: incremental strategies beyond cursor (updated-since watermark) — provide both patterns in the template.

### CONN-7: Parquet egress (single path)

- **Priority** P3 | **Estimate** M | **Depends on** manifold Models (typed `TOutput`); EPIC-F manifest (egress recorded as a node)
- **Context**: one boring path to ELT-completeness: cursor (or change stream) over a Model's collection → Parquet in object storage → warehouse `COPY INTO` (Fivetran's batch-file design minus gRPC/encryption ceremony).
- **Design**: `ParquetEgress<T>` per the sketch (`model`, `path(batch)`, `mode: "full" | "incremental"` on `_ps_synced`/change stream). **Library choice deferred — no dependency added now**; ticket includes the evaluation: `parquetjs`/forks (unmaintained — likely reject), `parquet-wasm` + `apache-arrow` (actively maintained, WASM, schema from Arrow), `hyparquet`/`hyparquet-writer` (small, pure JS), or DuckDB (`@duckdb/node-api`, `COPY (…) TO parquet` — heavyweight but battle-tested). Criteria: maintained, streaming row-group writes, BSON→logical-type mapping (Decimal128, dates, ObjectId→string), zero native-build pain on bun. Parquet schema derived from the Model's `TOutput` with a documented BSON→Parquet type table.
- **Acceptance criteria**: a Model's collection exports to a local Parquet file readable by DuckDB with correct types; incremental mode exports only new `_ps_synced` rows; path templating per batch window.
- **Test plan**: round-trip test (export → read back via chosen lib → compare); type-mapping table test incl. Decimal128/Date/ObjectId.
- **Open questions**: the library decision itself; object-storage upload stays out of scope (user pipes the file; document S3 example).

### CONN-8: backpressure & batching in the runner

- **Priority** P2 | **Estimate** S | **Depends on** CONN-1..3
- **Context**: the async-generator contract gives pull-based backpressure for free — the runner controls demand; spike finding 4 gives the idle-cost model.
- **Design**: runner batches ops to `bulkWrite` (default 1,000, configurable bytes cap for 16MB safety); consumes the generator only after the previous batch resolves (natural backpressure — no unbounded buffering); change-stream tunables surfaced (`maxAwaitTimeMS` default 1,000, `batchSize`); dual checkpoint cadence (CONN-2). Metrics per batch (ops, ms, bytes) flow into EPIC-G events.
- **Acceptance criteria**: memory stays bounded under a firehose source (heap assertion in test); throughput scales with batch size; slow-target test shows the generator is not drained ahead of writes.
- **Test plan**: synthetic 100k-op generator with instrumented pull timestamps proving pull-after-flush ordering; heap-usage regression test.
- **Open questions**: parallel bulkWrites per source (ordered:false) — start sequential; revisit with benchmarks.

### CONN-9: non-goals (restated as scope guardrails)

- **Priority** P2 (docs) | **Estimate** S | **Depends on** —
- **Context/Design**: encode plan 05 §6's do-NOT-build list in the connectors README and PR template so scope creep is reviewable: **no** connector catalog (≤5 exemplar sources + Singer/Airbyte interop adapters later), **no** hosted control plane, **no** generic multi-destination framework or `Migrate` algebra (CONN-7 is the only egress), **no** wire protocol (in-process TS interfaces until a multi-language ecosystem exists), **no** relational document shredding (the typed pipeline is the shredder), **no** scheduler daemon (hosts trigger; CONN-4 runs under a host-supplied process).
- **Acceptance criteria**: list published in package docs; each future connector PR links a filled scope checklist.
- **Test plan**: n/a (docs).
- **Open questions**: when interop adapters (run an Airbyte container, ingest its RECORD/STATE stream) get scheduled — P3 at earliest.
