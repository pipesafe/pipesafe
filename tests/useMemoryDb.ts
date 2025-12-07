import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { afterAll, afterEach, beforeAll } from "vitest";

export const useMemoryMongoDb = async () => {
  // Create a new in-memory MongoDB instance
  const memoryReplSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
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
