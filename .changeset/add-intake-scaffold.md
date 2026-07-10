---
"@pipesafe/infra": minor
"@pipesafe/intake": minor
"@pipesafe/manifold": minor
---

Scaffold the intake ingestion framework, the shared infra engine, and
manifold's event-driven foundation: package skeletons, public type surfaces
(Webhook/Fetcher/IntakeEnvelope/Intake; InfraProvider/PulumiBackend/SecretRef;
ChangeSubscription/DispatchConfig), and the architecture design doc
(packages/intake/ARCHITECTURE.md). Manifold owns all change-stream
reactivity - intake composes it. Type-level only - no runtime yet.
