import { describe, expect, it, vi } from "vitest";
import { Db, MongoClient, ReadConcern } from "mongodb";
import { useMemoryMongo } from "../utils/useMemoryMongo";
import { Collection } from "../collection/Collection";
import { Database } from "../database/Database";

type TestDoc = { _id: string; value: number };

const docs: TestDoc[] = [
  { _id: "1", value: 1 },
  { _id: "2", value: 2 },
];

describe("Connection and query options", async () => {
  const { client } = await useMemoryMongo();
  const DBName = client.db().databaseName;

  it("applies DbOptions and CollectionOptions to the driver objects", () => {
    // DbOptions.readConcern requires a ReadConcern instance (unlike
    // CollectionOptions, which accepts the { level } shorthand)
    const db = new Database({
      client,
      databaseName: DBName,
      options: { readConcern: new ReadConcern("majority") },
    });
    const collection = db.collection<TestDoc>("docs", {
      readPreference: "secondaryPreferred",
    });

    const mongoCollection = collection["getCollection"]();
    expect(mongoCollection.readConcern?.level).toBe("majority");
    expect(mongoCollection.readPreference?.mode).toBe("secondaryPreferred");
  });

  it("passes each layer's configured options to the driver at execute", () => {
    const dbOptions = { readConcern: new ReadConcern("majority") };
    const collectionOptions = { readPreference: "secondaryPreferred" } as const;
    const collection = new Collection<TestDoc>({
      client,
      databaseName: DBName,
      collectionName: "inherit_docs",
      dbOptions,
      collectionOptions,
    });

    const dbSpy = vi.spyOn(MongoClient.prototype, "db");
    const collectionSpy = vi.spyOn(Db.prototype, "collection");
    try {
      // Cursor is lazy, so no server round-trip happens here. Each layer's
      // options are set where the layer is created and flow down —
      // execute() takes only the aggregation's own AggregateOptions.
      collection.aggregate().execute();

      expect(dbSpy).toHaveBeenLastCalledWith(DBName, dbOptions);
      expect(collectionSpy).toHaveBeenLastCalledWith(
        "inherit_docs",
        collectionOptions
      );
    } finally {
      dbSpy.mockRestore();
      collectionSpy.mockRestore();
    }
  });

  it("exposes configured options through the Source accessors", () => {
    const dbOptions = { readConcern: new ReadConcern("majority") };
    const collectionOptions = { readPreference: "secondaryPreferred" } as const;
    const collection = new Collection<TestDoc>({
      client,
      collectionName: "accessor_docs",
      dbOptions,
      collectionOptions,
    });

    // Consumers reading a Collection through the Source interface (e.g.
    // manifold's Project) rely on these to honor the configured options
    expect(collection.getOutputDbOptions()).toBe(dbOptions);
    expect(collection.getOutputCollectionOptions()).toBe(collectionOptions);
  });

  it("passes AggregateOptions through Pipeline.execute", async () => {
    const collection = new Collection<TestDoc>({
      client,
      databaseName: DBName,
      collectionName: "agg_docs",
    });
    await collection.insertMany(docs);

    const results = await collection
      .aggregate()
      .match({ value: { $gte: 2 } })
      .execute({
        aggregateOptions: {
          allowDiskUse: true,
          maxTimeMS: 30_000,
          comment: "pipesafe-options-test",
        },
      })
      .toArray();

    expect(results).toEqual([{ _id: "2", value: 2 }]);
  });

  it("supports transactions via aggregateOptions.session", async () => {
    // The collection must exist before the transaction reads from it
    await client.db(DBName).createCollection("txn_docs");
    const collection = new Collection<TestDoc>({
      client,
      databaseName: DBName,
      collectionName: "txn_docs",
    });

    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await collection.insertMany(docs, { session });

        // Uncommitted writes are visible inside the transaction...
        const inTxn = await collection
          .aggregate()
          .execute({ aggregateOptions: { session } })
          .toArray();
        expect(inTxn).toHaveLength(2);

        // ...but not outside of it
        const outsideTxn = await collection.aggregate().execute().toArray();
        expect(outsideTxn).toHaveLength(0);
      });
    } finally {
      await session.endSession();
    }

    const committed = await collection.aggregate().execute().toArray();
    expect(committed).toHaveLength(2);
  });
});
