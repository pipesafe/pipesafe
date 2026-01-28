import { describe, expect, it } from "vitest";
import { Collection } from "@pipesafe/core";
import { Model, isModel } from "./Model";

type RawEvent = {
  _id: string;
  eventType: string;
  timestamp: Date;
  userId: string;
  _deleted?: boolean;
};

const RawEventsCollection = new Collection<RawEvent>({
  collectionName: "raw_events",
});

const stgEvents = new Model({
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
    mode: Model.Mode.Replace,
  },
});

const dailyMetrics = new Model({
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
    mode: Model.Mode.Upsert,
  },
});

describe("Model", () => {
  describe("Model Configuration", () => {
    it("should return correct output collection name", () => {
      expect(stgEvents.getOutputCollectionName()).toBe("stg_events");
      expect(dailyMetrics.getOutputCollectionName()).toBe("daily_metrics");
    });

    it("should return correct source collection name", () => {
      expect(stgEvents.getSourceCollectionName()).toBe("raw_events");
      expect(dailyMetrics.getSourceCollectionName()).toBe("stg_events");
    });

    it("should identify source model vs collection", () => {
      expect(stgEvents.sourceIsModel()).toBe(false);
      expect(dailyMetrics.sourceIsModel()).toBe(true);
    });

    it("should get upstream model when source is a model", () => {
      expect(stgEvents.getUpstreamModel()).toBeUndefined();
      expect(dailyMetrics.getUpstreamModel()).toBe(stgEvents);
    });

    it("should return undefined for output database when not specified", () => {
      expect(stgEvents.getOutputDatabase()).toBeUndefined();
    });

    it("should return output database when specified", () => {
      const modelWithDb = new Model({
        name: "with_db",
        from: RawEventsCollection,
        pipeline: (p) => p,
        materialize: {
          type: "collection",
          db: "analytics",
          mode: Model.Mode.Replace,
        },
      });
      expect(modelWithDb.getOutputDatabase()).toBe("analytics");
    });

    it("should expose source via getSource()", () => {
      expect(stgEvents.getSource()).toBe(RawEventsCollection);
      expect(dailyMetrics.getSource()).toBe(stgEvents);
    });

    it("should have correct sourceType discriminator", () => {
      expect(stgEvents.sourceType).toBe("model");
      expect(dailyMetrics.sourceType).toBe("model");
    });
  });

  describe("isModel predicate", () => {
    it("should return true for Model instances", () => {
      expect(isModel(stgEvents)).toBe(true);
      expect(isModel(dailyMetrics)).toBe(true);
    });

    it("should return false for Collection instances", () => {
      expect(isModel(RawEventsCollection)).toBe(false);
    });

    it("should return false for non-objects", () => {
      expect(isModel(null)).toBe(false);
      expect(isModel(undefined)).toBe(false);
      expect(isModel("string")).toBe(false);
      expect(isModel(123)).toBe(false);
    });

    it("should return false for objects without sourceType", () => {
      expect(isModel({})).toBe(false);
      expect(isModel({ name: "test" })).toBe(false);
    });

    it("should return false for objects with wrong sourceType", () => {
      expect(isModel({ sourceType: "collection" })).toBe(false);
      expect(isModel({ sourceType: "other" })).toBe(false);
    });
  });

  describe("Mode Presets", () => {
    it("should have Replace mode preset", () => {
      expect(Model.Mode.Replace).toEqual({ $out: {} });
    });

    it("should have Upsert mode preset", () => {
      expect(Model.Mode.Upsert).toEqual({
        $merge: { on: "_id", whenMatched: "replace", whenNotMatched: "insert" },
      });
    });

    it("should have Append mode preset", () => {
      expect(Model.Mode.Append).toEqual({
        $merge: { on: "_id", whenMatched: "fail", whenNotMatched: "insert" },
      });
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

    it("should build complete pipeline with $out for Replace mode", () => {
      const pipeline = stgEvents.buildPipeline();
      expect(pipeline).toHaveLength(4); // match, set, project, $out
      expect(pipeline[3]).toEqual({ $out: "stg_events" });
    });

    it("should build $out with db when database is specified", () => {
      const modelWithDb = new Model({
        name: "with_db",
        from: RawEventsCollection,
        pipeline: (p) => p,
        materialize: {
          type: "collection",
          db: "analytics",
          mode: Model.Mode.Replace,
        },
      });
      const pipeline = modelWithDb.buildPipeline();
      const lastStage = pipeline[pipeline.length - 1];
      expect(lastStage).toEqual({ $out: { db: "analytics", coll: "with_db" } });
    });

    it("should build $merge for Upsert mode", () => {
      const pipeline = dailyMetrics.buildPipeline();
      const lastStage = pipeline[pipeline.length - 1];
      expect(lastStage).toEqual({
        $merge: {
          into: "daily_metrics",
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert",
        },
      });
    });

    it("should build $merge with db when database is specified", () => {
      const modelWithDb = new Model({
        name: "with_db",
        from: RawEventsCollection,
        pipeline: (p) => p,
        materialize: {
          type: "collection",
          db: "analytics",
          mode: Model.Mode.Upsert,
        },
      });
      const pipeline = modelWithDb.buildPipeline();
      const lastStage = pipeline[pipeline.length - 1];
      expect(lastStage).toEqual({
        $merge: {
          into: { db: "analytics", coll: "with_db" },
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert",
        },
      });
    });

    it("should build $merge for Append mode", () => {
      const appendModel = new Model({
        name: "append_only",
        from: RawEventsCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Append },
      });
      const pipeline = appendModel.buildPipeline();
      const lastStage = pipeline[pipeline.length - 1];
      expect(lastStage).toEqual({
        $merge: {
          into: "append_only",
          on: "_id",
          whenMatched: "fail",
          whenNotMatched: "insert",
        },
      });
    });

    it("should not include output stage for view materialization", () => {
      const viewModel = new Model({
        name: "my_view",
        from: RawEventsCollection,
        pipeline: (p) => p.match({ _deleted: { $ne: true } }),
        materialize: { type: "view" },
      });
      const pipeline = viewModel.buildPipeline();
      expect(pipeline).toHaveLength(1); // Just the match stage
      expect(pipeline[0]).toHaveProperty("$match");
    });
  });
});
