import { TMCollection, TMPipeline, tmql } from "../src";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useMemoryMongoDb } from "./useMemoryDb";
import { TMDatabase } from "../src/database/TMDatabase";

const exampleDocs = [
  {
    test: "1",
  },
  {
    test: "2",
  },
];

describe("Connections", async () => {
  const { memoryReplSetUri, client } = await useMemoryMongoDb();
  const DBName = await client.db().databaseName;
  const CollectionName = "my_collection";

  beforeEach(async () => {
    await client
      .db(DBName)
      .collection<{ test: string }>(CollectionName)
      .insertMany(exampleDocs);
  });

  describe("Singleton", async () => {
    beforeAll(() => {
      tmql.connect(memoryReplSetUri);
    });

    it("should create a client when connected", async () => {
      expect(tmql.client).toBeDefined();
    });

    it("should pass that client to child databases", async () => {
      const db = tmql.db(DBName);
      expect(db["client"]).toBeDefined();
    });

    it("should pass that client to child databases then collections", async () => {
      const collection = tmql
        .db(DBName)
        .collection<{ test: string }>("my_collection");
      expect(collection["client"]).toBeDefined();
    });

    it("uses a singleton client for collection aggregations", async () => {
      const collection = new TMCollection<{ test: string }>({
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });

  describe("Chained", async () => {
    it("from DB", async () => {
      const db = new TMDatabase({
        client,
        databaseName: DBName,
      });
      const collection = db.collection<{ test: string }>(CollectionName);
      const cursor = await collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });

    it("from collection", async () => {
      const collection = new TMCollection<{ test: string }>({
        client,
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });

  describe("On execution", async () => {
    it("TMCollection's pipeline can be passed a client", async () => {
      const collection = new TMCollection<{ test: string }>({
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().execute({
        client,
      });
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });

    it("TMPipeline can be executed directly", async () => {
      const pipeline = new TMPipeline<{ test: string }>();
      const cursor = await pipeline.execute({
        collectionName: CollectionName,
        client,
      });
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });
});
