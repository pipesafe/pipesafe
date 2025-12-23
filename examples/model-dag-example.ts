/**
 * Example: DAG Pipeline Composition with TMModel and TMProject
 *
 * This example demonstrates how to:
 * 1. Define typed models with different materialization strategies
 * 2. Chain models into a DAG
 * 3. Execute models in dependency order
 */

import { TMCollection, TMProject, createModel } from "../src";

// ============================================================================
// Define Source Collections (your existing MongoDB collections)
// ============================================================================

type RawEvent = {
  _id: string;
  eventType: string;
  timestamp: Date;
  userId: string;
  data: Record<string, unknown>;
  _deleted?: boolean;
};

const RawEventsCollection = new TMCollection<RawEvent>({
  collectionName: "raw_events",
});

// ============================================================================
// Define Models
// ============================================================================

/**
 * Staging model - filters out deleted events and adds eventDate.
 * Uses 'collection' materialization with 'replace' mode.
 */
const stgEvents = createModel({
  name: "stg_events",
  from: RawEventsCollection,
  pipeline: (p) =>
    p
      .match({ _deleted: { $ne: true } })
      .set({
        eventDate: {
          $dateTrunc: { date: "$timestamp", unit: "day" },
        },
      })
      .project({
        _id: 1,
        eventType: 1,
        timestamp: 1,
        userId: 1,
        eventDate: 1,
      }),
  materialize: {
    type: "collection",
    mode: "replace",
  },
});

/**
 * Daily metrics model - aggregates events by date.
 * Depends on stgEvents (creates DAG edge).
 */
const dailyMetrics = createModel({
  name: "daily_metrics",
  from: stgEvents, // DAG edge! Depends on stgEvents output
  pipeline: (p) =>
    p.group({
      _id: "$eventDate",
      totalEvents: { $count: {} },
      uniqueUsers: { $addToSet: "$userId" },
      eventTypes: { $push: "$eventType" },
    }),
  materialize: {
    type: "collection",
    mode: {
      $merge: {
        on: "_id",
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  },
});

/**
 * User activity model - aggregates user activity stats.
 */
const userActivity = createModel({
  name: "user_activity",
  from: stgEvents,
  pipeline: (p) =>
    p.group({
      _id: "$userId",
      eventCount: { $count: {} },
      lastActivity: { $max: "$timestamp" },
      eventTypes: { $addToSet: "$eventType" },
    }),
  materialize: {
    type: "collection",
    mode: "replace",
  },
});

/**
 * Ephemeral model - not materialized, inlined into downstream models.
 */
const highActivityUsers = createModel({
  name: "high_activity_users",
  from: userActivity,
  pipeline: (p) => p.match({ eventCount: { $gte: 100 } }),
  // No materialize = ephemeral by default
});

// ============================================================================
// Create Project and Register Models
// ============================================================================

const analyticsProject = new TMProject({ name: "analytics" })
  .add(stgEvents)
  .add(dailyMetrics)
  .add(userActivity)
  .add(highActivityUsers);

// ============================================================================
// Usage Examples
// ============================================================================

async function main() {
  console.log("=== DAG Model Example ===\n");

  // 1. Validate the DAG
  const validation = analyticsProject.validate();
  console.log("Validation:", validation.valid ? "✓ Valid" : "✗ Invalid");
  if (!validation.valid) {
    console.log("Errors:", validation.errors);
  }
  if (validation.warnings.length > 0) {
    console.log("Warnings:", validation.warnings);
  }
  console.log();

  // 2. View the execution plan
  console.log("Execution Plan:");
  const plan = analyticsProject.plan();
  console.log(plan.toString());
  console.log();

  // 3. View as Mermaid diagram
  console.log("Mermaid Diagram:");
  console.log(analyticsProject.toMermaid());
  console.log();

  // 4. Inspect individual models
  console.log("Model: stgEvents");
  console.log("  Output collection:", stgEvents.getOutputCollection());
  console.log("  Is ephemeral:", stgEvents.isEphemeral());
  console.log(
    "  Pipeline stages:",
    JSON.stringify(stgEvents.getPipelineStages(), null, 2)
  );
  console.log();

  console.log("Model: dailyMetrics");
  console.log("  Output collection:", dailyMetrics.getOutputCollection());
  console.log("  Depends on model:", dailyMetrics.isSourceModel());
  console.log(
    "  Full pipeline:",
    JSON.stringify(dailyMetrics.buildPipeline(), null, 2)
  );
  console.log();

  // 5. To actually run (requires MongoDB connection):
  // await tmql.connect("mongodb://localhost:27017");
  // const result = await analyticsProject.run({ databaseName: "analytics_db" });
  // console.log("Run result:", result);
}

main().catch(console.error);
