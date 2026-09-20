/**
 * Fetcher - enrichment / polling unit
 *
 * Turns envelopes (or cron ticks) into full documents by calling the
 * third-party REST API, writing typed docs to an output collection.
 * Natural-key upserts on the output are the second idempotency layer
 * (after the envelope ledger): replaying the same event rewrites the
 * same documents, so at-least-once dispatch becomes effectively-once
 * processing.
 *
 * The output collection is a core Collection (and therefore a Source),
 * so fetched data plugs straight into Pipelines and manifold Models.
 */
import { Collection } from "@pipesafe/core";
import type { Document } from "@pipesafe/core";
import type { SecretRef } from "@pipesafe/infra";
import type { IntakeEnvelope } from "../envelope/Envelope";
import type { Webhook } from "../webhook/Webhook";

export interface IntakeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type FetcherTrigger<TEvent extends Document> =
  | {
      /**
       * Fire once per envelope landing on this webhook. Lowers to a
       * manifold ChangeSubscription on the envelope collection's inserts -
       * intake declares the reaction; manifold's event layer delivers it.
       */
      webhook: Webhook<string, TEvent>;
      filter?: (envelope: IntakeEnvelope<TEvent>) => boolean;
    }
  | {
      /**
       * 5-field cron expression, UTC. See infra's `ScheduleSpec.cron` for
       * the portability contract (providers translate; both-day-fields
       * expressions are rejected).
       */
      schedule: string;
    };

export interface FetchContext {
  getSecret(ref: SecretRef): Promise<string>;
  /**
   * Wrapped fetch: retries with backoff on 429/5xx and honors the
   * fetcher's rateLimit so handlers stay simple.
   */
  fetch: typeof fetch;
  logger: IntakeLogger;
}

export interface FetcherOutput<TDoc extends Document> {
  collection: string;
  database?: string;
  /**
   * Natural-key field for idempotent upserts, e.g. "id" for Stripe. The
   * writer also sets `_id` from this key, so stored docs are
   * `TDoc & { _id: string }` and downstream Model.Mode.Upsert composes.
   */
  key: keyof TDoc & string;
  /** "upsert" (default) is required for effectively-once processing. */
  mode?: "upsert" | "append";
}

/**
 * Read-side coalescing: collapse the pending envelope backlog to one unit
 * of work per key BEFORE fetching. Natural-key upserts already make the
 * write side idempotent; coalescing is what keeps the read side inside a
 * rate budget. For notification-only sources (webhook carries only a
 * resource id), a burst of N events referencing R distinct resources needs
 * R fetches, not N - against a shared per-account limit that is the
 * difference between minutes and hours of staleness during a spike.
 */
export interface CoalesceConfig<TEvent extends Document> {
  /**
   * Envelopes with equal keys are collapsed to the LATEST envelope per key
   * within a claimed batch (e.g. the resource id from the payload).
   */
  key: (envelope: IntakeEnvelope<TEvent>) => string;
  /** Max distinct keys handed to one handler invocation. */
  maxBatchSize?: number;
  /** Max time work may accumulate before a claim must run. */
  maxWaitSeconds?: number;
}

export interface FetcherConfig<
  TName extends string,
  TEvent extends Document,
  TDoc extends Document,
> {
  name: TName;
  trigger: FetcherTrigger<TEvent>;
  /**
   * Called with a CLAIMED BATCH of envelopes (webhook trigger) or an
   * empty array (schedule trigger ticks). Receiving a set - rather than
   * one envelope per call - is what makes ID-set batched requests
   * possible ("give me these 50 resources in one call"); with `coalesce`
   * configured the batch is already deduped to the latest envelope per
   * key. Return or yield the documents to write - an AsyncIterable
   * supports pagination without buffering.
   */
  handler: (
    input: { envelopes: IntakeEnvelope<TEvent>[] },
    ctx: FetchContext
  ) => AsyncIterable<TDoc> | Promise<TDoc[]>;
  output: FetcherOutput<TDoc>;
  /** Collapse the pending backlog per key before fetching. */
  coalesce?: CoalesceConfig<TEvent>;
  rateLimit?: { requestsPerSecond: number };
  /** Consumer-level attempts; transport retries come from the sweeper. */
  retry?: { maxAttempts?: number };
}

export class Fetcher<
  TName extends string = string,
  TEvent extends Document = Document,
  TDoc extends Document = Document,
> {
  /**
   * The typed output landing collection - a core Source, directly usable
   * as a Model's `from`. Stored docs carry `_id` (set by the upsert
   * writer from the natural key), so the type includes it.
   */
  readonly output: Collection<TDoc & { _id: string }>;

  private readonly config: FetcherConfig<TName, TEvent, TDoc>;

  constructor(config: FetcherConfig<TName, TEvent, TDoc>) {
    this.config = config;
    this.output = new Collection<TDoc & { _id: string }>({
      collectionName: config.output.collection,
      databaseName: config.output.database,
    });
  }

  getName(): TName {
    return this.config.name;
  }

  getTrigger(): FetcherTrigger<TEvent> {
    return this.config.trigger;
  }
}
