# @pipesafe/intake + @pipesafe/infra — Architecture

Cloud-deployed data ingestion for PipeSafe: declare webhook endpoints and REST
fetchers in TypeScript, and intake provisions the serverless infrastructure to
land that data in your MongoDB — where it surfaces as core `Collection<T>`
instances, ready for Pipelines and manifold `Model`/`Project` DAGs.

The responsibility split across the suite:

- **`@pipesafe/intake`** (ELv2) — the ingestion domain, and ONLY that:
  getting external data into the holding collections. `Webhook`, `Fetcher`,
  the `IntakeEnvelope` ledger, verifiers, and the `Intake` orchestrator.
  Intake's job ends when a document lands; it does not own reactions to
  those documents.
- **`@pipesafe/manifold`** (ELv2) — transformations, in both execution
  modes: batch (`Project.run`, pull-based, today) and **event-driven**
  (change-stream subscriptions — scaffold in `src/events/`). Watching an
  envelope collection and running a fetcher is just one usecase of
  manifold's `ChangeSubscription`; the same primitive serves event-driven
  transformations mid-DAG for users who never touch intake (manifold and
  core operate on ANY collection in the connected MongoDB — application
  operational data, other ETL tools' landing collections, CDC replicas,
  other services' databases, and manifold's own model outputs — intake is
  merely one producer among many).
- **`@pipesafe/infra`** (ELv2) — the shared infrastructure engine: the
  Pulumi program-factory seam, MongoDB-backed Pulumi state, deploy locking,
  and `SecretRef`s. Intake deploys ingestion infrastructure through it
  today; manifold deploys scheduled/reactive transformation jobs through it
  later. The end state is one cohesive DAG from webhook receipt through
  analytics transformations, deployed and operated with one look and feel.
  Nothing in infra may reference ingestion (or any other domain) concepts —
  that boundary is a review gate.

Dependency direction: intake peers on core, infra, AND manifold (it
composes manifold's event layer); manifold peers on core only; infra peers
on core only.

Status: **Phase 0** — this document plus type-level scaffolds. No runtime yet.
See the [roadmap](#roadmap) for the path to a working MVP.

## Design principles

1. **MongoDB-native.** The envelope collection is the queue, the retry/DLQ
   ledger, and the replay/audit surface. Pulumi deployment state lives in
   MongoDB (optionally a separate ops cluster) — no object-store bucket, no
   Pulumi Cloud account. Eventing is MongoDB change streams, not SQS.
2. **Declarative units, one orchestrator** (manifold symmetry: `Model` +
   `Project`). `Webhook` and `Fetcher` do no I/O; the `Intake` orchestrator
   validates, runs locally, and deploys.
3. **Landing collections are core `Collection<T>`s** — already `Source<T>` —
   so ingested data feeds Pipelines and manifold Models with zero adapters.
4. **Honest delivery semantics.** Exactly-once _delivery_ across process
   boundaries is impossible (sender retries, change-stream redelivery,
   function retries are all at-least-once). Intake pairs at-least-once
   transport with idempotency at both write points — envelope `_id` dedupe at
   the gateway, natural-key upserts at the consumer — for **effectively-once
   processing**.
5. **Suite client conventions.** Runtime pieces resolve the client as
   `options.client ?? pipesafe.client` (throw if neither) and call
   `tagClient()`, exactly like `Collection`, `Database`, and `Project`.

## The declarative units

### `Webhook<TName, TEvent>`

Declares an HTTP endpoint that receives third-party events, verifies them
against the **raw request bytes** (HMAC breaks on re-serialized JSON), and
persists the raw envelope. Exposes
`events: Collection<IntakeEnvelope<TEvent>>`.

Verification is a pluggable `Verifier` scheme: built-ins `verifiers.stripe()`
(Stripe-Signature v1 HMAC + timestamp tolerance), `verifiers.hmacSha256()`,
`verifiers.none()` (dev only; stores `verified: false`), and
`verifiers.custom()`. Schemes declare their secrets as `SecretRef`s so deploys
know what to provision.

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
arrived", queryable with PipeSafe itself.

### `Fetcher<TName, TEvent, TDoc>`

Turns envelopes (or cron ticks) into full documents by calling the
third-party REST API. Triggered per envelope (`{ webhook, filter? }`) or on a
schedule (`{ schedule: cron }`). The handler yields `TDoc`s — an
`AsyncIterable` supports pagination without buffering — and `ctx.fetch`
wraps retry/backoff (429/5xx) and rate limiting so handlers stay simple.
Output is `{ collection, key, mode }` where `key: keyof TDoc & string` drives
idempotent natural-key upserts. The upsert writer also sets `_id` from the
natural key, so downstream manifold models using `$merge on: "_id"`
(`Model.Mode.Upsert`) compose without extra keys. Exposes
`output: Collection<TDoc>`.

### `Intake` — the orchestrator

Constructed with `{ name, webhooks, fetchers, mongoUri, database?,
dispatch? }`; validates immediately (unique names/paths, trigger references);
immutable afterwards. Methods:

- `validate()` — structural checks.
- `dev()` — local dev server: a real HTTP endpoint per webhook path,
  change-stream dispatch, the **same** gateway/consumer code that ships to
  the cloud. Pairs with `stripe listen --forward-to localhost:PORT/...`.
- `replay()` — re-run fetchers over stored envelopes (failed by default,
  filterable by source/status/date).
- `plan()` / `deploy()` / `status()` / `teardown()` — delegate to infra's
  engine with intake's composed program spec.

## Delivery: change streams instead of SQS

The gateway's `insertOne` **is** the enqueue — there is no second write to
any queue system:

1. **Gateway** (function URL): verify signature → insert envelope
   (`status: "received"`). Duplicate `_id` ⇒ already received: ack 200, done.
   Nothing else on the hot path. **Intake's ingestion responsibility ends
   here** — everything below is manifold's event layer, which intake
   composes: each fetcher's `{ webhook }` trigger lowers to a manifold
   `ChangeSubscription` on the envelope collection's inserts.
2. **Dispatch** (manifold `src/events/`) — pluggable strategies over one
   consumer contract:
   - **`watcherBridge`** (default for AWS deployments, Atlas and self-hosted
     alike): a minimal always-on container (ECS Fargate, ~0.25 vCPU,
     Spot-eligible) runs `collection.watch()` with resume tokens persisted in
     the state store and asynchronously invokes consumer functions per
     envelope insert. Required because FaaS platforms have no event source
     mapping for real MongoDB change streams (AWS Lambda's ESM covers only
     DocumentDB). Consumers stay scale-to-zero serverless.
   - **`changeStreamWatcher`** (dev + long-running runtimes): the same watch
     loop in-process. Powers `Intake.dev()`.
   - **`ledgerPoller`** (zero-extra-infra fallback for any replica-set
     MongoDB): scheduled consumers claim envelopes atomically via
     `findOneAndUpdate` with a `leaseUntil` lease — lease expiry is the
     visibility timeout. Higher latency, no always-on parts.
   - **`atlasTrigger`** (deferred, unscheduled — see
     [Deferred work](#deferred-work)).
3. **Consumer**: load envelope by `_id`; skip if `processed`; run the
   fetcher; upsert outputs by natural key; mark `processed`. A crash between
   output-write and status-write causes a redelivery that harmlessly
   re-upserts.
4. **Retry/DLQ is the ledger**: failure ⇒ `failed` + `attempts++` +
   `lastError`. A scheduled **sweeper** (EventBridge Scheduler → function)
   re-drives `failed` envelopes with exponential backoff computed from
   `attempts`/`receivedAt`, and anything stuck in `received`/`processing` too
   long — so dispatch is self-healing regardless of strategy. After
   `maxAttempts` ⇒ `dead`; `replay()` re-drives on demand.

Caveats: change streams require a replica set (Atlas always qualifies; the
test fixture `useMemoryMongo` already runs one); async-invoke ordering is not
guaranteed (fine — the ledger is authoritative); oplog retention bounds how
long a stopped bridge can resume from its token (the sweeper covers the gap).

## Provisioning: Pulumi with MongoDB-backed state (`@pipesafe/infra`)

Pulumi provides diff/refresh/drift/rollback; infra provides the MongoDB state
home. No hand-rolled reconciler.

- **`InfraProvider`** — the program-factory seam: `getProgram(spec)` turns a
  provider-neutral `InfraProgramSpec` (resource kinds: `function`,
  `httpEndpoint`, `containerService`, `schedule`, `secret`) into an inline
  Pulumi Automation API program. The AWS implementation (Phase 3, subpath
  `@pipesafe/infra/aws`) maps to Lambda (node22/arm64) + IAM, Function URLs,
  ECS Fargate, EventBridge Scheduler, and SSM SecureString. `@pulumi/*` and
  cloud SDKs are deploy-side dependencies isolated to that subpath.
- **`PulumiBackend`** — two tracks behind one interface, selected
  automatically:
  - **`syncLayer`** (ships first; stock Pulumi CLI): hydrate an ephemeral
    `file://` workspace from the state document, run the operation, persist
    the stack checkpoint JSON back to MongoDB (GridFS above the document
    limit), release the Mongo lock.
  - **`native`** (parallel upstream contribution): a `mongodb://` backend in
    pulumi/pulumi implementing `blob.BucketURLOpener`, modeled on the
    community Postgres backend (pulumi/pulumi PR #19581, issue #5632).
    Backends compile into the CLI — there is no plugin mechanism — so this
    is an in-tree fork + PR. Once the installed CLI supports it, infra logs
    in directly; the syncLayer remains as a fallback. If upstream declines,
    the syncLayer is the fully supported path.
- **`StateStoreOptions`** — deploy state, locks, and resume tokens default to
  the data-plane client (`_pipesafe_infra`-scoped collections) but may target
  a completely different cluster/database/collection. The shape maps 1:1 onto
  the native backend URL so configurations carry over.
- **Secrets** — `secret(name)` returns a `SecretRef` (name only). Values come
  from deploy options or `process.env` at deploy time and land in the
  provider secret store; runtime resolves lazily and caches warm. Pulumi
  state secrets are encrypted with the passphrase provider —
  `PULUMI_CONFIG_PASSPHRASE` is the one value that must live outside MongoDB.
- **Bundling** — the module that default-exports the `Intake` is the
  deployment unit: `deploy()` imports it to compute the plan, then
  esbuild-bundles it with thin runtime shims that route events by name.
  Constraints: module-scope closures only; no inline secrets (deploy-time
  scan warns); import-side-effect-safe.

## The Stripe example, end to end

```ts
import { Webhook, Fetcher, Intake, verifiers } from "@pipesafe/intake";
import { secret } from "@pipesafe/infra";

const stripe = new Webhook<"stripe", StripeEvent>({
  name: "stripe",
  path: "/webhooks/stripe",
  verify: verifiers.stripe(secret("STRIPE_SIGNING_SECRET")),
  eventId: (body) => body.id,
});

const customers = new Fetcher({
  name: "stripe_customers",
  trigger: {
    webhook: stripe,
    filter: (e) => e.body.type.startsWith("customer."),
  },
  handler: async function* ({ envelope }, ctx) {
    const key = await ctx.getSecret(secret("STRIPE_API_KEY"));
    const res = await ctx.fetch(
      `https://api.stripe.com/v1/customers/${envelope!.body.data.object.id}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    yield (await res.json()) as StripeCustomer;
  },
  output: { collection: "stripe_customers", key: "id", mode: "upsert" },
});

export default new Intake({
  name: "acme",
  webhooks: [stripe],
  fetchers: [customers],
  mongoUri: secret("MONGODB_URI"),
});

// ---- manifold side: Fetcher.output is a Source<StripeCustomer> ----
const dimCustomers = new Model({
  name: "dim_customers",
  from: customers.output,
  pipeline: (p) => p.match({ livemode: true }),
  materialize: { type: "collection", mode: Model.Mode.Upsert },
});
```

Flow: Stripe → webhook function → `stripe_events` envelopes → change stream →
`watcherBridge` → async fetcher function → `stripe_customers` (typed
upserts) → manifold Model → Project DAG. Intake owns "external data into
Mongo, effectively once"; manifold owns "transform what's in Mongo" — and
because both sides speak `Source<T>`, a future unified orchestrator can
compose the whole graph.

## Type-safety scope

Intake is runtime-flavored; the promise is **generic flow, not validation**:
`TEvent` flows webhook → envelope → trigger filter → handler input; `TDoc`
flows handler → `output.key` (`keyof TDoc & string`) → `Collection<TDoc>` →
manifold inference. Literal `TName` generics mirror Model's. Payload types
are user-supplied (e.g. Stripe's published typings); runtime body validation
is an explicit non-goal for the MVP. `src/index.typeAssertions.ts` pins the
generic flow per repo convention.

## Roadmap

| Phase                                                         | Scope                                                                                                                                                                                                                              | Acceptance                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 (this PR)**                                               | infra + intake scaffolds, this document                                                                                                                                                                                            | build, lint, `typecheck:packages` green with both packages                                                                                                                                                                                                                                                                                                                                                           |
| **1 — local runtime**                                         | envelope ledger ops, verifier implementations, gateway/consumer code paths, `dev()` (change-stream dispatch), `replay()`                                                                                                           | Stripe-shaped integration test on `useMemoryMongo`: signed POST → envelope → dispatch → fetcher (mock API) → typed upsert; duplicate-delivery test proves effectively-once; failure test proves `failed` + backoff re-drive + replay; watcher-restart test proves resume tokens                                                                                                                                      |
| **2 — dispatch seam**                                         | `ledgerPoller` claim/lease semantics, sweeper logic, `Dispatcher` abstraction proven with two local strategies                                                                                                                     | kill-consumer-mid-flight test shows lease-expiry redelivery without double-processing                                                                                                                                                                                                                                                                                                                                |
| **3 — Pulumi + AWS (MVP deploy)**                             | infra: syncLayer backend (hydrate/persist/lock, `stateStore` targeting), AWS program factory, esbuild bundling, deploy engine. intake: ingestion program composition, `watcherBridge` image, minimal CLI, least-privilege IAM docs | Stripe example deploys to clean AWS from scratch against ANY replica-set MongoDB; state visible only in MongoDB (incl. separate-cluster `stateStore`); live event lands via bridge; bridge restart resumes from token; `plan()` on unchanged config is all no-ops; `teardown()` leaves nothing; concurrent deploys blocked; **no ingestion concepts in infra's API** (manifold must be able to consume it unchanged) |
| **4 — hardening**                                             | `status()` with ledger stats + bridge health, cursor-state polling sources, backfill helper, DLQ ops tooling, API Gateway/custom domains                                                                                           | poll-only source ingests on schedule with persisted cursor; ops runbook                                                                                                                                                                                                                                                                                                                                              |
| **Upstream track** (parallel, best-effort, alongside Phase 3) | `mongodb://` backend PR to pulumi/pulumi (BucketURLOpener, modeled on the Postgres contribution)                                                                                                                                   | on merge: `native` backend detection wired, syncLayer deprecated; if declined: syncLayer remains the supported path                                                                                                                                                                                                                                                                                                  |

## Deferred work

Deliberately unscheduled — revisit once the desired dev experience is
understood:

- **Event-driven manifold, the full design.** The `ChangeSubscription` +
  dispatch scaffold in `packages/manifold/src/events/` is deliberately
  minimal. The real design pass covers: incremental/reactive Model refresh
  (a Model re-materializing when its upstream Source changes), subscription
  placement inside the Project DAG, typed change-event schemas, and how
  batch and event-driven execution compose in one graph. Intake's fetcher
  triggers are the first consumer and must not constrain that design.
- **Atlas Triggers as a delivery mechanism within that design.** A trigger's
  config is essentially a `$match`/`$project` expression over change-event
  documents — a typed-aggregation surface that belongs to the whole suite.
  Once designed, the `atlasTrigger` strategy (Atlas Database Trigger →
  EventBridge partner bus, provisionable via Pulumi's
  `mongodbatlas.EventTrigger`) becomes a pure dispatch-strategy swap —
  `watcherBridge` already mirrors its event shape — and lets Atlas users
  drop the bridge container. Context: Atlas App Services reached EOL
  (Sept 2025) but database triggers were explicitly retained.
- **Atlas Stream Processing** `$externalFunction` as an opt-in
  high-throughput dispatcher.
- **Second cloud provider** (Cloudflare Workers program factory).
- **Manifold on infra** — scheduled materialization deployment; the step
  that realizes the single ingestion→analytics DAG.

## Risks

- **Not fully serverless**: `watcherBridge` is one always-on container.
  Mitigations: tiny/Spot-eligible; `ledgerPoller` for zero-infra; the
  deferred `atlasTrigger` swap removes it for Atlas users. Document the
  single-instance requirement (duplicate dispatch is absorbed by the ledger
  anyway).
- **Upstream Pulumi PR** may be declined or slow — syncLayer is the shipping
  path either way.
- **`pulumi` CLI** is a deploy-time prerequisite (not a runtime one).
- **Passphrase management**: `PULUMI_CONFIG_PASSPHRASE` cannot live in Mongo.
- **Mongo access from FaaS**: Atlas IP allowlisting (MVP: documented
  tradeoffs; PrivateLink later) and connection caps under concurrency —
  small `maxPoolSize`, reserved-concurrency guidance.
- **Cold starts** on the gateway ack path (~1–2 s with driver + TLS): keep
  bundles small, nothing but the insert on the hot path.
- **Payload limits**: ~6 MB sync function request; 16 MB Mongo document
  ceiling (GridFS escape hatch out of MVP). No SQS means no 256 KB concern.
- **Credential scoping**: ship copy-pasteable least-privilege IAM policies
  (deployer + runtime), name-scoped to `pipesafe-intake-*`.
