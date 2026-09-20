/**
 * Type assertions pinning the public @pipesafe/infra surface.
 *
 * Compile-time only - validated by `tsc --noEmit` (typecheck:packages).
 */
import type { Assert, Equal, IsAssignable } from "@pipesafe/core";
import { secret } from "./secrets/SecretRef";
import type { SecretRef } from "./secrets/SecretRef";
import type {
  InfraProgramSpec,
  InfraProvider,
  ResourceKind,
  ResourceSpec,
} from "./provider/Provider";
import type {
  InfraStateDoc,
  PulumiBackendKind,
  StateStoreOptions,
} from "./state/Backend";

// ============================================================================
// Secrets
// ============================================================================

// secret() produces a SecretRef; the value never travels with the reference
const _stripeKey = secret("STRIPE_API_KEY");
type SecretFactoryTest = Assert<Equal<typeof _stripeKey, SecretRef>>;
type SecretKindTest = Assert<Equal<SecretRef["kind"], "secret">>;

// ============================================================================
// Provider seam
// ============================================================================

// The resource-kind union is closed and matches the spec discriminants
type ResourceKindsTest = Assert<
  Equal<
    ResourceKind,
    "function" | "httpEndpoint" | "containerService" | "schedule" | "secret"
  >
>;
type SpecDiscriminantsTest = Assert<Equal<ResourceSpec["kind"], ResourceKind>>;

// Program specs carry every resource kind
type ProgramSpecResourcesTest = Assert<
  Equal<InfraProgramSpec["resources"], ResourceSpec[]>
>;

// Provider implementations only need a name and a program factory
type ProviderSurfaceTest = Assert<
  Equal<keyof InfraProvider, "providerName" | "getProgram">
>;

// ============================================================================
// State backend
// ============================================================================

// State store may target a different cluster/database/collection
type StateStoreKeysTest = Assert<
  Equal<keyof StateStoreOptions, "uri" | "client" | "database" | "collection">
>;

// Two-track backend selection is a closed union
type BackendKindsTest = Assert<
  Equal<PulumiBackendKind, "syncLayer" | "native">
>;
type StateDocBackendTest = Assert<
  IsAssignable<InfraStateDoc["backend"], PulumiBackendKind>
>;

export type {
  SecretFactoryTest,
  SecretKindTest,
  ResourceKindsTest,
  SpecDiscriminantsTest,
  ProgramSpecResourcesTest,
  ProviderSurfaceTest,
  StateStoreKeysTest,
  BackendKindsTest,
  StateDocBackendTest,
};
