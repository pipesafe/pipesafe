/**
 * PipeSafe Intake
 *
 * Declarative webhook and REST ingestion into MongoDB: declare Webhooks
 * (verified endpoints landing raw envelopes) and Fetchers (enrichment /
 * polling units landing typed documents), then run them locally or deploy
 * the serverless infrastructure via @pipesafe/infra. Landing collections
 * are core Collections (Sources), so ingested data feeds Pipelines and
 * manifold Models directly.
 */

// Declarative units
export { Webhook } from "./webhook/Webhook";
export { Fetcher } from "./fetcher/Fetcher";
export { verifiers } from "./verify/Verifier";

// Orchestrator
export { Intake } from "./intake/Intake";

// Errors
export { IntakeNotImplementedError } from "./errors";

// Envelope ledger
export type { IntakeEnvelope, EnvelopeStatus } from "./envelope/Envelope";

// Configuration types
export type { WebhookConfig } from "./webhook/Webhook";
export type {
  FetcherConfig,
  FetcherTrigger,
  FetcherOutput,
  FetchContext,
  IntakeLogger,
} from "./fetcher/Fetcher";
export type { Verifier, VerifyContext, VerifyResult } from "./verify/Verifier";
export type {
  IntakeConfig,
  DeployOptions,
  DeployPlan,
  DeployResult,
  DevOptions,
  LocalIntakeServer,
  ReplayOptions,
  ReplayResult,
  IntakeStatus,
  IntakeValidationResult,
  IntakeValidationError,
} from "./intake/Intake";
