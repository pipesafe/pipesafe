import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { afterAll, afterEach } from "vitest";

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
  try {
    await client.connect();
  } catch (error) {
    // A failed connect aborts suite collection before the afterAll below
    // is registered, so nothing else would ever stop this replset.
    await memoryReplSet.stop({ doCleanup: true });
    throw error;
  }

  afterEach(async () => {
    const collections = await client.db().listCollections().toArray();
    for (const collection of collections) {
      await client.db().collection(collection.name).drop();
    }
  });

  afterAll(async () => {
    await client.close();
    // doCleanup frees this instance's ~300MB dbPath eagerly — it is what
    // bounds disk across watch-mode reruns, where the globalSetup teardown
    // only fires on watch exit. That teardown covers suites that fail
    // before this hook runs; neither layer survives a hard kill of the
    // vitest main process.
    await memoryReplSet.stop({ doCleanup: true });
  }, 30_000);

  return { memoryReplSet, memoryReplSetUri, client };
};
