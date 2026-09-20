/**
 * Pulumi state backend with MongoDB as the source of truth
 *
 * Pulumi has no native MongoDB DIY backend (supported: file/S3/GCS/Azure
 * Blob/Postgres), so infra runs a two-track strategy behind one interface:
 *
 * - "syncLayer" (ships first; stock Pulumi CLI): hydrate an ephemeral
 *   `file://` workspace from the state document, run the operation via the
 *   Automation API, persist the stack checkpoint back to MongoDB, release
 *   the lock.
 * - "native" (parallel upstream contribution): a `mongodb://` backend in
 *   pulumi/pulumi implementing `blob.BucketURLOpener`, modeled on the
 *   community Postgres backend (pulumi/pulumi PR #19581 / issue #5632).
 *   Once available in the installed CLI, infra logs in directly and the
 *   syncLayer becomes a fallback.
 *
 * Either way, deployment state lives ONLY in MongoDB - no object-store
 * bucket, no Pulumi Cloud account.
 */
import type { MongoClient } from "mongodb";

/**
 * Where deployment state (Pulumi checkpoints, deploy locks, resume tokens)
 * is stored. Defaults to the data-plane client with `_pipesafe_infra`-scoped
 * collections, but may target a completely different cluster or database
 * (e.g. a dedicated ops cluster). Shaped to map 1:1 onto the native backend
 * URL (`mongodb://…/<db>?collection=…`) once the upstream track lands.
 */
export interface StateStoreOptions {
  /** Connection string for a dedicated state cluster. */
  uri?: string;
  /** Or an existing client (takes precedence over `uri`). */
  client?: MongoClient;
  database?: string;
  collection?: string;
}

export type PulumiBackendKind = "syncLayer" | "native";

/** A Pulumi state backend implementation. Selected automatically. */
export interface PulumiBackend {
  readonly kind: PulumiBackendKind;
}

/** Held for the duration of a deploy; blocks concurrent deploys. */
export interface DeployLock {
  holder: string;
  acquiredAt: Date;
}

/**
 * The per-deployment state document (one per stack) in the state store.
 */
export interface InfraStateDoc {
  /** Stack / deployment name. */
  _id: string;
  /** State schema version. */
  version: number;
  backend: PulumiBackendKind;
  /**
   * Pulumi stack checkpoint JSON (syncLayer track). Stored via GridFS
   * instead when it exceeds the document size limit.
   */
  checkpoint?: string;
  lock?: DeployLock;
  lastDeployedAt?: Date;
  /** @pipesafe/infra version that last wrote this document. */
  packageVersion?: string;
}
