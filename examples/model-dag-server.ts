/**
 * In-memory MongoDB server for testing the DAG model example
 *
 * Run with: bun run examples/model-dag-server.ts
 *
 * Then connect with MongoDB Compass using the URI printed to console.
 * Press Ctrl+C to stop the server.
 */

declare const process: {
  on: (event: string, handler: () => void) => void;
  exit: (code: number) => void;
};

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { TMCollection, TMProject } from "../src";

// ============================================================================
// Schema Types
// ============================================================================

type RawEvent = {
  _id: string;
  eventType: string;
  timestamp: Date;
  userId: string;
  data: Record<string, unknown>;
  _deleted?: boolean;
};

// ============================================================================
// Sample Data Generator
// ============================================================================

function generateSampleEvents(count: number): RawEvent[] {
  const eventTypes = [
    "page_view",
    "click",
    "purchase",
    "signup",
    "logout",
  ] as const;
  const users = [
    "user_001",
    "user_002",
    "user_003",
    "user_004",
    "user_005",
  ] as const;
  const events: RawEvent[] = [];

  const now = new Date();

  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(Math.random() * 14); // Random day in last 2 weeks
    const hoursAgo = Math.floor(Math.random() * 24);
    const timestamp = new Date(now);
    timestamp.setDate(timestamp.getDate() - daysAgo);
    timestamp.setHours(timestamp.getHours() - hoursAgo);

    events.push({
      _id: `event_${String(i).padStart(5, "0")}`,
      eventType: eventTypes[Math.floor(Math.random() * eventTypes.length)]!,
      timestamp,
      userId: users[Math.floor(Math.random() * users.length)]!,
      data: {
        page: `/page/${Math.floor(Math.random() * 10)}`,
        referrer: Math.random() > 0.5 ? "google" : "direct",
      },
      // ~10% of events are soft-deleted
      ...(Math.random() < 0.1 ? { _deleted: true } : {}),
    });
  }

  return events;
}

// ============================================================================
// Model Definitions using project.model() factory pattern
// ============================================================================

const RawEventsCollection = new TMCollection<RawEvent>({
  collectionName: "raw_events",
});

// Create project first, then define models on it
const analyticsProject = new TMProject({ name: "analytics" });

// Models are created AND registered in one step using project.model()
const stgEvents = analyticsProject.model({
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

analyticsProject.model({
  name: "daily_metrics",
  from: stgEvents, // Type-safe reference to upstream model
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

analyticsProject.model({
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

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("🚀 Starting MongoDB Memory Server...\n");

  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27018, // Use a specific port so Compass can reconnect
    },
  });

  const uri = mongod.getUri();
  console.log("═".repeat(60));
  console.log("📡 MongoDB Connection URI:");
  console.log(`   ${uri}`);
  console.log("═".repeat(60));
  console.log("\n🔗 Connect with MongoDB Compass using the URI above\n");

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db("analytics_db");

  // Insert sample data
  console.log("📦 Inserting sample data...");
  const sampleEvents = generateSampleEvents(200);
  await db.collection<RawEvent>("raw_events").insertMany(sampleEvents);
  console.log(`   ✓ Inserted ${sampleEvents.length} raw events`);
  console.log(
    `   ✓ ~${sampleEvents.filter((e) => e._deleted).length} are soft-deleted\n`
  );

  // Validate the DAG
  console.log("📋 Validating DAG...");
  const validation = analyticsProject.validate();
  if (!validation.valid) {
    console.log("   ✗ Validation failed:", validation.errors);
    return;
  }
  console.log("   ✓ DAG is valid\n");

  // Show execution plan
  console.log("📋 Execution Plan:");
  console.log(analyticsProject.plan().toString());
  console.log();

  // Show Mermaid diagram
  console.log("📊 DAG Diagram (Mermaid):");
  console.log(analyticsProject.toMermaid());
  console.log();

  // Run all models using project.run()
  console.log("⚙️  Running models via project.run()...\n");
  const result = await analyticsProject.run({
    client,
    databaseName: "analytics_db",
    onModelStart: (name) => console.log(`   ▶ Starting ${name}...`),
    onModelComplete: (name, stats) =>
      console.log(`   ✓ Completed ${name} (${stats.durationMs}ms)`),
    onModelError: (name, error) =>
      console.log(`   ✗ Failed ${name}: ${error.message}`),
  });

  // Get counts for summary
  const stgCount = await db.collection("stg_events").countDocuments();
  const dailyCount = await db.collection("daily_metrics").countDocuments();
  const userCount = await db.collection("user_activity").countDocuments();

  // Summary
  console.log();
  console.log("═".repeat(60));
  console.log(
    `✅ Project run ${result.success ? "succeeded" : "failed"} in ${result.totalDurationMs}ms`
  );
  console.log(
    `   Models run: ${result.modelsRun.length} (${result.modelsRun.join(", ")})`
  );
  if (result.modelsFailed.length > 0) {
    console.log(`   Models failed: ${result.modelsFailed.join(", ")}`);
  }
  console.log();
  console.log("Collections in analytics_db:");
  console.log("   • raw_events      - Source data (200 events)");
  console.log(
    `   • stg_events      - Staged events (${stgCount} after filtering)`
  );
  console.log(`   • daily_metrics   - Daily aggregates (${dailyCount} days)`);
  console.log(`   • user_activity   - Per-user stats (${userCount} users)`);
  console.log("═".repeat(60));
  console.log("\n🔍 Open MongoDB Compass and explore the collections!");
  console.log("   Press Ctrl+C to stop the server.\n");

  // Keep the server running
  await new Promise(() => {}); // Never resolves - keeps process alive
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...");
  process.exit(0);
});

main().catch(console.error);
