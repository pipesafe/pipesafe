import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useMemoryMongo } from "../utils/useMemoryMongo";
import { Collection } from "../collection/Collection";
import { Pipeline } from "../pipeline/Pipeline";
import { Database } from "../database/Database";
import { pipesafe } from "./pipesafe";

const exampleDocs = [
  {
    test: "1",
  },
  {
    test: "2",
  },
];

describe("Connections", async () => {
  const {
    memoryMongoUri,
    client,
    databaseName: DBName,
  } = await useMemoryMongo();
  const CollectionName = "my_collection";

  beforeEach(async () => {
    await client
      .db(DBName)
      .collection<{ test: string }>(CollectionName)
      .insertMany(exampleDocs);
  });

  describe("Singleton", async () => {
    beforeAll(() => {
      pipesafe.connect(memoryMongoUri);
    });

    // The singleton is module state, and with `test.isolate` off the module
    // registry outlives this file: a connection left open here would make the
    // next `connect` throw "Already connected".
    afterAll(async () => {
      await pipesafe.close();
    });

    it("should create a client when connected", async () => {
      expect(pipesafe.client).toBeDefined();
    });

    it("should pass that client to child databases", async () => {
      const db = pipesafe.db(DBName);
      expect(db["client"]).toBeDefined();
    });

    it("should pass that client to child databases then collections", async () => {
      const collection = pipesafe
        .db(DBName)
        .collection<{ test: string }>("my_collection");
      expect(collection["client"]).toBeDefined();
    });

    it("uses a singleton client for collection aggregations", async () => {
      const collection = new Collection<{ test: string }>({
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });

  describe("Chained", async () => {
    it("from DB", async () => {
      const db = new Database({
        client,
        databaseName: DBName,
      });
      const collection = db.collection<{ test: string }>(CollectionName);
      const cursor = await collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });

    it("from collection", async () => {
      const collection = new Collection<{ test: string }>({
        client,
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });

  describe("On execution", async () => {
    it("Collection's pipeline can be passed a client", async () => {
      const collection = new Collection<{ test: string }>({
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().execute({
        client,
      });
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });

    it("Pipeline can be executed directly", async () => {
      const pipeline = new Pipeline<{ test: string }>();
      const cursor = await pipeline.execute({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });
});
