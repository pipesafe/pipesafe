import { describe, expect, it } from "vitest";
import { useMemoryMongo } from "../utils/useMemoryMongo";
import { TMCollection } from "../collection/TMCollection";
import { TMModel } from "./TMModel";
import { TMProject } from "../project/TMProject";

// ============================================================================
// Schema Types
// ============================================================================

type RawEvent = {
  _id: string;
  eventType: string;
  timestamp: Date;
  userId: string;
  _deleted?: boolean;
};

// ============================================================================
// Sample Data
// ============================================================================

const sampleEvents: RawEvent[] = [
  {
    _id: "event_001",
    eventType: "page_view",
    timestamp: new Date("2024-01-15T10:00:00Z"),
    userId: "user_001",
  },
  {
    _id: "event_002",
    eventType: "click",
    timestamp: new Date("2024-01-15T11:00:00Z"),
    userId: "user_001",
  },
  {
    _id: "event_003",
    eventType: "page_view",
    timestamp: new Date("2024-01-15T12:00:00Z"),
    userId: "user_002",
  },
  {
    _id: "event_004",
    eventType: "purchase",
    timestamp: new Date("2024-01-16T09:00:00Z"),
    userId: "user_001",
    _deleted: true, // Soft-deleted
  },
  {
    _id: "event_005",
    eventType: "signup",
    timestamp: new Date("2024-01-16T14:00:00Z"),
    userId: "user_003",
  },
];

// ============================================================================
// Model Definitions
// ============================================================================

const RawEventsCollection = new TMCollection<RawEvent>({
  collectionName: "raw_events",
});

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

const dailyMetrics = new TMModel({
  name: "daily_metrics",
  from: stgEvents,
  pipeline: (p) =>
    p.group({
      _id: "$eventDate",
      totalEvents: { $count: {} },
      uniqueUsers: { $addToSet: "$userId" },
    }),
  materialize: {
    type: "collection",
    mode: TMModel.Mode.Upsert,
  },
});

const userActivity = new TMModel({
  name: "user_activity",
  from: stgEvents,
  pipeline: (p) =>
    p.group({
      _id: "$userId",
      eventCount: { $count: {} },
      lastActivity: { $max: "$timestamp" },
    }),
  materialize: {
    type: "collection",
    mode: TMModel.Mode.Replace,
  },
});

const analyticsProject = new TMProject({
  name: "analytics",
  models: [stgEvents, dailyMetrics, userActivity],
});

describe("TMModel", () => {
  describe("Model Configuration", () => {
    it("should return correct output collection name", () => {
      expect(stgEvents.getOutputCollectionName()).toBe("stg_events");
      expect(dailyMetrics.getOutputCollectionName()).toBe("daily_metrics");
    });

    it("should identify source model vs collection", () => {
      expect(stgEvents.isSourceModel()).toBe(false);
      expect(dailyMetrics.isSourceModel()).toBe(true);
    });

    it("should get upstream model when source is a model", () => {
      expect(stgEvents.getUpstreamModel()).toBeUndefined();
      expect(dailyMetrics.getUpstreamModel()).toBe(stgEvents);
    });
  });

  describe("Pipeline Generation", () => {
    it("should generate pipeline stages", () => {
      const stages = stgEvents.getPipelineStages();
      expect(stages).toHaveLength(3); // match, set, project
      expect(stages[0]).toHaveProperty("$match");
      expect(stages[1]).toHaveProperty("$set");
      expect(stages[2]).toHaveProperty("$project");
    });

    it("should build complete pipeline with output stage", () => {
      const pipeline = stgEvents.buildPipeline();
      expect(pipeline).toHaveLength(4); // match, set, project, $out
      expect(pipeline[3]).toHaveProperty("$out", "stg_events");
    });

    it("should use $merge for upsert mode", () => {
      const pipeline = dailyMetrics.buildPipeline();
      const lastStage = pipeline[pipeline.length - 1];
      expect(lastStage).toHaveProperty("$merge");
    });
  });

  describe("Project", () => {
    it("should create valid execution plan", () => {
      const plan = analyticsProject.plan();
      expect(plan.stages).toHaveLength(2);
      expect(plan.stages[0]).toContain("stg_events");
      expect(plan.stages[1]).toContain("daily_metrics");
      expect(plan.stages[1]).toContain("user_activity");
    });

    it("should generate valid Mermaid syntax", () => {
      const mermaid = analyticsProject.toMermaid();
      expect(mermaid).toContain("graph TD");
      expect(mermaid).toContain("stg_events");
      expect(mermaid).toContain("daily_metrics");
      expect(mermaid).toContain("user_activity");
      expect(mermaid).toContain("stg_events --> daily_metrics");
      expect(mermaid).toContain("stg_events --> user_activity");
    });
  });
});

describe("TMModel Integration", async () => {
  const { client } = await useMemoryMongo();

  it("should run all models and materialize output", async () => {
    const db = client.db();

    // Insert sample data
    await db.collection<RawEvent>("raw_events").insertMany(sampleEvents);

    const result = await analyticsProject.run({
      client,
      databaseName: db.databaseName,
    });

    expect(result.success).toBe(true);
    expect(result.modelsRun).toContain("stg_events");
    expect(result.modelsRun).toContain("daily_metrics");
    expect(result.modelsRun).toContain("user_activity");

    // Verify stg_events filtered out deleted event
    const stgCount = await db.collection("stg_events").countDocuments();
    expect(stgCount).toBe(4); // 5 events - 1 deleted

    // Verify daily_metrics aggregated by date
    const dailyCount = await db.collection("daily_metrics").countDocuments();
    expect(dailyCount).toBe(2); // 2 distinct dates

    // Verify user_activity aggregated by user
    const userCount = await db.collection("user_activity").countDocuments();
    expect(userCount).toBe(3); // 3 distinct users
  });
});
