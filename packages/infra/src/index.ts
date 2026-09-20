/**
 * PipeSafe Infra
 *
 * Shared cloud infrastructure engine for the PipeSafe suite: the Pulumi
 * program-factory seam, MongoDB-backed Pulumi state, deploy locking, and
 * secret references. Consumed by @pipesafe/intake today; designed so
 * @pipesafe/manifold (scheduled materialization jobs) and future packages
 * deploy through the same engine with one look and feel.
 *
 * Nothing in this package knows about ingestion or transformation - domain
 * packages compose provider-neutral resource specs; infra provisions them.
 */

// Secrets
export { secret } from "./secrets/SecretRef";
export type { SecretRef } from "./secrets/SecretRef";

// Provider seam
export type {
  InfraProvider,
  InfraProgram,
  InfraProgramSpec,
  ResourceKind,
  ResourceSpec,
  FunctionSpec,
  HttpEndpointSpec,
  ContainerServiceSpec,
  ScheduleSpec,
  SecretSpec,
} from "./provider/Provider";

// State backend
export type {
  StateStoreOptions,
  PulumiBackend,
  PulumiBackendKind,
  DeployLock,
  InfraStateDoc,
} from "./state/Backend";
