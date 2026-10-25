/**
 * IntakeEnvelope - raw storage that IS the queue and the idempotency ledger
 *
 * Every accepted webhook request is stored verbatim BEFORE any processing.
 * The `_id` is `${webhookName}:${eventId}`, so a unique-index violation on
 * insert means "already received" - the envelope collection doubles as the
 * delivery/idempotency ledger. It is also the transport: dispatchers react
 * to envelope inserts (change streams) or claim work from it (leases), and
 * the retry/DLQ story is entirely status transitions on this collection.
 * `replay()` and audits read it; it is the single source of truth for
 * "what arrived".
 */
import type { Document } from "@pipesafe/core";

/**
 * Envelope lifecycle:
 * received -> processing -> processed
 *                        -> failed (retried by the sweeper with backoff)
 *                        -> dead (after maxAttempts; re-drivable via replay)
 */
export type EnvelopeStatus =
  | "received"
  | "processing"
  | "processed"
  | "failed"
  | "dead";

export interface IntakeEnvelope<TEvent extends Document = Document> {
  /** `${webhookName}:${eventId}` - unique, hence the idempotency ledger. */
  _id: string;
  /** Webhook name the event arrived through. */
  source: string;
  /** The provider's event id (e.g. Stripe `evt_...`). */
  eventId: string;
  receivedAt: Date;
  /** Allowlisted header subset only - auth headers are never persisted. */
  headers: Record<string, string>;
  /** Whether signature verification passed. */
  verified: boolean;
  /** The raw parsed payload, untouched. */
  body: TEvent;
  status: EnvelopeStatus;
  attempts: number;
  lastError?: string;
  processedAt?: Date;
  /** Claim lease for the ledger-poller dispatcher (visibility timeout). */
  leaseUntil?: Date;
}
