/**
 * ChangeSubscription - event-driven manifold (scaffold)
 *
 * Manifold owns transformations; batch execution (Project.run) is the
 * pull-based half, and change-stream subscriptions are the event-driven
 * half: react to changes on any Source's backing collection by invoking a
 * consumer. Intake's "run a fetcher when a webhook envelope lands" is one
 * usecase of this primitive; event-driven transformations mid-DAG (e.g.
 * refreshing a downstream Model when its upstream changes) are the same
 * primitive without intake anywhere in the picture.
 *
 * The full event-driven design (incremental model refresh, subscription
 * placement in the Project DAG, typed change-event schemas) is a dedicated
 * future design pass - see packages/intake/ARCHITECTURE.md "Deferred work".
 */
import type { Document, Source } from "@pipesafe/core";

export type ChangeOperation = "insert" | "update" | "replace" | "delete";

/**
 * A declarative subscription: when the source's backing collection sees a
 * matching change, deliver the event to the named consumer via the
 * configured dispatch strategy.
 */
export interface ChangeSubscription<TDoc extends Document = Document> {
  /** The Source whose backing collection's change stream is watched. */
  source: Source<TDoc>;
  /** Which change-stream operations trigger delivery. Default: insert. */
  operations?: ChangeOperation[];
  /**
   * Logical consumer name, resolved by the runtime (local) or the deployed
   * dispatcher (cloud) to the function that handles the event.
   */
  consumer: string;
}
