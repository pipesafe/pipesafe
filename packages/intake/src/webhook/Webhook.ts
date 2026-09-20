/**
 * Webhook - declarative webhook source
 *
 * Declares an HTTP endpoint that receives third-party events, verifies
 * them, and persists the raw envelope. Like manifold's Model, a Webhook
 * does no I/O itself - the runtime (local dev server or deployed gateway
 * function) executes it. Its landing collection is a core Collection (and
 * therefore a Source), so raw envelopes are directly queryable with
 * Pipelines and usable as Model inputs.
 */
import { Collection } from "@pipesafe/core";
import type { Document } from "@pipesafe/core";
import type { IntakeEnvelope } from "../envelope/Envelope";
import type { Verifier } from "../verify/Verifier";

export interface WebhookConfig<TName extends string, TEvent extends Document> {
  /** Unique name within the Intake, e.g. "stripe". */
  name: TName;
  /** URL path the provider exposes, e.g. "/webhooks/stripe". */
  path: `/${string}`;
  /** Signature verification scheme. */
  verify: Verifier;
  /**
   * Extract the provider's event id from the payload - the idempotency
   * key. The envelope `_id` becomes `${name}:${eventId}`.
   */
  eventId: (body: TEvent, headers: Readonly<Record<string, string>>) => string;
  /** Landing collection for raw envelopes; defaults to `${name}_events`. */
  eventsCollection?: string;
  database?: string;
  /**
   * Header allowlist persisted into envelopes (defaults to content-type
   * plus the verifier's scheme-relevant headers). Auth headers are never
   * persisted.
   */
  keepHeaders?: string[];
}

export class Webhook<
  TName extends string = string,
  TEvent extends Document = Document,
> {
  /**
   * The raw-envelope landing collection as a core Source - usable in
   * Pipelines and as a Model's `from`.
   */
  readonly events: Collection<IntakeEnvelope<TEvent>>;

  private readonly config: WebhookConfig<TName, TEvent>;

  constructor(config: WebhookConfig<TName, TEvent>) {
    this.config = config;
    this.events = new Collection<IntakeEnvelope<TEvent>>({
      collectionName: config.eventsCollection ?? `${config.name}_events`,
      databaseName: config.database,
    });
  }

  getName(): TName {
    return this.config.name;
  }

  getPath(): `/${string}` {
    return this.config.path;
  }

  getVerifier(): Verifier {
    return this.config.verify;
  }
}
