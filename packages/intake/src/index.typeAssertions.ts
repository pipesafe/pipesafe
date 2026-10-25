/**
 * Type assertions pinning @pipesafe/intake's public generic flow:
 * TEvent flows webhook -> envelope -> event filter/identifiers; TDoc flows
 * BOTH handlers -> output.key -> Intake.output Collection. The scope arms
 * are pinned too: each handler sees only its own arm, so neither has to
 * narrow something that cannot vary.
 *
 * Compile-time only - validated by `tsc --noEmit` (typecheck:packages).
 */
import type {
  Assert,
  Collection,
  Equal,
  InferSourceType,
  IsAssignable,
  Source,
} from "@pipesafe/core";
import { Webhook } from "./webhook/Webhook";
import { Intake } from "./intake/Intake";
import type { IntakeMeta } from "./intake/Intake";
import type { BatchScope, EventScope, IntakeScope } from "./intake/Scope";
import { verifiers } from "./verify/Verifier";
import type { IntakeEnvelope } from "./envelope/Envelope";

// ============================================================================
// Fixture schemas
// ============================================================================

interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id: string } };
}

interface StripeCustomer {
  id: string;
  email: string;
  livemode: boolean;
  updated: number;
}

// ============================================================================
// Scope: the handler arms are exactly the union members
// ============================================================================

type BatchArmTest = Assert<
  Equal<BatchScope, { kind: "batch"; window?: { from?: Date; to?: Date } }>
>;
type EventArmTest = Assert<
  Equal<EventScope, { kind: "event"; identifiers: string[] }>
>;
type ScopeIsExhaustiveTest = Assert<
  Equal<IntakeScope, BatchScope | EventScope>
>;

// ============================================================================
// Webhook: TEvent flows into the envelope collection
// ============================================================================

const stripe = new Webhook<"stripe", StripeEvent>({
  name: "stripe",
  path: "/webhooks/stripe",
  verify: verifiers.stripe("whsec_test"),
  eventId: (body) => body.id,
});

type WebhookNameTest = Assert<
  Equal<ReturnType<typeof stripe.getName>, "stripe">
>;
type WebhookEventsTest = Assert<
  Equal<typeof stripe.events, Collection<IntakeEnvelope<StripeEvent>>>
>;
type EnvelopeBodyTest = Assert<
  Equal<InferSourceType<typeof stripe.events>["body"], StripeEvent>
>;

// ============================================================================
// Intake: both routes yield the same TDoc; key/version constrained to it
// ============================================================================

const _customers = new Intake({
  name: "stripe_customers",
  batch: {
    handler: async function* (scope) {
      // The batch handler sees only the batch arm
      const since: Date | undefined = scope.window?.from;
      yield {
        id: "cus_1",
        email: "a@b.co",
        livemode: true,
        updated: since?.getTime() ?? 0,
      } as StripeCustomer;
    },
    schedules: [
      { cron: "*/5 * * * *", lookback: "1h" },
      { cron: "0 3 * * *", lookback: "7d" },
      // No lookback: an unbounded sweep, which is what deletes.sweep needs
      { cron: "0 4 * * 0" },
    ],
    overlap: "skip",
  },
  event: {
    webhook: stripe,
    // filter and identifiers see the typed envelope
    filter: (envelope) => envelope.body.type.startsWith("customer."),
    identifiers: (envelope) => [envelope.body.data.object.id],
    handler: async function* (scope, ctx) {
      // The event handler sees only the event arm
      for (const id of scope.identifiers) {
        if (id === "gone") {
          ctx.delete(id);
          continue;
        }
        yield {
          id,
          email: "a@b.co",
          livemode: true,
          updated: 1,
        } as StripeCustomer;
      }
    },
    concurrencyLimit: 4,
  },
  rateLimit: { requestsPerSecond: 3 },
  output: {
    collection: "stripe_customers",
    key: "id",
    version: "updated",
    deletes: { mode: "soft", sweep: true },
  },
});

// The landing collection carries the writer-set meta fields
type IntakeOutputTest = Assert<
  Equal<typeof _customers.output, Collection<StripeCustomer & IntakeMeta>>
>;
// `_deletedAt` must accept null so the downstream live-document filter -
// `p.match({ _deletedAt: null })`, MongoDB's null-or-missing idiom - stays
// typeable. (`$exists: false` is the wrong matcher AND narrows to `never`.)
type SoftDeleteFilterableTest = Assert<
  IsAssignable<null, (StripeCustomer & IntakeMeta)["_deletedAt"]>
>;
type IntakeNameTest = Assert<
  Equal<ReturnType<typeof _customers.getName>, "stripe_customers">
>;

// ============================================================================
// Interop: landing collections are core Sources (Model `from` compatible)
// ============================================================================

type EventsAreASourceTest = Assert<
  IsAssignable<typeof stripe.events, Source<IntakeEnvelope<StripeEvent>>>
>;
type OutputIsASourceTest = Assert<
  IsAssignable<typeof _customers.output, Source<StripeCustomer & IntakeMeta>>
>;
type OutputInferenceTest = Assert<
  Equal<InferSourceType<typeof _customers.output>, StripeCustomer & IntakeMeta>
>;

export type {
  BatchArmTest,
  EventArmTest,
  ScopeIsExhaustiveTest,
  WebhookNameTest,
  WebhookEventsTest,
  EnvelopeBodyTest,
  IntakeOutputTest,
  SoftDeleteFilterableTest,
  IntakeNameTest,
  EventsAreASourceTest,
  OutputIsASourceTest,
  OutputInferenceTest,
};
