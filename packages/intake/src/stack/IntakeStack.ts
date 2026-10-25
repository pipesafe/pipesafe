/**
 * IntakeStack - the declaration your infrastructure wires up
 *
 * Analogous to manifold's Project: constructed with the declarative units
 * (Webhooks and Intakes) and immutable afterwards.
 *
 * It does NOT provision anything. Intake ships runtime handlers
 * (src/runtime/handlers.ts) and a `manifest()` describing what needs to
 * exist - HTTP routes and cron triggers, each naming the handler it
 * invokes. Your existing IaC creates those resources and injects secrets;
 * intake is a library that runs inside them, not a deployment tool.
 *
 * Client resolution follows the suite pattern: `options.client ??
 * pipesafe.client`, throw if neither, `tagClient()`.
 */
import type { MongoClient } from "mongodb";
import type { EnvelopeStatus } from "../envelope/Envelope";
import type { Intake } from "../intake/Intake";
import type { Duration } from "../intake/Scope";
import type { Webhook } from "../webhook/Webhook";
import { IntakeNotImplementedError } from "../errors";

export interface IntakeStackConfig {
  /** Namespace for collections and manifest entries, e.g. "acme-prod". */
  name: string;
  /* `any` mirrors manifold's Project: Collection is invariant in its doc
     type, so concretely-typed units don't assign to Document-typed ones. */
  intakes: Intake<string, any, any>[];
  /**
   * Webhooks are DISCOVERED from `intakes[].event.webhook`, mirroring
   * Project's ancestor discovery - list one here only when it has no
   * consumer on this stack (landing envelopes for audit, or a webhook whose
   * intakes are batch-only for now).
   */
  webhooks?: Webhook<string, any>[];
  defaultDatabase?: string;
}

/** An HTTP route to create, invoking the gateway handler. */
export interface IntakeManifestEndpoint {
  webhook: string;
  path: `/${string}`;
}

/** A cron trigger to create, invoking the named handler. */
export type IntakeManifestSchedule =
  | { kind: "batch"; intake: string; cron: string; lookback?: Duration }
  | { kind: "dispatch"; cron: string; intakes: string[] }
  | { kind: "sweeper"; cron: string };

/**
 * Everything your IaC needs to create, as plain data. No provider, no
 * resource graph, no state - read it and declare the equivalent in
 * whatever you already use.
 */
export interface IntakeManifest {
  name: string;
  endpoints: IntakeManifestEndpoint[];
  schedules: IntakeManifestSchedule[];
  /** Long-running processes required, for intakes on `changeStream`. */
  workers: { kind: "watcher"; intakes: string[] }[];
  /** Collections intake reads and writes, for index/permission setup. */
  collections: { name: string; role: "envelopes" | "landing" }[];
}

export interface IntakeValidationError {
  /**
   * No `missing_webhook`: discovery makes an event route referencing an
   * unregistered webhook impossible by construction. `duplicate_name` still
   * catches two DISTINCT webhook instances declared under one name.
   */
  type: "duplicate_name" | "duplicate_path" | "duplicate_output";
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

/** Operational state read from the ledger - nothing about deployments. */
export interface IntakeStackStatus {
  envelopes: Partial<Record<EnvelopeStatus, number>>;
  intakes: Record<string, { lastRunAt?: Date; landedDocuments: number }>;
}

export class IntakeStack {
  private readonly config: IntakeStackConfig;

  constructor(config: IntakeStackConfig) {
    this.config = config;
  }

  getName(): string {
    return this.config.name;
  }

  /**
   * Every webhook this stack serves: those reached through an intake's
   * event route, then any declared explicitly. Deduped by identity, so one
   * Webhook feeding several intakes appears once; two distinct instances
   * sharing a name survive here and are reported by `validate()`.
   */
  getWebhooks(): Webhook<string, any>[] {
    const seen = new Set<Webhook<string, any>>();
    const webhooks: Webhook<string, any>[] = [];
    const add = (webhook: Webhook<string, any>): void => {
      if (seen.has(webhook)) return;
      seen.add(webhook);
      webhooks.push(webhook);
    };
    for (const intake of this.config.intakes) {
      const webhook = intake.getEvent()?.webhook;
      if (webhook) add(webhook);
    }
    for (const webhook of this.config.webhooks ?? []) add(webhook);
    return webhooks;
  }

  getIntakes(): Intake<string, any, any>[] {
    return [...this.config.intakes];
  }

  /** Unique intake names, webhook names, paths and output collections. */
  validate(): IntakeValidationResult {
    throw new IntakeNotImplementedError("IntakeStack.validate");
  }

  /** What your IaC needs to create. Pure derivation - no I/O. */
  manifest(): IntakeManifest {
    throw new IntakeNotImplementedError("IntakeStack.manifest");
  }

  /**
   * Local dev server: a real HTTP endpoint per webhook path, in-process
   * dispatch, and the same handler code paths that run in production.
   */
  dev(_options?: DevOptions): Promise<LocalIntakeServer> {
    throw new IntakeNotImplementedError("IntakeStack.dev");
  }

  /** Re-run event routes over stored envelopes (failed ones by default). */
  replay(_options?: ReplayOptions): Promise<ReplayResult> {
    throw new IntakeNotImplementedError("IntakeStack.replay");
  }

  /** Ledger and landing-collection stats. */
  status(_options?: { client?: MongoClient }): Promise<IntakeStackStatus> {
    throw new IntakeNotImplementedError("IntakeStack.status");
  }
}
