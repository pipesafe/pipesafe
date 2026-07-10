/**
 * Intake - the orchestrator
 *
 * Analogous to manifold's Project: constructed with the declarative units,
 * validated immediately, immutable afterwards. Owns local execution
 * (dev/replay) and delegates provisioning to @pipesafe/infra's engine
 * (plan/deploy/status/teardown), composing the ingestion-specific resource
 * specs - gateway, consumers, bridge, sweeper - for the chosen provider.
 *
 * Client resolution follows the suite pattern: `options.client ??
 * pipesafe.client`, throw if neither, `tagClient()`.
 */
import type { MongoClient } from "mongodb";
import type {
  InfraProvider,
  SecretRef,
  StateStoreOptions,
} from "@pipesafe/infra";
import type { EnvelopeStatus } from "../envelope/Envelope";
import type { Fetcher } from "../fetcher/Fetcher";
import type { Webhook } from "../webhook/Webhook";
import type { DispatchConfig } from "../dispatch/Dispatcher";
import { IntakeNotImplementedError } from "../errors";

export interface IntakeConfig {
  /** Deployment namespace, e.g. "acme-prod". */
  name: string;
  /* `any` mirrors manifold's Project: Collection is invariant in its doc
     type, so concretely-typed units don't assign to Document-typed ones. */
  webhooks: Webhook<string, any>[];
  fetchers: Fetcher<string, any, any>[];
  /** What the deployed functions use to reach MongoDB. */
  mongoUri: SecretRef;
  database?: string;
  /** Defaults to watcherBridge on deploy, changeStreamWatcher in dev. */
  dispatch?: DispatchConfig;
}

export interface DeployOptions {
  provider: InfraProvider;
  /**
   * Path to the module that default-exports this Intake - the bundling
   * unit shipped to the cloud functions.
   */
  entry: string;
  /** State-store client; falls back to `pipesafe.client`. */
  client?: MongoClient;
  /** Deploy state, locks, and resume tokens - may be a different cluster. */
  stateStore?: StateStoreOptions;
  /** Values for declared SecretRefs (else read from process.env). */
  secrets?: Record<string, string>;
}

export interface IntakeValidationError {
  type: "duplicate_name" | "duplicate_path" | "missing_webhook";
  message: string;
}

export interface IntakeValidationResult {
  valid: boolean;
  errors: IntakeValidationError[];
}

export interface DevOptions {
  port?: number;
  client?: MongoClient;
}

export interface LocalIntakeServer {
  port: number;
  close(): Promise<void>;
}

export interface ReplayOptions {
  client?: MongoClient;
  /** Restrict to one webhook's envelopes. */
  source?: string;
  /** Defaults to ["failed"]. */
  status?: EnvelopeStatus[];
  since?: Date;
}

export interface ReplayResult {
  replayed: number;
  succeeded: number;
  failed: number;
}

export interface DeployPlan {
  creates: string[];
  updates: string[];
  deletes: string[];
  unchanged: string[];
}

export interface DeployResult {
  plan: DeployPlan;
  /** e.g. webhook URLs keyed by webhook name. */
  endpoints: Record<string, string>;
}

export interface IntakeStatus {
  deployed: boolean;
  endpoints: Record<string, string>;
  envelopes: Partial<Record<EnvelopeStatus, number>>;
}

export class Intake {
  private readonly config: IntakeConfig;

  constructor(config: IntakeConfig) {
    this.config = config;
  }

  getName(): string {
    return this.config.name;
  }

  getWebhooks(): Webhook<string, any>[] {
    return [...this.config.webhooks];
  }

  getFetchers(): Fetcher<string, any, any>[] {
    return [...this.config.fetchers];
  }

  /** Unique names/paths; fetcher triggers reference registered webhooks. */
  validate(): IntakeValidationResult {
    throw new IntakeNotImplementedError("Intake.validate");
  }

  /**
   * Local dev server: a real HTTP endpoint per webhook path, change-stream
   * dispatch, and the same gateway/consumer code paths as the cloud.
   */
  dev(_options?: DevOptions): Promise<LocalIntakeServer> {
    throw new IntakeNotImplementedError("Intake.dev");
  }

  /** Re-run fetchers over stored envelopes (failed ones by default). */
  replay(_options?: ReplayOptions): Promise<ReplayResult> {
    throw new IntakeNotImplementedError("Intake.replay");
  }

  /** Diff desired infrastructure against recorded state - no changes. */
  plan(_options: DeployOptions): Promise<DeployPlan> {
    throw new IntakeNotImplementedError("Intake.plan");
  }

  /** Provision/update cloud resources to match this declaration. */
  deploy(_options: DeployOptions): Promise<DeployResult> {
    throw new IntakeNotImplementedError("Intake.deploy");
  }

  status(_options: DeployOptions): Promise<IntakeStatus> {
    throw new IntakeNotImplementedError("Intake.status");
  }

  /** Destroy cloud resources. Landing collections are never touched. */
  teardown(_options: DeployOptions): Promise<void> {
    throw new IntakeNotImplementedError("Intake.teardown");
  }
}
