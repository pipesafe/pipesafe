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
      /** 5-field cron expression, UTC. */
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
  /** Natural-key field for idempotent upserts, e.g. "id" for Stripe. */
  key: keyof TDoc & string;
  /** "upsert" (default) is required for effectively-once processing. */
  mode?: "upsert" | "append";
}

export interface FetcherConfig<
  TName extends string,
  TEvent extends Document,
  TDoc extends Document,
> {
  name: TName;
  trigger: FetcherTrigger<TEvent>;
  /**
   * Called once per envelope (webhook trigger) or per tick (schedule
   * trigger; `envelope` is null). Return or yield the documents to
   * write - an AsyncIterable supports pagination without buffering.
   */
  handler: (
    input: { envelope: IntakeEnvelope<TEvent> | null },
    ctx: FetchContext
  ) => AsyncIterable<TDoc> | Promise<TDoc[]>;
  output: FetcherOutput<TDoc>;
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
   * as a Model's `from`.
   */
  readonly output: Collection<TDoc>;

  private readonly config: FetcherConfig<TName, TEvent, TDoc>;

  constructor(config: FetcherConfig<TName, TEvent, TDoc>) {
    this.config = config;
    this.output = new Collection<TDoc>({
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
