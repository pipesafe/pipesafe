# 05 — Orchestration & EL Roadmap

This document charts manifold's evolution from an in-memory DAG runner into an orchestration and extract/load layer that competes with Dagster/Airflow/Prefect/Orchestra on run semantics and with Fivetran/Airbyte/dlt on data movement — without becoming a workflow engine. The design center: persist run state in MongoDB itself (a `_manifold` database), derive everything — staleness, resume, lineage history, freshness — from an append-only event log, and expose a manifest + CLI seam so any scheduler or control plane can host manifold the way they host dbt. Sibling boundaries: doc 04 owns _what a run computes_ (incremental models, tests, the manifest and run-results artifacts); this doc owns _how runs execute, get scheduled, and observed_, and how data gets into and out of MongoDB.

## 1. Goal & positioning

Manifold should become **the typed, MongoDB-native asset layer** — not a scheduler. Every incumbent converged on the same decomposition: the unit of value is the asset (Dagster's `@asset` maps term-for-term onto `Model`; Airflow spent three releases retrofitting it), and the scheduler is a thin polling daemon over persisted state. Hosts — Dagster, Temporal, Orchestra, GitHub Actions, plain cron — do triggering. Manifold owns two things: **run semantics** (retries, resume, node-granular parallelism) and, critically, **the state that decides work doesn't need to happen**. Orchestra's State-Aware Orchestration is the cautionary tale: because dbt shipped only a runner with parseable artifacts, Orchestra built the skip-decision state table _above_ it and now owns the "75% fewer builds" value story. Manifold must keep that state inside the product — persisted materialization history plus pipeline hashes plus source freshness — while remaining hostable by every scheduler and legible to every control plane.

## 2. Run-state & event log (P0)

The keystone, directly portable from Dagster's instance schema: everything downstream (staleness detection, resume-from-failure, run history UI, freshness SLAs, `retry`) is _derived from persisted events_, never from in-process memory. Today `ProjectRunResult` is returned and discarded (packages/manifold/src/project/Project.ts:264); nothing survives the process.

Two collections in a `_manifold` database on the connection manifold already has — no new infrastructure dependency, which no competitor can claim:

- **`_manifold.events`** — append-only. One document per lifecycle event: `run_started`, `model_started`, `model_materialized`, `model_failed`, `model_skipped`, `run_finished`. Each carries `runId`, `model`, timestamps, and metadata: docs written (from `$merge` response), duration, **pipeline hash** (canonical-JSON hash of the stage array — manifold's semantic `code_version`, see doc 04 §state), input fingerprints.
- **`_manifold.models`** — a derived summary (Dagster's `asset_keys` table): one doc per model caching `lastMaterialization`, last pipeline hash, last input fingerprints — so staleness queries don't scan the log.

```ts
type ManifoldEvent =
  | {
      type: "model_materialized";
      runId: string;
      model: string;
      ts: Date;
      pipelineHash: string;
      docsWritten: number;
      durationMs: number;
      inputFingerprints: Record<string, InputFingerprint>;
    }
  | {
      type: "model_failed";
      runId: string;
      model: string;
      ts: Date;
      attempt: number;
      error: string;
    };
```

The summary write is **non-transactional by design**: append the event first, then perform an idempotent summary upsert (corrected by the EPIC-G spike — see trd/EPIC-G-event-log-executor.md; this doc previously required the summary update "in the same transaction as the event append"). The spike measured the transaction as marginally _faster_, so the decision rests on correctness and reach, not cost: a crash between the two writes leaves a stale summary that fails safe (the model just re-runs; materialization is idempotent) and is rebuildable from events — and the non-transactional path works on standalone mongod (no replica-set requirement) with no `TransientTransactionError` retry machinery. Transactions remain an optional mode when a replset is detected; the contract must not require them. See `plan/spikes/event-log-exec.spike.ts` (executed; supersedes the illustrative `run-event-log.spike.ts`) for the full event union and derivations. Decision: events are the source of truth and the summary is a cache rebuildable from them — Dagster's exact split, and the property that makes every later feature a query rather than a migration.

## 3. Execution semantics (P0/P1)

**Node-granular ready-queue scheduling (P0).** Replace `Project.run`'s level-based stages (Kahn batches at Project.ts:495, `Promise.allSettled` per stage) with dbt's `GraphQueue` recipe (~230 lines in dbt): a priority queue of in-degree-0 nodes scored by topological depth; completing a node decrements successors' in-degrees and releases any that hit zero. A slow node no longer blocks unrelated work in the "next stage". Prerequisite: fix the lookup-edge bug (doc 01 §5) — the execution graph must include `lookup`/`unionWith` edges, not just `from`, or the queue schedules races.

**Per-Model retries with backoff (P0).** The universal shape across all six systems surveyed: retry is a property of the node, honored by the runner.

```ts
new Model({ name: "stg_events", from: events, pipeline: p => ...,
  materialize: Model.Mode.Upsert,
  retry: { maxAttempts: 3, backoffMs: 5_000, factor: 2 } });
```

Safe because materialization is idempotent by construction: `$out` replaces, `$merge` upserts keyed on `on:` — Inngest's memoization pattern where the "memoized result" is the materialized collection itself.

**Resume-from-failure (P0).** `project.run({ resumeFrom: runId })` queries the event log, skips models with a `model_materialized` event in that run whose pipeline hash is unchanged, and re-executes the rest. dbt-retry semantics with no `run_results.json` shuffling — the log is already in the database.

**Skipped-children propagation (P0 — promoted from P1 by EPIC-G: the ready-queue executor is incoherent without it, and naive dep-set deletion was shown to wrongly release grandchildren; see trd/EPIC-G-event-log-executor.md LOG-6) + bounded parallelism (P1).** On failure, mark all transitive dependents skipped via explicit BFS (emitting `model_skipped` with the causing model) rather than aborting the whole run — dbt's `_skipped_children`. Add `maxParallel` (bounded worker pool pulling from the ready queue): parallel `$merge`s contend on the same mongod, so unbounded `allSettled` is actively harmful at scale.

## 4. Staleness & automation (P1)

With the event log in place, `run({ onlyStale: true })` becomes a pure query. A model is stale iff any of: (a) its pipeline hash differs from the last materialization's; (b) an upstream model materialized more recently; (c) a _source collection_ has fresh data. For (c), two Mongo-native freshness probes — the analog of dbt `source freshness`/`loaded_at_field` that powers Orchestra's SAO:

- **Fingerprint probe**: cheap max-watermark query (`updatedAt`, or max `_id` — ObjectIds embed timestamps) declared per source.
- **Change-stream token probe**: open a change stream on the source, record the `postBatchResumeToken`; on the next tick, resuming from the stored token and receiving zero events proves nothing changed — no schema cooperation needed.

Cost story: a 5-minute cron running `manifold build --only-stale` skips everything untouched — the 30–75% build-reduction claim Orchestra sells, kept inside the product.

**Explicitly not building a scheduler daemon.** No cron parser, no long-running evaluation loop. Hosts trigger; manifold decides what to skip. Dagster's own lesson is that the scheduler is a stateless condition-evaluation function over stored state — anyone can supply the loop once the state exists. Dagster-style composable `AutomationCondition` trees (`anyDepsUpdated().and(not(inProgress()))`) are a P3 layer over the same event-log queries, worth doing only if a hosted product needs them.

## 5. The host / control-plane seam (P1)

Control planes integrate tools through exactly three touchpoints: start a run, stream per-node status, fetch parseable artifacts. dbt won distribution on this seam (dagster-dbt parses `manifest.json` and streams per-node JSON from one `dbt build`); Orchestra built a business on it. Manifold's version:

1. **`manifold-manifest.json` manifest** (filename standardized by EPIC-I — see trd/EPIC-I-cli-host-seam.md; this doc previously said `manifold.json`, the sketch said `.manifold/manifest.json`) — serialized graph: models, deps (including lookup edges), materialization config, pipeline hashes. Schema and versioning owned by doc 04; this doc's requirement is that it exists and is stable, so a `dagster-manifold` mapping Models→assets is an afternoon's work — by anyone.
2. **CLI**: `manifold run|build|test --select 'stg_events+' --only-stale --json`. `--json` streams one NDJSON event per line to stdout — the same `ManifoldEvent` shapes as §2, each carrying a `v` schema-version field (added to the event union by EPIC-I's contract requirement, owned by EPIC-G), so hosts consume exactly what the log stores. `build` interleaves tests (doc 04) with models in DAG order; graph selectors (`+model+`, tags) shared with doc 04's selector design.
3. **Run-results artifact** — per-model status/durations/docs-written plus the invocation args (dbt's trick that makes `retry` self-contained), written to a file and queryable from `_manifold.events`.

Exit codes and event shapes are the contract; an HTTP trigger wrapper is optional later (a 20-line express handler once the CLI semantics exist). The seam also serves PipeSafe commercially: a "managed state-aware manifold runner" is buildable _by us_ on ELv2 terms precisely because the skip decision consumes manifold's own persisted state.

## 6. EL: typed connectors (P2)

The EL landscape has a settled protocol vocabulary and an open lane. Follow dlt's form factor (library code in the user's runtime, not a platform) with Fivetran's semantics (the proven op/state contract):

```ts
type SourceOp<T> =
  | { op: "upsert"; doc: T } // full doc, keyed replace
  | { op: "update"; key: KeyOf<T>; patch: Partial<T> }
  | { op: "delete"; key: KeyOf<T> } // soft delete: _ps_deleted
  | { op: "truncate"; before: Date }
  | { op: "checkpoint"; state: JsonValue }; // opaque, connector-owned

interface ExternalSource<T> {
  pull(state: JsonValue | null): AsyncGenerator<SourceOp<T>>;
}
```

Decisions, with rationale:

- **Fivetran's four ops, verbatim.** They map 1:1 onto Mongo bulk ops (`replaceOne` upsert / `updateOne $set` / soft-delete flag / timestamped sweep), and system fields (`_ps_synced`, `_ps_deleted`) are a documented contract users demonstrably accept.
- **Checkpointed opaque state in Mongo** (`_manifold.sourceState` — the standardized name; the CDC spike's `_manifold.checkpoints` is unified onto it, see trd/EPIC-J-connectors-cdc.md CONN-2), persisted only after the preceding batch's `bulkWrite` resolves — the interface makes premature checkpointing unreachable, enforcing Fivetran's at-least-once + idempotent-upsert invariant (spike-verified: crash with applied-but-uncheckpointed events re-delivered exactly those, no loss, no duplication). Replays are safe because everything is keyed.
- **Change-stream CDC first-class, both directions.** _Mongo as source_: resume tokens are the natural checkpoint; `fullDocument: "updateLookup"`; the initial snapshot must capture `operationTime` **before** the snapshot read and start the stream from it — capturing it after silently loses concurrent updates (corrected by the EPIC-J spike — see trd/EPIC-J-connectors-cdc.md finding 1). Re-snapshot triggers are broader than `ChangeStreamHistoryLost` alone (also corrected by the spike, finding 3): match the `NonResumableChangeStreamError` label **or** code ∈ {286, 280, 50811} around the whole iteration loop, plus a liveness watchdog — a parseable resume token with a future timestamp is silently accepted and the stream idles forever. _Mongo as sink_: Airbyte's Mongo destination is archived, Fivetran has none — "first serious typed EL into MongoDB" is uncontested, and the loader lands an `ExternalSource<T>` into a collection that implements `Source<T>`, joining the existing DAG so the connector's TypeScript type flows through `$match`/`$group` at compile time. No other EL tool can say that.
- **Schema drift as the third pole**: Fivetran treats drift as a protocol event, dlt as a runtime contract; PipeSafe makes it a compile-time `PipeSafeError` (source type changed → downstream models fail `tsc` before deploy), with dlt-style runtime contracts (`evolve`/`freeze`/`discard`) for non-conforming documents.
- **One Parquet egress path**: a cursor (or change stream) over a Model's collection → Parquet files in object storage → `COPY INTO`. Fivetran's batch-file design without the gRPC ceremony; that single path makes manifold ELT-complete for warehouse handoff.

**Do NOT build**: a connector catalog (ship ≤5 exemplary typed sources plus Singer/Airbyte interop adapters); a hosted control plane; a generic multi-destination framework or `Migrate` algebra; a wire protocol (in-process TS interfaces beat proto files until there's a multi-language ecosystem); relational document shredding (the typed aggregation pipeline _is_ the shredder). See `plan/spikes/source-connector-api.spike.ts`.

## 7. Observability (P2)

Mostly free once §2 exists. Run-history queries are aggregations over `_manifold.events` — duration trends, failure rates, docs-written per model — expressible in PipeSafe itself (pleasing, and a real dogfood). `toMermaid()` already renders topology; the missing half is history overlaid on it, deferable to a tiny local viewer. Structured NDJSON logs come from the CLI (§5). Add optional OTel hooks — one span per model run, one per run — Trigger.dev's lesson that OTel-native observability lets users bring their own backend instead of waiting for our dashboard.

## 8. Phasing & risks

| Phase  | Scope                                                                                                                                          | Unlocks                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **P0** | Lookup-edge graph fix; `_manifold` event log + model summary; ready-queue executor; per-Model retries; `resumeFrom`                            | Durable, resumable, correctly-ordered runs           |
| **P1** | `onlyStale` + freshness probes; skipped-children; `maxParallel`; manifest + CLI with NDJSON events + run-results artifact; selectors (with 04) | Schedulable by anything; skip-state owned in-product |
| **P2** | `ExternalSource<T>` + checkpointed state; change-stream CDC source; Mongo-sink loader; Parquet egress; OTel + history queries                  | EL story; control-plane-grade observability          |
| **P3** | Composable automation conditions; host adapters (dagster-manifold, Temporal/Inngest recipes); optional HTTP trigger; local history viewer      | Hosted/managed-runner product surface                |

**Risks.** (1) _Scope creep into workflow-engine land_ — the moment manifold grows a daemon, arbitrary code tasks, or cross-system triggers, it competes with Temporal on Temporal's terms; the mitigation is the §4 rule: hosts trigger, manifold skips. (2) _Multi-writer concurrency on the event log_ — two concurrent CLI invocations against one `_manifold` db; mitigate with a per-run document-level lease (`findOneAndUpdate` lock per model) and transactional event+summary writes. (3) _Resume-token expiry_ — a paused CDC source outliving oplog retention throws `ChangeStreamHistoryLost`; the connector contract must mandate automatic re-snapshot (truncate + full re-sync), Fivetran's exact behavior. (4) _Hosting the CLI in serverless environments_ — long aggregations vs. Lambda timeouts and the singleton's double-connect throw; mitigate with per-invocation client injection, `resumeFrom` making interrupted runs cheap to continue, and documenting the "one model per invocation" pattern for step-function-style hosts.
