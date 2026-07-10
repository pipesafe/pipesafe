/**
 * Dispatcher - how envelope inserts reach fetcher consumers
 *
 * The envelope collection is the transport (the gateway's insert IS the
 * enqueue); dispatch strategies differ only in how consumers learn about
 * new envelopes. All strategies deliver at-least-once; the envelope
 * ledger + natural-key upserts make processing effectively-once, and the
 * sweeper re-drives anything stuck or failed regardless of strategy.
 *
 * "atlasTrigger" (Atlas Database Trigger -> EventBridge -> consumer) is
 * deliberately NOT modeled yet: trigger match/project expressions over
 * change events are a typed-aggregation surface that belongs to the whole
 * suite, and its dev experience needs its own design pass. Its event shape
 * is already mirrored by watcherBridge, so it can slot in later as a pure
 * dispatcher swap with no consumer changes.
 */

/**
 * Default for AWS deployments (Atlas and self-hosted alike): a minimal
 * always-on bridge container that watches the envelope change stream
 * (resume tokens persisted in the state store) and asynchronously invokes
 * the consumer functions. Needed because FaaS platforms have no event
 * source mapping for real MongoDB change streams; consumers stay
 * scale-to-zero serverless.
 */
export interface WatcherBridgeDispatch {
  strategy: "watcherBridge";
  cpu?: number;
  memoryMb?: number;
}

/**
 * In-process `collection.watch()` with persisted resume tokens. Used by
 * `Intake.dev()` and long-running runtimes; not deployable to FaaS.
 */
export interface ChangeStreamWatcherDispatch {
  strategy: "changeStreamWatcher";
}

/**
 * Zero-extra-infra fallback for any replica-set MongoDB: scheduled
 * consumers claim envelopes atomically (findOneAndUpdate lease); lease
 * expiry is the visibility timeout. Higher latency, no always-on parts.
 */
export interface LedgerPollerDispatch {
  strategy: "ledgerPoller";
  /** 5-field cron expression for the polling schedule, UTC. */
  schedule?: string;
  leaseSeconds?: number;
}

export type DispatchConfig =
  | WatcherBridgeDispatch
  | ChangeStreamWatcherDispatch
  | LedgerPollerDispatch;

export type DispatchStrategy = DispatchConfig["strategy"];
