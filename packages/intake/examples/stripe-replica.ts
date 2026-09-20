/**
 * Example: Stripe customer replica (scaffold preview)
 *
 * Demonstrates the intended end-to-end flow:
 * 1. A verified Stripe webhook lands raw envelopes in `stripe_events`
 * 2. One Intake replicates customers into `stripe_customers` by two routes
 *    to the same documents:
 *      - batch: list customers changed in a window, on two cadences plus a
 *        weekly unbounded sweep that also detects deletions
 *      - event: fetch exactly the customers a webhook implicated
 *    Both upsert on the natural key with a monotonic version guard, so the
 *    routes are idempotent individually AND against each other
 * 3. The landing collection is a core Source, so a manifold Model consumes
 *    it directly - the ingestion-to-analytics DAG
 *
 * Phase 0 note: declarations compile and the type flow is real, but runtime
 * methods (run/dev/replay) and the handler factories throw
 * IntakeNotImplementedError until later phases. Intake provisions nothing:
 * `stack.manifest()` says what to create and the handlers in
 * `@pipesafe/intake` are what your resources invoke.
 * See packages/intake/ARCHITECTURE.md.
 */

import { Model, Project } from "@pipesafe/manifold";
import { Webhook, Intake, IntakeStack, verifiers } from "@pipesafe/intake";

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
  updated: number;
};

// ============================================================================
// Declare the Webhook (raw envelopes land in `stripe_events`)
// ============================================================================

const stripe = new Webhook<"stripe", StripeEvent>({
  name: "stripe",
  path: "/webhooks/stripe",
  // Your IaC provisions and injects the secret; intake just reads it.
  verify: verifiers.stripe(process.env["STRIPE_SIGNING_SECRET"] ?? ""),
  eventId: (body) => body.id,
});

// ============================================================================
// Declare the Intake (one entity, two routes, one landing collection)
// ============================================================================

const customers = new Intake({
  name: "stripe_customers",

  // The reconciliation job. Same handler for backfill, incremental and
  // sweep - only the window differs.
  batch: {
    handler: async function* (scope, ctx) {
      const apiKey = process.env["STRIPE_API_KEY"] ?? "";
      const params = new URLSearchParams({ limit: "100" });
      if (scope.window?.from) {
        params.set(
          "created[gte]",
          String(Math.floor(scope.window.from.getTime() / 1000))
        );
      }
      const res = await ctx.fetch(
        `https://api.stripe.com/v1/customers?${params}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      const page = (await res.json()) as { data: StripeCustomer[] };
      for (const customer of page.data) {
        yield customer;
      }
    },
    schedules: [
      { cron: "*/5 * * * *", lookback: "1h" }, // keep fresh
      { cron: "0 3 * * *", lookback: "7d" }, // catch what the webhook missed
      { cron: "0 4 * * 0" }, // unbounded: converges deletions
    ],
    overlap: "skip",
  },

  // Low-latency route. A burst of N customer events referencing R distinct
  // customers is deduped to one run with R identifiers - R fetches, not N.
  event: {
    webhook: stripe,
    filter: (envelope) => envelope.body.type.startsWith("customer."),
    identifiers: (envelope) => [envelope.body.data.object.id],
    handler: async function* (scope, ctx) {
      const apiKey = process.env["STRIPE_API_KEY"] ?? "";
      for (const id of scope.identifiers) {
        const res = await ctx.fetch(
          `https://api.stripe.com/v1/customers/${id}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (res.status === 404) {
          ctx.delete(id);
          continue;
        }
        yield (await res.json()) as StripeCustomer;
      }
    },
    concurrencyLimit: 4,
  },

  // This intake's SHARE of Stripe's account-wide budget, spent by both
  // routes together.
  rateLimit: { requestsPerSecond: 5 },

  output: {
    collection: "stripe_customers",
    key: "id",
    version: "updated",
    deletes: { mode: "soft", sweep: true },
  },
});

// ============================================================================
// The IntakeStack (the declaration your own IaC wires up)
// ============================================================================

// `webhooks` is not listed: the stack discovers `stripe` through the
// intake's event route, the way Project discovers a Model's ancestors.
const acme = new IntakeStack({ name: "acme", intakes: [customers] });

export default acme;

// ============================================================================
// Manifold side: Intake.output is a Source<StripeCustomer & IntakeMeta>
// ============================================================================

const dimCustomers = new Model({
  name: "dim_customers",
  from: customers.output,
  // `_deletedAt: null` is the MongoDB idiom for "not soft-deleted": it
  // matches a null value OR a missing field.
  pipeline: (p) => p.match({ livemode: true, _deletedAt: null }),
  materialize: { type: "collection", mode: Model.Mode.Upsert },
});

const project = new Project({
  name: "stripe_analytics",
  models: [dimCustomers],
});

console.log(
  "Discovered webhooks:",
  acme.getWebhooks().map((webhook) => webhook.getPath())
);
console.log("Intake output collection:", customers.output.getCollectionName());
console.log(project.plan().toString());
