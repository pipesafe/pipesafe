import { beforeEach, describe, expect, it } from "vitest";
import { useMemoryMongo } from "../utils/useMemoryMongo";
import { Collection } from "../collection/Collection";
import { Pipeline } from "../pipeline/Pipeline";

type Doc = {
  _id: number;
  name: string;
  score: number;
};

const exampleDocs: Doc[] = [
  { _id: 1, name: "a", score: 10 },
  { _id: 2, name: "b", score: 20 },
  { _id: 3, name: "c", score: 30 },
  { _id: 4, name: "d", score: 40 },
  { _id: 5, name: "e", score: 50 },
];

describe("Trivial pipeline stages", async () => {
  const { client } = await useMemoryMongo();
  const DBName = client.db().databaseName;
  const CollectionName = "trivial_stages_collection";

  beforeEach(async () => {
    await client
      .db(DBName)
      .collection<Doc>(CollectionName)
      .insertMany(exampleDocs);
  });

  describe("$limit", () => {
    it("emits a $limit stage with the provided count", () => {
      const pipeline = new Pipeline<Doc>().limit(3);
      expect(pipeline.getPipeline()).toEqual([{ $limit: 3 }]);
    });

    it("returns at most the requested number of documents", async () => {
      const collection = new Collection<Doc>({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const cursor = await collection
        .aggregate()
        .sort({ _id: 1 })
        .limit(2)
        .execute();
      const results = await cursor.toArray();
      expect(results).toEqual([
        { _id: 1, name: "a", score: 10 },
        { _id: 2, name: "b", score: 20 },
      ]);
    });
  });

  describe("$skip", () => {
    it("emits a $skip stage with the provided count", () => {
      const pipeline = new Pipeline<Doc>().skip(2);
      expect(pipeline.getPipeline()).toEqual([{ $skip: 2 }]);
    });

    it("skips the first N documents", async () => {
      const collection = new Collection<Doc>({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const cursor = await collection
        .aggregate()
        .sort({ _id: 1 })
        .skip(3)
        .execute();
      const results = await cursor.toArray();
      expect(results).toEqual([
        { _id: 4, name: "d", score: 40 },
        { _id: 5, name: "e", score: 50 },
      ]);
    });

    it("composes with $limit for paging", async () => {
      const collection = new Collection<Doc>({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const cursor = await collection
        .aggregate()
        .sort({ _id: 1 })
        .skip(1)
        .limit(2)
        .execute();
      const results = await cursor.toArray();
      expect(results).toEqual([
        { _id: 2, name: "b", score: 20 },
        { _id: 3, name: "c", score: 30 },
      ]);
    });
  });

  describe("$sample", () => {
    it("emits a $sample stage with a size option", () => {
      const pipeline = new Pipeline<Doc>().sample({ size: 2 });
      expect(pipeline.getPipeline()).toEqual([{ $sample: { size: 2 } }]);
    });

    it("returns the requested number of documents drawn from the source", async () => {
      const collection = new Collection<Doc>({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().sample({ size: 3 }).execute();
      const results = await cursor.toArray();
      expect(results).toHaveLength(3);
      const ids = new Set(exampleDocs.map((d) => d._id));
      for (const r of results) {
        expect(ids.has(r._id)).toBe(true);
      }
    });
  });

  describe("$count", () => {
    it("emits a $count stage with the supplied field name", () => {
      const pipeline = new Pipeline<Doc>().count("total");
      expect(pipeline.getPipeline()).toEqual([{ $count: "total" }]);
    });

    it("returns a single document with the count under the supplied field name", async () => {
      const collection = new Collection<Doc>({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const cursor = await collection.aggregate().count("total").execute();
      const results = await cursor.toArray();
      expect(results).toEqual([{ total: exampleDocs.length }]);
    });

    it("returns no documents when the input pipeline is empty", async () => {
      const collection = new Collection<Doc>({
        client,
        databaseName: DBName,
        collectionName: CollectionName,
      });
      const cursor = await collection
        .aggregate()
        .match({ name: "does-not-exist" })
        .count("hits")
        .execute();
      const results = await cursor.toArray();
      expect(results).toEqual([]);
    });
  });
});
