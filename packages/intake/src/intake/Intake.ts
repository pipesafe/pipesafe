/**
 * Intake - the idempotent replication unit
 *
 * One Intake replicates one external entity ("stripe customers") into one
 * landing collection. It has two routes to the same documents:
 *
 * - the BATCH route: a handler over a time window, run on one or more
 *   schedules. Because it is idempotent it IS the reconciliation job -
 *   backfill, incremental sync and gap recovery are the same handler with
 *   different windows.
 * - the EVENT route (optional): a handler over natural keys extracted from
 *   webhook envelopes, for sources where waiting for the next batch tick is
 *   too slow.
 *
 * Both routes yield the same TDoc into the same collection under the same
 * natural key, which is what makes idempotency meaningful ACROSS them and
 * not merely within each. Coalescing needs no configuration: the dispatcher
 * dedupes identifiers across the claimed envelope set, so N events touching
 * R resources produce one run with R identifiers.
 *
 * The landing collection is a core Collection (and therefore a Source), so
 * replicated data plugs straight into Pipelines and manifold Models.
 */
import { Collection } from "@pipesafe/core";
import type { Document } from "@pipesafe/core";
import type { IntakeEnvelope } from "../envelope/Envelope";
import type { Webhook } from "../webhook/Webhook";
import { IntakeNotImplementedError } from "../errors";
import type { BatchScope, Duration, EventScope, IntakeScope } from "./Scope";

export interface IntakeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Writer-set fields on every landed document. `_id` comes from the natural
 * key so downstream `Model.Mode.Upsert` (`$merge on: "_id"`) composes.
 *
 * `_deletedAt` is optional AND nullable because all three states are real:
 * absent (never deleted), a Date (soft-deleted), and null (deleted, then
 * resurrected by a later upsert - cleared rather than `$unset`). That is
 * also what makes the MongoDB idiom for "not deleted" - `{ _deletedAt:
 * null }`, which matches a null value OR a missing field - the correct
 * downstream filter, and it typechecks. Do NOT reach for `$exists: false`:
 * it is stricter than intended (it excludes an explicitly-null document).
 */
export interface IntakeMeta {
  _id: string;
  _deletedAt?: Date | null;
}

export interface IntakeContext {
  /**
   * Wrapped fetch: retries with backoff on 429/5xx and honors the intake's
   * `rateLimit` so handlers stay simple.
   */
  fetch: typeof fetch;
  /**
   * Record a deletion of the document with this natural key. Yielding
   * documents is how a handler says "these exist"; this is how it says
   * "this one is gone" (a `customer.deleted` event, or a 404 on a
   * targeted fetch). No-op unless `output.deletes` is configured.
   */
  delete(key: string): void;
  logger: IntakeLogger;
}

/**
 * Handlers are scoped: a batch handler only ever receives a batch scope, an
 * event handler only ever an event scope. Both yield TDoc - an AsyncIterable
 * supports pagination without buffering.
 */
export type IntakeHandler<TScope extends IntakeScope, TDoc extends Document> = (
  scope: TScope,
  ctx: IntakeContext
) => AsyncIterable<TDoc> | Promise<TDoc[]>;

/** What a scheduled batch run covers. */
export interface IntakeSchedule {
  /**
   * 5-field cron expression, UTC. Declared here so your IaC can read it
   * off `IntakeStack.manifest()` and create the trigger; intake does not
   * create schedules itself.
   */
  cron: string;
  /**
   * Window size, resolved to concrete dates at fire time. Omit for an
   * unbounded run (a full sweep - what `deletes.sweep` needs).
   */
  lookback?: Duration;
}

/**
 * What to do when a scheduled batch run is still in flight at the next
 * tick. Governs batch-vs-batch only: an event run racing a batch run is
 * made safe by `output.version`, not by this.
 */
export type OverlapPolicy = "skip" | "queue" | "allow";

export interface IntakeBatchConfig<TDoc extends Document> {
  handler: IntakeHandler<BatchScope, TDoc>;
  /**
   * Any number of cadences over the same handler - typically a frequent
   * narrow window plus a periodic wide reconcile, e.g. every 5 minutes over
   * 1h and nightly over 7d. On-demand backfill is `Intake.run` with an
   * explicit window; it needs no declaration here.
   */
  schedules?: readonly IntakeSchedule[];
  /** Defaults to "skip" (lease-based). */
  overlap?: OverlapPolicy;
}

/**
 * How this intake's landed envelopes become event runs. Per-INTAKE, not
 * per-stack: a high-volume notification source wants claim-based batched
 * dispatch, while a low-volume latency-sensitive one wants the push path,
 * and they routinely sit in the same deployment.
 *
 * `poll` is the default: a cron trigger your IaC already knows how to
 * create invokes the dispatch handler, which claims everything accumulated
 * since the last run - exactly the shape identifier coalescing wants, and
 * no always-on process. `changeStream` trades that for lower idle latency,
 * at the cost of running the watcher as a long-lived worker.
 */
export type EventDispatch =
  | { strategy: "poll"; cron?: string }
  | { strategy: "changeStream" };

export interface IntakeEventConfig<
  TEvent extends Document,
  TDoc extends Document,
> {
  /**
   * The webhook whose envelopes drive this route. Referenced, not owned:
   * one provider endpoint commonly feeds several intakes (one Stripe
   * endpoint -> customers, invoices, subscriptions).
   */
  webhook: Webhook<string, TEvent>;
  /** Natural keys this envelope implicates. Deduped across the claim. */
  identifiers: (envelope: IntakeEnvelope<TEvent>) => string[];
  /** Ignore envelopes this route does not care about. */
  filter?: (envelope: IntakeEnvelope<TEvent>) => boolean;
  handler: IntakeHandler<EventScope, TDoc>;
  /**
   * Max concurrent event runs. Bounds fan-out, connection-pool pressure and
   * function concurrency - NOT the third-party request rate, which drifts
   * with API latency at fixed concurrency. Use `rateLimit` for the budget.
   */
  concurrencyLimit?: number;
  /** Defaults to `{ strategy: "poll" }`. */
  dispatch?: EventDispatch;
}

/** How detected deletions are applied. Omit to ignore deletions entirely. */
export interface IntakeDeletes {
  /** "soft" stamps `_deletedAt`; "hard" removes the document. */
  mode: "soft" | "hard";
  /**
   * Also detect deletions structurally on UNBOUNDED batch runs: mark the
   * run, upsert everything the handler yields, then apply `mode` to any
   * document the run did not see. Only sound without a window - a bounded
   * run has not looked at the whole entity.
   */
  sweep?: boolean;
}

export interface IntakeOutput<TDoc extends Document> {
  collection: string;
  database?: string;
  /**
   * Natural-key field, e.g. "id" for Stripe. Drives the idempotent upsert
   * and is written to `_id`.
   */
  key: keyof TDoc & string;
  /**
   * Monotonic guard: a write only applies when this field is greater than
   * or equal to the stored value. Required in practice once both routes are
   * live - an event run and a batch run may legitimately be in flight over
   * the same document, and last-write-wins would let an older fetch that
   * landed second regress the record.
   */
  version?: keyof TDoc & string;
  deletes?: IntakeDeletes;
}

export interface IntakeConfig<
  TName extends string,
  TEvent extends Document,
  TDoc extends Document,
> {
  name: TName;
  /** The reconciliation job. Every intake has one. */
  batch: IntakeBatchConfig<TDoc>;
  /** Low-latency route for sources that push. Optional by design. */
  event?: IntakeEventConfig<TEvent, TDoc>;
  /**
   * Third-party request budget, shared by BOTH routes - a nightly sweep and
   * an event burst spend from the same account ceiling, so neither route
   * can own it. Treat it as this intake's SHARE of a possibly account-wide
   * limit, not the documented limit.
   */
  rateLimit?: { requestsPerSecond: number };
  output: IntakeOutput<TDoc>;
}

export interface IntakeRunResult {
  scope: IntakeScope;
  written: number;
  deleted: number;
}

export class Intake<
  TName extends string = string,
  TEvent extends Document = Document,
  TDoc extends Document = Document,
> {
  /**
   * The typed landing collection - a core Source, directly usable as a
   * Model's `from`. Includes the writer-set meta fields.
   */
  readonly output: Collection<TDoc & IntakeMeta>;

  private readonly config: IntakeConfig<TName, TEvent, TDoc>;

  constructor(config: IntakeConfig<TName, TEvent, TDoc>) {
    this.config = config;
    this.output = new Collection<TDoc & IntakeMeta>({
      collectionName: config.output.collection,
      databaseName: config.output.database,
    });
  }

  getName(): TName {
    return this.config.name;
  }

  getBatch(): IntakeBatchConfig<TDoc> {
    return this.config.batch;
  }

  getEvent(): IntakeEventConfig<TEvent, TDoc> | undefined {
    return this.config.event;
  }

  getOutput(): IntakeOutput<TDoc> {
    return this.config.output;
  }

  /**
   * Run this intake once over an explicit scope - the same entry point the
   * schedules and the event dispatcher use. A historical backfill is
   * `run({ kind: "batch", window: { from, to } })`; no separate mechanism.
   */
  run(_scope: IntakeScope): Promise<IntakeRunResult> {
    throw new IntakeNotImplementedError("Intake.run");
  }
}
