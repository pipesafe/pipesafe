import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { afterAll, afterEach, beforeAll } from "vitest";

export const useMemoryMongo = async () => {
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
    await client.close();
    // doCleanup removes exactly this instance's own dbPath directory —
    // without it every test run leaks a ~300MB tmp dir. The vitest
    // globalSetup teardown is the backstop for runs that die before this
    // hook fires.
    await memoryReplSet.stop({ doCleanup: true });
  }, 30_000);

  return { memoryReplSet, memoryReplSetUri, client };
};
