import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { afterAll, afterEach, beforeAll } from "vitest";

export const useMemoryMongo = async () => {
  // Create a new in-memory MongoDB instance
  // Note: Using 7.0.11 as 7.0.14 doesn't exist for ubuntu2204 on MongoDB's CDN
  const memoryReplSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
    binary: {
      version: "7.0.11",
    },
  });
  const memoryReplSetUri = memoryReplSet.getUri();

  const client = new MongoClient(memoryReplSetUri);
  await client.connect();

  beforeAll(async () => {});

  afterEach(async () => {
    const collections = await client.db().listCollections().toArray();
    for (const collection of collections) {
      await client.db().collection(collection.name).drop();
    }
  });

  afterAll(async () => {
    await memoryReplSet.stop({ doCleanup: false });
  }, 30_000);

  return { memoryReplSet, memoryReplSetUri, client };
};
