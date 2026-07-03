# EPIC-G — Run-state event log & node-granular executor

**Overview.** The keystone of the orchestration roadmap: persist every run as an append-only event log in a `_manifold` MongoDB database (plus a derived per-model summary), and replace `Project.run`'s level-based staging (`topologicalSort` into stage arrays + `Promise.allSettled`, packages/manifold/src/project/Project.ts:495/309) with a node-granular ready-queue executor supporting bounded parallelism, per-Model retries, transitive skip propagation, and `resumeFrom(runId)`. Everything downstream — staleness (`onlyStale`), run history, the CLI's NDJSON stream, freshness SLAs — becomes a query over the log, never in-process memory. All design decisions below were validated empirically by an executed spike against `MongoMemoryReplSet`.

**Plan docs:** [05 — Orchestration & EL roadmap §2–4](../05-orchestration-and-el-roadmap.md) (P0/P1 scope), [01 — Current state §5.1](../01-current-state-and-gaps.md) (lookup-edge graph bug that gates the executor). **Spikes:** [event-log-exec.spike.ts](../spikes/event-log-exec.spike.ts) (EXECUTED — this TRD's evidence), refining the illustrative sketch [run-event-log.spike.ts](../spikes/run-event-log.spike.ts) (unmodified). **Sibling TRDs (parallel):** EPIC-A (graph fix — hard dependency of the executor), EPIC-E (incremental models / watermarks — consumes `inputFingerprints`), EPIC-F (manifest & run-results artifacts), EPIC-I (CLI — consumes the NDJSON event stream).

## Spike findings

`bun run tsx plan/spikes/event-log-exec.spike.ts` — replset up in 1.2 s (binary cached), full spike ~6 s.

**A. Sequence assignment under concurrent writers** (8 writers across 4 `MongoClient`s, 400 events):

```
A1 counter:    400 events in 611ms (654 ev/s) — unique=400/400, gapless 1..N=true
A2 client ts:  400 events in 321ms (1245 ev/s) — distinct ts=188/400 (53% ambiguous ordering)
A3 $natural:   85 inversions vs counter order out of 400 (acquire-counter-then-insert race)
```

A per-run `findOneAndUpdate` counter (`_manifold.counters`, `$inc` + `returnDocument: "after"`) gives unique, gapless, resumable ordering at ~2x the round-trip cost of bare inserts — irrelevant next to aggregation runtimes. Client timestamps collide on >50% of events at ms granularity; `$natural` order disagrees with counter-acquisition order (and is not queryable as "events after X" anyway). **Decision: per-run counter.** Contention is scoped to one run's counter doc, so concurrent runs don't contend with each other.

**B. Transactional vs non-transactional event+summary write** (150 identical write pairs each):

```
plain (event-first + idempotent upsert): 8.15ms/op (re-run after txn: 7.78ms/op)
withTransaction:                         6.67ms/op (0.86x vs best plain)
```

**Surprise:** the transaction was slightly _faster_ (one commit ack vs two acknowledged writes) — the sketch's and my own prior assumption of meaningful txn overhead is wrong on a 1-node replset. The decision therefore rests on correctness and reach, not cost: the transaction is **not needed** — append the event first, then do an idempotent summary upsert. A crash between the two leaves a stale summary that (a) fails safe (the model just re-runs; `$out`/`$merge` are idempotent) and (b) is rebuildable from events. **Decision: non-transactional, event-first** — this also works on standalone mongod (transactions require a replica set) and avoids `TransientTransactionError` retry machinery. **This refines plan/05 §2**, which says the summary "is updated in the same transaction as the event append"; we keep the transaction as an optional mode when a replset is detected, but the contract must not require it.

**C. Ready-queue executor, crash, resume** — 9-node DAG with real `$lookup` edges (`enriched_events → stg_users`, `user_ltv → enriched_events`) and a `$unionWith` edge (`dashboard_summary → user_ltv`), `maxParallel: 3`, real `$merge` materializations. Run 1 injected: `order_facts` fails once (retry succeeds), `enriched_events` fails all 2 attempts (skips propagate), `audit_log` hangs (mid-run crash — in-process state abandoned, no `run_finished` written). Final event sequence of run 1:

```
#01 run_started            #11 model_failed order_facts attempt=1 willRetry=true
#02-04 model_started stg_* #12 model_failed enriched_events attempt=1 willRetry=true
#05-07 model_materialized  #13-14 model_started (attempt=2, after backoff)
    stg_events/users/orders#15 model_failed enriched_events attempt=2 willRetry=false
#08 model_started audit_log#16 model_materialized order_facts attempt=2 docs=4
#09-10 model_started       #17 model_skipped daily_metrics   reason=upstream_failed(enriched_events)
    enriched_events,       #18 model_skipped user_ltv        reason=upstream_failed(enriched_events)
    order_facts            #19 model_skipped dashboard_summary reason=upstream_failed(enriched_events)
(no run_finished — the crashed-run signature)
```

Run 2 = `resumeFrom(run-001)` rebuilt work purely from the log: skipped the 4 materialized models (`model_skipped reason=resume_already_materialized`), re-ran the failed/skipped/in-flight ones, completed in 165 ms with `run_finished status=success`; all 9 output collections verified non-empty. The resume query's winning plan uses the `runId_1_seq_1` index (verified via `explain`). Note the depth-scored ready queue ran `audit_log` (depth 1) alongside deep nodes — level-based staging would have serialized it behind the whole "stage".

**Dead end / bug found in the sketch:** `run-event-log.spike.ts`'s skip propagation deletes the skipped child from grandchildren's remaining-deps sets (`remaining.get(gc)?.delete(child)`), which _releases_ grandchildren to execute despite a failed ancestor. The executable spike replaces this with explicit BFS transitive skip and pins the correct behavior (`dashboard_summary` skipped two hops from the failure).

**D. Staleness derivation** — after run 2, `isStale` over summaries + a live watermark probe:

```
stg_events before new data: {"stale":false}
stg_events after insert:    {"stale":true,"reason":"source_has_new_data"}
stg_users (untouched):      {"stale":false}
daily_metrics (upstream not yet rematerialized): {"stale":false}
```

Exactly the Orchestra-SAO semantics plan/05 §4 wants kept in-product: a 5-minute cron of `onlyStale` would rebuild `stg_events` only, then `daily_metrics` flips stale via `upstream_newer` on the next tick.

**Naming note:** we retain plan/05 §2 / sketch nomenclature (`run_started`, `model_materialized`, `model_failed`, `run_finished`) rather than `run_start`/`model_success`/`model_error`/`run_end`; the union adds `seq`, `durationMs` on failures, and a `resume_already_materialized` skip reason.

## Tickets

### LOG-1: `_manifold` event schema + storage layer

- **Priority** P0 | **Estimate** M | **Depends on** — (first ticket; EPIC-F consumes the schema)
- **Context**: Nothing survives the process today (`ProjectRunResult` returned and discarded, Project.ts:264).
- **Design**: New `packages/manifold/src/state/events.ts` exporting the `ManifoldEvent` union and `InputFingerprint` exactly as in the executed spike (fields: `runId`, `seq`, `ts`, `type`, `model`, `attempt`, `error`, `willRetry`, `durationMs`, `pipelineHash`, `docsWritten`, `inputFingerprints`, `materialization`, `SkipReason`). This union is THE shared contract — the log document, the CLI NDJSON line (EPIC-I), and the run-results artifact rows (EPIC-F) are the same shapes. `packages/manifold/src/state/EventLog.ts`: collections `_manifold.events` (append-only), `_manifold.models`, `_manifold.counters`; `append()` assigns `seq` via per-run `findOneAndUpdate` counter (spike A); indexes `{runId:1, seq:1}` unique, `{model:1, ts:-1}`, `{type:1, ts:-1}`. Retention: optional `retention.eventsDays` config creates a TTL index on `ts` — safe because summaries (LOG-2) survive expiry; `resumeFrom` only needs recent runs. Non-transactional event-first writes (spike B decision); optional txn mode behind `state.transactional: true`.
- **Acceptance criteria**: concurrent appends from ≥2 clients produce unique gapless seq per run; storage layer usable standalone (no replset); TTL index created only when retention configured; db name configurable (default `_manifold`).
- **Test plan**: port spike experiment A as a vitest suite against `MongoMemoryReplSet` and a plain `MongoMemoryServer` (standalone path); unique-index violation test; TTL index shape assertion.
- **Open questions**: cap seq counter cleanup (delete counter doc on `run_finished`?); `error` field — string now, structured `{message, stack, codeName}` later?

### LOG-2: Derived model-summary maintenance + rebuild

- **Priority** P0 | **Estimate** S | **Depends on** LOG-1
- **Context**: Staleness queries must not scan the log (Dagster's `asset_keys` split).
- **Design**: `ModelSummary` (`_id` = model name, `lastMaterialization {runId, ts, pipelineHash, inputFingerprints}`, `lastStatus`, `updatedAt`) upserted idempotently after each terminal model event (`recordMaterialized` in EventLog.ts). `EventLog.rebuildSummaries()` — one aggregation over `events` (`$match` terminal types → `$sort seq` → `$group` last per model → `$merge` into `models`) restores the cache after TTL expiry or torn writes; dogfood it in PipeSafe.
- **Acceptance criteria**: summary matches log-derived state after any run permutation; `rebuildSummaries()` is idempotent and equals incremental maintenance byte-for-byte on `lastMaterialization`.
- **Test plan**: property-style test — replay recorded event fixtures (incl. the spike's crashed run) through both paths, compare.
- **Open questions**: should `failed`/`skipped` update `lastStatus` only, keeping `lastMaterialization` untouched (spike says yes — resume depends on it)?

### LOG-3: Ready-queue executor replacing level-based staging

- **Priority** P0 | **Estimate** L | **Depends on** **EPIC-A graph fix** (execution graph must include lookup/unionWith edges or the queue schedules races — verified live in the spike DAG), LOG-1
- **Context**: Project.ts:309 runs Kahn stages with `Promise.allSettled` and aborts the whole run at the first failed stage; a slow node blocks unrelated work.
- **Design**: `packages/manifold/src/project/executor/ReadyQueueExecutor.ts` (~250 lines, mirroring the spike's `executeRun`): in-degree map over the full edge set, ready list ordered by topological depth (dbt GraphQueue score — shallowest first), inline semaphore (`inFlight < maxParallel`), BFS transitive skip (NOT the sketch's dep-deletion — see findings bug). `Project.run` keeps its signature; `RunOptions` gains `maxParallel?: number` (default 4), `state?: "auto" | "required" | "off"` (LOG-10). `ProjectRunResult` gains `runId`, `modelsSkipped: string[]`. **Breaking-change assessment**: types are additive, but behavior changes — independent branches now continue past a failure (dependents skipped) instead of the run halting at a stage boundary, so `modelsRun`/`modelsFailed` can both be larger. Ship as a minor with a changelog note; existing callbacks (`onModelStart/Complete/Error`) keep firing, implemented as subscribers on the event stream. Multi-writer safety across processes: per-model lease via `findOneAndUpdate` on `_manifold.locks` (plan/05 risk 2) — designed here, **untested in the spike**; gate behind `state.lease: true` until exercised.
- **Acceptance criteria**: spike DAG topology executes with correct ordering under `maxParallel ∈ {1, 3, 8}`; lookup-only dependency never races its dependent; a failing node never blocks an independent branch; dry-run output unchanged.
- **Test plan**: port spike experiment C (minus chaos hangs) to vitest with a seeded replset; deterministic-order test at `maxParallel: 1`; fuzz random DAGs against a reference topological checker.
- **Open questions**: keep `plan()`'s stage-array shape for display while the executor ignores it (yes — `ExecutionPlan.stages` stays as documentation of depth levels)?

### LOG-4: Per-Model retry policy

- **Priority** P0 | **Estimate** S | **Depends on** LOG-3
- **Context**: Universal shape across all surveyed systems; safe because materialization is idempotent.
- **Design**: `retry?: { maxAttempts: number; backoffMs: number; factor?: number; jitter?: boolean }` on `ModelConfig` (packages/manifold/src/model/Model.ts), default `{maxAttempts: 1}`; project-level default in `ProjectConfig`. Executor emits `model_started` per attempt and `model_failed {attempt, willRetry}` per failure (spike: `order_facts` attempt 1 fail → backoff → attempt 2 success, events #10–16).
- **Acceptance criteria**: attempts and backoff delays observable in the event log; retry never re-runs a succeeded model; per-Model overrides beat project default.
- **Test plan**: fake timers for backoff; chaos injection helper extracted from the spike.
- **Open questions**: retry on which errors — all, or exclude non-transient (e.g. pipeline `$merge` duplicate-key on `Append`)? Propose: retry all in v1, add `retryable?: (err) => boolean` later.

### LOG-5: `resumeFrom` API

- **Priority** P0 | **Estimate** M | **Depends on** LOG-1, LOG-3
- **Context**: dbt-retry semantics with no artifact shuffling — the log is already in the database.
- **Design**: `project.run({ resumeFrom: runId })`: query prior run's events (`{runId, seq}` index — IXSCAN verified), skip models with `model_materialized` **and unchanged pipelineHash** (canonical-JSON SHA-256 of the compiled stage array, `packages/manifold/src/state/pipelineHash.ts` — shared with EPIC-E/EPIC-F); emit `model_skipped {reason: {kind: "resume_already_materialized", sourceRunId}}` for each. Models with `model_started` but no terminal event (in-flight at crash) re-run — safe by idempotence. A crashed run is detected by absent `run_finished`; `run({resume: "last"})` sugar finds the latest unfinished run.
- **Acceptance criteria**: spike scenario reproduced as a test — crash mid-run, resume completes, every model has exactly one terminal state across the two runs, outputs verified.
- **Test plan**: port experiment C's crash+resume; hash-change test (edit one model's stages between runs → it re-runs on resume).
- **Open questions**: resume with a _changed selection_ — intersect or error? Propose error in v1.

### LOG-6: Skipped-children semantics

- **Priority** P0 (promoted from plan/05's P1 — the executor is incoherent without it, as the spike showed) | **Estimate** S | **Depends on** LOG-3
- **Design**: on terminal failure, BFS all transitive dependents (over the full edge set incl. lookup edges), emit `model_skipped {kind: "upstream_failed", cause}`, remove from ready/remaining. `run_finished.status`: `success` (all succeeded), `partial` (some succeeded), `failed` (none). Skipped models listed in `ProjectRunResult.modelsSkipped`.
- **Acceptance criteria**: two-hop propagation (the spike's `dashboard_summary` case) pinned; a skipped model's dependents via _any_ edge type are skipped; no grandchild-release regression (findings bug).
- **Test plan**: unit tests on the pure graph routine + the ported spike DAG.
- **Open questions**: none.

### LOG-7: Staleness / `onlyStale`

- **Priority** P1 | **Estimate** M | **Depends on** LOG-1, LOG-2; **cross-ref EPIC-E** (owns watermark/fingerprint declaration on sources and incremental semantics)
- **Context**: The Orchestra lesson (plan/05 §1, §4): whoever owns the skip-decision state owns the value story; keep it in-product.
- **Design**: `packages/manifold/src/state/staleness.ts`: `isStale(model)` = `never_materialized` | `pipeline_changed` (hash) | `upstream_newer` (summary ts compare) | `source_has_new_data` (probe declared watermark / change-stream resume token vs `lastMaterialization.inputFingerprints`). `run({onlyStale: true})` filters the selection before the executor and emits `model_skipped {kind: "not_stale"}` for the rest. Spike D demonstrates the full verdict matrix including the two-tick cascade.
- **Acceptance criteria**: spike D matrix reproduced; skipped-as-fresh models appear in the log (auditable skip decisions — the SAO analytics story).
- **Test plan**: seeded replset; each of the four reasons triggered independently.
- **Open questions**: `upstream_newer` uses summary timestamps — clock skew across writers? (Mitigate later by comparing runId/seq lineage rather than wall clocks.)

### LOG-8: NDJSON event stream (CLI seam)

- **Priority** P1 | **Estimate** S | **Depends on** LOG-1; **cross-ref EPIC-I** (CLI) and EPIC-F (artifacts)
- **Design**: `run()` accepts `onEvent?: (e: ManifoldEvent) => void` invoked post-append with the exact stored document (incl. `seq`). The CLI's `--json` mode is `JSON.stringify` per event — hosts consume precisely what the log stores (dagster-dbt pattern). The union from LOG-1 is the single versioned contract: additive changes only; `manifoldVersion` on `run_started` carries the schema version.
- **Acceptance criteria**: byte-equivalence between stored events and streamed events for a full run; works with `state: "off"` (events streamed, not persisted).
- **Test plan**: capture stream + log for the spike DAG, deep-equal modulo `_id`.
- **Open questions**: backpressure — `onEvent` sync fire-and-forget vs awaited? Propose sync in v1.

### LOG-9: Observability queries

- **Priority** P2 | **Estimate** S | **Depends on** LOG-1, LOG-2
- **Design**: `packages/manifold/src/state/history.ts` — `runHistory(limit)`, `modelHistory(name)`, `durations(name)` (p50/p95 trend), `failureRate(window)`; each an aggregation over `_manifold.events` authored with `@pipesafe/core` pipelines (dogfood). Crashed runs surfaced as `status: "crashed"` (derived: `run_started` without `run_finished`).
- **Acceptance criteria**: queries covered by tests over recorded fixtures; documented examples; all queries hit the LOG-1 indexes (explain-verified, as in the spike).
- **Test plan**: fixture-driven vitest; explain-plan assertions.
- **Open questions**: expose as `project.history` namespace or free functions?

### LOG-10: Migration & rollout — graceful degradation

- **Priority** P0 | **Estimate** S | **Depends on** LOG-1, LOG-3
- **Context**: Users may lack permissions to create a `_manifold` database; the event log must be optional (plan/05 §8 risk 4: serverless hosts).
- **Design**: `state: "auto" | "required" | "off"` on `ProjectConfig`/`RunOptions` (default `"auto"`). `"auto"`: attempt `ensureIndexes()` at run start; on authorization failure, warn once and fall back to a `NullEventLog` (events still stream via LOG-8, nothing persisted). `"required"`: throw. `"off"`: skip entirely. `resumeFrom`/`onlyStale` with a Null log throw a clear error naming the `state` option. No data migration needed (new database); document the additive `ProjectRunResult` fields and the LOG-3 behavior change in one changeset (minor).
- **Acceptance criteria**: run succeeds against a user with read/write on data dbs but none on `_manifold`; error messages actionable; changeset present.
- **Test plan**: memory-server user with restricted roles; assert warn-and-continue vs throw per mode.
- **Open questions**: should `"auto"` cache the degradation verdict per client to avoid a probe per run? (Yes — tag on the client like `tagClient`.)
