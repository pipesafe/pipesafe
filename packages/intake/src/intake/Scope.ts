/**
 * IntakeScope - the only input an intake run takes
 *
 * An intake run is idempotent, so backfill, incremental sync, gap recovery
 * after a missed webhook, replay, and reconciliation are not five features:
 * they are one unit invoked with different scopes. Cadence is then just how
 * often the scope is issued.
 *
 * The union is authoritative: it is what `Intake.run` accepts and what the
 * run ledger records. Handlers receive their own arm (see BatchScope /
 * EventScope) so neither has to narrow something that cannot vary.
 */

/** Relative duration, e.g. "30s", "15m", "6h", "7d". */
export type Duration = `${number}${"s" | "m" | "h" | "d"}`;

export type IntakeScope =
  | {
      kind: "batch";
      /**
       * Absent, or with an absent bound, means unbounded in that direction -
       * so a full sweep is `{ kind: "batch" }` with no window, and there is
       * no separate "all" scope. Schedules declare a `lookback`; the runner
       * resolves it to concrete dates before the handler sees it.
       */
      window?: { from?: Date; to?: Date };
    }
  | {
      kind: "event";
      /**
       * Natural keys to reconcile, extracted from the envelopes claimed
       * since the last dispatch. Deduped across the claimed set, so a burst
       * of N events touching R resources yields one run with R identifiers.
       */
      identifiers: string[];
    };

/** The arm a batch handler receives. */
export type BatchScope = Extract<IntakeScope, { kind: "batch" }>;

/** The arm an event handler receives. */
export type EventScope = Extract<IntakeScope, { kind: "event" }>;
