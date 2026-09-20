# @pipesafe/intake — Architecture

Declarative replication of third-party data into MongoDB: describe an
external entity in TypeScript and intake keeps a landing collection
converged with it — where it surfaces as a core `Collection<T>`, ready for
Pipelines and manifold `Model`/`Project` DAGs.

The responsibility split across the suite:

- **`@pipesafe/intake`** (ELv2) — the ingestion domain, and ONLY that:
  getting external data into landing collections and keeping it converged.
  `Intake`, `Webhook`, the `IntakeEnvelope` ledger, verifiers, the runtime
  handlers, and the `IntakeStack` declaration. Intake's job ends when a
  document lands; it does not own reactions to those documents, and it does
  not own infrastructure.
- **`@pipesafe/manifold`** (ELv2) — transformations, in both execution
  modes: batch (`Project.run`, pull-based, today) and event-driven
  (change-stream subscriptions — scaffold in `src/events/`). Manifold and
  core operate on ANY collection in the connected MongoDB — application
  operational data, other ETL tools' landing collections, CDC replicas,
  other services' databases, and manifold's own model outputs. Intake is
  merely one producer among many, and intake does NOT depend on manifold.
- **Your infrastructure-as-code** — whatever you already use. Intake ships
  no provider, no state backend and no secret store, because you already
  have all three and they are already in your review process. See
  [Deployment](#deployment-your-iac-our-handlers).

Dependency direction: intake peers on core only, as does manifold.

Status: **Phase 0** — this document plus type-level scaffolds. No runtime
yet. See the [roadmap](#roadmap) for the path to a working MVP.

## Design principles

1. **One idempotent unit, invoked with different scopes.** An `Intake` run
   is idempotent, which makes it a reconciliation job by its very nature.
   Backfill, incremental sync, gap recovery after a missed webhook, replay
   and reconciliation are therefore not five features — they are one unit
   invoked with different `IntakeScope`s. Cadence is just how often a scope
   is issued.
2. **Scope in, not state out.** A run is told what to cover; it does not
   depend on a persisted cursor being intact. Lookback windows overlap on
   purpose, and idempotent writes make the overlap free. Cursors and
   checkpoints may be added later purely as "don't re-read what you don't
   need" optimizations — they must never become load-bearing for
   correctness, because the failure mode of load-bearing sync state is an
   incident rather than a slow run.
3. **MongoDB-native data plane.** The envelope collection is the queue, the
   retry/DLQ ledger, and the replay/audit surface, queryable with PipeSafe
   itself. This is orthogonal to who owns the deploy.
4. **Landing collections are core `Collection<T>`s** — already `Source<T>` —
   so replicated data feeds Pipelines and manifold Models with zero
   adapters.
5. **Honest delivery semantics.** Exactly-once _delivery_ across process
   boundaries is impossible (sender retries, function retries and dispatch
   redelivery are all at-least-once). Intake pairs at-least-once transport
   with idempotency at both write points — envelope `_id` dedupe at the
   gateway, natural-key upserts guarded by a monotonic version at the
   writer — for **effectively-once processing**.
6. **Declarative units, one declaration** (manifold symmetry: `Model` +
   `Project`). `Webhook` and `Intake` do no I/O; `IntakeStack` collects
   them, validates, and reports what infrastructure is required.
7. **Intake is a library, not a deployment tool.** It provisions nothing,
   stores no deploy state, and resolves no secrets. Adopting it must not
   mean adopting a second IaC.
8. **Suite client conventions.** Runtime pieces resolve the client as
   `options.client ?? pipesafe.client` (throw if neither) and call
   `tagClient()`, exactly like `Collection`, `Database`, and `Project`.

## `IntakeScope` — the only run input

```ts
type IntakeScope =
  | { kind: "batch"; window?: { from?: Date; to?: Date } }
  | { kind: "event"; identifiers: string[] };
```

An absent window — or an absent bound — is unbounded in that direction, so a
full sweep is `{ kind: "batch" }` and there is no separate "all" scope.
Schedules declare a `lookback`; the runner resolves it to concrete dates
before the handler sees it, so no handler computes its own window.

The union is authoritative: it is what `Intake.run` accepts and what the run
ledger records. Handlers receive their own arm (`BatchScope` / `EventScope`,
both `Extract`ed from the union) so neither has to narrow something that
cannot vary in its position.

## The declarative units

### `Intake<TName, TEvent, TDoc>`

One intake replicates one external entity into one landing collection, by
two routes to the same documents:

- **The batch route** (always present) — a handler over a window, run on any
  number of schedules. This is the reconciliation job. A typical entity
  declares a frequent narrow window, a periodic wide one, and an unbounded
  sweep:

  ```ts
  schedules: [
    { cron: "*/5 * * * *", lookback: "1h" }, // keep fresh
    { cron: "0 3 * * *", lookback: "7d" }, // catch what the webhook missed
    { cron: "0 4 * * 0" }, // unbounded: converges deletions
  ];
  ```

  A historical backfill needs no declaration at all: it is
  `intake.run({ kind: "batch", window: { from, to } })`.

- **The event route** (optional) — a handler over natural keys extracted
  from webhook envelopes, for sources where waiting for the next batch tick
  is too slow. It references a `Webhook` rather than owning one, because one
  provider endpoint commonly feeds several intakes (one Stripe endpoint →
  customers, invoices, subscriptions).

Both routes yield the same `TDoc` into the same collection under the same
natural key. That shared type is what makes idempotency meaningful ACROSS
the routes, not merely within each.

**Coalescing needs no configuration.** The dispatcher dedupes identifiers
across the claimed envelope set, so a burst of N events touching R resources
produces one run with R identifiers. This matters more than it looks:
measured against a live high-volume commercial source (notification-only
webhooks behind an account-wide limit of a few hundred requests per minute,
shared across every consumer), a batch dispatch run clearing ~50k
stock-movement events in one peak trading hour drains in **~4 hours fetched
one-per-event, ~1 hour per parent document, or under a minute per distinct
entity with ID-set batched requests (~30 requests for ~1.5k distinct
entities)** — three orders of magnitude from granularity alone, with the
worst case landing in the busiest trading hour of the year. Handing the
handler a SET of identifiers rather than one per call is what makes the
batched request expressible at all.

#### Output and idempotency

```ts
output: {
  collection: string;
  key: keyof TDoc & string;       // natural key -> _id
  version?: keyof TDoc & string;  // monotonic guard
  deletes?: { mode: "soft" | "hard"; sweep?: boolean };
}
```

- **`key`** drives the upsert and is written to `_id`, so downstream
  `Model.Mode.Upsert` (`$merge on: "_id"`) composes without extra keys. The
  landing type reflects the writer-set fields: `Collection<TDoc &
IntakeMeta>` where `IntakeMeta = { _id: string; _deletedAt?: Date | null }`.
- **`version`** is the monotonic guard: a write only applies when the source
  version is at least the stored one. This is required in practice once both
  routes are live — an event run and a batch run may legitimately be in
  flight over the same document, and last-write-wins would let an older
  fetch that landed second regress the record. `overlap` does NOT cover
  this; it governs batch-vs-batch only.
- **`deletes`** is how convergence is completed. Upserts alone never
  converge on deletion, so without this the word "reconciliation" would be
  an overclaim. Two mechanisms, both feeding one `mode`:
  - explicit — `ctx.delete(key)` from either handler (a `customer.deleted`
    event, or a 404 on a targeted fetch);
  - structural — `sweep: true` marks an UNBOUNDED batch run, upserts
    everything the handler yields, then applies `mode` to any document the
    run did not see. Only sound without a window: a bounded run has not
    looked at the whole entity.

  `mode: "soft"` stamps `_deletedAt`, which is optional AND nullable on
  `IntakeMeta` because all three states are real: absent (never deleted), a
  Date (soft-deleted), and null (deleted then resurrected by a later upsert
  — cleared rather than `$unset`). Downstream, filter live documents with
  the MongoDB idiom `{ _deletedAt: null }`, which matches a null value OR a
  missing field. `$exists: false` is the wrong matcher here: it is stricter
  than intended, excluding an explicitly-null document.

#### Budget and concurrency

`rateLimit` sits on the intake, not on either route, because a nightly sweep
and an event burst spend from the SAME third-party ceiling — neither route
can own it. `concurrencyLimit` sits on the event route, where it belongs: it
bounds fan-out, connection-pool pressure and function concurrency, but it
does NOT bound request rate, which at fixed concurrency drifts with API
latency.

### `Webhook<TName, TEvent>`

Declares an HTTP endpoint that receives third-party events, verifies them
against the **raw request bytes** (HMAC breaks on re-serialized JSON), and
persists the raw envelope. Exposes
`events: Collection<IntakeEnvelope<TEvent>>`.

Verification is a pluggable `Verifier` scheme: built-ins `verifiers.stripe()`
(Stripe-Signature v1 HMAC + timestamp tolerance), `verifiers.hmacSha256()`,
`verifiers.none()` (dev only; stores `verified: false`), and
`verifiers.custom()`. Schemes take a `SecretValue` — a string, or a thunk
for values fetched at runtime — so the secret comes from wherever your IaC
put it.

### `IntakeEnvelope<TEvent>` — the ledger

Every accepted request is stored verbatim **before** any processing, with
`_id = "${webhookName}:${eventId}"` where `eventId` is extracted from the
payload by the webhook's `eventId` function (e.g. Stripe's `evt_...`). The
unique `_id` makes the envelope collection the idempotency ledger — and the
transport, and the DLQ:

```
received -> processing -> processed
                       -> failed  (sweeper retries with backoff)
                       -> dead    (after maxAttempts; re-drivable via replay)
```

Only an allowlisted header subset is persisted (never auth headers). Replays
and audits read this collection; it is the single source of truth for "what
arrived".

### `IntakeStack` — the declaration

Constructed with `{ name, intakes, webhooks?, defaultDatabase? }`; validates
immediately (unique intake names, webhook names, paths and output
collections); immutable afterwards. Methods: `validate()`, `manifest()`,
`dev()`, `replay()`, `status()`.

Webhooks are **discovered** from `intakes[].event.webhook`, mirroring
Project's ancestor discovery — declare one explicitly only when it has no
consumer on this stack. Discovery also deletes a whole class of error: an
event route referencing a webhook nobody registered is impossible by
construction.

It collects the units and reports what infrastructure they require; it does
not create any. See [Deployment](#deployment-your-iac-our-handlers).

## Delivery

1. **Gateway** (function URL): verify signature → insert envelope
   (`status: "received"`). Duplicate `_id` ⇒ already received: ack 200,
   done. Nothing else on the hot path.
2. **Dispatch** — envelopes become `{ kind: "event", identifiers }` runs:
   - **`poll`** (default and primary): a scheduled function claims pending
     envelopes atomically via `findOneAndUpdate` with a `leaseUntil` lease —
     lease expiry is the visibility timeout. A claim naturally scoops up
     everything accumulated since the last run, which is exactly the shape
     identifier coalescing wants and the natural dedupe point. It also keeps
     a deployment to functions and cron triggers: nothing exotic for your
     IaC to express, on any cloud.
   - **`changeStream`**: lower idle latency for low-volume,
     latency-sensitive sources, at the cost of an always-on watcher (and
     therefore a container). Powers `dev()` in-process.

   **Strategy is chosen per INTAKE, on its event route — not per stack.** A
   high-volume notification source wants claim-based batched dispatch while
   a low-volume latency-sensitive one wants the push path, and they
   routinely sit in the same deployment. `manifest()` therefore emits one
   dispatch schedule per distinct cron group, naming the intakes in it.

3. **Runner**: resolve the scope, run the route's handler, upsert yielded
   documents by natural key under the version guard, apply `ctx.delete`
   calls, mark envelopes `processed`. A crash between output-write and
   status-write causes a redelivery that harmlessly re-upserts.
4. **Retry/DLQ is the ledger**: failure ⇒ `failed` + `attempts++` +
   `lastError`. A scheduled **sweeper** re-drives `failed` envelopes with
   exponential backoff computed from `attempts`/`receivedAt`, and anything
   stuck in `received`/`processing` too long — so dispatch is self-healing
   regardless of strategy.

Because the batch route reconciles on its own schedule, a lost or
never-delivered webhook is a latency problem, not a data-loss problem. That
is the single biggest operational difference from a webhook-only design, and
it is why the batch route is mandatory and the event route optional.

Caveats: change streams require a replica set (Atlas always qualifies; the
test fixture `useMemoryMongo` already runs one); async-invoke ordering is not
guaranteed (fine — the ledger is authoritative and the version guard
protects the writer).

## Deployment: your IaC, our handlers

Intake provisions nothing. Most adopters already have an IaC tool, a state
backend, a secret store and a review process wrapped around all three;
"any cloud, but our deploy engine" is still lock-in, and the constraint that
actually bites is the IaC tool, not the cloud. So the contract is two
pieces of plain data and code:

**1. Runtime handlers** (`@pipesafe/intake`) — plain functions over an
`IntakeStack`, with a framework-neutral request shape you adapt in a few
lines:

| Handler                 | Invoked by                                       | Does                                                                 |
| ----------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `createGatewayHandler`  | your HTTP route(s)                               | verify signature, insert envelope, ack. Nothing else on the hot path |
| `createRunHandler`      | your batch cron triggers, or you, for a backfill | run one intake over one scope                                        |
| `createDispatchHandler` | your dispatch cron (or the watcher worker)       | claim envelopes, coalesce identifiers, run event routes              |
| `createSweeperHandler`  | your sweeper cron                                | re-drive failed envelopes with backoff, reap stuck ones              |

They take `{ client?, database?, logger? }` and nothing else. No provider,
no bundler, no deployment step.

**2. `IntakeStack.manifest()`** — what needs to exist, as data:

```ts
{
  name: string;
  endpoints: { webhook: string; path: `/${string}` }[];
  schedules: (
    | { kind: "batch"; intake: string; cron: string; lookback?: Duration }
    | { kind: "dispatch"; cron: string }
    | { kind: "sweeper"; cron: string }
  )[];
  workers: { kind: "watcher" }[];          // only under changeStream dispatch
  collections: { name: string; role: "envelopes" | "landing" }[];
}
```

Read it in a Pulumi program, generate Terraform from it, or ignore it and
hand-write four Lambdas and three EventBridge rules. It is a description,
not a plan to apply — there is no state, no diff, no lock, and nothing for
intake to own between deploys.

**Secrets are yours.** Verifiers take a `SecretValue` — a string, or a
thunk when the value must be fetched (and re-fetched on rotation) at
runtime — so `process.env.STRIPE_SIGNING_SECRET` is the common case and
Vault/Secrets Manager is a one-line resolver. Handlers read whatever your
IaC injected. Intake has no secret-reference type, no secret store and no
resolution step, because every one of those existed only to serve a
provisioning engine it no longer has.

**Under `poll` dispatch the whole deployment is functions plus cron
triggers plus a MongoDB connection** — no always-on process, nothing exotic
to translate per cloud. `changeStream` dispatch adds one long-lived watcher
worker in exchange for lower idle latency; it is opt-in for that reason.

**On not building a cross-cloud abstraction.** Pulumi shipped exactly that
as `@pulumi/cloud` and archived it in December 2024: users "were broadly
not satisfied", and cloud-neutrality "led to severe limitations for users
working in AWS". A provider-neutral resource vocabulary (`function`,
`httpEndpoint`, `schedule`, `secret`) is the surface that failed, and this
design avoids it by not having a vocabulary at all — the manifest names
intake's own concepts and lets your IaC decide what they map to. If an
optional Pulumi `ComponentResource` is ever wanted for users with no IaC,
it belongs in a separate package built ON these handlers, never underneath
them.

## The Stripe example, end to end

See [`examples/stripe-replica.ts`](./examples/stripe-replica.ts) for the
compiled version. In outline:

```ts
const stripe = new Webhook<"stripe", StripeEvent>({
  name: "stripe",
  path: "/webhooks/stripe",
  verify: verifiers.stripe(process.env.STRIPE_SIGNING_SECRET!),
  eventId: (body) => body.id,
});

const customers = new Intake({
  name: "stripe_customers",
  batch: {
    handler: async function* (scope, ctx) {
      /* list customers changed since scope.window?.from */
    },
    schedules: [
      { cron: "*/5 * * * *", lookback: "1h" },
      { cron: "0 3 * * *", lookback: "7d" },
      { cron: "0 4 * * 0" },
    ],
  },
  event: {
    webhook: stripe,
    filter: (e) => e.body.type.startsWith("customer."),
    identifiers: (e) => [e.body.data.object.id],
    handler: async function* (scope, ctx) {
      /* fetch exactly scope.identifiers; ctx.delete(id) on 404 */
    },
  },
  rateLimit: { requestsPerSecond: 5 },
  output: {
    collection: "stripe_customers",
    key: "id",
    version: "updated",
    deletes: { mode: "soft", sweep: true },
  },
});

export default new IntakeStack({ name: "acme", intakes: [customers] });

// manifold side: Intake.output is a Source<StripeCustomer & IntakeMeta>
const dimCustomers = new Model({
  name: "dim_customers",
  from: customers.output,
  pipeline: (p) => p.match({ livemode: true, _deletedAt: null }),
  materialize: { type: "collection", mode: Model.Mode.Upsert },
});
```

Intake owns "external data into Mongo, converged"; manifold owns "transform
what's in Mongo" — and because both sides speak `Source<T>`, a future
unified orchestrator can compose the whole graph.

## Type-safety scope

Intake is runtime-flavored; the promise is **generic flow, not validation**:
`TEvent` flows webhook → envelope → event `filter`/`identifiers`; `TDoc`
flows BOTH handlers → `output.key`/`output.version` (`keyof TDoc & string`)
→ `Collection<TDoc & IntakeMeta>` → manifold inference. Each handler
receives its own scope arm, so it never narrows something that cannot vary.
Literal `TName` generics mirror Model's. Payload types are user-supplied
(e.g. Stripe's published typings); runtime body validation is an explicit
non-goal for the MVP. `src/index.typeAssertions.ts` pins the generic flow
per repo convention.

## Roadmap

| Phase                         | Scope                                                                                                                                                                                                         | Acceptance                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 (this PR)**               | intake scaffolds, this document                                                                                                                                                                               | build, lint, `typecheck:packages` green                                                                                                                                                                                                                                                                                                                                                                                                |
| **1 — local runtime**         | envelope ledger ops, verifier implementations, gateway/runner code paths, scope resolution (lookback → dates), the idempotent writer (natural-key upsert + version guard + `ctx.delete`), `dev()`, `replay()` | Stripe-shaped integration test on `useMemoryMongo`: signed POST → envelope → dispatch → event run (mock API) → typed upsert; duplicate-delivery test proves effectively-once; coalescing test proves N envelopes for R resources produce ONE run with R identifiers; out-of-order test proves the version guard rejects a stale write; scope-equivalence test proves a batch window run and an event run converge on the same document |
| **2 — cadence & convergence** | schedule firing, `overlap` leases, sweeper logic, delete application (explicit + `sweep`)                                                                                                                     | kill-runner-mid-flight test shows lease-expiry redelivery without double-processing; sweep test proves a document absent from an unbounded run is soft-deleted and a bounded run never sweeps                                                                                                                                                                                                                                          |
| **3 — deployable**            | runtime handler factories (gateway/run/dispatch/sweeper) over the framework-neutral request shape, `manifest()`, a worked reference deployment in one IaC tool as documentation only                          | the Stripe example runs end to end on infrastructure declared entirely outside this repo: signed request lands, crons drive batch/dispatch/sweeper, nothing in `@pipesafe/intake` imports a cloud SDK or an IaC library                                                                                                                                                                                                                |
| **4 — hardening**             | `status()` with ledger stats, `ctx.paginate`, `ctx.checkpoint` (mid-run resumption as a pure optimization), DLQ ops tooling, API Gateway/custom domains                                                       | a 500-page backfill resumes after a forced kill without re-reading completed pages; ops runbook                                                                                                                                                                                                                                                                                                                                        |

## Deferred work

- **Core: `$exists: false` narrows to `never` on any declared field.**
  Unrelated to intake's own surface (the soft-delete filter idiom is
  `{ _deletedAt: null }`, which typechecks), but a real pre-existing core
  bug worth fixing on its own: `FieldMatchingInterim`
  (packages/core/src/stages/match.ts) routes a declared key through
  `ExpectedValue`, which returns `unknown` for `$exists: false`, and
  `unknown` extends no field type, so `FilterUnion` drops the member. Its
  `Query[K] extends { $exists: false } ? true` arm sits in the
  not-a-field-selector branch and so only ever fires for keys absent from
  the schema.
- **`ctx.checkpoint()` for mid-run resumption.** A long paginated batch run
  that dies today re-runs its whole window — correct, because idempotent,
  but expensive against a shared rate budget. Deferrable precisely because
  principle 2 makes it an optimization with no semantic effect.
- **Event-driven manifold, the full design.** The `ChangeSubscription` +
  dispatch scaffold in `packages/manifold/src/events/` is deliberately
  minimal and is now manifold's own concern: intake no longer depends on it.
  The real design pass covers incremental/reactive Model refresh,
  subscription placement in the Project DAG, typed change-event schemas, and
  how batch and event-driven execution compose in one graph.
- **Atlas Triggers** as a `changeStream` dispatch implementation, letting
  Atlas users drop the watcher container. Context: Atlas App Services
  reached EOL (Sept 2025) but database triggers were explicitly retained.
- **Second cloud provider** (Cloudflare Workers component) — reachable
  precisely because `poll` dispatch avoids `containerService`.
- **Connector-platform interop.** Auth and provider catalogs are a different
  product (Nango and friends do OAuth, token refresh and hundreds of
  pre-built providers). A batch handler reading such a platform's records
  API, or a `Webhook` accepting its outbound webhooks, gives intake that
  catalog without building it. Per-customer OAuth is explicitly NOT intake's
  job.
- **An optional Pulumi component** for users with no IaC of their own. It
  would be a separate package consuming the runtime handlers, never a
  dependency underneath them — the direction matters, because the moment
  intake depends on it the secret-reference and deploy-state types come
  back.

## Risks

- **Convergence depends on the batch route being declared well.** An intake
  whose only schedule is a narrow lookback will silently never converge on
  deletions or on records the API back-dated. Validation should warn when
  `deletes.sweep` is set but no unbounded schedule exists.
- **Shared rate budgets**: many APIs rate limit **per account across all
  consumers**, not per app — an intake cannot assume it has the documented
  limit to itself (e.g. a 200 req/min account ceiling already shared with an
  incumbent polling pipeline leaves real headroom well below the docs).
  `rateLimit` is the intake's _share_, set by the operator; deploying
  alongside an existing pipeline means coordinating with or replacing it.
- **Unbounded sweeps are expensive.** A weekly full sweep of a large entity
  can dwarf every other run combined. Document the cost and make the cadence
  a deliberate choice.
- **Mongo access from FaaS**: Atlas IP allowlisting (MVP: documented
  tradeoffs; PrivateLink later) and connection caps under concurrency —
  small `maxPoolSize`, reserved-concurrency guidance. `concurrencyLimit` is
  the intake-side lever.
- **Cold starts** on the gateway ack path (~1–2 s with driver + TLS): keep
  bundles small, nothing but the insert on the hot path.
- **Payload limits**: ~6 MB sync function request; 16 MB Mongo document
  ceiling (GridFS escape hatch out of MVP).
- **Documentation carries the weight that a deploy engine used to.** With
  no provisioning of our own, "wire four handlers and three crons correctly"
  becomes a docs problem — an incomplete wiring (a missing sweeper trigger,
  say) fails quietly by degrading convergence rather than erroring.
  `validate()` and `manifest()` should make the required set explicit, and
  `status()` should make an unhealthy one visible.
