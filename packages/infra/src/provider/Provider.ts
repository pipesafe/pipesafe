/**
 * InfraProvider - the Pulumi program-factory seam
 *
 * A provider turns a provider-neutral {@link InfraProgramSpec} into a Pulumi
 * program (Automation API inline program) that provisions the described
 * resources. Suite packages (intake today, manifold later) COMPOSE specs;
 * providers OWN the cloud-specific resource declarations. Nothing in this
 * module may reference ingestion (or any other domain) concepts - the same
 * engine must serve every PipeSafe package unchanged.
 *
 * The AWS implementation ships in Phase 3 behind the `@pipesafe/infra/aws`
 * subpath so `@pulumi/*` and AWS SDK dependencies never reach declaration-only
 * consumers or runtime bundles.
 */
import type { SecretRef } from "../secrets/SecretRef";

/** The resource kinds every provider must know how to provision. */
export type ResourceKind =
  | "function"
  | "httpEndpoint"
  | "containerService"
  | "schedule"
  | "secret";

/** A serverless function (AWS: Lambda, node22/arm64). */
export interface FunctionSpec {
  kind: "function";
  /** Stable logical name, unique within the program. */
  name: string;
  /** Path to the esbuild-bundled code artifact. */
  codePath: string;
  /** Exported handler name within the bundle. */
  handler: string;
  /** Plain environment variables (never secret values). */
  env?: Record<string, string>;
  /** Secrets resolved at runtime via the provider's secret store. */
  secrets?: SecretRef[];
  memoryMb?: number;
  timeoutSeconds?: number;
}

/** A public HTTPS endpoint routing to a function (AWS: Function URL). */
export interface HttpEndpointSpec {
  kind: "httpEndpoint";
  name: string;
  /** Logical name of the {@link FunctionSpec} this endpoint fronts. */
  functionName: string;
}

/** An always-on container service (AWS: ECS Fargate). */
export interface ContainerServiceSpec {
  kind: "containerService";
  name: string;
  image: string;
  env?: Record<string, string>;
  secrets?: SecretRef[];
  cpu?: number;
  memoryMb?: number;
}

/** A cron schedule invoking a function (AWS: EventBridge Scheduler). */
export interface ScheduleSpec {
  kind: "schedule";
  name: string;
  /** 5-field cron expression, UTC. */
  cron: string;
  /** Logical name of the {@link FunctionSpec} to invoke. */
  functionName: string;
}

/** A secret value provisioned into the provider's secret store. */
export interface SecretSpec {
  kind: "secret";
  ref: SecretRef;
}

export type ResourceSpec =
  | FunctionSpec
  | HttpEndpointSpec
  | ContainerServiceSpec
  | ScheduleSpec
  | SecretSpec;

/**
 * A provider-neutral description of everything one deployment provisions.
 * Suite packages build this; providers consume it.
 */
export interface InfraProgramSpec {
  /** Deployment namespace (becomes the Pulumi stack name). */
  name: string;
  resources: ResourceSpec[];
}

/**
 * An inline Pulumi program. Placeholder signature until Phase 3 wires the
 * Pulumi Automation API dependency (where this aligns with `PulumiFn`).
 */
export type InfraProgram = () => Promise<void>;

/**
 * The provider seam. One implementation per cloud; selection happens at
 * deploy time via deploy options.
 */
export interface InfraProvider {
  /** e.g. "aws", "local". */
  readonly providerName: string;
  /** Build the Pulumi program that provisions the given spec. */
  getProgram(spec: InfraProgramSpec): InfraProgram;
}
