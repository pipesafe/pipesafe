import { describe, expect, it, vi } from "vitest";
import { useMemoryMongo } from "../utils/useMemoryMongo";
import { TMCollection } from "../collection/TMCollection";
import { TMModel } from "../model/TMModel";
import { TMProject } from "./TMProject";

type RawDoc = { _id: string; value: number; active?: boolean };

const sampleDocs: RawDoc[] = [
  { _id: "1", value: 10, active: true },
  { _id: "2", value: 20, active: true },
  { _id: "3", value: 30, active: false },
];

describe("TMProject.run()", async () => {
  const { client } = await useMemoryMongo();

  const sourceCollection = new TMCollection<RawDoc>({
    collectionName: "raw_docs",
  });

  const stagingModel = new TMModel({
    name: "staging",
    from: sourceCollection,
    pipeline: (p) => p.match({ active: true }),
    materialize: { type: "collection", mode: TMModel.Mode.Replace },
  });

  const aggregateModel = new TMModel({
    name: "aggregate",
    from: stagingModel,
    pipeline: (p) =>
      p.group({
        _id: null,
        total: { $sum: "$value" },
        count: { $count: {} },
      }),
    materialize: { type: "collection", mode: TMModel.Mode.Replace },
  });

  const project = new TMProject({
    name: "test_project",
    models: [stagingModel, aggregateModel],
  });

  describe("successful execution", () => {
    it("should run all models in order", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const result = await project.run({
        client,
        databaseName: db.databaseName,
      });

      expect(result.success).toBe(true);
      expect(result.modelsRun).toEqual(["staging", "aggregate"]);
      expect(result.modelsFailed).toHaveLength(0);
      expect(result.totalDurationMs).toBeGreaterThan(0);

      // Verify staging filtered correctly (only active docs)
      const stagingDocs = await db.collection("staging").find().toArray();
      expect(stagingDocs).toHaveLength(2);

      // Verify aggregate computed correctly
      const aggregateDocs = await db.collection("aggregate").find().toArray();
      expect(aggregateDocs).toHaveLength(1);
      expect(aggregateDocs[0]?.["total"]).toBe(30); // 10 + 20
      expect(aggregateDocs[0]?.["count"]).toBe(2);
    });
  });

  describe("dry run", () => {
    it("should not execute pipelines in dry run mode", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const result = await project.run({
        client,
        databaseName: db.databaseName,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      // In dry run mode, no models are actually run
      expect(result.modelsRun).toEqual([]);
      expect(result.modelsFailed).toEqual([]);

      // Collections should not exist in dry run
      const collections = await db.listCollections().toArray();
      const collNames = collections.map((c) => c.name);
      expect(collNames).not.toContain("staging");
      expect(collNames).not.toContain("aggregate");
    });
  });

  describe("callbacks", () => {
    it("should call onModelStart for each model", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const onModelStart = vi.fn();

      await project.run({
        client,
        databaseName: db.databaseName,
        onModelStart,
      });

      expect(onModelStart).toHaveBeenCalledTimes(2);
      expect(onModelStart).toHaveBeenCalledWith("staging");
      expect(onModelStart).toHaveBeenCalledWith("aggregate");
    });

    it("should call onModelComplete with stats", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const onModelComplete = vi.fn();

      await project.run({
        client,
        databaseName: db.databaseName,
        onModelComplete,
      });

      expect(onModelComplete).toHaveBeenCalledTimes(2);

      // Check that stats were passed
      const firstCall = onModelComplete.mock.calls[0];
      expect(firstCall).toBeDefined();
      const [firstName, firstStats] = firstCall!;
      expect(firstName).toBe("staging");
      expect(firstStats).toHaveProperty("durationMs");
      expect(firstStats.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("target selection", () => {
    it("should run only specified targets and their dependencies", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const result = await project.run({
        client,
        databaseName: db.databaseName,
        targets: ["aggregate"],
      });

      expect(result.success).toBe(true);
      // Should run staging (dependency) and aggregate (target)
      expect(result.modelsRun).toContain("staging");
      expect(result.modelsRun).toContain("aggregate");
    });

    it("should exclude specified models", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const result = await project.run({
        client,
        databaseName: db.databaseName,
        exclude: ["aggregate"],
      });

      expect(result.success).toBe(true);
      expect(result.modelsRun).toContain("staging");
      expect(result.modelsRun).not.toContain("aggregate");
    });
  });
});
