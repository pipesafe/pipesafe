import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { MongoClient } from "mongodb";
import { afterAll, afterEach, expect, inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** URI of the one mongod this run shares. See vitest.globalSetup.ts. */
    memoryMongoUri: string;
  }
}

/**
 * Gives the calling test file its own database on the ONE mongod the run
 * shares, started in vitest.globalSetup.ts.
 *
 * A mongod per suite is process spawning and file work inside `beforeAll`,
 * and vitest's hook budget assumes a hook is cheap. That holds on an idle
 * machine and stops holding under load: a downstream project on these
 * conventions reached 39 suites, so 39 mongods in one run, and once the
 * machine was busy — the pre-commit hook runs the whole suite beside lint and
 * format — files began timing out in rotation. Never an assertion, always a
 * hook, a different file each run, every one of them green when run alone. A
 * gate that fails for reasons unrelated to the change teaches people to step
 * around it, and they did.
 *
 * One server, one database per file. Suites still cannot see each other's
 * data, and because the boundary is now the database rather than the process,
 * `test.isolate` is off (see vitest.config.ts).
 */
export const useMemoryMongo = async () => {
  const databaseName = uniqueDatabaseName();
  const memoryMongoUri = withDatabase(inject("memoryMongoUri"), databaseName);

  const client = new MongoClient(memoryMongoUri);
  await client.connect();

  afterEach(async () => {
    const collections = await client.db().listCollections().toArray();
    for (const collection of collections) {
      await client.db().collection(collection.name).drop();
    }
  });

  afterAll(async () => {
    // The shared instance outlives this file, so the file's database is its
    // own to clean up; the globalSetup teardown frees the dbPath of the whole
    // run as the backstop.
    await client.db().dropDatabase();
    await client.close();
  });

  return { memoryMongoUri, databaseName, client };
};

/**
 * A database name no other test file will pick: the test file's own name, so
 * a stray database says which suite left it, plus a random suffix so that two
 * files of the same name — or the same file re-run in watch mode — never
 * collide.
 */
const uniqueDatabaseName = (): string => {
  const testPath = expect.getState().testPath;
  const stem =
    testPath === undefined ? "suite" : (
      basename(testPath)
        .replace(/[^A-Za-z0-9]+/g, "_")
        .slice(0, 32)
    );
  return `pipesafe_${stem}_${randomUUID().slice(0, 8)}`;
};

/** The same URI, pointed at one database of the shared instance. */
const withDatabase = (uri: string, databaseName: string): string => {
  const url = new URL(uri);
  url.pathname = `/${databaseName}`;
  return url.toString();
};
