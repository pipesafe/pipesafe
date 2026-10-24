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

  describe("Singleton", () => {
    beforeAll(() => {
      pipesafe.connect(memoryMongoUri);
    });

    // The singleton holds its own MongoClient, which is not the one
    // `useMemoryMongo` closes. Left open it outlives the file.
    afterAll(async () => {
      await pipesafe.close();
    });

    it("should create a client when connected", () => {
      expect(pipesafe.client).toBeDefined();
    });

    it("should pass that client to child databases", () => {
      const db = pipesafe.db(DBName);
      expect(db["client"]).toBeDefined();
    });

    it("should pass that client to child databases then collections", () => {
      const collection = pipesafe
        .db(DBName)
        .collection<{ test: string }>("my_collection");
      expect(collection["client"]).toBeDefined();
    });

    it("uses a singleton client for collection aggregations", async () => {
      const collection = new Collection<{ test: string }>({
        collectionName: CollectionName,
      });
      const cursor = collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });

  describe("Chained", () => {
    it("from DB", async () => {
      const db = new Database({
        client,
        databaseName: DBName,
      });
      const collection = db.collection<{ test: string }>(CollectionName);
      const cursor = collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });

    it("from collection", async () => {
      const collection = new Collection<{ test: string }>({
        client,
        collectionName: CollectionName,
      });
      const cursor = collection.aggregate().execute();
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });

  describe("On execution", () => {
    it("Collection's pipeline can be passed a client", async () => {
      const collection = new Collection<{ test: string }>({
        collectionName: CollectionName,
      });
      const cursor = collection.aggregate().execute({
        client,
      });
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });

    it("Pipeline can be executed directly", async () => {
      const pipeline = new Pipeline<{ test: string }>();
      const cursor = pipeline.execute({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const results = await cursor.toArray();
      expect(results).toEqual(exampleDocs);
    });
  });
});
