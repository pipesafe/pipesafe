/**
 * Example: Realtime Stripe Replica (scaffold preview)
 *
 * This example demonstrates the intended end-to-end flow:
 * 1. A verified Stripe webhook lands raw envelopes in `stripe_events`
 * 2. A fetcher enriches customer events via the Stripe REST API into
 *    `stripe_customers` (natural-key upserts = effectively-once)
 * 3. The fetcher's output collection is a core Source, so a manifold
 *    Model consumes it directly - the ingestion-to-analytics DAG
 *
 * Phase 0 note: declarations compile and the type flow is real, but
 * runtime methods (dev/deploy/replay) throw IntakeNotImplementedError
 * until later phases. See packages/intake/ARCHITECTURE.md.
 */

import { Model, Project } from "@pipesafe/manifold";
import { secret } from "@pipesafe/infra";
import { Webhook, Fetcher, Intake, verifiers } from "@pipesafe/intake";

// ============================================================================
// Payload Schemas (typically sourced from Stripe's published typings)
// ============================================================================

type StripeEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: { id: string } };
};

type StripeCustomer = {
  id: string;
  email: string;
  name: string;
  livemode: boolean;
  created: number;
};

// ============================================================================
// Declare the Webhook (raw envelopes land in `stripe_events`)
// ============================================================================

const stripe = new Webhook<"stripe", StripeEvent>({
  name: "stripe",
  path: "/webhooks/stripe",
  verify: verifiers.stripe(secret("STRIPE_SIGNING_SECRET")),
  eventId: (body) => body.id,
});

// ============================================================================
// Declare the Fetcher (enrich customer events via the Stripe REST API)
// ============================================================================

const customers = new Fetcher({
  name: "stripe_customers",
  trigger: {
    webhook: stripe,
    filter: (envelope) => envelope.body.type.startsWith("customer."),
  },
  handler: async function* ({ envelope }, ctx) {
    const apiKey = await ctx.getSecret(secret("STRIPE_API_KEY"));
    const objectId = envelope?.body.data.object.id;
    const res = await ctx.fetch(
      `https://api.stripe.com/v1/customers/${objectId ?? ""}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    yield (await res.json()) as StripeCustomer;
  },
  output: { collection: "stripe_customers", key: "id", mode: "upsert" },
});

// ============================================================================
// The Intake (deployment unit - this module is the bundling entry)
// ============================================================================

export default new Intake({
  name: "acme",
  webhooks: [stripe],
  fetchers: [customers],
  mongoUri: secret("MONGODB_URI"),
});

// ============================================================================
// Manifold side: Fetcher.output is a Source<StripeCustomer>
// ============================================================================

const dimCustomers = new Model({
  name: "dim_customers",
  from: customers.output,
  pipeline: (p) => p.match({ livemode: true }),
  materialize: { type: "collection", mode: Model.Mode.Upsert },
});

const project = new Project({
  name: "stripe_analytics",
  models: [dimCustomers],
});

console.log("Webhook path:", stripe.getPath());
console.log("Fetcher output collection:", customers.output.getCollectionName());
console.log(project.plan().toString());
