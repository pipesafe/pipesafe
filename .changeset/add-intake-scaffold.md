---
"@pipesafe/intake": minor
"@pipesafe/manifold": minor
---

Scaffold the intake replication framework and manifold's event-driven
foundation: package skeleton, public type surfaces
(Webhook/Intake/IntakeScope/IntakeEnvelope/IntakeStack, the runtime handler
factories; ChangeSubscription/DispatchConfig), and the architecture design
doc (packages/intake/ARCHITECTURE.md).

An `Intake` is one idempotent replication unit per external entity, so it is
a reconciliation job by nature: backfill, incremental sync, gap recovery and
replay are the same unit invoked with different scopes, at any cadence. It
has a mandatory scheduled batch route and an optional webhook-driven event
route, both landing the same document type under the same natural key.

Intake provisions nothing: it ships runtime handlers (gateway, run,
dispatch, sweeper) and an `IntakeStack.manifest()` describing the routes and
cron triggers to create, for whatever IaC the user already runs. Secrets are
passed in as values. Type-level only - no runtime yet.
