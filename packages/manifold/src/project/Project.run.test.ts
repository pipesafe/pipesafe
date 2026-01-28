import { describe, expect, it, vi } from "vitest";
import { Collection, useMemoryMongo } from "@pipesafe/core";
import { Model } from "../model/Model";
import { Project } from "./Project";
// ============================================================================
// Simple DAG Test Data
// ============================================================================

type RawDoc = { _id: string; value: number; active?: boolean };

const sampleDocs: RawDoc[] = [
  { _id: "1", value: 10, active: true },
  { _id: "2", value: 20, active: true },
  { _id: "3", value: 30, active: false },
];

// ============================================================================
// Complex DAG with Lookup Test Data
// ============================================================================

type Order = { _id: string; userId: string; amount: number };
type User = { _id: string; name: string; tier: string };

const sampleOrders: Order[] = [
  { _id: "order_1", userId: "user_1", amount: 100 },
  { _id: "order_2", userId: "user_1", amount: 200 },
  { _id: "order_3", userId: "user_2", amount: 150 },
];

const sampleUsers: User[] = [
  { _id: "user_1", name: "Alice", tier: "gold" },
  { _id: "user_2", name: "Bob", tier: "silver" },
];

describe("Project.run()", async () => {
  const { client } = await useMemoryMongo();

  // ==========================================================================
  // Simple Linear DAG: source -> staging -> aggregate
  // ==========================================================================

  const sourceCollection = new Collection<RawDoc>({
    collectionName: "raw_docs",
  });

  const stagingModel = new Model({
    name: "staging",
    from: sourceCollection,
    pipeline: (p) => p.match({ active: true }),
    materialize: { type: "collection", mode: Model.Mode.Replace },
  });

  const aggregateModel = new Model({
    name: "aggregate",
    from: stagingModel,
    pipeline: (p) =>
      p.group({
        _id: null,
        total: { $sum: "$value" },
        count: { $count: {} },
      }),
    materialize: { type: "collection", mode: Model.Mode.Replace },
  });

  const simpleProject = new Project({
    name: "simple_project",
    models: [aggregateModel],
  });

  // ==========================================================================
  // Complex DAG with Lookup:
  //   ordersSource -> stgOrders -> enrichedOrders -> orderSummary
  //   usersSource  -> stgUsers  --------^
  // ==========================================================================

  const ordersSource = new Collection<Order>({
    collectionName: "orders",
  });

  const usersSource = new Collection<User>({
    collectionName: "users",
  });

  const stgOrders = new Model({
    name: "stg_orders",
    from: ordersSource,
    pipeline: (p) => p,
    materialize: { type: "collection", mode: Model.Mode.Replace },
  });

  const stgUsers = new Model({
    name: "stg_users",
    from: usersSource,
    pipeline: (p) => p,
    materialize: { type: "collection", mode: Model.Mode.Replace },
  });

  // User groups for testing chained lookup dependencies
  const userGroupsSource = new Collection<{ _id: string; groupName: string }>({
    collectionName: "user_groups",
  });

  const stgUserGroups = new Model({
    name: "stg_user_groups",
    from: userGroupsSource,
    pipeline: (p) => p,
    materialize: { type: "collection", mode: Model.Mode.Replace },
  });

  const enrichedOrders = new Model({
    name: "enriched_orders",
    from: stgOrders,
    pipeline: (p) =>
      p.lookup({
        from: stgUsers,
        localField: "userId",
        foreignField: "_id",
        as: "user",
        // Sub-pipeline with its own lookup - tests chained dependency discovery
        pipeline: (userPipeline) =>
          userPipeline.lookup({
            from: stgUserGroups,
            localField: "_id",
            foreignField: "_id",
            as: "groups",
          }),
      }),
    materialize: { type: "collection", mode: Model.Mode.Replace },
  });

  const orderSummary = new Model({
    name: "order_summary",
    from: enrichedOrders,
    pipeline: (p) =>
      p.group({
        _id: null,
        totalOrders: { $count: {} },
        totalAmount: { $sum: "$amount" },
      }),
    materialize: { type: "collection", mode: Model.Mode.Replace },
  });

  const complexProject = new Project({
    name: "complex_project",
    models: [orderSummary],
  });

  describe("successful execution", () => {
    it("should run simple linear DAG", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const result = await simpleProject.run({
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

    it("should run complex DAG with model-to-model lookup", async () => {
      const db = client.db();

      // Insert source data
      await db.collection<Order>("orders").insertMany(sampleOrders);
      await db.collection<User>("users").insertMany(sampleUsers);

      const result = await complexProject.run({
        client,
        databaseName: db.databaseName,
      });

      expect(result.success).toBe(true);
      // All 5 models should run (includes stg_user_groups from chained lookup)
      expect(result.modelsRun).toHaveLength(5);
      expect(result.modelsRun).toContain("stg_orders");
      expect(result.modelsRun).toContain("stg_users");
      expect(result.modelsRun).toContain("stg_user_groups");
      expect(result.modelsRun).toContain("enriched_orders");
      expect(result.modelsRun).toContain("order_summary");

      // stg_users must run before enriched_orders (lookup dependency)
      const stgUsersIdx = result.modelsRun.indexOf("stg_users");
      const enrichedIdx = result.modelsRun.indexOf("enriched_orders");
      expect(stgUsersIdx).toBeLessThan(enrichedIdx);

      // stg_user_groups must run before enriched_orders (chained lookup dependency)
      const stgUserGroupsIdx = result.modelsRun.indexOf("stg_user_groups");
      expect(stgUserGroupsIdx).toBeLessThan(enrichedIdx);

      // Verify enriched orders have user data
      const enriched = await db.collection("enriched_orders").find().toArray();
      expect(enriched).toHaveLength(3);
      // Each order should have a 'user' array from the lookup
      expect(enriched[0]).toHaveProperty("user");

      // Verify summary
      const summary = await db.collection("order_summary").find().toArray();
      expect(summary).toHaveLength(1);
      expect(summary[0]?.["totalOrders"]).toBe(3);
      expect(summary[0]?.["totalAmount"]).toBe(450); // 100 + 200 + 150
    });
  });

  describe("dry run", () => {
    it("should not execute pipelines in dry run mode", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      const result = await simpleProject.run({
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

      await simpleProject.run({
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

      await simpleProject.run({
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

      const result = await simpleProject.run({
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

      const result = await simpleProject.run({
        client,
        databaseName: db.databaseName,
        exclude: ["aggregate"],
      });

      expect(result.success).toBe(true);
      expect(result.modelsRun).toContain("staging");
      expect(result.modelsRun).not.toContain("aggregate");
    });
  });

  describe("output schema validation", () => {
    it("stagingModel output matches exact expected documents", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      await simpleProject.run({
        client,
        databaseName: db.databaseName,
      });

      const stagingDocs = await db
        .collection("staging")
        .find()
        .sort({ _id: 1 })
        .toArray();

      // Verify exact output - only active docs pass through
      expect(stagingDocs).toHaveLength(2);
      expect(stagingDocs).toEqual([
        { _id: "1", value: 10, active: true },
        { _id: "2", value: 20, active: true },
      ]);
    });

    it("aggregateModel output matches exact expected documents", async () => {
      const db = client.db();
      await db.collection<RawDoc>("raw_docs").insertMany(sampleDocs);

      await simpleProject.run({
        client,
        databaseName: db.databaseName,
      });

      const aggregateDocs = await db.collection("aggregate").find().toArray();

      // Verify exact output - sum of 10 + 20 = 30, count = 2
      expect(aggregateDocs).toHaveLength(1);
      expect(aggregateDocs).toEqual([{ _id: null, total: 30, count: 2 }]);
    });

    it("enrichedOrders output matches exact expected documents", async () => {
      const db = client.db();
      await db.collection<Order>("orders").insertMany(sampleOrders);
      await db.collection<User>("users").insertMany(sampleUsers);

      await complexProject.run({
        client,
        databaseName: db.databaseName,
      });

      const enrichedDocs = await db
        .collection("enriched_orders")
        .find()
        .sort({ _id: 1 })
        .toArray();

      // Verify exact output - orders with user lookup (user has nested groups from chained lookup)
      expect(enrichedDocs).toHaveLength(3);
      expect(enrichedDocs).toEqual([
        {
          _id: "order_1",
          userId: "user_1",
          amount: 100,
          user: [{ _id: "user_1", name: "Alice", tier: "gold", groups: [] }],
        },
        {
          _id: "order_2",
          userId: "user_1",
          amount: 200,
          user: [{ _id: "user_1", name: "Alice", tier: "gold", groups: [] }],
        },
        {
          _id: "order_3",
          userId: "user_2",
          amount: 150,
          user: [{ _id: "user_2", name: "Bob", tier: "silver", groups: [] }],
        },
      ]);
    });

    it("orderSummary output matches exact expected documents", async () => {
      const db = client.db();
      await db.collection<Order>("orders").insertMany(sampleOrders);
      await db.collection<User>("users").insertMany(sampleUsers);

      await complexProject.run({
        client,
        databaseName: db.databaseName,
      });

      const summaryDocs = await db.collection("order_summary").find().toArray();

      // Verify exact output - 3 orders totaling 100 + 200 + 150 = 450
      expect(summaryDocs).toHaveLength(1);
      expect(summaryDocs).toEqual([
        { _id: null, totalOrders: 3, totalAmount: 450 },
      ]);
    });
  });
});
