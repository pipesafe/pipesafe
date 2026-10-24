import { describe, expect, it, vi } from "vitest";
import {
  Collection as MongoCollection,
  Db,
  MongoClient,
  ReadConcern,
} from "mongodb";
import { useMemoryMongo } from "@pipesafe/test-utils";
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
      db: {
        name: DBName,
        options: { readConcern: new ReadConcern("majority") },
      },
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
    const collection = new Database({
      client,
      db: { name: DBName, options: dbOptions },
    }).collection<TestDoc>("inherit_docs", collectionOptions);

    const dbSpy = vi.spyOn(MongoClient.prototype, "db");
    const collectionSpy = vi.spyOn(Db.prototype, "collection");
    try {
      // Cursor is lazy, so no server round-trip happens here
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

  it("replaces a layer's inherited options when execute re-targets it", () => {
    const collection = new Database({
      client,
      db: {
        name: DBName,
        options: { readConcern: new ReadConcern("majority") },
      },
    }).collection<TestDoc>("inherit_docs", {
      readPreference: "secondaryPreferred",
    });

    const dbSpy = vi.spyOn(MongoClient.prototype, "db");
    const collectionSpy = vi.spyOn(Db.prototype, "collection");
    try {
      collection.aggregate().execute({ collection: { name: "other_docs" } });

      expect(dbSpy).toHaveBeenLastCalledWith(DBName, {
        readConcern: expect.any(ReadConcern),
      });
      expect(collectionSpy).toHaveBeenLastCalledWith("other_docs", undefined);
    } finally {
      dbSpy.mockRestore();
      collectionSpy.mockRestore();
    }
  });

  it("runs a db-less Collection in the execute-time database", () => {
    const collection = new Collection<TestDoc>({
      client,
      collection: { name: "dbless_docs" },
    });

    const dbSpy = vi.spyOn(MongoClient.prototype, "db");
    try {
      collection.aggregate().execute({ db: { name: "elsewhere" } });
      expect(dbSpy).toHaveBeenLastCalledWith("elsewhere", undefined);
    } finally {
      dbSpy.mockRestore();
    }
  });

  it("passes AggregateOptions through Pipeline.execute", async () => {
    const collection = new Database({
      client,
      db: { name: DBName },
    }).collection<TestDoc>("agg_docs");
    await collection.insertMany(docs);

    const aggregateOptions = {
      allowDiskUse: true,
      maxTimeMS: 30_000,
      comment: "pipesafe-options-test",
    };
    const aggregateSpy = vi.spyOn(MongoCollection.prototype, "aggregate");
    try {
      const results = await collection
        .aggregate()
        .match({ value: { $gte: 2 } })
        .execute({ aggregateOptions })
        .toArray();

      expect(results).toEqual([{ _id: "2", value: 2 }]);
      expect(aggregateSpy).toHaveBeenLastCalledWith(
        expect.any(Array),
        aggregateOptions
      );
    } finally {
      aggregateSpy.mockRestore();
    }
  });

  it("supports transactions via aggregateOptions.session", async () => {
    // The collection must exist before the transaction reads from it
    await client.db(DBName).createCollection("txn_docs");
    const collection = new Database({
      client,
      db: { name: DBName },
    }).collection<TestDoc>("txn_docs");

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
