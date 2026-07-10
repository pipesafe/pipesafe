/**
 * Type assertions pinning @pipesafe/intake's public generic flow:
 * TEvent flows webhook -> envelope -> trigger filter -> handler input;
 * TDoc flows handler -> output.key -> Fetcher.output Collection.
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
import { secret } from "@pipesafe/infra";
import { Webhook } from "./webhook/Webhook";
import { Fetcher } from "./fetcher/Fetcher";
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
}

// ============================================================================
// Webhook: TEvent flows into the envelope collection
// ============================================================================

const stripe = new Webhook<"stripe", StripeEvent>({
  name: "stripe",
  path: "/webhooks/stripe",
  verify: verifiers.stripe(secret("STRIPE_SIGNING_SECRET")),
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
// Fetcher: TEvent in, TDoc out, natural key constrained to keyof TDoc
// ============================================================================

const _customers = new Fetcher({
  name: "stripe_customers",
  trigger: {
    webhook: stripe,
    // The filter sees the typed envelope
    filter: (envelope) => envelope.body.type.startsWith("customer."),
  },
  handler: async function* ({ envelope }) {
    // The handler sees the typed envelope (null only for schedule triggers)
    const objectId = envelope?.body.data.object.id ?? "cus_unknown";
    yield {
      id: objectId,
      email: "a@b.co",
      livemode: true,
    } as StripeCustomer;
  },
  output: { collection: "stripe_customers", key: "id", mode: "upsert" },
});

type FetcherOutputTest = Assert<
  Equal<typeof _customers.output, Collection<StripeCustomer>>
>;

// ============================================================================
// Interop: landing collections are core Sources (Model `from` compatible)
// ============================================================================

type EventsAreASourceTest = Assert<
  IsAssignable<typeof stripe.events, Source<IntakeEnvelope<StripeEvent>>>
>;
type OutputIsASourceTest = Assert<
  IsAssignable<typeof _customers.output, Source<StripeCustomer>>
>;
type OutputInferenceTest = Assert<
  Equal<InferSourceType<typeof _customers.output>, StripeCustomer>
>;

export type {
  WebhookNameTest,
  WebhookEventsTest,
  EnvelopeBodyTest,
  FetcherOutputTest,
  EventsAreASourceTest,
  OutputIsASourceTest,
  OutputInferenceTest,
};
