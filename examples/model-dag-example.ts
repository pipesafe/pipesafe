/**
 * Example: DAG Pipeline Composition with TMModel and TMProject
 *
 * This example demonstrates how to:
 * 1. Define typed models with different materialization strategies
 * 2. Chain models into a DAG
 * 3. Execute models in dependency order
 * 4. Use lookup stages to join data from different sources
 */

import { TMCollection, TMModel, TMProject } from "../src";

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

type User = {
  _id: string;
  email: string;
  name: string;
  createdAt: Date;
  plan: "free" | "pro" | "enterprise";
};

const UsersCollection = new TMCollection<User>({
  collectionName: "users",
});

// ============================================================================
// Define Models (standalone, not registered to a project)
// ============================================================================

/**
 * Staging model - filters out deleted events and adds eventDate.
 * Uses 'collection' materialization with $out (replace).
 */
const stgEvents = new TMModel({
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
    mode: TMModel.Mode.Replace,
  },
});

/**
 * Daily metrics model - aggregates events by date.
 * Depends on stgEvents (creates DAG edge).
 */
const dailyMetrics = new TMModel({
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
    mode: TMModel.Mode.Upsert,
  },
});

/**
 * User activity model - aggregates user activity stats.
 */
const userActivity = new TMModel({
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
    mode: TMModel.Mode.Replace,
  },
});

/**
 * Enriched user activity model - joins user activity with user details.
 * Uses lookup stage to fetch user profile information.
 * Depends on userActivity (creates another DAG edge).
 */
const enrichedUserActivity = new TMModel({
  name: "enriched_user_activity",
  from: userActivity, // DAG edge! Depends on userActivity output
  pipeline: (p) =>
    p
      .lookup({
        from: UsersCollection,
        localField: "_id", // userId from userActivity
        foreignField: "_id", // _id from users collection
        as: "userDetails",
        // Optional: sub-pipeline to select only needed fields from users
        pipeline: (userPipeline) =>
          userPipeline.project({
            _id: 0,
            name: 1,
            email: 1,
            plan: 1,
          }),
      })
      // Project final shape - userDetails is an array (MongoDB's lookup behavior)
      .project({
        _id: 1,
        eventCount: 1,
        lastActivity: 1,
        eventTypes: 1,
        userDetails: 1, // Array of matched user documents
      }),
  materialize: {
    type: "collection",
    mode: TMModel.Mode.Replace,
  },
});

// ============================================================================
// Create Project with Models
// ============================================================================

// Only specify leaf models - all dependencies are auto-discovered:
// - stgEvents is discovered via dailyMetrics.from and userActivity.from
// - userActivity is discovered via enrichedUserActivity.from
// - UsersCollection is discovered via enrichedUserActivity's lookup stage
const analyticsProject = new TMProject({
  name: "analytics",
  models: [dailyMetrics, enrichedUserActivity],
});

// ============================================================================
// Usage Examples
// ============================================================================

console.log("=== DAG Model Example ===\n");

// View the execution plan
console.log("Execution Plan:");
const plan = analyticsProject.plan();
console.log(plan.toString());
console.log();

// View as Mermaid diagram
console.log("Mermaid Diagram:");
console.log(analyticsProject.toMermaid());
console.log();

// Inspect individual models
console.log("Model: stgEvents");
console.log("  Output collection:", stgEvents.getOutputCollectionName());
console.log(
  "  Pipeline stages:",
  JSON.stringify(stgEvents.getPipelineStages(), null, 2)
);
console.log();

console.log("Model: dailyMetrics");
console.log("  Output collection:", dailyMetrics.getOutputCollectionName());
console.log("  Depends on model:", dailyMetrics.sourceIsModel());
console.log(
  "  Full pipeline:",
  JSON.stringify(dailyMetrics.buildPipeline(), null, 2)
);
console.log();

console.log("Model: enrichedUserActivity (with lookup)");
console.log(
  "  Output collection:",
  enrichedUserActivity.getOutputCollectionName()
);
console.log("  Depends on model:", enrichedUserActivity.sourceIsModel());
console.log(
  "  Pipeline with lookup:",
  JSON.stringify(enrichedUserActivity.buildPipeline(), null, 2)
);
console.log();

// To actually run (requires MongoDB connection):
// await tmql.connect("mongodb://localhost:27017");
// const result = await analyticsProject.run({ databaseName: "analytics_db" });
// console.log("Run result:", result);
