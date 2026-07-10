/**
 * Dispatch strategies - how change events reach consumers
 *
 * A ChangeSubscription needs a delivery mechanism. All strategies deliver
 * at-least-once; consumers are responsible for idempotency (e.g. intake's
 * envelope ledger + natural-key upserts, or a Model's $merge semantics).
 *
 * "atlasTrigger" (Atlas Database Trigger -> EventBridge -> consumer) is
 * deliberately NOT modeled yet: trigger match/project expressions over
 * change events are a typed-aggregation surface that needs its own design
 * pass. Its event shape is already mirrored by watcherBridge, so it can
 * slot in later as a pure strategy swap with no consumer changes.
 */

/**
 * Default for cloud deployments (Atlas and self-hosted alike): a minimal
 * always-on bridge container that watches change streams (resume tokens
 * persisted in the state store) and asynchronously invokes the consumer
 * functions. Needed because FaaS platforms have no event source mapping
 * for real MongoDB change streams; consumers stay scale-to-zero
 * serverless.
 */
export interface WatcherBridgeDispatch {
  strategy: "watcherBridge";
  cpu?: number;
  memoryMb?: number;
}

/**
 * In-process `collection.watch()` with persisted resume tokens. Used by
 * local dev servers and long-running runtimes; not deployable to FaaS.
 */
export interface ChangeStreamWatcherDispatch {
  strategy: "changeStreamWatcher";
}

/**
 * Zero-extra-infra fallback for any replica-set MongoDB: scheduled
 * consumers claim work atomically (findOneAndUpdate lease); lease expiry
 * is the visibility timeout. Requires the watched collection to carry
 * claimable status/lease fields (e.g. intake's envelope ledger). Higher
 * latency, no always-on parts.
 */
export interface LedgerPollerDispatch {
  strategy: "ledgerPoller";
  /**
   * 5-field cron expression for the polling schedule, UTC. Providers
   * translate to native syntax; expressions constraining both day fields
   * are rejected (not portably expressible).
   */
  schedule?: string;
  leaseSeconds?: number;
}

export type DispatchConfig =
  | WatcherBridgeDispatch
  | ChangeStreamWatcherDispatch
  | LedgerPollerDispatch;

export type DispatchStrategy = DispatchConfig["strategy"];
