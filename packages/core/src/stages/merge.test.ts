import { describe, expect, it, beforeEach } from "vitest";
import { useMemoryMongo } from "../utils/useMemoryMongo";
import { Collection } from "../collection/Collection";

type SourceDoc = {
  _id: string;
  value: number;
  category?: string;
};

type TargetDoc = {
  _id: string;
  value: number;
  category?: string;
  legacy?: string;
};

describe("$merge stage", async () => {
  const { client } = await useMemoryMongo();

  const sourceDocs: SourceDoc[] = [
    { _id: "a", value: 10, category: "x" },
    { _id: "b", value: 20, category: "y" },
    { _id: "c", value: 30, category: "z" },
  ];

  const SOURCE = "merge_source";
  const TARGET = "merge_target";

  beforeEach(async () => {
    await client.db().collection<SourceDoc>(SOURCE).insertMany(sourceDocs);
  });

  describe("emitted stage shape", () => {
    it("emits the $merge document untouched into the pipeline", () => {
      const source = new Collection<SourceDoc>({
        client,
        collectionName: SOURCE,
      });
      const stages = source
        .aggregate()
        .merge({
          into: TARGET,
          on: "_id",
          whenMatched: "merge",
          whenNotMatched: "insert",
        })
        .getPipeline();
      expect(stages).toEqual([
        {
          $merge: {
            into: TARGET,
            on: "_id",
            whenMatched: "merge",
            whenNotMatched: "insert",
          },
        },
      ]);
    });

    it("supports cross-database into via { db, coll }", () => {
      const source = new Collection<SourceDoc>({
        client,
        collectionName: SOURCE,
      });
      const stages = source
        .aggregate()
        .merge({ into: { db: "warehouse", coll: TARGET }, on: "_id" })
        .getPipeline();
      expect(stages).toEqual([
        {
          $merge: {
            into: { db: "warehouse", coll: TARGET },
            on: "_id",
          },
        },
      ]);
    });

    it("supports composite on field arrays and let bindings", () => {
      const source = new Collection<SourceDoc>({
        client,
        collectionName: SOURCE,
      });
      const stages = source
        .aggregate()
        .merge({
          into: TARGET,
          on: ["_id", "category"],
          whenMatched: "replace",
          let: { threshold: 10 },
        })
        .getPipeline();
      expect(stages).toEqual([
        {
          $merge: {
            into: TARGET,
            on: ["_id", "category"],
            whenMatched: "replace",
            let: { threshold: 10 },
          },
        },
      ]);
    });
  });

  describe("MongoDB execution", () => {
    it("whenMatched: 'merge' + whenNotMatched: 'insert' merges fields and inserts new docs", async () => {
      // Pre-seed target with one matching and one extra doc to keep
      const target = client.db().collection<TargetDoc>(TARGET);
      await target.insertMany([
        { _id: "a", value: 999, legacy: "preserved" },
        { _id: "z", value: 1, legacy: "untouched" },
      ]);

      const source = new Collection<SourceDoc>({
        client,
        collectionName: SOURCE,
      });
      const cursor = await source
        .aggregate()
        .merge({
          into: TARGET,
          on: "_id",
          whenMatched: "merge",
          whenNotMatched: "insert",
        })
        .execute();
      // $merge returns no documents from the cursor; consume it to ensure the
      // pipeline actually executed against MongoDB.
      await cursor.toArray();

      const finalDocs = await target.find().sort({ _id: 1 }).toArray();
      expect(finalDocs).toEqual([
        // matched: source value overrides, legacy field preserved
        { _id: "a", value: 10, category: "x", legacy: "preserved" },
        // inserted from source
        { _id: "b", value: 20, category: "y" },
        { _id: "c", value: 30, category: "z" },
        // untouched original
        { _id: "z", value: 1, legacy: "untouched" },
      ]);
    });

    it("whenMatched: 'replace' replaces the entire document", async () => {
      const target = client.db().collection<TargetDoc>(TARGET);
      await target.insertOne({ _id: "a", value: 999, legacy: "will_be_lost" });

      const source = new Collection<SourceDoc>({
        client,
        collectionName: SOURCE,
      });
      const cursor = await source
        .aggregate()
        .merge({
          into: TARGET,
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert",
        })
        .execute();
      await cursor.toArray();

      const replaced = await target.findOne({ _id: "a" });
      // legacy field is gone because the matched doc was fully replaced
      expect(replaced).toEqual({ _id: "a", value: 10, category: "x" });
    });

    it("whenMatched: 'fail' throws when a duplicate is encountered", async () => {
      const target = client.db().collection<TargetDoc>(TARGET);
      await target.insertOne({ _id: "a", value: 999 });

      const source = new Collection<SourceDoc>({
        client,
        collectionName: SOURCE,
      });
      const cursor = await source
        .aggregate()
        .merge({
          into: TARGET,
          on: "_id",
          whenMatched: "fail",
          whenNotMatched: "insert",
        })
        .execute();
      await expect(cursor.toArray()).rejects.toThrow();
    });
  });
});
